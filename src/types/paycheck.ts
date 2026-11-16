export interface PaycheckRecord {
  id: string;
  payee: string;
  paycheck: number;
  tax: number;
  netPay: number;
  date: string;
  note: string;
}

export type PeriodFilter = 'all' | 'today' | 'weekly' | 'monthly' | 'custom';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export interface ScannedSlipEntry {
  payee: string;
  paycheck: number;
  tax: number;
  netPay: number;
  date: string;
  note: string;
}

export interface ScanSlipResult {
  entries: ScannedSlipEntry[];
}

export interface BatchDraftRow {
  tempId: string;
  payee: string;
  paycheck: string;
  tax: string;
  netPay: string;
  date: string;
  note: string;
}
