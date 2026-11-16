import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { PaycheckRecord } from '../types/paycheck';
import { getThailandTodayISO } from '../utils/formatters';

const PAYCHECKS_COLLECTION = 'paychecks';

export function sanitizeFieldText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1_000_000_000, Math.max(0, Number(value.toFixed(2))));
}

export function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return getThailandTodayISO();
}

export function generateSafeDocId(prefix = 'rec'): string {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${randomPart}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function subscribePaychecks(
  onData: (records: PaycheckRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const colRef = collection(db, PAYCHECKS_COLLECTION);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: PaycheckRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          payee: typeof data.payee === 'string' ? data.payee : '',
          paycheck: Number(data.paycheck) || 0,
          tax: Number(data.tax) || 0,
          netPay: Number(data.netPay) || 0,
          date: typeof data.date === 'string' ? data.date : getThailandTodayISO(),
          note: typeof data.note === 'string' ? data.note : '',
        };
      });

      items.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return b.netPay - a.netPay;
      });

      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, PAYCHECKS_COLLECTION);
      } catch (wrappedErr) {
        onError(wrappedErr instanceof Error ? wrappedErr : new Error(String(wrappedErr)));
      }
    }
  );
}

export async function createPaycheckRecord(input: Omit<PaycheckRecord, 'id'>): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('กรุณาเชื่อมต่อบัญชี Google Admin ก่อนบันทึกข้อมูลออนไลน์');
  }

  const id = generateSafeDocId('rec');
  const docPath = `${PAYCHECKS_COLLECTION}/${id}`;
  const payload = {
    payee: sanitizeFieldText(input.payee, 120),
    paycheck: clampAmount(input.paycheck),
    tax: clampAmount(input.tax),
    netPay: clampAmount(input.netPay),
    date: normalizeDate(input.date),
    note: sanitizeFieldText(input.note, 200),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (!payload.payee) {
    throw new Error('กรุณาระบุชื่อผู้เบิกก่อนบันทึก');
  }

  try {
    await setDoc(doc(db, PAYCHECKS_COLLECTION, id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function createPaycheckRecordsBatch(
  inputs: Omit<PaycheckRecord, 'id'>[]
): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('กรุณาเชื่อมต่อบัญชี Google Admin ก่อนบันทึกข้อมูลออนไลน์');
  }

  const validInputs = inputs
    .map((item) => ({
      payee: sanitizeFieldText(item.payee, 120),
      paycheck: clampAmount(item.paycheck),
      tax: clampAmount(item.tax),
      netPay: clampAmount(item.netPay),
      date: normalizeDate(item.date),
      note: sanitizeFieldText(item.note, 200),
    }))
    .filter((item) => item.payee.length > 0);

  if (validInputs.length === 0) {
    throw new Error('ไม่พบรายการที่มีชื่อผู้เบิกสำหรับบันทึก');
  }

  // Firestore writeBatch supports up to 500 ops per batch
  const chunkSize = 400;
  try {
    for (let i = 0; i < validInputs.length; i += chunkSize) {
      const chunk = validInputs.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((item, idx) => {
        const id = generateSafeDocId(`rec${i + idx}`);
        batch.set(doc(db, PAYCHECKS_COLLECTION, id), {
          ...item,
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
    return validInputs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, PAYCHECKS_COLLECTION);
  }
}

export async function updatePaycheckRecord(
  id: string,
  input: Omit<PaycheckRecord, 'id'>
): Promise<void> {
  if (!auth.currentUser?.uid) {
    throw new Error('กรุณาเชื่อมต่อบัญชี Google Admin ก่อนแก้ไขข้อมูลออนไลน์');
  }

  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const docPath = `${PAYCHECKS_COLLECTION}/${safeId}`;
  const payload = {
    payee: sanitizeFieldText(input.payee, 120),
    paycheck: clampAmount(input.paycheck),
    tax: clampAmount(input.tax),
    netPay: clampAmount(input.netPay),
    date: normalizeDate(input.date),
    note: sanitizeFieldText(input.note, 200),
    updatedAt: serverTimestamp(),
  };

  if (!payload.payee) {
    throw new Error('กรุณาระบุชื่อผู้เบิกก่อนบันทึก');
  }

  try {
    await updateDoc(doc(db, PAYCHECKS_COLLECTION, safeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deletePaycheckRecord(id: string): Promise<void> {
  if (!auth.currentUser?.uid) {
    throw new Error('กรุณาเชื่อมต่อบัญชี Google Admin ก่อนลบข้อมูลออนไลน์');
  }

  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const docPath = `${PAYCHECKS_COLLECTION}/${safeId}`;
  try {
    await deleteDoc(doc(db, PAYCHECKS_COLLECTION, safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function deleteAllPaycheckRecords(ids: string[]): Promise<void> {
  if (!auth.currentUser?.uid) {
    throw new Error('กรุณาเชื่อมต่อบัญชี Google Admin ก่อนล้างข้อมูลออนไลน์');
  }
  if (ids.length === 0) return;

  const chunkSize = 400;
  try {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((id) => {
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
        if (safeId) {
          batch.delete(doc(db, PAYCHECKS_COLLECTION, safeId));
        }
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, PAYCHECKS_COLLECTION);
  }
}
