// Canonical export/import schema — version 1
// All nullable fields are explicitly null (never undefined) in exports.

export interface ExportTrade {
  date: string;                     // YYYY-MM-DD
  exchange_time: string | null;     // HH:MM
  direction: 'LONG' | 'SHORT';
  instrument: string | null;        // e.g. "ES", "MES"
  setup_name: string | null;
  total_quantity: number | null;
  avg_entry_price: number | null;
  avg_exit_price: number | null;
  pnl: number | null;
  time_in_position_min: number | null;
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
  // legacy / extended fields — not yet dedicated DB columns
  // exported as null from DB; populated by .txt importer
  footprint_name: string | null;
  type_of_exit: string | null;
  mae_10min_ticks: number | null;
  mfe_10min_ticks: number | null;
  mae_30min_ticks: number | null;
  mfe_30min_ticks: number | null;
  all_options_conditions_met: boolean | null;
  rule_broken: string | null;
  active_management_result: string | null;
}

export interface ExportSessionNote {
  date: string;       // YYYY-MM-DD
  type: 'session' | 'pre_session';
  notes: string;
}

export interface JournalExport {
  version: 1;
  exported_at: string;              // ISO 8601
  trades: ExportTrade[];
  session_notes: ExportSessionNote[];
}
