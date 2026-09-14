import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { requireDb, BACKEND_MODE } from '../firebase/config';
import type { DailyEntry, Transaction } from '../types';
import { mealSlot } from '../types';
import * as api from './api';

const COLLECTION = 'transactions';

export function toTransaction(id: string, data: Record<string, unknown>): Transaction {
  const addons = Array.isArray(data.addons)
    ? (data.addons as Record<string, unknown>[])
        .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.price === 'number')
        .map((a) => ({ id: a.id as string, name: a.name as string, price: a.price as number }))
    : [];
  return {
    id,
    employeeId: typeof data.employeeId === 'string' ? data.employeeId : '',
    employeeNo: typeof data.employeeNo === 'string' ? data.employeeNo : '',
    serial: typeof data.serial === 'string' ? data.serial : '',
    name: typeof data.name === 'string' ? data.name : '',
    department: typeof data.department === 'string' ? data.department : '',
    date: typeof data.date === 'string' ? data.date : '',
    time: typeof data.time === 'string' ? data.time : '',
    qrType: mealSlot((data.meal as Transaction['meal']) ?? 'lunch'),
    meal: (data.meal as Transaction['meal']) ?? 'lunch',
    mealAmount: typeof data.mealAmount === 'number' ? data.mealAmount : 0,
    addons,
    addonAmount: typeof data.addonAmount === 'number' ? data.addonAmount : 0,
    amount: typeof data.amount === 'number' ? data.amount : 0,
    status: data.status === 'cancelled' ? 'cancelled' : 'ok',
    mode: data.mode === 'manual' ? 'manual' : data.mode === 'addon' ? 'addon' : 'qr',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

/** Realtime transactions for one day (dashboard + serial page). */
export function subscribeTransactionsByDate(
  dateStr: string,
  cb: (txns: Transaction[]) => void,
  onError?: (msg: string) => void,
): () => void {
  if (BACKEND_MODE !== 'firebase') {
    let list: Transaction[] = [];
    const refresh = async () => {
      try {
        list = await api.apiListTransactions(dateStr, dateStr);
        list.sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt);
        cb(list);
      } catch {
        onError?.('Live updates stopped. Please check your connection and refresh.');
      }
    };
    void refresh();
    const unsub = api.apiSubscribe('transactions', () => void refresh());
    return () => unsub();
  }
  try {
    const db = requireDb();
    const q = query(collection(db, COLLECTION), where('date', '==', dateStr), orderBy('createdAt'));
    return onSnapshot(
      q,
      (snap) => {
        const txns: Transaction[] = [];
        snap.forEach((d) => txns.push(toTransaction(d.id, d.data() as Record<string, unknown>)));
        txns.sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt);
        cb(txns);
      },
      (err) => {
        if (err.code === 'failed-precondition') {
          onError?.('The database index is still building. Please retry in a few minutes.');
        } else {
          onError?.('Live updates stopped. Please check your connection and refresh.');
        }
      },
    );
  } catch {
    onError?.('The system is not configured yet.');
    return () => undefined;
  }
}

/** Realtime transactions for a date range (transactions page). */
export function subscribeTransactionsRange(
  from: string,
  to: string,
  cb: (txns: Transaction[]) => void,
  onError?: (msg: string) => void,
): () => void {
  if (BACKEND_MODE !== 'firebase') {
    let list: Transaction[] = [];
    const refresh = async () => {
      try {
        list = await api.apiListTransactions(from, to);
        list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
        cb(list);
      } catch {
        onError?.('Live updates stopped. Please check your connection and refresh.');
      }
    };
    void refresh();
    const unsub = api.apiSubscribe('transactions', () => void refresh());
    return () => unsub();
  }
  try {
    const db = requireDb();
    const q = query(collection(db, COLLECTION), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        const txns: Transaction[] = [];
        snap.forEach((d) => txns.push(toTransaction(d.id, d.data() as Record<string, unknown>)));
        cb(txns);
      },
      (err) => {
        if (err.code === 'failed-precondition') {
          onError?.('The database index is still building. Please retry in a few minutes.');
        } else {
          onError?.('Live updates stopped. Please check your connection and refresh.');
        }
      },
    );
  } catch {
    onError?.('The system is not configured yet.');
    return () => undefined;
  }
}

