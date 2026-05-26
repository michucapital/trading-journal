'use client';
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, BookOpen } from 'lucide-react';
import { DayCard } from '@/components/journal/DayCard';
import type { JournalData } from '@/types/journal';

export default function JournalPage() {
  const [data, setData]       = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trades');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as JournalData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const totalTrades = data?.days.reduce((s, d) => s + d.trades.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-primary" />
            <span className="font-semibold text-base">Trading Journal</span>
          </div>
          <div className="flex items-center gap-4">
            {data && (
              <span className="hidden sm:block text-sm text-muted-foreground">
                {data.days.length} sessions · {totalTrades} trades
              </span>
            )}
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading && !data && (
          <div className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-5 py-4 text-sm text-destructive">
            Failed to load journal data: {error}
          </div>
        )}

        {data && data.days.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookOpen size={40} className="text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-medium mb-1">No trades yet</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              Trades will appear here automatically once NT8 sends executions via the JournalExporter.
            </p>
          </div>
        )}

        {data && data.days.length > 0 && (
          <div className="flex flex-col gap-4">
            {data.days.map(day => (
              <DayCard
                key={day.date}
                day={day}
                onDataChange={loadData}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
