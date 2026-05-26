'use client';
import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';
import { TradeRow } from './TradeRow';
import type { DayGroup, Trade } from '@/types/journal';

function formatDate(dateStr: string) {
  // Parse as local date — avoid UTC shift
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const safeN = (v: number | null | undefined) => (v == null || !isFinite(v) ? 0 : v);

export function DayCard({ day, onDataChange }: {
  day: DayGroup;
  onDataChange: () => void;
}) {
  const [open, setOpen]             = useState(false);
  const [notes, setNotes]           = useState(day.sessionNotes);
  const [notesSaved, setNotesSaved] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError]   = useState<string | null>(null);

  const closedTrades = day.trades.filter(t => t.status === 'CLOSED');
  const totalPnl  = closedTrades.reduce((s, t) => s + safeN(t.pnl), 0);
  const winners   = closedTrades.filter(t => safeN(t.pnl) > 0).length;
  const losers    = closedTrades.filter(t => safeN(t.pnl) < 0).length;
  const winRate   = closedTrades.length > 0 ? Math.round((winners / closedTrades.length) * 100) : null;

  const pnlColor = totalPnl > 0
    ? 'text-emerald-400'
    : totalPnl < 0
    ? 'text-red-400'
    : 'text-muted-foreground';

  async function saveNotes() {
    setSavingNotes(true);
    setNotesError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: day.date, notes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotesSaved(true);
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingNotes(false);
    }
  }

  const handleDelete = useCallback(async (id: number) => {
    const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      alert(`Delete failed: ${body.error ?? res.status}`);
      return;
    }
    onDataChange();
  }, [onDataChange]);

  const handleSave = useCallback(async (id: number, fields: Partial<Trade>) => {
    const res = await fetch(`/api/trades/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      alert(`Save failed: ${body.error ?? res.status}`);
      return;
    }
    onDataChange();
  }, [onDataChange]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 hover:bg-muted/40 transition-colors text-left"
      >
        <span className="font-semibold text-base">{formatDate(day.date)}</span>
        <div className="flex items-center gap-3 ml-auto">
          {winRate != null && (
            <span className="text-xs text-muted-foreground tabular-nums">{winners}W / {losers}L · {winRate}%</span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{day.trades.length} trade{day.trades.length !== 1 ? 's' : ''}</span>
          <span className={`font-mono font-semibold text-sm tabular-nums ${pnlColor}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
          {totalPnl > 0
            ? <TrendingUp size={16} className="text-emerald-400" />
            : totalPnl < 0
            ? <TrendingDown size={16} className="text-red-400" />
            : null}
          {open
            ? <ChevronUp size={16} className="text-muted-foreground" />
            : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="px-5 py-4 bg-muted/20 border-b border-border">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Session Notes</label>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesSaved(false); }}
              onBlur={saveNotes}
              rows={2}
              placeholder="Market context, what you focused on, overall session observations..."
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <div className="flex items-center justify-between mt-1.5">
              {notesError
                ? <span className="text-xs text-destructive">{notesError}</span>
                : <span />}
              <button
                onClick={saveNotes}
                disabled={savingNotes || notesSaved}
                className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                {savingNotes ? 'Saving…' : notesSaved ? 'Saved' : 'Save notes'}
              </button>
            </div>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            {day.trades.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No trades recorded for this day.</p>
            ) : (
              day.trades.map(trade => (
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  onDelete={handleDelete}
                  onSave={handleSave}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
