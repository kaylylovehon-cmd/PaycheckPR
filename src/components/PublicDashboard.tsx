import { useMemo, useState } from 'react';
import {
  Award,
  Coins,
  FileSpreadsheet,
  Inbox,
  Landmark,
  ListOrdered,
  Percent,
  RotateCcw,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { PaycheckRecord, PeriodFilter, ToastType } from '../types/paycheck';
import {
  formatCurrency,
  formatDateThaiDisplay,
  getThailandTodayISO,
} from '../utils/formatters';

interface PublicDashboardProps {
  records: PaycheckRecord[];
  isLoading?: boolean;
  onNotify: (message: string, type: ToastType) => void;
}

const PERIOD_TABS: { id: Exclude<PeriodFilter, 'custom'>; label: string; caption: string }[] = [
  { id: 'all', label: 'ทั้งหมด', caption: 'ทั้งหมด' },
  { id: 'today', label: 'วันนี้', caption: 'วันนี้' },
  { id: 'weekly', label: 'รายสัปดาห์', caption: 'รายสัปดาห์ (7 วันล่าสุด)' },
  { id: 'monthly', label: 'รายเดือน', caption: 'รายเดือน (เดือนปัจจุบัน)' },
];

export function PublicDashboard({ records, isLoading = false, onNotify }: PublicDashboardProps) {
  const todayISO = getThailandTodayISO();

  const [activePeriod, setActivePeriod] = useState<PeriodFilter>('all');
  const [startDateInput, setStartDateInput] = useState<string>(todayISO);
  const [endDateInput, setEndDateInput] = useState<string>(todayISO);
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSelectPeriod = (period: Exclude<PeriodFilter, 'custom'>) => {
    setActivePeriod(period);
    setAppliedStartDate('');
    setAppliedEndDate('');
  };

  const handleApplyDateRange = () => {
    if (!startDateInput && !endDateInput) {
      onNotify('กรุณาเลือกวันที่เริ่มต้นหรือวันที่สิ้นสุด', 'error');
      return;
    }
    if (startDateInput && endDateInput && startDateInput > endDateInput) {
      onNotify('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด', 'error');
      return;
    }
    const start = startDateInput || endDateInput;
    const end = endDateInput || startDateInput;
    setAppliedStartDate(start);
    setAppliedEndDate(end);
    setActivePeriod('custom');
  };

  const handleResetDates = () => {
    const today = getThailandTodayISO();
    setActivePeriod('all');
    setStartDateInput(today);
    setEndDateInput(today);
    setAppliedStartDate('');
    setAppliedEndDate('');
  };

  const captionLabel = useMemo(() => {
    if (activePeriod === 'custom') {
      if (appliedStartDate === appliedEndDate) {
        return formatDateThaiDisplay(appliedStartDate);
      }
      return `${formatDateThaiDisplay(appliedStartDate)} ถึง ${formatDateThaiDisplay(appliedEndDate)}`;
    }
    return PERIOD_TABS.find((t) => t.id === activePeriod)?.caption ?? 'ทั้งหมด';
  }, [activePeriod, appliedStartDate, appliedEndDate]);

  const filteredRecords = useMemo(() => {
    const todayStr = getThailandTodayISO();
    const query = searchQuery.trim().toLowerCase();

    return records
      .filter((item) => {
        const itemDate = item.date || todayStr;

        if (activePeriod === 'today') {
          if (itemDate !== todayStr) return false;
        } else if (activePeriod === 'weekly') {
          const now = new Date(`${todayStr}T00:00:00`);
          const sevenDaysAgo = new Date(now);
          sevenDaysAgo.setDate(now.getDate() - 6);
          const minDate = sevenDaysAgo.toISOString().split('T')[0];
          if (itemDate < minDate || itemDate > todayStr) return false;
        } else if (activePeriod === 'monthly') {
          const currentMonthPrefix = todayStr.slice(0, 7);
          if (!itemDate.startsWith(currentMonthPrefix)) return false;
        } else if (activePeriod === 'custom') {
          if (appliedStartDate && itemDate < appliedStartDate) return false;
          if (appliedEndDate && itemDate > appliedEndDate) return false;
        }

        if (query) {
          const nameMatch = (item.payee || '').toLowerCase().includes(query);
          const noteMatch = (item.note || '').toLowerCase().includes(query);
          if (!nameMatch && !noteMatch) return false;
        }

        return true;
      })
      .sort((a, b) => (Number(b.netPay) || 0) - (Number(a.netPay) || 0));
  }, [records, activePeriod, appliedStartDate, appliedEndDate, searchQuery]);

  const summary = useMemo(() => {
    return filteredRecords.reduce(
      (acc, r) => {
        acc.totalPaycheck += Number(r.paycheck) || 0;
        acc.totalTax += Number(r.tax) || 0;
        acc.totalNet += Number(r.netPay) || 0;
        return acc;
      },
      { totalPaycheck: 0, totalTax: 0, totalNet: 0 }
    );
  }, [filteredRecords]);

  return (
    <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Quick Period Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1.5 bg-obsidian-900/90 p-1.5 rounded-2xl border border-slate-800/90 shadow-inner">
          {PERIOD_TABS.map((tab) => {
            const isActive = activePeriod === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectPeriod(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-obsidian-950 shadow-md shadow-amber-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Calendar Date Range Filter Bar */}
      <section className="rounded-2xl bg-[#131015]/95 border border-amber-500/20 p-4 sm:p-5 shadow-xl space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 items-end">
          <div className="md:col-span-4 space-y-1.5">
            <label htmlFor="filter-start-date" className="block text-xs sm:text-sm font-medium text-slate-300">
              จากวันที่
            </label>
            <div className="relative bg-[#1B151A] border border-white/10 focus-within:border-[#D4AF37] rounded-xl px-3.5 py-2.5 transition">
              <input
                id="filter-start-date"
                type="date"
                value={startDateInput}
                onChange={(e) => setStartDateInput(e.target.value)}
                className="w-full bg-transparent text-sm sm:text-base font-medium text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="md:col-span-4 space-y-1.5">
            <label htmlFor="filter-end-date" className="block text-xs sm:text-sm font-medium text-slate-300">
              ถึงวันที่
            </label>
            <div className="relative bg-[#1B151A] border border-white/10 focus-within:border-[#D4AF37] rounded-xl px-3.5 py-2.5 transition">
              <input
                id="filter-end-date"
                type="date"
                value={endDateInput}
                onChange={(e) => setEndDateInput(e.target.value)}
                className="w-full bg-transparent text-sm sm:text-base font-medium text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="md:col-span-4">
            <button
              type="button"
              onClick={handleApplyDateRange}
              style={{ background: 'linear-gradient(135deg, #F3D999, #C89B3C)' }}
              className="w-full py-2.5 sm:py-3 px-5 rounded-xl text-[#1A140B] hover:brightness-105 active:scale-[0.99] text-sm sm:text-base font-bold shadow-lg shadow-amber-500/15 transition cursor-pointer whitespace-nowrap"
            >
              ดูยอดในช่วงวันที่
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs sm:text-sm text-slate-400">
          <p>
            ช่วงที่แสดง: <strong className="font-bold text-white">{captionLabel}</strong> &middot;
            รวมวันที่เริ่มต้นและสิ้นสุด ตามเวลาประเทศไทย
          </p>
          {activePeriod === 'custom' && (
            <button
              type="button"
              onClick={handleResetDates}
              className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 underline cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              รีเซ็ตช่วงวันที่
            </button>
          )}
        </div>
      </section>

      {/* 3 Executive Summary KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        <div className="gold-card rounded-2xl p-5 sm:p-6 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs sm:text-sm font-medium text-slate-400">
              ยอดรวม Paycheck (รายได้รวม)
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-400/25 text-blue-400 flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white tracking-tight">
            {formatCurrency(summary.totalPaycheck)}
          </div>
          <p className="text-xs text-blue-300/80 mt-2 flex items-center gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>จากทั้งหมด {filteredRecords.length.toLocaleString('th-TH')} รายการในช่วงเวลานี้</span>
          </p>
        </div>

        <div className="gold-card rounded-2xl p-5 sm:p-6 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs sm:text-sm font-medium text-slate-400">
              ยอดรวมภาษี / รายการหัก (Tax)
            </span>
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-400/25 text-rose-400 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-rose-300 tracking-tight">
            {formatCurrency(summary.totalTax)}
          </div>
          <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
            <Percent className="w-3.5 h-3.5 text-rose-400" />
            <span>หักภาษี ณ ที่จ่ายและรายการหักรวม</span>
          </p>
        </div>

        <div className="gold-card rounded-2xl p-5 sm:p-6 relative overflow-hidden border-amber-400/35 bg-gradient-to-br from-slate-900 via-obsidian-900 to-amber-950/25">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs sm:text-sm font-semibold text-amber-300">
              ยอดเงินที่ได้รับสุทธิรวม (Total Net Pay)
            </span>
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 flex items-center justify-center shadow-inner">
              <Coins className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-300 bg-clip-text text-transparent tracking-tight">
            {formatCurrency(summary.totalNet)}
          </div>
          <p className="text-xs text-emerald-300/90 mt-2 flex items-center gap-1.5 truncate">
            <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            {filteredRecords.length > 0 ? (
              <span className="truncate">
                อันดับ 1: <strong>{filteredRecords[0].payee}</strong> ({formatCurrency(filteredRecords[0].netPay)})
              </span>
            ) : (
              <span>อันดับ 1: -</span>
            )}
          </p>
        </div>
      </section>

      {/* Search Bar & Leaderboard Table */}
      <section className="gold-card rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-obsidian-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <ListOrdered className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">ตารางจัดอันดับผู้เบิกจ่าย</h3>
              <p className="text-xs text-slate-400">
                เรียงลำดับจากผู้ที่ได้รับ{' '}
                <span className="text-amber-300 font-medium">เงินที่ได้รับสุทธิ (Net Pay)</span>{' '}
                มากที่สุดไปน้อยที่สุด
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="public-search-input"
              type="text"
              autoComplete="off"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหารายชื่อผู้เบิกที่ต้องการ..."
              className="w-full bg-obsidian-950/90 border border-slate-700/90 focus:border-amber-400 rounded-xl pl-10 pr-9 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/20 transition"
            />
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="ล้างคำค้นหา"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian-950/90 border-b border-slate-800 text-[11px] font-bold text-amber-300/80 tracking-wider">
                <th className="py-4 px-4 sm:px-6 w-20 text-center">อันดับ</th>
                <th className="py-4 px-4">ชื่อผู้เบิก</th>
                <th className="py-4 px-4 whitespace-nowrap">วันที่ / เวลา</th>
                <th className="py-4 px-4 text-right whitespace-nowrap">Paycheck (รายได้รวม)</th>
                <th className="py-4 px-4 text-right whitespace-nowrap">ภาษี (Tax)</th>
                <th className="py-4 px-4 sm:px-6 text-right whitespace-nowrap">
                  เงินที่ได้รับสุทธิ (Net Pay)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {isLoading && records.length === 0 ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`skel_${i}`} className="animate-pulse">
                    <td className="py-4 px-4 sm:px-6 text-center">
                      <div className="w-7 h-7 rounded-lg bg-slate-800 mx-auto" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 w-36 bg-slate-800 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-3.5 w-20 bg-slate-800 rounded" />
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="h-4 w-24 bg-slate-800 rounded ml-auto" />
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="h-4 w-20 bg-slate-800 rounded ml-auto" />
                    </td>
                    <td className="py-4 px-4 sm:px-6 text-right">
                      <div className="h-4 w-28 bg-slate-800 rounded ml-auto" />
                    </td>
                  </tr>
                ))
              ) : (
                filteredRecords.map((rec, idx) => {
                  const rank = idx + 1;
                  return (
                    <tr key={rec.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-4 px-4 sm:px-6 text-center">
                        {rank === 1 && (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-obsidian-950 font-mono tabular-nums text-xs font-extrabold shadow-md shadow-amber-500/30">
                            1
                          </span>
                        )}
                        {rank === 2 && (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-slate-200 to-slate-400 text-obsidian-950 font-mono tabular-nums text-xs font-extrabold">
                            2
                          </span>
                        )}
                        {rank === 3 && (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-amber-600 to-orange-800 text-white font-mono tabular-nums text-xs font-extrabold">
                            3
                          </span>
                        )}
                        {rank > 3 && (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 text-slate-300 font-mono tabular-nums text-xs font-bold">
                            {rank}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-semibold text-white">{rec.payee}</div>
                        {rec.note && <div className="text-xs text-slate-400 mt-0.5">{rec.note}</div>}
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-300 whitespace-nowrap font-mono tabular-nums">
                        {formatDateThaiDisplay(rec.date)}
                      </td>
                      <td className="py-4 px-4 text-right font-mono tabular-nums text-blue-300 whitespace-nowrap">
                        {formatCurrency(rec.paycheck)}
                      </td>
                      <td className="py-4 px-4 text-right font-mono tabular-nums text-rose-300 whitespace-nowrap">
                        {formatCurrency(rec.tax)}
                      </td>
                      <td className="py-4 px-4 sm:px-6 text-right font-mono tabular-nums font-bold text-amber-300 whitespace-nowrap">
                        {formatCurrency(rec.netPay)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && filteredRecords.length === 0 && (
          <div className="py-16 px-4 text-center space-y-2.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/80 text-amber-400/80 flex items-center justify-center mx-auto border border-slate-700/80">
              <Inbox className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-200">
              {records.length === 0
                ? 'ยังไม่มีข้อมูลรายการเบิกจ่ายในระบบ'
                : 'ไม่พบข้อมูลรายการเบิกจ่ายที่ตรงกับเงื่อนไข'}
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              แอดมินสามารถกดปุ่ม <span className="text-amber-300 font-semibold">Admin</span>{' '}
              ด้านบนขวาเพื่ออัปโหลดและสแกนสลิปเงินเดือนเข้าสู่ระบบได้ทันที
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
