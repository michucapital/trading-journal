import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// POST /api/notes
// Body: { date: "2026-05-25", notes: "..." }
// Upserts the session note for a given date.
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

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
