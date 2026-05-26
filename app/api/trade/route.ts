import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const POINT_VALUES: Record<string, number> = {
  ES:  50,
  MES: 5,
  NQ:  20,
  MNQ: 2,
};

const COMMISSION_RT: Record<string, number> = {
  ES:  5.76,
  MES: 1.90,
  NQ:  5.76,
  MNQ: 1.90,
};

const safeNum = (val: unknown, fallback = 0): number => {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : Number(val);
  return isFinite(n) ? n : fallback;
};

/**
 * NT8 sends timestamps like "2026-05-26T02:13:13.5690000" — 7 fractional digits.
 * JavaScript Date only reliably parses up to 3 (milliseconds).
 * We truncate to 3 decimal places before parsing.
 */
function parseNT8Timestamp(raw: string): Date {
  // Normalise: trim to 3 decimal places on seconds, ensure Z suffix
  const normalised = raw
    .replace(/(\d{2}:\d{2}:\d{2}\.\d{0,3})\d*/, '$1') // keep max 3 decimal digits
    .replace(/([+-]\d{2}:\d{2}|Z)?$/, (m) => m || 'Z');  // add Z if no tz
  const d = new Date(normalised);
  if (isNaN(d.getTime())) {
    // Fallback: strip fractional seconds entirely
    const stripped = raw.replace(/\.\d+/, '').replace(/([+-]\d{2}:\d{2}|Z)?$/, (m) => m || 'Z');
    return new Date(stripped);
  }
  return d;
}

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
    const { instrument, action, quantity, price, position, timestamp, executionId, orderId, marker } = payload;

    const safePrice    = safeNum(price);
    const safeQuantity = safeNum(quantity);
    const safePosition = safeNum(position);
    const markerStr    = String(marker || '');

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
        ${markerStr},
        ${String(timestamp)}
      )
      ON CONFLICT (execution_id) DO NOTHING
      RETURNING id;
    `;

    if (inserted.length === 0) {
      return NextResponse.json({ success: true, message: 'Duplicate execution ignored' });
    }

    // ── Step 2: Parse timestamp (handles NT8's 7-decimal format) ─────────────
    const instrKey = String(instrument);
    const tsDate   = parseNT8Timestamp(String(timestamp));
    const dateOnly = tsDate.toISOString().substring(0, 10);
    const timeOnly = tsDate.toISOString().substring(11, 16);

    // ── Step 3: Find open trade for this instrument ───────────────────────────
    const activeTrades = await sql`
      SELECT * FROM trades
      WHERE instrument = ${instrKey} AND status = 'OPEN'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const trade = activeTrades.length > 0 ? activeTrades[0] : null;

    // ── Helper: safely parse a stored HH:MM or HH:MM:SS exchange_time ────────
    function buildStartDate(tradeRow: Record<string, unknown>): Date {
      const dateStr = String(tradeRow.date).substring(0, 10);
      const timeStr = String(tradeRow.exchange_time).substring(0, 5); // HH:MM
      const d = new Date(`${dateStr}T${timeStr}:00Z`);
      return isNaN(d.getTime()) ? tsDate : d; // fallback to current fill time
    }

    // ── Helper: close a trade row ─────────────────────────────────────────────
    async function closeTrade(closeQty: number, closePrice: number, openTrade: Record<string, unknown>) {
      const prevExited  = safeNum(openTrade.exited_quantity, 0);
      const prevAvgExit = safeNum(openTrade.avg_exit_price,  0);
      const newExited   = prevExited + closeQty;
      const newAvgExit  = newExited > 0
        ? ((prevAvgExit * prevExited) + (closePrice * closeQty)) / newExited
        : closePrice;

      const ptValue  = POINT_VALUES[instrKey]  || 1;
      const commRT   = COMMISSION_RT[instrKey] || 0;
      const entryPx  = safeNum(openTrade.avg_entry_price);
      const totalQty = safeNum(openTrade.total_quantity);

      const grossPnl = openTrade.direction === 'Buy'
        ? (newAvgExit - entryPx) * totalQty * ptValue
        : (entryPx - newAvgExit) * totalQty * ptValue;
      const netPnl = grossPnl - commRT * totalQty;

      const startMs   = buildStartDate(openTrade).getTime();
      const endMs     = tsDate.getTime();
      const diffMin   = (endMs - startMs) / 60000;
      // Guard: if diff is negative or NaN (clocks, bad data), default to 1
      const timeInMin = isFinite(diffMin) && diffMin > 0 ? Math.round(diffMin) : 1;

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

    // ── No open trade ─────────────────────────────────────────────────────────
    if (!trade) {
      if (safePosition === 0) {
        return NextResponse.json({ success: true, message: 'Flat fill with no open trade — ignored' });
      }
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

    // ── Open trade exists ─────────────────────────────────────────────────────
    const prevQtyRaw  = safeNum(trade.total_quantity);
    const prevPos     = trade.direction === 'Buy' ? prevQtyRaw : -prevQtyRaw;
    const isFlip      = safePosition !== 0 && ((prevPos > 0 && safePosition < 0) || (prevPos < 0 && safePosition > 0));
    const isClose     = safePosition === 0;
    const isReducing  = !isFlip && !isClose && Math.abs(safePosition) < Math.abs(prevPos);
    const isAdding    = !isFlip && !isClose && !isReducing;

    if (isClose) {
      await closeTrade(safeQuantity, safePrice, trade);
      return NextResponse.json({ success: true, message: 'Trade closed' });
    }

    if (isFlip) {
      const closingQty = Math.abs(prevPos);
      const openingQty = Math.abs(safePosition);
      await closeTrade(closingQty, safePrice, trade);
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
      const prevExited  = safeNum(trade.exited_quantity, 0);
      const prevAvgExit = safeNum(trade.avg_exit_price,  0);
      const newExited   = prevExited + safeQuantity;
      const newAvgExit  = newExited > 0
        ? ((prevAvgExit * prevExited) + (safePrice * safeQuantity)) / newExited
        : safePrice;
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
      const prevAvgPx = safeNum(trade.avg_entry_price);
      const newQty    = prevQtyRaw + safeQuantity;
      const newAvgPx  = ((prevAvgPx * prevQtyRaw) + (safePrice * safeQuantity)) / newQty;
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
