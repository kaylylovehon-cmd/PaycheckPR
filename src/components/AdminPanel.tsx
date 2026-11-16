import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Cpu,
  Database,
  Download,
  FileCheck2,
  FolderOpen,
  ImagePlus,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Share2,
  Trash2,
  UploadCloud,
  User,
} from 'lucide-react';
import {
  createPaycheckRecord,
  createPaycheckRecordsBatch,
  deleteAllPaycheckRecords,
  deletePaycheckRecord,
  updatePaycheckRecord,
} from '../services/paycheckService';
import {
  BatchDraftRow,
  PaycheckRecord,
  ScannedSlipEntry,
  ScanSlipResult,
  ToastType,
} from '../types/paycheck';
import { getServerAuthToken } from '../utils/crypto';
import {
  exportRecordsToCsv,
  formatCurrency,
  formatDateThaiDisplay,
  getThailandTodayISO,
} from '../utils/formatters';

interface AdminPanelProps {
  records: PaycheckRecord[];
  onBackToDashboard: () => void;
  onNotify: (message: string, type: ToastType) => void;
}

interface PreparedImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

function createEmptyBatchRow(defaultDate: string): BatchDraftRow {
  return {
    tempId: 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    payee: '',
    paycheck: '',
    tax: '',
    netPay: '',
    date: defaultDate,
    note: '',
  };
}

function entryToBatchRow(entry: ScannedSlipEntry, fallbackDate: string): BatchDraftRow {
  const paycheckNum = Number(entry.paycheck) || 0;
  const taxNum = Number(entry.tax) || 0;
  const netNum =
    Number(entry.netPay) > 0 || paycheckNum === 0
      ? Number(entry.netPay) || 0
      : Math.max(0, paycheckNum - taxNum);

  return {
    tempId: 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    payee: (entry.payee || '').slice(0, 120),
    paycheck: paycheckNum ? paycheckNum.toFixed(2) : '',
    tax: taxNum ? taxNum.toFixed(2) : '0.00',
    netPay: netNum ? netNum.toFixed(2) : '',
    date: entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : fallbackDate,
    note: (entry.note || '').slice(0, 200),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.readAsDataURL(file);
  });
}

async function prepareImageForScan(file: File): Promise<PreparedImage> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const needsResize = file.size > 3.5 * 1024 * 1024;

  if (!needsResize) {
    const base64 = originalDataUrl.split(',')[1] || '';
    return {
      dataUrl: originalDataUrl,
      base64,
      mimeType: file.type || 'image/png',
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 2200;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          dataUrl: originalDataUrl,
          base64: originalDataUrl.split(',')[1] || '',
          mimeType: file.type || 'image/jpeg',
        });
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const resizedUrl = canvas.toDataURL('image/jpeg', 0.9);
      resolve({
        dataUrl: resizedUrl,
        base64: resizedUrl.split(',')[1] || '',
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => {
      resolve({
        dataUrl: originalDataUrl,
        base64: originalDataUrl.split(',')[1] || '',
        mimeType: file.type || 'image/jpeg',
      });
    };
    img.src = originalDataUrl;
  });
}

function getFriendlyFirestoreError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return 'บัญชี Google นี้ไม่มีสิทธิ์แก้ไขฐานข้อมูล กรุณาใช้อีเมลผู้ดูแลระบบที่ได้รับอนุญาต';
  }
  if (lower.includes('quota exceeded')) {
    return 'โควต้าการใช้งานฐานข้อมูลรายวันเต็มแล้ว กรุณาลองใหม่ในวันถัดไป';
  }
  return raw || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลออนไลน์';
}

