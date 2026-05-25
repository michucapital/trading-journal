import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const POINT_VALUES: Record<string, number> = {
  "ES": 50,
  "MES": 5,
  "NQ": 20,
  "MNQ": 2
};

// Safely coerce any DB value (string, number, null, undefined) to a finite number
const safeNum = (val: unknown, fallback = 0): number => {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : Number(val);
  return isFinite(n) ? n : fallback;
};

export async function POST(request: Request) {
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
    const { instrument, action, quantity, price, marker, position, timestamp, executionId, orderId } = payload;

    const safePrice    = safeNum(price);
    const safeQuantity = safeNum(quantity);
    const safePosition = safeNum(position);
    const isClosingFill = safePosition === 0;

    const sql = neon(process.env.POSTGRES_URL);

    // Step 1: Insert execution row — idempotent via ON CONFLICT
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

    // If duplicate execution_id, skip trade assembly entirely
    if (inserted.length === 0) {
      return NextResponse.json({ success: true, message: 'Duplicate execution ignored' });
    }

    // Step 2: Find open trade for this instrument
    const activeTrades = await sql`
      SELECT * FROM trades
      WHERE instrument = ${instrument} AND status = 'OPEN'
      LIMIT 1
    `;

    const trade = activeTrades.length > 0 ? activeTrades[0] : null;

    if (!trade) {
      // No open trade — create one from this first entry fill
      const tradeId = `trade_${Date.now()}`;
      const dateOnly = timestamp.substring(0, 10);  // "2026-05-26"
      const timeOnly = timestamp.substring(11, 16); // "09:30"

      await sql`
        INSERT INTO trades (
          trade_id, date, exchange_time, direction, instrument,
          total_quantity, avg_entry_price, exited_quantity, status
        ) VALUES (
          ${tradeId}, ${dateOnly}, ${timeOnly}, ${action}, ${instrument},
          ${safeQuantity}, ${safePrice}, 0, 'OPEN'
        )
      `;

    } else {

      if (marker === 'Entry') {
        // Scale-in: recalculate weighted average entry price
        const prevTotalQty = safeNum(trade.total_quantity);
        const prevAvgEntry = safeNum(trade.avg_entry_price);
        const newTotalQty  = prevTotalQty + safeQuantity;
        const newAvgEntry  = ((prevAvgEntry * prevTotalQty) + (safePrice * safeQuantity)) / newTotalQty;

        await sql`
          UPDATE trades
          SET total_quantity  = ${newTotalQty},
              avg_entry_price = ${newAvgEntry},
              updated_at      = NOW()
          WHERE id = ${trade.id}
        `;

      } else if (marker === 'Exit') {
        // Scale-out: accumulate exit fills into weighted average exit price
        const prevExitedQty = safeNum(trade.exited_quantity, 0); // safe against null/undefined
        const prevAvgExit   = safeNum(trade.avg_exit_price,  0);
        const newExitedQty  = prevExitedQty + safeQuantity;
        const newAvgExit    = ((prevAvgExit * prevExitedQty) + (safePrice * safeQuantity)) / newExitedQty;

        if (isClosingFill) {
          const ptValue  = POINT_VALUES[instrument] || 1;
          const entryPx  = safeNum(trade.avg_entry_price);
          const totalQty = safeNum(trade.total_quantity);
          let   pnl      = 0;

          if (trade.direction === 'Buy') {
            pnl = (newAvgExit - entryPx) * totalQty * ptValue;
          } else {
            pnl = (entryPx - newAvgExit) * totalQty * ptValue;
          }

          // Duration: strip any timezone suffix so JS treats both as naive local datetimes
          const stripTz  = (iso: string) => iso.replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');
          const startMs  = new Date(stripTz(`${trade.date}T${trade.exchange_time}:00`)).getTime();
          const endMs    = new Date(stripTz(timestamp)).getTime();
          const timeInMin = Math.max(1, Math.round((endMs - startMs) / 60000));

          await sql`
            UPDATE trades
            SET avg_exit_price        = ${newAvgExit},
                exited_quantity       = ${newExitedQty},
                pnl                   = ${pnl},
                time_in_position_min  = ${timeInMin},
                status                = 'CLOSED',
                updated_at            = NOW()
            WHERE id = ${trade.id}
          `;
        } else {
          // Partial exit — keep trade OPEN, update running averages
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