/** One-time fetch for reports (range, newest first). */
export async function fetchTransactionsRange(from: string, to: string): Promise<Transaction[]> {
  if (BACKEND_MODE !== 'firebase') return api.apiListTransactions(from, to);
  const db = requireDb();
  const q = query(collection(db, COLLECTION), where('date', '>=', from), where('date', '<=', to));
  const snap = await getDocs(q);
  const txns: Transaction[] = [];
  snap.forEach((d) => txns.push(toTransaction(d.id, d.data() as Record<string, unknown>)));
  txns.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return txns;
}

/** Realtime daily billing sheet (Serial page). */
export function subscribeDailyEntries(
  from: string,
  to: string,
  cb: (entries: DailyEntry[]) => void,
  onError?: (msg: string) => void,
): () => void {
  if (BACKEND_MODE !== 'firebase') {
    let list: DailyEntry[] = [];
    const refresh = async () => {
      try {
        list = await api.apiListDailyEntries(from, to);
        cb(list);
      } catch {
        onError?.('Live updates stopped. Please check your connection and refresh.');
      }
    };
    void refresh();
    const unsub = api.apiSubscribe('transactions', () => void refresh());
    return () => unsub();
  }
  // Firebase mode: subscribe to the range and aggregate on the client.
  const unsubTxns = subscribeTransactionsRange(
    from,
    to,
    (txns) => cb(aggregateDailyEntries(txns)),
    onError,
  );
  return () => unsubTxns();
}

/** Client-side aggregation mirroring the server's /api/daily-entries. */
export function aggregateDailyEntries(txns: Transaction[]): DailyEntry[] {
  const bySerial = new Map<string, DailyEntry>();
  for (const t of txns) {
    let e = bySerial.get(t.serial);
    if (!e) {
      e = {
        serial: t.serial,
        employeeNo: t.employeeNo,
        name: t.name,
        department: t.department,
        date: t.date,
        breakfast: 0,
        snacks: 0,
        lunch: 0,
        dinner: 0,
        addonAmount: 0,
        addons: [],
        total: 0,
        lastTime: t.time,
      };
      bySerial.set(t.serial, e);
    }
    if (t.meal === 'breakfast') e.breakfast += t.mealAmount;
    else if (t.meal === 'snacks') e.snacks += t.mealAmount;
    else if (t.meal === 'lunch') e.lunch += t.mealAmount;
    else if (t.meal === 'dinner') e.dinner += t.mealAmount;
    e.addonAmount += t.addonAmount;
    e.addons.push(...t.addons);
    e.total += t.amount;
    if (t.time > e.lastTime) e.lastTime = t.time;
  }
  return [...bySerial.values()].sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
}

/** Admin manual entry / correction (skips duplicate protection on purpose). */
export async function createManualEntry(input: {
  serial: string;
  meal: Transaction['meal'];
  addonIds?: string[];
}): Promise<Transaction> {
  if (BACKEND_MODE !== 'firebase') return api.apiManualEntry(input);
  const db = requireDb();
  const t = new Date();
  const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const id = `${date}_${input.serial}_${input.meal}_${Date.now()}`;
  const txn: Omit<Transaction, 'id' | 'employeeNo' | 'name' | 'department'> & { createdAt: number; updatedAt: number } = {
    employeeId: input.serial,
    serial: input.serial,
    date,
    time,
    qrType: mealSlot(input.meal),
    meal: input.meal,
    mealAmount: 0, // resolved from pricing at read time in Firebase mode is not possible; admin edits amounts on the row if needed
    addons: [],
    addonAmount: 0,
    amount: 0,
    status: 'ok',
    mode: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, COLLECTION, id), txn);
  return { ...txn, id, employeeNo: '', name: '', department: '' };
}

export async function deleteTransaction(id: string): Promise<void> {
  if (BACKEND_MODE !== 'firebase') return api.apiDeleteTransaction(id);
  const db = requireDb();
  await deleteDoc(doc(db, COLLECTION, id));
}

export async function cleanupOldTransactions(cutoff: string): Promise<number> {
  if (BACKEND_MODE !== 'firebase') return api.apiCleanupOldTransactions(cutoff);
  const db = requireDb();
  const q = query(collection(db, COLLECTION), where('date', '<', cutoff));
  const snap = await getDocs(q);
  let deleted = 0;
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    deleted++;
  }
  return deleted;
}
