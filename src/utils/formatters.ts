import { PaycheckRecord } from '../types/paycheck';

const RECORDS_STORAGE_KEY = 'paycheck_rp_records_v1';
let inMemoryRecords: PaycheckRecord[] = [];

export function getThailandTodayISO(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) {
      return `${y}-${m}-${d}`;
    }
  } catch {
    // Fallback below
  }
  return new Date().toISOString().split('T')[0];
}

export function formatDateThaiDisplay(isoDate: string): string {
  if (!isoDate) return '-';
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

export function formatCurrency(num: number): string {
  const val = Number(num) || 0;
  return (
    '฿' +
    val.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function loadRecords(): PaycheckRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryRecords = parsed;
        return parsed;
      }
    }
  } catch {
    // Fallback to in-memory storage
  }
  return inMemoryRecords;
}

export function saveRecords(records: PaycheckRecord[]): void {
  inMemoryRecords = records;
  try {
    localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage restrictions
  }
}

export function exportRecordsToCsv(records: PaycheckRecord[]): void {
  const headers = ['วันที่', 'ชื่อผู้เบิก', 'Paycheck', 'ภาษี', 'เงินที่ได้รับสุทธิ', 'หมายเหตุ'];
  const rows = records.map((r) => [
    r.date,
    `"${(r.payee || '').replace(/"/g, '""')}"`,
    Number(r.paycheck || 0).toFixed(2),
    Number(r.tax || 0).toFixed(2),
    Number(r.netPay || 0).toFixed(2),
    `"${(r.note || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Paycheck_RP_${getThailandTodayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
