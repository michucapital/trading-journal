'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, Save } from 'lucide-react';
import type { Trade } from '@/types/journal';

const SETUPS = [
  'Flashlight With Floor',
  'Flashlight Without Floor',
  'Intraday Restructure',
  'Open Dex Range',
  'Open Drive Dex Bias',
  'Red among green',
];

const fmt = (n: number | null | undefined, digits = 2): string => {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(digits);
};

const pnlClass = (pnl: number | null) => {
  if (pnl == null || !isFinite(pnl)) return 'text-muted-foreground';
  if (pnl > 0) return 'text-emerald-400 font-semibold tabular-nums';
  if (pnl < 0) return 'text-red-400 font-semibold tabular-nums';
  return 'text-muted-foreground tabular-nums';
};

export function TradeRow({ trade, onDelete, onSave }: {
  trade: Trade;
  onDelete: (id: number) => void;
  onSave: (id: number, fields: Partial<Trade>) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/50 ring-0'
    : 'bg-red-950/70 text-red-300 border border-red-800/50';

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
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
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
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
        className="w-full flex flex-wrap items-center gap-2 px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-left"
      >
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold tracking-wide shrink-0 ${dirBadge}`}>
          {trade.direction === 'Buy' ? 'LONG' : 'SHORT'}
        </span>
        <span className="font-mono text-sm font-medium shrink-0 text-foreground/90">{trade.instrument}</span>
        <span className="text-sm text-muted-foreground shrink-0 tabular-nums">{trade.exchange_time}</span>
        <span className="text-sm tabular-nums shrink-0 text-foreground/80">{trade.total_quantity ?? '—'}x</span>
        <span className="text-sm tabular-nums flex-1 min-w-0 truncate text-foreground/70 font-mono">
          {fmt(trade.avg_entry_price, 2)}
          {trade.avg_exit_price != null && <> → {fmt(trade.avg_exit_price, 2)}</>}
        </span>
        {trade.time_in_position_min != null && (
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{trade.time_in_position_min}m</span>
        )}
        <span className={`shrink-0 text-right text-sm min-w-[5rem] font-mono ${pnlClass(trade.pnl)}`}>
          {trade.pnl != null && isFinite(trade.pnl)
            ? `${trade.pnl >= 0 ? '+' : ''}$${fmt(trade.pnl)}`
            : '—'}
        </span>
        {trade.setup_name && (
          <span className="hidden sm:inline text-xs text-muted-foreground/70 bg-muted/60 px-2 py-0.5 rounded shrink-0 max-w-[10rem] truncate">
            {trade.setup_name}
          </span>
        )}
        {open
          ? <ChevronUp size={15} className="ml-auto shrink-0 text-muted-foreground" />
          : <ChevronDown size={15} className="ml-auto shrink-0 text-muted-foreground" />}
      </button>

      {/* Expanded details */}
      {open && (
        <div className="border-t border-border bg-background/60 px-4 py-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Setup */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Setup</label>
              <select value={setupName} onChange={e => setSetupName(e.target.value)}
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-foreground">
                <option value="">— select —</option>
                {SETUPS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {/* Risk $ */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Risk $</label>
              <input type="number" step="0.01" min="0" value={riskDollars}
                onChange={e => setRiskDollars(e.target.value)} placeholder="100"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* SL ticks */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">SL (ticks)</label>
              <input type="number" min="0" value={slTicks}
                onChange={e => setSlTicks(e.target.value)} placeholder="8"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* TP1 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">TP1</label>
              <input type="number" step="0.25" value={tp1}
                onChange={e => setTp1(e.target.value)} placeholder="price"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* TP2 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">TP2</label>
              <input type="number" step="0.25" value={tp2}
                onChange={e => setTp2(e.target.value)} placeholder="price"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* TP3 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">TP3</label>
              <input type="number" step="0.25" value={tp3}
                onChange={e => setTp3(e.target.value)} placeholder="price"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* MFE */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">MFE (ticks)</label>
              <input type="number" min="0" value={mfeTicks}
                onChange={e => setMfeTicks(e.target.value)} placeholder="20"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* MAE */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">MAE (ticks)</label>
              <input type="number" min="0" value={maeTicks}
                onChange={e => setMaeTicks(e.target.value)} placeholder="4"
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            {/* DEX Reached */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">DEX Reached</label>
              <select value={dexReached ? 'yes' : 'no'} onChange={e => setDexReached(e.target.value === 'yes')}
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            {/* Rule Adherence */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Rule Adherence</label>
              <select value={ruleAdherence ? 'yes' : 'no'} onChange={e => setRuleAdherence(e.target.value === 'yes')}
                className="h-8 rounded-md border border-input bg-muted/30 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>

          {/* Trade notes */}
          <div className="mt-4">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Trade Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Observations, mistakes, what went well..."
              className="mt-1.5 w-full rounded-lg border border-input bg-muted/20 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50" />
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center gap-2 justify-end">
            {saveError && <span className="text-xs text-destructive mr-auto">{saveError}</span>}
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={13} />{deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              <Save size={13} />{saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
