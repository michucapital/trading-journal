import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const POINT_VALUES: Record<string, number> = {
  ES:  50,
  MES: 5,
  NQ:  20,
  MNQ: 2,
};

// Roundtrip commission per contract
const COMMISSION_RT: Record<string, number> = {
  ES:  5.76,  // $2.88 x2
  MES: 1.90,  // $0.95 x2
  NQ:  5.76,
  MNQ: 1.90,
};

const safeNum = (val: unknown, fallback = 0): number => {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : Number(val);
  return isFinite(n) ? n : fallback;
};

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Server misconfiguration: missing POSTGRES_URL' }, { status: 500 });
  }

  let payload: Record<string, unknown> = {};

  try {
    const authHeader = request.headers.get('authorization');
    const secret = process.env.API_SECRET_TOKEN;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    payload = await request.json();
    const { instrument, action, quantity, price, position, timestamp, executionId, orderId } = payload;

    const safePrice    = safeNum(price);
    const safeQuantity = safeNum(quantity);
    const safePosition = safeNum(position);

    const sql = neon(process.env.POSTGRES_URL);

    // ── Step 1: Idempotent execution insert ──────────────────────────────────
    const inserted = await sql`
      INSERT INTO executions (
        execution_id, order_id, instrument, action, quantity, price, position_after, marker, timestamp
      ) VALUES (
        ${String(executionId || 'manual')},
        ${String(orderId     || 'manual')},
        ${String(instrument)},
        ${String(action)},
        ${safeQuantity},
        ${safePrice},
        ${safePosition},
        ${''},
        ${String(timestamp)}
      )
      ON CONFLICT (execution_id) DO NOTHING
      RETURNING id;
    `;

    if (inserted.length === 0) {
      return NextResponse.json({ success: true, message: 'Duplicate execution ignored' });
    }

    // ── Step 2: Determine what this fill does to the open trade ───────────────
    //
    // Key insight: we use position_after (signed) to determine everything.
    //   position_after  = 0           → closes the trade fully
    //   position_after  = same sign   → scale-in (adding) or partial exit (reducing)
    //   position_after  = flipped sign → direction flip: close current + open new
    //
    // "action" from NT8 is the fill side (Buy/Sell), not the trade direction.
    // We derive direction from the sign of position_after.

    const instrKey = String(instrument);
    const tsDate   = new Date(String(timestamp));
    const dateOnly = tsDate.toISOString().substring(0, 10);
    const timeOnly = tsDate.toISOString().substring(11, 16);

    const activeTrades = await sql`
      SELECT * FROM trades
      WHERE instrument = ${instrKey} AND status = 'OPEN'
      LIMIT 1
    `;
    const trade = activeTrades.length > 0 ? activeTrades[0] : null;

    // ── No open trade ─────────────────────────────────────────────────────────
    if (!trade) {
      if (safePosition === 0) {
        // Fill that results in flat with no prior trade — ignore
        return NextResponse.json({ success: true, message: 'Flat fill with no open trade — ignored' });
      }

      // Open a fresh trade
      const tradeDirection = safePosition > 0 ? 'Buy' : 'Sell';
      await sql`
        INSERT INTO trades (
          trade_id, date, exchange_time, direction, instrument,
          total_quantity, avg_entry_price, exited_quantity, status
        ) VALUES (
          ${'trade_' + Date.now()},
          ${dateOnly},
          ${timeOnly},
          ${tradeDirection},
          ${instrKey},
          ${safeQuantity},
          ${safePrice},
          ${0},
          ${'OPEN'}
        )
      `;
      return NextResponse.json({ success: true, message: 'New trade opened' });
    }

    // ── There is an open trade ─────────────────────────────────────────────────
    const prevPosition  = safeNum(trade.direction === 'Buy' ? trade.total_quantity : -trade.total_quantity);
    // prevPosition is the signed net position before this fill
    // After this fill it becomes safePosition

    const isFlip        = safePosition !== 0 && (
      (prevPosition > 0 && safePosition < 0) ||
      (prevPosition < 0 && safePosition > 0)
    );
    const isClose       = safePosition === 0;
    const isReducing    = !isFlip && Math.abs(safePosition) < Math.abs(prevPosition);
    const isAdding      = !isFlip && !isClose && !isReducing;

    // Helper: close an open trade row
    async function closeTrade(closeQty: number, closePrice: number, openTrade: Record<string, unknown>) {
      const prevExited  = safeNum(openTrade.exited_quantity, 0);
      const prevAvgExit = safeNum(openTrade.avg_exit_price,  0);
      const newExited   = prevExited + closeQty;
      const newAvgExit  = ((prevAvgExit * prevExited) + (closePrice * closeQty)) / newExited;

      const ptValue  = POINT_VALUES[instrKey]  || 1;
      const commRT   = COMMISSION_RT[instrKey] || 0;
      const entryPx  = safeNum(openTrade.avg_entry_price);
      const totalQty = safeNum(openTrade.total_quantity);

      const grossPnl = openTrade.direction === 'Buy'
        ? (newAvgExit - entryPx) * totalQty * ptValue
        : (entryPx - newAvgExit) * totalQty * ptValue;
      const netPnl = grossPnl - commRT * totalQty;

      const startMs   = new Date(`${String(openTrade.date).substring(0,10)}T${openTrade.exchange_time}:00Z`).getTime();
      const endMs     = tsDate.getTime();
      const timeInMin = Math.max(1, Math.round((endMs - startMs) / 60000));

      await sql`
        UPDATE trades
        SET avg_exit_price       = ${newAvgExit},
            exited_quantity      = ${newExited},
            pnl                  = ${netPnl},
            time_in_position_min = ${timeInMin},
            status               = ${'CLOSED'},
            updated_at           = NOW()
        WHERE id = ${openTrade.id}
      `;
    }

    if (isClose) {
      // Full close
      await closeTrade(safeQuantity, safePrice, trade);
      return NextResponse.json({ success: true, message: 'Trade closed' });
    }

    if (isFlip) {
      // Close the existing trade with the portion that covers it, then open a new one
      const closingQty  = Math.abs(prevPosition);         // qty needed to flatten
      const openingQty  = Math.abs(safePosition);         // remaining qty opens new trade

      await closeTrade(closingQty, safePrice, trade);

      // Open new trade in the flipped direction
      const newDirection = safePosition > 0 ? 'Buy' : 'Sell';
      await sql`
        INSERT INTO trades (
          trade_id, date, exchange_time, direction, instrument,
          total_quantity, avg_entry_price, exited_quantity, status
        ) VALUES (
          ${'trade_' + Date.now()},
          ${dateOnly},
          ${timeOnly},
          ${newDirection},
          ${instrKey},
          ${openingQty},
          ${safePrice},
          ${0},
          ${'OPEN'}
        )
      `;
      return NextResponse.json({ success: true, message: 'Trade flipped' });
    }

    if (isReducing) {
      // Partial exit — update exit avg but don’t close yet
      const prevExited  = safeNum(trade.exited_quantity, 0);
      const prevAvgExit = safeNum(trade.avg_exit_price,  0);
      const newExited   = prevExited + safeQuantity;
      const newAvgExit  = ((prevAvgExit * prevExited) + (safePrice * safeQuantity)) / newExited;

      await sql`
        UPDATE trades
        SET avg_exit_price  = ${newAvgExit},
            exited_quantity = ${newExited},
            updated_at      = NOW()
        WHERE id = ${trade.id}
      `;
      return NextResponse.json({ success: true, message: 'Partial exit recorded' });
    }

    if (isAdding) {
      // Scale-in: add to existing position
      const prevQty    = safeNum(trade.total_quantity);
      const prevAvgPx  = safeNum(trade.avg_entry_price);
      const newQty     = prevQty + safeQuantity;
      const newAvgPx   = ((prevAvgPx * prevQty) + (safePrice * safeQuantity)) / newQty;

      await sql`
        UPDATE trades
        SET total_quantity  = ${newQty},
            avg_entry_price = ${newAvgPx},
            updated_at      = NOW()
        WHERE id = ${trade.id}
      `;
      return NextResponse.json({ success: true, message: 'Scale-in recorded' });
    }

    return NextResponse.json({ success: true, message: 'No action taken' });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('API Error:', msg, '| Payload:', JSON.stringify(payload));
    return NextResponse.json({ error: msg, received: payload }, { status: 500 });
  }
}
