import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const POINT_VALUES: Record<string, number> = {
  "ES": 50,
  "MES": 5,
  "NQ": 20,
  "MNQ": 2
};

export async function POST(request: Request) {
  // Guard: ensure DB URL is configured
  if (!process.env.POSTGRES_URL) {
    console.error('POSTGRES_URL environment variable is not set');
    return NextResponse.json({ error: 'Server misconfiguration: missing POSTGRES_URL' }, { status: 500 });
  }

  try {
    const authHeader = request.headers.get('authorization');
    const secret = process.env.API_SECRET_TOKEN;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    const {
      instrument,
      action,
      quantity,
      price,
      marker,
      position,
      timestamp,
      executionId,
      orderId
    } = payload;

    // Safely parse numbers — guards against any remaining locale comma separators
    const safeParse = (val: unknown): number => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
      return 0;
    };

    const safePrice    = safeParse(price);
    const safeQuantity = typeof quantity === 'string' ? parseInt(quantity) : Number(quantity);
    const safePosition = typeof position === 'string' ? parseInt(position) : Number(position);
    const isClosingFill = safePosition === 0;

    const sql = neon(process.env.POSTGRES_URL);

    // --- Step 1: Insert execution row (idempotent) ---
    const inserted = await sql`
      INSERT INTO executions (
        execution_id, order_id, instrument, action, quantity, price, position_after, marker, timestamp
      ) VALUES (
        ${executionId || 'manual'}, ${orderId || 'manual'}, ${instrument}, ${action},
        ${safeQuantity}, ${safePrice}, ${safePosition}, ${marker}, ${timestamp}
      )
      ON CONFLICT (execution_id) DO NOTHING
      RETURNING id;
    `;

    // Bug 8 fix: if ON CONFLICT fired (duplicate execution_id), skip trade logic entirely
    if (inserted.length === 0) {
      return NextResponse.json({ success: true, message: 'Duplicate execution ignored' });
    }

    // --- Step 2: Find or create the open trade ---
    const activeTrades = await sql`
      SELECT * FROM trades
      WHERE instrument = ${instrument} AND status = 'OPEN'
      LIMIT 1
    `;

    const trade = activeTrades.length > 0 ? activeTrades[0] : null;

    if (!trade) {
      // No open trade exists — create one
      const tradeId = `trade_${Date.now()}`;
      // timestamp is ISO 8601 from NT8: "2026-05-26T09:30:00.0000000"
      // Store date and time parts directly from the NT8 timestamp (exchange local time)
      const dateOnly = timestamp.substring(0, 10);           // "2026-05-26"
      const timeOnly = timestamp.substring(11, 16);          // "09:30"

      await sql`
        INSERT INTO trades (
          trade_id, date, exchange_time, direction, instrument,
          total_quantity, avg_entry_price, status
        ) VALUES (
          ${tradeId}, ${dateOnly}, ${timeOnly}, ${action}, ${instrument},
          ${safeQuantity}, ${safePrice}, 'OPEN'
        )
      `;

    } else {

      if (marker === 'Entry') {
        // Scale-in: recalculate weighted average entry
        const oldTotalValue  = Number(trade.avg_entry_price) * Number(trade.total_quantity);
        const newTotalQty    = Number(trade.total_quantity) + safeQuantity;
        const newAvgEntry    = (oldTotalValue + safePrice * safeQuantity) / newTotalQty;

        await sql`
          UPDATE trades
          SET total_quantity  = ${newTotalQty},
              avg_entry_price = ${newAvgEntry},
              updated_at      = NOW()
          WHERE id = ${trade.id}
        `;

      } else if (marker === 'Exit') {
        // Bug 7 fix: track how many contracts have already exited using a dedicated column.
        // exited_quantity starts at 0 and accumulates with each partial exit fill.
        const prevExitedQty  = Number(trade.exited_quantity || 0);
        const prevExitValue  = Number(trade.avg_exit_price  || 0) * prevExitedQty;
        const newExitedQty   = prevExitedQty + safeQuantity;
        const newAvgExit     = (prevExitValue + safePrice * safeQuantity) / newExitedQty;

        if (isClosingFill) {
          const ptValue   = POINT_VALUES[instrument] || 1;
          const entryPx   = Number(trade.avg_entry_price);
          let   pnl       = 0;

          if (trade.direction === 'Buy') {
            pnl = (newAvgExit - entryPx) * Number(trade.total_quantity) * ptValue;
          } else {
            pnl = (entryPx - newAvgExit) * Number(trade.total_quantity) * ptValue;
          }

          // Bug 6 fix: parse both times as plain local strings — no UTC offset applied.
          // NT8 sends exchange local time in the ISO string; we strip the timezone suffix
          // and compare them as naive datetimes to get correct duration.
          const stripTz = (iso: string) => iso.replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');
          const startMs = new Date(stripTz(trade.exchange_time_iso || `${trade.date}T${trade.exchange_time}:00`)).getTime();
          const endMs   = new Date(stripTz(timestamp)).getTime();
          const timeInMin = Math.max(1, Math.round((endMs - startMs) / 60000));

          await sql`
            UPDATE trades
            SET avg_exit_price    = ${newAvgExit},
                exited_quantity   = ${newExitedQty},
                pnl               = ${pnl},
                time_in_position_min = ${timeInMin},
                status            = 'CLOSED',
                updated_at        = NOW()
            WHERE id = ${trade.id}
          `;
        } else {
          // Partial exit — update running exit average and exited quantity
          await sql`
            UPDATE trades
            SET avg_exit_price  = ${newAvgExit},
                exited_quantity = ${newExitedQty},
                updated_at      = NOW()
            WHERE id = ${trade.id}
          `;
        }
      }
    }

    return NextResponse.json({ success: true, message: 'Execution processed' });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('API Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
