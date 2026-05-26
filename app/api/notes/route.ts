import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET() {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }
  const sql = neon(process.env.POSTGRES_URL);
  const rows = await sql`SELECT * FROM session_notes ORDER BY date DESC`;
  return NextResponse.json({ rows });
}

export async function POST(request: Request) {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }

  let body: { date?: string; notes?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { date, notes } = body;

  if (!date || typeof date !== 'string') {
    return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
  }

  const sql = neon(process.env.POSTGRES_URL);

  try {
    await sql`
      INSERT INTO session_notes (date, notes, updated_at)
      VALUES (${date}, ${notes ?? ''}, NOW())
      ON CONFLICT (date)
      DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW()
    `;
    return NextResponse.json({ success: true, date, notes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('Notes save error:', msg);
    return NextResponse.json({ error: msg, stack, receivedDate: date, receivedNotes: notes }, { status: 500 });
  }
}
