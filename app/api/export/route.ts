import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import type { JournalExport, ExportTrade, ExportSessionNote } from '@/lib/exportSchema';

const bool = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : Boolean(v);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

export async function GET() {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }

  const sql = neon(process.env.POSTGRES_URL);

  try {
    const [tradeRows, noteRows] = await Promise.all([
      sql`
        SELECT
          TO_CHAR(date, 'YYYY-MM-DD') AS date,
          exchange_time, direction, instrument,
          setup_name, total_quantity,
          avg_entry_price, avg_exit_price, pnl,
          time_in_position_min, risk_dollars, sl_ticks,
          tp1, tp2, tp3, dex_reached,
          mfe_ticks, mae_ticks, rule_adherence, notes
        FROM trades
        WHERE status = 'CLOSED'
        ORDER BY date ASC, exchange_time ASC
      `,
      sql`
        SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, notes
        FROM session_notes
        ORDER BY date ASC
      `,
    ]);

    const trades: ExportTrade[] = tradeRows.map(t => ({
      date:                       String(t.date),
      exchange_time:              str(t.exchange_time),
      direction:                  (t.direction === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
      instrument:                 str(t.instrument),
      setup_name:                 str(t.setup_name),
      total_quantity:             num(t.total_quantity),
      avg_entry_price:            num(t.avg_entry_price),
      avg_exit_price:             num(t.avg_exit_price),
      pnl:                        num(t.pnl),
      time_in_position_min:       num(t.time_in_position_min),
      risk_dollars:               num(t.risk_dollars),
      sl_ticks:                   num(t.sl_ticks),
      tp1:                        num(t.tp1),
      tp2:                        num(t.tp2),
      tp3:                        num(t.tp3),
      dex_reached:                bool(t.dex_reached),
      mfe_ticks:                  num(t.mfe_ticks),
      mae_ticks:                  num(t.mae_ticks),
      rule_adherence:             bool(t.rule_adherence),
      notes:                      str(t.notes),
      footprint_name:             null,
      type_of_exit:               null,
      mae_10min_ticks:            null,
      mfe_10min_ticks:            null,
      mae_30min_ticks:            null,
      mfe_30min_ticks:            null,
      all_options_conditions_met: null,
      rule_broken:                null,
      active_management_result:   null,
    }));

    const session_notes: ExportSessionNote[] = noteRows.map(n => ({
      date:  String(n.date),
      type:  'session' as const,
      notes: String(n.notes ?? ''),
    }));

    const payload: JournalExport = {
      version:     1,
      exported_at: new Date().toISOString(),
      trades,
      session_notes,
    };

    const today = new Date().toISOString().slice(0, 10);
    const filename = `journal-${today}.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Export error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
