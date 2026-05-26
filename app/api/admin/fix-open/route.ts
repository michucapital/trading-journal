import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * One-shot cleanup endpoint.
 * POST /api/admin/fix-open
 * Marks any OPEN trade whose instrument has no current real position
 * (i.e. position_after = 0 in the most recent execution) as CLOSED with pnl=0.
 *
 * Also accepts: DELETE to hard-delete all OPEN trades for a fresh start.
 *
 * Protected by API_SECRET_TOKEN.
 */
export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: 'No POSTGRES_URL' }, { status: 500 });

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.API_SECRET_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.POSTGRES_URL);

  // Find OPEN trades where the latest execution for that instrument shows position_after = 0
  const stale = await sql`
    SELECT t.id, t.instrument
    FROM trades t
    WHERE t.status = 'OPEN'
    AND EXISTS (
      SELECT 1 FROM executions e
      WHERE e.instrument = t.instrument
        AND e.position_after = 0
        AND e.timestamp = (
          SELECT MAX(e2.timestamp) FROM executions e2 WHERE e2.instrument = t.instrument
        )
    )
  `;

  if (stale.length === 0) {
    return NextResponse.json({ message: 'No stale OPEN trades found.' });
  }

  const ids = stale.map((r: Record<string, unknown>) => r.id as number);

  await sql`
    UPDATE trades
    SET status = 'CLOSED',
        pnl    = COALESCE(pnl, 0),
        updated_at = NOW()
    WHERE id = ANY(${ids})
  `;

  return NextResponse.json({
    message: `Closed ${ids.length} stale trade(s).`,
    affected: stale.map((r: Record<string, unknown>) => ({ id: r.id, instrument: r.instrument })),
  });
}

// Nuclear option: delete all OPEN trades
export async function DELETE(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: 'No POSTGRES_URL' }, { status: 500 });

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.API_SECRET_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.POSTGRES_URL);
  const deleted = await sql`DELETE FROM trades WHERE status = 'OPEN' RETURNING id, instrument`;

  return NextResponse.json({
    message: `Deleted ${deleted.length} OPEN trade(s).`,
    deleted,
  });
}
