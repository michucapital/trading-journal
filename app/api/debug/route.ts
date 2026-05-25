import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET() {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }
  const sql = neon(process.env.POSTGRES_URL);

  const [trades, executions, openTrades] = await Promise.all([
    sql`SELECT id, trade_id, date, instrument, direction, status, pnl FROM trades ORDER BY id DESC LIMIT 20`,
    sql`SELECT COUNT(*) as count FROM executions`,
    sql`SELECT * FROM trades WHERE status = 'OPEN' LIMIT 10`,
  ]);

  return NextResponse.json({ trades, executions, openTrades });
}

// DELETE /api/debug  — wipe all trades + executions so executions can be replayed
// Protected by API secret
export async function DELETE(request: Request) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.API_SECRET_TOKEN;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.POSTGRES_URL!);
  await sql`DELETE FROM trades`;
  await sql`DELETE FROM executions`;
  return NextResponse.json({ success: true, message: 'All trades and executions wiped' });
}
