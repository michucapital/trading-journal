import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

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

    const sessionNotes = await sql`
      SELECT date, notes FROM session_notes ORDER BY date DESC
    `;

    const notesMap: Record<string, string> = {};
    for (const row of sessionNotes) {
      notesMap[String(row.date).substring(0, 10)] = row.notes ?? '';
    }

    const days: Record<string, { date: string; sessionNotes: string; trades: unknown[] }> = {};

    for (const t of trades) {
      const d = String(t.date).substring(0, 10);
      if (!days[d]) {
        days[d] = { date: d, sessionNotes: notesMap[d] ?? '', trades: [] };
      }
      // Explicitly cast every numeric field — Neon returns NUMERIC/DECIMAL as strings
      days[d].trades.push({
        ...t,
        date:                 d,
        total_quantity:       toNum(t.total_quantity),
        avg_entry_price:      toNum(t.avg_entry_price),
        avg_exit_price:       toNum(t.avg_exit_price),
        exited_quantity:      toNum(t.exited_quantity),
        pnl:                  toNum(t.pnl),
        time_in_position_min: toNum(t.time_in_position_min),
        risk_dollars:         toNum(t.risk_dollars),
        sl_ticks:             toNum(t.sl_ticks),
        tp1:                  toNum(t.tp1),
        tp2:                  toNum(t.tp2),
        tp3:                  toNum(t.tp3),
        mfe_ticks:            toNum(t.mfe_ticks),
        mae_ticks:            toNum(t.mae_ticks),
      });
    }

    const result = Object.values(days).sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json({ days: result });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
