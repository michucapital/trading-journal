import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// GET /api/trades
// Returns all CLOSED trades ordered newest-day-first, newest-trade-first within each day.
export async function GET() {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }

  const sql = neon(process.env.POSTGRES_URL);

  try {
    const trades = await sql`
      SELECT
        id, trade_id, date, exchange_time, direction, instrument,
        total_quantity, avg_entry_price, avg_exit_price, exited_quantity,
        pnl, time_in_position_min, status,
        setup_name, risk_dollars, sl_ticks,
        tp1, tp2, tp3, dex_reached,
        mfe_ticks, mae_ticks, rule_adherence, notes,
        created_at, updated_at
      FROM trades
      WHERE status = 'CLOSED'
      ORDER BY date DESC, exchange_time DESC
    `;

    // Fetch session notes so the UI can merge them with day groups
    const sessionNotes = await sql`
      SELECT date, notes FROM session_notes ORDER BY date DESC
    `;

    const notesMap: Record<string, string> = {};
    for (const row of sessionNotes) {
      notesMap[String(row.date).substring(0, 10)] = row.notes ?? '';
    }

    // Group trades by date
    const days: Record<string, { date: string; sessionNotes: string; trades: typeof trades }> = {};
    for (const t of trades) {
      const d = String(t.date).substring(0, 10);
      if (!days[d]) {
        days[d] = { date: d, sessionNotes: notesMap[d] ?? '', trades: [] };
      }
      days[d].trades.push(t);
    }

    // Return as array sorted newest-first
    const result = Object.values(days).sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ days: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
