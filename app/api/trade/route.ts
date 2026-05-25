    import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// This is where you set the point values for the instruments you trade
const POINT_VALUES: Record<string, number> = {
  "ES": 50,
  "MES": 5,
  "NQ": 20,
  "MNQ": 2
};

export async function POST(request: Request) {
  try {
    // 1. Security Check: Ensure the request comes from your NinjaTrader
    const authHeader = request.headers.get('authorization');
    const secret = process.env.API_SECRET_TOKEN;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse the payload from NT8
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

    // Connect to Neon Postgres
    const sql = neon(process.env.POSTGRES_URL!);

    // 3. Save raw execution for backup/audit
    await sql`
      INSERT INTO executions (
        execution_id, order_id, instrument, action, quantity, price, position_after, marker, timestamp
      ) VALUES (
        ${executionId || 'manual'}, ${orderId || 'manual'}, ${instrument}, ${action}, ${quantity}, ${price}, ${position}, ${marker}, ${timestamp}
      )
      ON CONFLICT (execution_id) DO NOTHING;
    `;

    // 4. Trade Assembly Logic
    // Find if there is an active trade open for this instrument
    const activeTrades = await sql`
      SELECT * FROM trades 
      WHERE instrument = ${instrument} AND status = 'OPEN'
      LIMIT 1
    `;

    let trade = activeTrades.length > 0 ? activeTrades[0] : null;
    const isClosingFill = position === 0;

    if (!trade) {
      // START OF A NEW TRADE
      const tradeId = `trade_${Date.now()}`;
      // Extract just the date (YYYY-MM-DD)
      const dateOnly = timestamp.split('T')[0];
      // Extract the time (HH:MM)
      const timeOnly = timestamp.split('T')[1].substring(0, 5);

      await sql`
        INSERT INTO trades (
          trade_id, date, exchange_time, direction, instrument, total_quantity, avg_entry_price, status
        ) VALUES (
          ${tradeId}, ${dateOnly}, ${timeOnly}, ${action}, ${instrument}, ${quantity}, ${price}, 'OPEN'
        )
      `;
    } else {
      // UPDATE AN EXISTING TRADE
      
      if (marker === 'Entry') {
        // Adding to the position: Calculate new weighted average entry
        const oldTotalValue = Number(trade.avg_entry_price) * trade.total_quantity;
        const newValueAdded = price * quantity;
        const newTotalQty = trade.total_quantity + quantity;
        const newAvgEntry = (oldTotalValue + newValueAdded) / newTotalQty;

        await sql`
          UPDATE trades 
          SET total_quantity = ${newTotalQty}, 
              avg_entry_price = ${newAvgEntry}, 
              updated_at = NOW()
          WHERE id = ${trade.id}
        `;
      } 
      else if (marker === 'Exit') {
        // Scaling out or closing: Calculate weighted average exit
        const currentExitQty = trade.avg_exit_price ? trade.total_quantity - Math.abs(position) : 0;
        const oldTotalExitValue = Number(trade.avg_exit_price || 0) * currentExitQty;
        const newExitValue = price * quantity;
        const newTotalExitQty = currentExitQty + quantity;
        const newAvgExit = (oldTotalExitValue + newExitValue) / newTotalExitQty;

        if (isClosingFill) {
          // TRADE IS FINISHED
          // Calculate PNL based on direction and instrument point value
          const ptValue = POINT_VALUES[instrument] || 1;
          const entryPx = Number(trade.avg_entry_price);
          let pnl = 0;

          if (trade.direction === 'Buy') {
            pnl = (newAvgExit - entryPx) * trade.total_quantity * ptValue;
          } else {
            pnl = (entryPx - newAvgExit) * trade.total_quantity * ptValue;
          }

          // Calculate time in position (minutes)
          const startTime = new Date(`${trade.date.toISOString().split('T')[0]}T${trade.exchange_time}:00Z`);
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
          // Partial Exit (Trade still open)
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