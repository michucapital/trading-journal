export type Direction = 'Buy' | 'Sell';
export type TradeStatus = 'OPEN' | 'CLOSED';

export interface Trade {
  id: number;
  trade_id: string;
  date: string;            // YYYY-MM-DD
  exchange_time: string;   // HH:MM
  direction: Direction;
  instrument: string;
  total_quantity: number;
  avg_entry_price: number;
  avg_exit_price: number | null;
  exited_quantity: number;
  pnl: number | null;
  time_in_position_min: number | null;
  status: TradeStatus;
  // Manual fields
  setup_name: string | null;
  risk_dollars: number | null;
  sl_ticks: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  dex_reached: boolean | null;
  mfe_ticks: number | null;
  mae_ticks: number | null;
  rule_adherence: boolean | null;
  notes: string | null;
}

export interface DayGroup {
  date: string;
  sessionNotes: string;
  trades: Trade[];
}

export interface JournalData {
  days: DayGroup[];
}
