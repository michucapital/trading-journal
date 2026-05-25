import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const POINT_VALUES: Record<string, number> = {
  "ES": 50,
  "MES": 5,
  "NQ": 20,
  "MNQ": 2
};

// Handle OPTIONS preflight requests (sent by HttpClient before POST)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Allow': 'POST, OPTIONS',
    },
  });
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const secret = process.env.API_SECRET_TOKEN;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Safely parse numbers — guards against locale comma decimal separators
    const safeParse = (val: unknown) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
      return 0;
    };

    const safePrice = safeParse(price);
    const safeQuantity = typeof quantity === 'string' ? parseInt(quantity) : Number(quantity);
    const safePosition = typeof position === 'string' ? parseInt(position) : Number(position);

    const sql = neon(process.env.POSTGRES_URL!);

    await sql`
      INSERT INTO executions (
        execution_id, order_id, instrument, action, quantity, price, position_after, marker, timestamp
      ) VALUES (
        ${executionId || 'manual'}, ${orderId || 'manual'}, ${instrument}, ${action}, ${safeQuantity}, ${safePrice}, ${safePosition}, ${marker}, ${timestamp}
      )
      ON CONFLICT (execution_id) DO NOTHING;
    `;

    const activeTrades = await sql`
      SELECT * FROM trades
      WHERE instrument = ${instrument} AND status = 'OPEN'
      LIMIT 1
    `;

    const trade = activeTrades.length > 0 ? activeTrades[0] : null;
    const isClosingFill = safePosition === 0;

    if (!trade) {
      const tradeId = `trade_${Date.now()}`;
      const dateOnly = timestamp.split('T')[0];
      const timeOnly = timestamp.split('T')[1].substring(0, 5);

      await sql`
        INSERT INTO trades (
          trade_id, date, exchange_time, direction, instrument, total_quantity, avg_entry_price, status
        ) VALUES (
          ${tradeId}, ${dateOnly}, ${timeOnly}, ${action}, ${instrument}, ${safeQuantity}, ${safePrice}, 'OPEN'
        )
      `;
    } else {
      if (marker === 'Entry') {
        const oldTotalValue = Number(trade.avg_entry_price) * trade.total_quantity;
        const newValueAdded = safePrice * safeQuantity;
        const newTotalQty = trade.total_quantity + safeQuantity;
        const newAvgEntry = (oldTotalValue + newValueAdded) / newTotalQty;

        await sql`
          UPDATE trades
          SET total_quantity = ${newTotalQty},
              avg_entry_price = ${newAvgEntry},
              updated_at = NOW()
          WHERE id = ${trade.id}
        `;
      } else if (marker === 'Exit') {
        const currentExitQty = trade.avg_exit_price ? trade.total_quantity - Math.abs(safePosition) : 0;
        const oldTotalExitValue = Number(trade.avg_exit_price || 0) * currentExitQty;
        const newExitValue = safePrice * safeQuantity;
        const newTotalExitQty = currentExitQty + safeQuantity;
        const newAvgExit = (oldTotalExitValue + newExitValue) / newTotalExitQty;

        if (isClosingFill) {
          const ptValue = POINT_VALUES[instrument] || 1;
          const entryPx = Number(trade.avg_entry_price);
          let pnl = 0;

          if (trade.direction === 'Buy') {
            pnl = (newAvgExit - entryPx) * trade.total_quantity * ptValue;
          } else {
            pnl = (entryPx - newAvgExit) * trade.total_quantity * ptValue;
          }

          const startTime = new Date(`${new Date(trade.date).toISOString().split('T')[0]}T${trade.exchange_time}:00Z`);
          const endTime = new Date(timestamp);
          const timeInMin = Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / 60000));

          await sql`
            UPDATE trades
            SET avg_exit_price = ${newAvgExit},
                pnl = ${pnl},
                time_in_position_min = ${timeInMin},
                status = 'CLOSED',
                updated_at = NOW()
            WHERE id = ${trade.id}
          `;
        } else {
          await sql`
            UPDATE trades
            SET avg_exit_price = ${newAvgExit},
                updated_at = NOW()
            WHERE id = ${trade.id}
          `;
        }
      }
    }

    return NextResponse.json({ success: true, message: "Execution processed" });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
