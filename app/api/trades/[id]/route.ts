import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/trades/[id]
// Updates manual-entry fields on a trade. Only the fields included in the body are updated.
export async function PATCH(request: Request, { params }: Params) {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ALLOWED = [
    'setup_name', 'risk_dollars', 'sl_ticks',
    'tp1', 'tp2', 'tp3', 'dex_reached',
    'mfe_ticks', 'mae_ticks', 'rule_adherence', 'notes',
  ] as const;

  type AllowedKey = typeof ALLOWED[number];
  const updates: Partial<Record<AllowedKey, unknown>> = {};
  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const sql = neon(process.env.POSTGRES_URL);

  try {
    await sql`
      UPDATE trades SET
        setup_name       = COALESCE(${updates.setup_name      ?? null}::VARCHAR,  setup_name),
        risk_dollars     = COALESCE(${updates.risk_dollars    ?? null}::NUMERIC,  risk_dollars),
        sl_ticks         = COALESCE(${updates.sl_ticks        ?? null}::INTEGER,  sl_ticks),
        tp1              = COALESCE(${updates.tp1             ?? null}::NUMERIC,  tp1),
        tp2              = COALESCE(${updates.tp2             ?? null}::NUMERIC,  tp2),
        tp3              = COALESCE(${updates.tp3             ?? null}::NUMERIC,  tp3),
        dex_reached      = COALESCE(${updates.dex_reached     ?? null}::BOOLEAN,  dex_reached),
        mfe_ticks        = COALESCE(${updates.mfe_ticks       ?? null}::INTEGER,  mfe_ticks),
        mae_ticks        = COALESCE(${updates.mae_ticks       ?? null}::INTEGER,  mae_ticks),
        rule_adherence   = COALESCE(${updates.rule_adherence  ?? null}::BOOLEAN,  rule_adherence),
        notes            = COALESCE(${updates.notes           ?? null}::TEXT,     notes),
        updated_at       = NOW()
      WHERE id = ${id}
    `;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/trades/[id]
export async function DELETE(_request: Request, { params }: Params) {
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Missing POSTGRES_URL' }, { status: 500 });
  }

  const { id } = await params;
  const sql = neon(process.env.POSTGRES_URL);

  try {
    // Also remove associated executions to keep the DB clean
    const deleted = await sql`
      DELETE FROM trades WHERE id = ${id} RETURNING trade_id
    `;

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const tradeId = deleted[0].trade_id;
    // Best-effort cleanup of executions; ignore errors if table structure differs
    try {
      await sql`DELETE FROM executions WHERE trade_id = ${tradeId}`;
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
