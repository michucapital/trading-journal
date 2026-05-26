import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

async function ensureTable(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS session_notes (
      id         SERIAL PRIMARY KEY,
      date       DATE        UNIQUE NOT NULL,
      notes      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
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
    await ensureTable(sql);

    await sql`
      INSERT INTO session_notes (date, notes, updated_at)
      VALUES (${date}, ${notes ?? ''}, NOW())
      ON CONFLICT (date)
      DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW()
    `;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Notes save error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
