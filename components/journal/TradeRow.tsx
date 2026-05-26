'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, Save } from 'lucide-react';
import type { Trade } from '@/types/journal';

const SETUPS = [
  'ICT BPR', 'ICT OTE', 'ICT FVG Retest', 'ICT Breaker',
  'ICT Order Block', 'ICT Rejection Block', 'ICT CISD',
  'Liquidity Grab', 'Range Break', 'News Trade', 'Other',
];

// Safe formatter — never calls .toFixed on null/undefined/NaN
const fmt = (n: number | null | undefined, digits = 2): string => {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(digits);
};

const pnlClass = (pnl: number | null) => {
  if (pnl == null || !isFinite(pnl)) return 'text-muted-foreground';
  if (pnl > 0) return 'text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums';
  if (pnl < 0) return 'text-red-500 dark:text-red-400 font-semibold tabular-nums';
  return 'text-muted-foreground tabular-nums';
};

export function TradeRow({ trade, onDelete, onSave }: {
  trade: Trade;
  onDelete: (id: number) => void;
  onSave: (id: number, fields: Partial<Trade>) => void;
}) {
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [setupName, setSetupName]         = useState(trade.setup_name     ?? '');
  const [riskDollars, setRiskDollars]     = useState<string>(trade.risk_dollars != null ? String(trade.risk_dollars) : '');
  const [slTicks, setSlTicks]             = useState<string>(trade.sl_ticks     != null ? String(trade.sl_ticks)     : '');
  const [tp1, setTp1]                     = useState<string>(trade.tp1          != null ? String(trade.tp1)          : '');
  const [tp2, setTp2]                     = useState<string>(trade.tp2          != null ? String(trade.tp2)          : '');
  const [tp3, setTp3]                     = useState<string>(trade.tp3          != null ? String(trade.tp3)          : '');
  const [dexReached, setDexReached]       = useState(trade.dex_reached    ?? false);
  const [mfeTicks, setMfeTicks]           = useState<string>(trade.mfe_ticks    != null ? String(trade.mfe_ticks)    : '');
  const [maeTicks, setMaeTicks]           = useState<string>(trade.mae_ticks    != null ? String(trade.mae_ticks)    : '');
  const [ruleAdherence, setRuleAdherence] = useState(trade.rule_adherence ?? false);
  const [notes, setNotes]                 = useState(trade.notes          ?? '');

  const dirBadge = trade.direction === 'Buy'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
    : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';

  async function handleSave() {
    setSaving(true);
    await onSave(trade.id, {
      setup_name:     setupName     || null,
      risk_dollars:   riskDollars !== '' ? Number(riskDollars) : null,
      sl_ticks:       slTicks     !== '' ? Number(slTicks)     : null,
      tp1:            tp1         !== '' ? Number(tp1)         : null,
      tp2:            tp2         !== '' ? Number(tp2)         : null,
      tp3:            tp3         !== '' ? Number(tp3)         : null,
      dex_reached:    dexReached,
      mfe_ticks:      mfeTicks    !== '' ? Number(mfeTicks)    : null,
      mae_ticks:      maeTicks    !== '' ? Number(maeTicks)    : null,
      rule_adherence: ruleAdherence,
      notes:          notes || null,
    });
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm(`Delete trade ${trade.trade_id}?`)) return;
    setDeleting(true);
    await onDelete(trade.id);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-left"
      >
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${dirBadge}`}>
          {trade.direction === 'Buy' ? 'LONG' : 'SHORT'}
        </span>
        <span className="font-mono text-sm font-medium w-14">{trade.instrument}</span>
        <span className="text-sm text-muted-foreground w-12 tabular-nums">{trade.exchange_time}</span>
        <span className="text-sm tabular-nums w-16">{trade.total_quantity ?? '—'}x</span>
        <span className="text-sm tabular-nums flex-1">
          {fmt(trade.avg_entry_price, 4)}
          {trade.avg_exit_price != null && <> → {fmt(trade.avg_exit_price, 4)}</>}
        </span>
        {trade.time_in_position_min != null && (
          <span className="text-xs text-muted-foreground w-16 tabular-nums">{trade.time_in_position_min}m</span>
        )}
        <span className={`w-24 text-right text-sm ${pnlClass(trade.pnl)}`}>
          {trade.pnl != null && isFinite(trade.pnl) ? `$${fmt(trade.pnl)}` : '—'}
        </span>
        {trade.setup_name && (
          <span className="hidden sm:inline text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded w-36 truncate">
            {trade.setup_name}
          </span>
        )}
        {open
          ? <ChevronUp size={16} className="ml-auto shrink-0 text-muted-foreground" />
          : <ChevronDown size={16} className="ml-auto shrink-0 text-muted-foreground" />}
      </button>

      {/* Expanded details */}
      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">Setup</label>
              <select value={setupName} onChange={e => setSetupName(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">— select —</option>
                {SETUPS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">Risk $</label>
              <input type="number" step="0.01" min="0" value={riskDollars} onChange={e => setRiskDollars(e.target.value)} placeholder="e.g. 100"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">SL (ticks)</label>
              <input type="number" min="0" value={slTicks} onChange={e => setSlTicks(e.target.value)} placeholder="e.g. 8"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">TP1</label>
              <input type="number" step="0.25" value={tp1} onChange={e => setTp1(e.target.value)} placeholder="price"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">TP2</label>
              <input type="number" step="0.25" value={tp2} onChange={e => setTp2(e.target.value)} placeholder="price"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">TP3</label>
              <input type="number" step="0.25" value={tp3} onChange={e => setTp3(e.target.value)} placeholder="price"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">MFE (ticks)</label>
              <input type="number" min="0" value={mfeTicks} onChange={e => setMfeTicks(e.target.value)} placeholder="e.g. 20"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">MAE (ticks)</label>
              <input type="number" min="0" value={maeTicks} onChange={e => setMaeTicks(e.target.value)} placeholder="e.g. 4"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">DEX Reached</label>
              <select value={dexReached ? 'yes' : 'no'} onChange={e => setDexReached(e.target.value === 'yes')}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">Rule Adherence</label>
              <select value={ruleAdherence ? 'yes' : 'no'} onChange={e => setRuleAdherence(e.target.value === 'yes')}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="text-xs text-muted-foreground uppercase tracking-wide">Trade Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Observations, mistakes, what went well..."
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
          </div>
          <div className="mt-3 flex items-center gap-2 justify-end">
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={14} />{deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              <Save size={14} />{saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
