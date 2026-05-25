import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// One-shot migration endpoint.
// Call once: POST /api/migrate  (requires API_SECRET_TOKEN bearer auth)
// Safe to run multiple times — all statements use IF NOT EXISTS / DO NOTHING.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.API_SECRET_TOKEN;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }

  const sql = neon(process.env.POSTGRES_URL);

  try {
    // --- Manual-entry trade fields ---
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup_name       VARCHAR(120)`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_dollars      NUMERIC(10,2)`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS sl_ticks          INTEGER`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1               NUMERIC(10,4)`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp2               NUMERIC(10,4)`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp3               NUMERIC(10,4)`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS dex_reached       BOOLEAN`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe_ticks         INTEGER`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae_ticks         INTEGER`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS rule_adherence    BOOLEAN`;
    await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS notes             TEXT`;

    // --- Session notes (one row per trading day) ---
    await sql`
      CREATE TABLE IF NOT EXISTS session_notes (
        id         SERIAL PRIMARY KEY,
        date       DATE        UNIQUE NOT NULL,
        notes      TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    return NextResponse.json({ success: true, message: 'Migration complete' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