export function AdminPanel({
  records,
  onBackToDashboard,
  onNotify,
}: AdminPanelProps) {
  const [entryMode, setEntryMode] = useState<'single' | 'batch'>('single');

  // Single-entry state
  const [payee, setPayee] = useState('');
  const [paycheck, setPaycheck] = useState('');
  const [tax, setTax] = useState('');
  const [netPay, setNetPay] = useState('');
  const [date, setDate] = useState(getThailandTodayISO());
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Batch multi-entry state
  const [batchRows, setBatchRows] = useState<BatchDraftRow[]>(() => [
    createEmptyBatchRow(getThailandTodayISO()),
  ]);
  const [batchSharedDate, setBatchSharedDate] = useState(getThailandTodayISO());
  const [batchSharedNote, setBatchSharedNote] = useState('');

  // Image & Scanner state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [queuedImages, setQueuedImages] = useState<PreparedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [scanProgressText, setScanProgressText] = useState('Gemini AI กำลังสแกนข้อมูลสลิป...');
  const [scanBadgeText, setScanBadgeText] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [clearConfirmArmed, setClearConfirmArmed] = useState(false);
  const clearTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const payeeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const calculateNet = (grossVal: string, taxVal: string) => {
    const gross = parseFloat(grossVal) || 0;
    const taxNum = parseFloat(taxVal) || 0;
    const net = Math.max(0, gross - taxNum);
    setNetPay(net ? net.toFixed(2) : '');
  };

  const handlePaycheckChange = (val: string) => {
    setPaycheck(val);
    calculateNet(val, tax);
  };

  const handleTaxChange = (val: string) => {
    setTax(val);
    calculateNet(paycheck, val);
  };

  async function handleCopyShareLink() {
    const shareUrl = window.location.origin;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      onNotify('คัดลอกลิงก์ระบบออนไลน์แล้ว ส่งต่อในแชทได้ทันที', 'success');
      window.setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      onNotify(`ลิงก์สำหรับแชร์: ${shareUrl}`, 'info');
    }
  }

  async function requestScanApi(base64Data: string, mimeType: string): Promise<ScannedSlipEntry[]> {
    const token = getServerAuthToken();
    const response = await fetch('/api/scan-slip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        imageBase64: base64Data,
        mimeType,
      }),
    });

    const rawBody = await response.text();
    let payload: (Partial<ScanSlipResult> & { error?: string }) | null = null;
    try {
      payload = JSON.parse(rawBody) as Partial<ScanSlipResult> & { error?: string };
    } catch {
      throw new Error('เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ กรุณาลองสแกนใหม่อีกครั้ง');
    }

    if (!response.ok) {
      throw new Error(payload?.error || 'สแกนรูปภาพไม่สำเร็จ');
    }

    return Array.isArray(payload?.entries) ? payload.entries : [];
  }

  async function scanPreparedImages(images: PreparedImage[], isRescan = false) {
    if (images.length === 0) return;
    setIsScanning(true);
    setScanBadgeText(null);

    const today = getThailandTodayISO();
    const collectedEntries: ScannedSlipEntry[] = [];
    let lastErrorMessage = '';

    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        setPreviewUrl(img.dataUrl);
        setScanProgressText(
          images.length > 1
            ? `Gemini AI กำลังสแกนรูปภาพ (${i + 1}/${images.length})...`
            : 'Gemini AI กำลังสแกนข้อมูลสลิป...'
        );

        try {
          const entries = await requestScanApi(img.base64, img.mimeType);
          collectedEntries.push(...entries);
        } catch (err) {
          lastErrorMessage = err instanceof Error ? err.message : 'สแกนรูปภาพไม่สำเร็จ';
        }
      }

      if (collectedEntries.length === 0) {
        setScanBadgeText('สแกนไม่สำเร็จ');
        onNotify(
          lastErrorMessage || 'ไม่สามารถอ่านข้อมูลจากรูปภาพได้ กรุณาลองกดสแกนใหม่หรือกรอกข้อมูลด้วยตนเอง',
          'error'
        );
        return;
      }

      if (collectedEntries.length === 1 && entryMode === 'single' && !editingId) {
        const first = collectedEntries[0];
        const paycheckNum = Number(first.paycheck) || 0;
        const taxNum = Number(first.tax) || 0;
        const netNum =
          Number(first.netPay) > 0 || paycheckNum === 0
            ? Number(first.netPay) || 0
            : Math.max(0, paycheckNum - taxNum);

        setPayee((first.payee || '').slice(0, 120));
        setPaycheck(paycheckNum ? paycheckNum.toFixed(2) : '');
        setTax(taxNum ? taxNum.toFixed(2) : '0.00');
        setNetPay(netNum ? netNum.toFixed(2) : '');
        if (first.date && /^\d{4}-\d{2}-\d{2}$/.test(first.date)) {
          setDate(first.date);
        }
        if (first.note) {
          setNote(first.note.slice(0, 200));
        }
        setScanBadgeText('AI สแกนสำเร็จ (1 รายการ)');
        onNotify('AI สแกนข้อมูลจากสลิปเรียบร้อยแล้ว กรุณาตรวจสอบก่อนบันทึก', 'success');
      } else {
        const mappedRows = collectedEntries.map((entry) => entryToBatchRow(entry, today));
        setEntryMode('batch');
        setEditingId(null);
        setBatchRows((prev) => {
          if (isRescan) {
            return mappedRows;
          }
          const hasExistingContent = prev.some(
            (r) => r.payee.trim() !== '' || r.paycheck.trim() !== '' || r.netPay.trim() !== ''
          );
          return hasExistingContent && images.length === 1 && entryMode === 'batch'
            ? [...prev, ...mappedRows]
            : mappedRows;
        });
        setScanBadgeText(`AI สแกนพบ ${collectedEntries.length} รายชื่อ`);
        onNotify(
          `AI สแกนพบ ${collectedEntries.length} รายชื่อเรียบร้อยแล้ว ตรวจสอบและกดบันทึกทั้งหมดได้ทันที`,
          'success'
        );
      }
    } finally {
      setIsScanning(false);
    }
  }

  async function handleImageFiles(fileList: FileList | File[]) {
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const files = Array.from(fileList).filter((f) => allowedTypes.has(f.type));
    if (files.length === 0) {
      onNotify('รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP เท่านั้น', 'error');
      return;
    }

    try {
      const prepared = await Promise.all(files.map((file) => prepareImageForScan(file)));
      setQueuedImages(prepared);
      setPreviewUrl(prepared[0].dataUrl);
      await scanPreparedImages(prepared);
    } catch {
      onNotify('ไม่สามารถโหลดรูปภาพได้ กรุณาลองใหม่อีกครั้ง', 'error');
    }
  }

  function handlePasteImages(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      void handleImageFiles(pastedFiles);
    }
  }

  function resetForm() {
    const today = getThailandTodayISO();
    setEditingId(null);
    setPayee('');
    setPaycheck('');
    setTax('');
    setNetPay('');
    setDate(today);
    setNote('');
    setBatchRows([createEmptyBatchRow(today)]);
    setBatchSharedDate(today);
    setBatchSharedNote('');
    setPreviewUrl(null);
    setQueuedImages([]);
    setScanBadgeText(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function switchToBatchMode() {
    const today = getThailandTodayISO();
    setEditingId(null);
    if (payee.trim() || paycheck.trim() || netPay.trim()) {
      setBatchRows([
        {
          tempId: 'draft_' + Date.now(),
          payee,
          paycheck,
          tax,
          netPay,
          date: date || today,
          note,
        },
      ]);
    } else if (batchRows.length === 0) {
      setBatchRows([createEmptyBatchRow(today)]);
    }
    setEntryMode('batch');
  }

  async function handleSaveSingleRecord() {
    const trimmedPayee = payee.trim();
    const paycheckNum = parseFloat(paycheck) || 0;
    const taxNum = parseFloat(tax) || 0;
    const netPayNum =
      netPay !== '' ? parseFloat(netPay) || 0 : Math.max(0, paycheckNum - taxNum);
    const recordDate = date || getThailandTodayISO();
    const trimmedNote = note.trim();

    if (!trimmedPayee) {
      onNotify('กรุณาระบุชื่อผู้เบิก / พนักงานก่อนบันทึก', 'error');
      payeeInputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        await updatePaycheckRecord(editingId, {
          payee: trimmedPayee,
          paycheck: paycheckNum,
          tax: taxNum,
          netPay: netPayNum,
          date: recordDate,
          note: trimmedNote,
        });
        onNotify(`อัปเดตข้อมูลออนไลน์ของ "${trimmedPayee}" เรียบร้อยแล้ว`, 'success');
      } else {
        await createPaycheckRecord({
          payee: trimmedPayee,
          paycheck: paycheckNum,
          tax: taxNum,
          netPay: netPayNum,
          date: recordDate,
          note: trimmedNote,
        });
        onNotify(`บันทึกข้อมูลออนไลน์ของ "${trimmedPayee}" ขึ้นหน้าหลักแล้ว`, 'success');
      }
      resetForm();
    } catch (err) {
      onNotify(getFriendlyFirestoreError(err), 'error');
    } finally {
      setIsSaving(false);
    }
  }

  function handleUpdateBatchRow(
    tempId: string,
    field: keyof Omit<BatchDraftRow, 'tempId'>,
    value: string
  ) {
    setBatchRows((prev) =>
      prev.map((row) => {
        if (row.tempId !== tempId) return row;
        const updated = { ...row, [field]: value };
        if (field === 'paycheck' || field === 'tax') {
          const gross = parseFloat(field === 'paycheck' ? value : updated.paycheck) || 0;
          const taxVal = parseFloat(field === 'tax' ? value : updated.tax) || 0;
          const net = Math.max(0, gross - taxVal);
          updated.netPay = net ? net.toFixed(2) : '';
        }
        return updated;
      })
    );
  }

  function handleApplySharedDateToBatch() {
    if (!batchSharedDate) return;
    setBatchRows((prev) => prev.map((row) => ({ ...row, date: batchSharedDate })));
    onNotify(`กำหนดวันที่ ${formatDateThaiDisplay(batchSharedDate)} ให้ทุกรายการแล้ว`, 'info');
  }

  function handleApplySharedNoteToBatch() {
    setBatchRows((prev) => prev.map((row) => ({ ...row, note: batchSharedNote.slice(0, 200) })));
    onNotify('อัปเดตหมายเหตุให้ทุกรายการแล้ว', 'info');
  }

  async function handleSaveBatchRecords() {
    const today = getThailandTodayISO();
    const validRows = batchRows.filter((row) => row.payee.trim() !== '');

    if (validRows.length === 0) {
      onNotify('กรุณาระบุชื่อผู้เบิกอย่างน้อย 1 รายการก่อนบันทึก', 'error');
      return;
    }

    const inputs = validRows.map((row) => {
      const paycheckNum = parseFloat(row.paycheck) || 0;
      const taxNum = parseFloat(row.tax) || 0;
      const netPayNum =
        row.netPay !== '' ? parseFloat(row.netPay) || 0 : Math.max(0, paycheckNum - taxNum);

      return {
        payee: row.payee.trim(),
        paycheck: paycheckNum,
        tax: taxNum,
        netPay: netPayNum,
        date: row.date || batchSharedDate || today,
        note: row.note.trim(),
      };
    });

    setIsSaving(true);
    try {
      const count = await createPaycheckRecordsBatch(inputs);
      onNotify(`บันทึกข้อมูลออนไลน์ทั้งหมด ${count} รายการขึ้นหน้าหลักเรียบร้อยแล้ว`, 'success');
      resetForm();
    } catch (err) {
      onNotify(getFriendlyFirestoreError(err), 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const batchSummary = useMemo(() => {
    return batchRows.reduce(
      (acc, row) => {
        if (!row.payee.trim() && !row.paycheck.trim() && !row.netPay.trim()) return acc;
        const p = parseFloat(row.paycheck) || 0;
        const t = parseFloat(row.tax) || 0;
        const n = row.netPay !== '' ? parseFloat(row.netPay) || 0 : Math.max(0, p - t);
        acc.count += row.payee.trim() ? 1 : 0;
        acc.paycheck += p;
        acc.tax += t;
        acc.netPay += n;
        return acc;
      },
      { count: 0, paycheck: 0, tax: 0, netPay: 0 }
    );
  }, [batchRows]);

  function handleEditRow(rec: PaycheckRecord) {
    setEntryMode('single');
    setEditingId(rec.id);
    setPayee(rec.payee);
    setPaycheck(String(rec.paycheck));
    setTax(String(rec.tax));
    setNetPay(String(rec.netPay));
    setDate(rec.date);
    setNote(rec.note || '');
    setTimeout(() => payeeInputRef.current?.focus(), 50);
    onNotify(`กำลังแก้ไขรายการของ "${rec.payee}"`, 'info');
  }

  async function handleDeleteRow(id: string) {
    try {
      await deletePaycheckRecord(id);
      if (editingId === id) {
        resetForm();
      }
      onNotify('ลบรายการออนไลน์เรียบร้อยแล้ว', 'info');
    } catch (err) {
      onNotify(getFriendlyFirestoreError(err), 'error');
    }
  }

  function handleExportCsv() {
    if (records.length === 0) {
      onNotify('ไม่มีข้อมูลสำหรับส่งออก CSV', 'error');
      return;
    }
    exportRecordsToCsv(records);
    onNotify('ส่งออกไฟล์ CSV สำเร็จ', 'success');
  }

  async function handleClearAll() {
    if (!clearConfirmArmed) {
      setClearConfirmArmed(true);
      clearTimerRef.current = window.setTimeout(() => {
        setClearConfirmArmed(false);
      }, 4000);
      return;
    }
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
    }
    setClearConfirmArmed(false);
    setIsSaving(true);
    try {
      await deleteAllPaycheckRecords(records.map((r) => r.id));
      resetForm();
      onNotify('ล้างข้อมูลทั้งหมดในฐานข้อมูลออนไลน์เรียบร้อยแล้ว', 'info');
    } catch (err) {
      onNotify(getFriendlyFirestoreError(err), 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      onPaste={handlePasteImages}
      className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8"
    >
      {/* Back-Office Header Banner */}
      <div className="gold-card rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 border-amber-500/30">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 border border-blue-400/30 flex items-center justify-center text-white shadow-md shrink-0">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex flex-wrap items-center gap-2">
              <span>Paycheck RP &mdash; ระบบหลังบ้าน AI สแกนสลิปและอัปเดตข้อมูลออนไลน์</span>
              <span className="text-xs font-medium text-amber-300">· Cloud Sync</span>
            </h2>
            <p className="text-xs text-slate-400">
              ข้อมูลทุกชุดบันทึกบนคลาวด์แบบเรียลไทม์ ทุกคนที่เปิดลิงก์ในแชทจะเห็นข้อมูลเดียวกันทันที
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyShareLink()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-amber-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            {copiedLink ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์แชร์ในแชท'}
          </button>
          <button
            type="button"
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-amber-400" />
            ดูผลลัพธ์บนหน้าหลัก
          </button>
        </div>
      </div>

      {/* Scanner & Form Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Left: Image Upload & Laser Scan Preview */}
        <div className="lg:col-span-5 gold-card rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <ImagePlus className="w-5 h-5 text-amber-400" />
              อัปโหลดสลิป / ตารางรายชื่อ
            </h3>
            <span className="text-[11px] text-slate-400">Multi-Row AI OCR</span>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void handleImageFiles(e.dataTransfer.files);
              }
            }}
            className={`relative group rounded-2xl border-2 border-dashed transition-all duration-200 overflow-hidden min-h-[290px] sm:min-h-[330px] flex flex-col items-center justify-center p-4 text-center cursor-pointer ${
              isDragging
                ? 'border-amber-400 bg-slate-900/90'
                : 'border-slate-700 hover:border-amber-400 bg-obsidian-950/70 hover:bg-slate-900/80'
            }`}
          >
            {!previewUrl ? (
              <div className="space-y-3.5 max-w-xs mx-auto pointer-events-none">
                <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700/80 flex items-center justify-center mx-auto text-amber-400 group-hover:scale-105 transition-transform shadow-lg">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-200">
                    ลากรูปภาพมาวาง, กด Ctrl+V หรือ{' '}
                    <span className="text-amber-400 underline">คลิกเลือกไฟล์</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    รองรับสลิปเดี่ยว ตารางรายชื่อหลายคน และเลือกหลายรูปพร้อมกันได้ (JPG, PNG, WEBP)
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center rounded-xl overflow-hidden bg-black/40">
                <img
                  src={previewUrl}
                  alt="สลิปที่อัปโหลด"
                  className="max-h-[350px] w-auto object-contain rounded-xl shadow-lg"
                />

                {isScanning && (
                  <div className="absolute inset-0 bg-obsidian-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center z-10 rounded-xl">
                    <div className="laser-line">
                      <div className="laser-glow" />
                    </div>
                    <div className="bg-obsidian-900/95 text-amber-200 px-4 py-2.5 rounded-xl border border-amber-400/40 shadow-2xl flex items-center gap-3 z-30">
                      <svg
                        className="animate-spin h-4 w-4 text-amber-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span className="text-xs sm:text-sm font-medium">{scanProgressText}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const selected = Array.from(e.target.files);
                  e.target.value = '';
                  void handleImageFiles(selected);
                }
              }}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-semibold border border-slate-700 transition cursor-pointer whitespace-nowrap"
            >
              <FolderOpen className="w-4 h-4 text-amber-400" />
              เลือกรูปภาพ (1 หรือหลายไฟล์)
            </button>
            {queuedImages.length > 0 && (
              <button
                type="button"
                disabled={isScanning}
                onClick={() => void scanPreparedImages(queuedImages, true)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-400/40 text-blue-300 text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                สแกนใหม่
              </button>
            )}
          </div>
        </div>

        {/* Right: Single or Batch Multi-Entry Form */}
        <div className="lg:col-span-7 gold-card rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-emerald-400" />
                {entryMode === 'batch'
                  ? `ตรวจสอบข้อมูลหลายรายชื่อ (${batchSummary.count} รายการ)`
                  : 'ข้อมูลรายการเบิกจ่าย (ตรวจสอบและแก้ไขก่อนบันทึก)'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {entryMode === 'batch'
                  ? 'แก้ไขตัวเลขหรือเพิ่ม/ลบแถวได้ทันที เมื่อกดบันทึกทุกรายการจะอัปเดตออนไลน์พร้อมกัน'
                  : 'เมื่อกดบันทึก ข้อมูลจะอัปเดตขึ้นตารางหน้าหลักออนไลน์ทันที'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {scanBadgeText && (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-semibold whitespace-nowrap">
                  {scanBadgeText}
                </span>
              )}
              <div className="inline-flex items-center bg-obsidian-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setEntryMode('single')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    entryMode === 'single'
                      ? 'bg-amber-500 text-obsidian-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ทีละ 1 ชื่อ
                </button>
                <button
                  type="button"
                  onClick={switchToBatchMode}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    entryMode === 'batch'
                      ? 'bg-amber-500 text-obsidian-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  หลายรายชื่อ
                </button>
              </div>
            </div>
          </div>

          {entryMode === 'single' ? (
            <>
              <div className="space-y-1.5">
                <label
                  htmlFor="input-payee"
                  className="block text-xs font-semibold text-amber-300 tracking-wider"
                >
                  ชื่อผู้เบิก / พนักงาน (Payee Name) *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    ref={payeeInputRef}
                    id="input-payee"
                    type="text"
                    maxLength={120}
                    autoComplete="off"
                    value={payee}
                    onChange={(e) => setPayee(e.target.value)}
                    placeholder="ระบุชื่อ-นามสกุลผู้เบิกจ่าย..."
                    className="w-full bg-obsidian-950 border border-slate-700 focus:border-amber-400 rounded-xl pl-10 pr-4 py-3 text-base font-semibold text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/20 transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-blue-950/30 border border-blue-500/30 p-3.5 space-y-1.5">
                  <label htmlFor="input-paycheck" className="block text-xs font-semibold text-blue-300">
                    Paycheck (รายได้รวม)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 font-bold">
                      ฿
                    </span>
                    <input
                      id="input-paycheck"
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      value={paycheck}
                      onChange={(e) => handlePaycheckChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-obsidian-950 border border-blue-500/30 focus:border-blue-400 rounded-lg pl-7 pr-2.5 py-2 text-base font-bold font-mono tabular-nums text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-rose-950/30 border border-rose-500/30 p-3.5 space-y-1.5">
                  <label htmlFor="input-tax" className="block text-xs font-semibold text-rose-300">
                    ภาษี / รายการหัก (Tax)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 font-bold">
                      ฿
                    </span>
                    <input
                      id="input-tax"
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      value={tax}
                      onChange={(e) => handleTaxChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-obsidian-950 border border-rose-500/30 focus:border-rose-400 rounded-lg pl-7 pr-2.5 py-2 text-base font-bold font-mono tabular-nums text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-amber-950/30 border border-amber-400/40 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="input-netpay" className="block text-xs font-bold text-amber-300">
                      เงินที่ได้รับสุทธิ (Net Pay)
                    </label>
                    <button
                      type="button"
                      onClick={() => calculateNet(paycheck, tax)}
                      className="text-[10px] text-amber-400 hover:underline cursor-pointer whitespace-nowrap"
                    >
                      คำนวณอัตโนมัติ
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 font-bold">
                      ฿
                    </span>
                    <input
                      id="input-netpay"
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      value={netPay}
                      onChange={(e) => setNetPay(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-obsidian-950 border border-amber-400/50 focus:border-amber-300 rounded-lg pl-7 pr-2.5 py-2 text-base font-extrabold font-mono tabular-nums text-amber-300 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="input-date" className="block text-xs font-semibold text-slate-300">
                    วันที่ทำรายการ (Date)
                  </label>
                  <input
                    id="input-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-obsidian-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="input-note" className="block text-xs font-semibold text-slate-300">
                    หมายเหตุ / แผนก (Note)
                  </label>
                  <input
                    id="input-note"
                    type="text"
                    maxLength={200}
                    autoComplete="off"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="เช่น เงินเดือนงวดล่าสุด / เบิกค่าโครงการ"
                    className="w-full bg-obsidian-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={resetForm}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-semibold transition cursor-pointer disabled:opacity-50"
                >
                  ล้างฟอร์ม
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSaveSingleRecord()}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-obsidian-950 text-sm font-bold shadow-lg shadow-amber-500/25 transition active:scale-[0.99] cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-4 h-4 stroke-[2.5]" />
                  {isSaving
                    ? 'กำลังบันทึก...'
                    : editingId
                      ? 'อัปเดตข้อมูลออนไลน์'
                      : 'บันทึกข้อมูลขึ้นหน้าหลัก'}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-obsidian-950/75 border border-slate-800">
                <div className="space-y-1.5">
                  <label htmlFor="batch-shared-date" className="block text-[11px] font-semibold text-slate-300">
                    ตั้งวันที่ร่วมให้ทุกรายการ
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="batch-shared-date"
                      type="date"
                      value={batchSharedDate}
                      onChange={(e) => setBatchSharedDate(e.target.value)}
                      className="flex-1 min-w-0 bg-obsidian-900 border border-slate-700 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleApplySharedDateToBatch}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      ใช้ทั้งหมด
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="batch-shared-note" className="block text-[11px] font-semibold text-slate-300">
                    ตั้งหมายเหตุร่วมให้ทุกรายการ
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="batch-shared-note"
                      type="text"
                      maxLength={200}
                      value={batchSharedNote}
                      onChange={(e) => setBatchSharedNote(e.target.value)}
                      placeholder="เช่น งวดวันที่..."
                      className="flex-1 min-w-0 bg-obsidian-900 border border-slate-700 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleApplySharedNoteToBatch}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      ใช้ทั้งหมด
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {batchRows.map((row, index) => (
                  <div
                    key={row.tempId}
                    className="rounded-xl bg-obsidian-950/90 border border-slate-800 hover:border-slate-700 p-3 space-y-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-300 font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0">
                        {index + 1}
                      </span>
                      <input
                        type="text"
                        maxLength={120}
                        value={row.payee}
                        onChange={(e) => handleUpdateBatchRow(row.tempId, 'payee', e.target.value)}
                        placeholder="ชื่อผู้เบิก..."
                        className="flex-1 min-w-0 bg-obsidian-900 border border-slate-700 focus:border-amber-400 rounded-lg px-3 py-1.5 text-sm font-semibold text-white placeholder-slate-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setBatchRows((prev) =>
                            prev.length > 1
                              ? prev.filter((r) => r.tempId !== row.tempId)
                              : [createEmptyBatchRow(getThailandTodayISO())]
                          );
                        }}
                        title="ลบแถวนี้"
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-rose-400 transition cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div>
                        <label className="block text-[10px] text-blue-300 mb-1">Paycheck</label>
                        <input
                          type="number"
                          min="0"
                          max="1000000000"
                          step="0.01"
                          value={row.paycheck}
                          onChange={(e) =>
                            handleUpdateBatchRow(row.tempId, 'paycheck', e.target.value)
                          }
                          placeholder="0.00"
                          className="w-full bg-obsidian-900 border border-blue-500/30 focus:border-blue-400 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-rose-300 mb-1">ภาษี (Tax)</label>
                        <input
                          type="number"
                          min="0"
                          max="1000000000"
                          step="0.01"
                          value={row.tax}
                          onChange={(e) => handleUpdateBatchRow(row.tempId, 'tax', e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-obsidian-900 border border-rose-500/30 focus:border-rose-400 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-amber-300 mb-1">สุทธิ (Net)</label>
                        <input
                          type="number"
                          min="0"
                          max="1000000000"
                          step="0.01"
                          value={row.netPay}
                          onChange={(e) =>
                            handleUpdateBatchRow(row.tempId, 'netPay', e.target.value)
                          }
                          placeholder="0.00"
                          className="w-full bg-obsidian-900 border border-amber-400/40 focus:border-amber-300 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums font-bold text-amber-300 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">วันที่</label>
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) => handleUpdateBatchRow(row.tempId, 'date', e.target.value)}
                          className="w-full bg-obsidian-900 border border-slate-700 focus:border-amber-400 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-[10px] text-slate-400 mb-1">หมายเหตุ</label>
                        <input
                          type="text"
                          maxLength={200}
                          value={row.note}
                          onChange={(e) => handleUpdateBatchRow(row.tempId, 'note', e.target.value)}
                          placeholder="หมายเหตุ"
                          className="w-full bg-obsidian-900 border border-slate-700 focus:border-amber-400 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                <div className="text-xs text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    พร้อมบันทึก <strong className="text-white">{batchSummary.count}</strong> รายชื่อ
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-amber-300 font-semibold">
                    ยอดสุทธิรวม {formatCurrency(batchSummary.netPay)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() =>
                      setBatchRows((prev) => [
                        ...prev,
                        createEmptyBatchRow(batchSharedDate || getThailandTodayISO()),
                      ])
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    เพิ่มรายชื่อ
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={resetForm}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    ล้างทั้งหมด
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleSaveBatchRecords()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-obsidian-950 text-xs sm:text-sm font-bold shadow-lg shadow-amber-500/25 transition active:scale-[0.99] cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    <Save className="w-4 h-4 stroke-[2.5]" />
                    {isSaving
                      ? 'กำลังบันทึก...'
                      : `บันทึกทั้งหมด ${batchSummary.count} รายการขึ้นหน้าหลัก`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Admin Data Management Table */}
      <div className="gold-card rounded-2xl overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-obsidian-900/60">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-400" />
              จัดการฐานข้อมูลรายการเบิกจ่ายทั้งหมด ({records.length.toLocaleString('th-TH')} รายการ)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              แอดมินสามารถดึงข้อมูลกลับมาแก้ไข ลบรายการ หรือส่งออกเป็นไฟล์ CSV ได้
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-400/40 text-emerald-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              ส่งออก CSV
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleClearAll()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/35 text-rose-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              {clearConfirmArmed ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  กดอีกครั้งเพื่อยืนยันการลบทั้งหมด
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  ล้างข้อมูลทั้งหมด
                </>
              )}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian-950/90 border-b border-slate-800 text-[11px] font-bold text-slate-400 tracking-wider">
                <th className="py-3.5 px-4 sm:px-6">วันที่</th>
                <th className="py-3.5 px-4">ชื่อผู้เบิก</th>
                <th className="py-3.5 px-4 text-right">Paycheck</th>
                <th className="py-3.5 px-4 text-right">ภาษี</th>
                <th className="py-3.5 px-4 text-right">เงินที่ได้รับสุทธิ</th>
                <th className="py-3.5 px-4">หมายเหตุ</th>
                <th className="py-3.5 px-4 sm:px-6 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                    ยังไม่มีรายการในฐานข้อมูล อัปโหลดสลิปด้านบนเพื่อเพิ่มรายการแรก
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3.5 px-4 sm:px-6 font-mono tabular-nums text-xs text-slate-300 whitespace-nowrap">
                      {formatDateThaiDisplay(rec.date)}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-white">{rec.payee}</td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-blue-300 whitespace-nowrap">
                      {formatCurrency(rec.paycheck)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-rose-300 whitespace-nowrap">
                      {formatCurrency(rec.tax)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-amber-300 whitespace-nowrap">
                      {formatCurrency(rec.netPay)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-400">{rec.note || '-'}</td>
                    <td className="py-3.5 px-4 sm:px-6 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditRow(rec)}
                          title="แก้ไข"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteRow(rec.id)}
                          title="ลบ"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-rose-400 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
