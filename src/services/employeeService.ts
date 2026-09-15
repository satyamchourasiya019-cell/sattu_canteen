import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { requireDb, BACKEND_MODE } from '../firebase/config';
import type { Employee } from '../types';
import * as api from './api';

const COLLECTION = 'employees';

export function validateSerialInput(raw: string): string {
  const serial = raw.trim().replace(/\s+/g, '');
  if (!serial) return '';
  if (serial.length > 20) return '';
  if (!/^[0-9A-Za-z-]+$/.test(serial)) return '';
  return serial;
}

function toEmployee(serial: string, data: Record<string, unknown>): Employee {
  return {
    serial,
    employeeNo: typeof data.employeeNo === 'string' ? data.employeeNo : '',
    name: typeof data.name === 'string' ? data.name : '',
    department: typeof data.department === 'string' ? data.department : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    active: data.active !== false,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    loggedIn: data.loggedIn === true || typeof data.loginDevice === 'string' && data.loginDevice !== '',
    loginAt: typeof data.loginAt === 'number' ? data.loginAt : null,
  };
}

/** Realtime list of all employees (admin only). */
export function subscribeEmployees(cb: (list: Employee[]) => void, onError?: (msg: string) => void): () => void {
  if (BACKEND_MODE !== 'firebase') {
    const refresh = async () => {
      try {
        cb(await api.apiListEmployees());
      } catch {
        onError?.('Unable to load employees. Please check your connection.');
      }
    };
    void refresh();
    const unsub = api.apiSubscribe('employees', () => void refresh());
    return () => unsub();
  }
  try {
    const db = requireDb();
    return onSnapshot(
      collection(db, COLLECTION),
      (snap) => {
        const list: Employee[] = [];
        snap.forEach((d) => list.push(toEmployee(d.id, d.data() as Record<string, unknown>)));
        list.sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
        cb(list);
      },
      () => onError?.('Unable to load employees. Please check your connection.'),
    );
  } catch {
    onError?.('The system is not configured yet.');
    return () => undefined;
  }
}

/** One-time fetch (admin / reports). */
export async function fetchEmployees(): Promise<Employee[]> {
  if (BACKEND_MODE !== 'firebase') return api.apiListEmployees();
  const db = requireDb();
  const snap = await getDocs(collection(db, COLLECTION));
  const list: Employee[] = [];
  snap.forEach((d) => list.push(toEmployee(d.id, d.data() as Record<string, unknown>)));
  list.sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
  return list;
}

export interface SerialCheck {
  ok: boolean;
  reason: 'not_found' | 'inactive' | 'db' | null;
}

export interface SerialCheck {
  ok: boolean;
  reason: 'not_found' | 'inactive' | 'db' | null;
  /** Full master data (empty strings when the doc has none). */
  employeeNo?: string;
  name?: string;
  department?: string;
  phone?: string;
}

/**
 * Public single-serial check (used during employee registration and scans).
 * In both modes this reads ONE employee doc only — never the list.
 */
export async function checkSerial(serial: string): Promise<SerialCheck> {
  if (BACKEND_MODE !== 'firebase') {
    try {
      const r = await api.apiGetEmployee(serial);
      if (!r.exists) return { ok: false, reason: 'not_found' };
      if (!r.active) return { ok: false, reason: 'inactive' };
      return { ok: true, reason: null, employeeNo: (r as { employeeNo?: string }).employeeNo ?? '', name: (r as { name?: string }).name ?? '', department: (r as { department?: string }).department ?? '', phone: (r as { phone?: string }).phone ?? '' };
    } catch {
      return { ok: false, reason: 'db' };
    }
  }
  try {
    const db = requireDb();
    const snap = await getDoc(doc(db, COLLECTION, serial));
    if (!snap.exists()) return { ok: false, reason: 'not_found' };
    const data = snap.data() as Record<string, unknown>;
    if (data.active === false) return { ok: false, reason: 'inactive' };
    return {
      ok: true,
      reason: null,
      employeeNo: typeof data.employeeNo === 'string' ? data.employeeNo : '',
      name: typeof data.name === 'string' ? data.name : '',
      department: typeof data.department === 'string' ? data.department : '',
      phone: typeof data.phone === 'string' ? data.phone : '',
    };
  } catch {
    return { ok: false, reason: 'db' };
  }
}

/** Create or update an employee (admin). */
export async function saveEmployee(serial: string, data: Partial<Employee>): Promise<void> {
  if (BACKEND_MODE !== 'firebase') return api.apiSaveEmployee(serial, data);
  const db = requireDb();
  await setDoc(
    doc(db, COLLECTION, serial),
    { ...data, updatedAt: Date.now() },
    { merge: true },
  );
}

export async function deleteEmployee(serial: string): Promise<void> {
  if (BACKEND_MODE !== 'firebase') return api.apiDeleteEmployee(serial);
  const db = requireDb();
  await deleteDoc(doc(db, COLLECTION, serial));
}

/**
 * Admin action: sign the employee out of their device. The employee can log
 * in again afterwards (Firebase mode uses a Firestore flag; see FIREBASE_SETUP.md).
 */
export async function resetEmployeeLogin(serial: string): Promise<void> {
  if (BACKEND_MODE !== 'firebase') return api.apiEmployeeReset(serial);
  const db = requireDb();
  await setDoc(doc(db, COLLECTION, serial), { loginDevice: null, loginAt: null, updatedAt: Date.now() }, { merge: true });
}

export async function bulkCreateSerials(count: number): Promise<number> {
  if (BACKEND_MODE !== 'firebase') return api.apiBulkEmployees(count);
  const db = requireDb();
  const pad = Math.min(6, Math.max(3, String(count).length + 1));
  let added = 0;
  const t = Date.now();
  for (let i = 1; i <= count; i++) {
    const serial = String(i).padStart(pad, '0');
    const ref = doc(db, COLLECTION, serial);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, { employeeNo: '', name: '', department: '', active: true, createdAt: t, updatedAt: t });
      added++;
    }
  }
  return added;
}
