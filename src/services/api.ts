/**
 * HTTP + SSE client for the local demo backend (server/demo-server.mjs),
 * used when Firebase env vars are not configured. Error codes mirror the
 * Firebase path so UI code is mode-agnostic.
 */
import type {
  AdminUser,
  CanteenSettings,
  ConfirmScanResult,
  DailyEntry,
  Employee,
  MealItem,
  ScanContext,
  Transaction,
} from '../types';
import { BACKEND_MODE } from '../firebase/config';

export class ApiError extends Error {
  code: string;
  fieldErrors?: Record<string, string>;
  constructor(code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const ADMIN_TOKEN_KEY = 'canteen_admin_token';
const EMP_TOKEN_KEY = 'canteen_emp_token';
const EMP_SERIAL_KEY = 'canteen_emp_serial';

export function storedEmployeeToken(): string | null {
  return localStorage.getItem(EMP_TOKEN_KEY);
}

export function storedEmployeeSerial(): string | null {
  return localStorage.getItem(EMP_SERIAL_KEY);
}

export function storeEmployeeSerial(serial: string | null): void {
  if (serial) localStorage.setItem(EMP_SERIAL_KEY, serial);
  else localStorage.removeItem(EMP_SERIAL_KEY);
}

export function storeEmployeeToken(token: string | null): void {
  if (token) localStorage.setItem(EMP_TOKEN_KEY, token);
  else localStorage.removeItem(EMP_TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { employee?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  const t = opts?.employee ? storedEmployeeToken() : localStorage.getItem(ADMIN_TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // Hosted static deployments have no demo backend: /api/* is answered by the
  // SPA fallback (HTML with 200). Detect that and fail cleanly instead of
  // feeding null data into the UI (which used to crash the app).
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError('BACKEND_UNAVAILABLE', 'The data backend is not available on this hosted site. Run the app on the office computer, or complete the Firebase setup.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; fieldErrors?: Record<string, string> };
    throw new ApiError(d.error ?? `HTTP_${res.status}`, d.message ?? 'Request failed. Please try again.', d.fieldErrors);
  }
  return data as T;
}

// ---------------------------------------------------------------- auth ---
export async function apiLogin(email: string, password: string): Promise<AdminUser> {
  try {
    const res = await request<{ token: string; user: AdminUser }>('POST', '/api/auth', { email, password });
    localStorage.setItem(ADMIN_TOKEN_KEY, res.token);
    return res.user;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'AUTH_FAILED') throw err;
    throw new ApiError('NETWORK', 'Could not reach the server. Is it running?');
  }
}

export async function apiLogout(): Promise<void> {
  try {
    await request('POST', '/api/auth', { action: 'logout' });
  } finally {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

export async function apiFetchSession(): Promise<AdminUser | null> {
  const t = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!t) return null;
  try {
    return await request<AdminUser | null>('GET', '/api/auth');
  } catch {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    return null;
  }
}

// ------------------------------------------------------------ realtime ---
type Listener = (event: string) => void;
let es: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<Listener>();

function notifyAll(): void {
  // Cloud mode has no SSE stream: refresh all subscribed feeds on a short
  // interval. Each hook re-fetches only its own entity, so this stays cheap.
  listeners.forEach((l) => l('*'));
}

function ensureRealtime(): void {
  if (BACKEND_MODE === 'cloud') {
    // Serverless functions cannot hold SSE connections — poll instead.
    if (!pollTimer) pollTimer = setInterval(notifyAll, 5000);
    return;
  }
  if (es) return;
  es = new EventSource('/api/events');
  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do.
  };
  const forward = (name: string) => () => listeners.forEach((l) => l(name));
  for (const name of ['transactions', 'employees', 'mealItems', 'settings']) {
    es.addEventListener(name, forward(name));
  }
}

export function apiSubscribe(entity: 'transactions' | 'employees' | 'mealItems' | 'settings', cb: () => void): () => void {
  ensureRealtime();
  const l: Listener = (name) => {
    if (name === entity || name === '*') cb();
  };
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

// ------------------------------------------------- employee self-service ---
export interface RegisterInput {
  serial: string;
  employeeNo: string;
  name: string;
  department: string;
  phone: string;
}

const DEVICE_KEY = 'canteen_device_id';

/** Stable per-device identifier used to enforce one-login-per-serial. */
export function deviceIdentity(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function apiEmployeeRegister(input: RegisterInput): Promise<{ token: string; employee: Employee }> {
  const res = await request<{ token: string; employee: Employee }>('POST', '/api/employee-session', { ...input, deviceId: deviceIdentity() }, { employee: true });
  storeEmployeeToken(res.token);
  storeEmployeeSerial(res.employee.serial);
  return res;
}

export async function apiEmployeeMe(): Promise<Employee | null> {
  if (!storedEmployeeToken()) return null;
  try {
    const me = await request<Employee>('GET', '/api/employee-session', undefined, { employee: true });
    storeEmployeeSerial(me.serial);
    return me;
  } catch {
    storeEmployeeToken(null);
    storeEmployeeSerial(null);
    return null;
  }
}

export async function apiEmployeeLogout(): Promise<void> {
  try {
    await request('POST', '/api/employee-session', { action: 'logout' }, { employee: true });
  } finally {
    storeEmployeeToken(null);
  }
}

export async function apiScanContext(qrType: 'breakfastSnacks' | 'lunchDinner'): Promise<ScanContext> {
  return request<ScanContext>('GET', `/api/scan?qr=${qrType}`, undefined, { employee: true });
}

export async function apiScanConfirm(meal: string, addonIds: string[]): Promise<ConfirmScanResult> {
  return request<ConfirmScanResult>('POST', '/api/scan', { meal, addonIds }, { employee: true });
}

// ---------------------------------------------------------- employees ----
export async function apiListEmployees(): Promise<Employee[]> {
  const res = await request<{ employees: Employee[] }>('GET', '/api/employees');
  return res.employees;
}

export async function apiGetEmployee(serial: string): Promise<{ exists: boolean; active: boolean; employeeNo?: string; name?: string; department?: string }> {
  try {
    const e = await request<{ serial: string; active: boolean; employeeNo?: string; name?: string; department?: string }>('GET', `/api/employees?serial=${encodeURIComponent(serial)}`);
    return { exists: true, active: e.active, employeeNo: e.employeeNo, name: e.name, department: e.department };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') return { exists: false, active: false };
    throw err;
  }
}

export async function apiSaveEmployee(serial: string, data: Partial<Employee>): Promise<void> {
  await request('POST', '/api/employees', { serial, ...data });
}

export async function apiDeleteEmployee(serial: string): Promise<void> {
  await request('POST', '/api/employees', { action: 'delete', serial });
}

export async function apiBulkEmployees(count: number): Promise<number> {
  const res = await request<{ added: number }>('POST', '/api/employees', { count });
  return res.added;
}

/** Admin action: sign the employee out of their device. */
export async function apiEmployeeReset(serial: string): Promise<void> {
  await request('POST', '/api/employee-session', { action: 'reset', serial });
}

// ---------------------------------------------------------- meal items ---
export async function apiListMealItems(): Promise<MealItem[]> {
  const res = await request<{ items: MealItem[] }>('GET', '/api/meal-items');
  return res.items;
}

export async function apiCreateMealItem(item: { id?: string; name: string; price: number; enabled?: boolean }): Promise<void> {
  await request('POST', '/api/meal-items', item);
}

export async function apiSaveMealItem(item: MealItem): Promise<void> {
  await request('POST', '/api/meal-items', { action: 'save', id: item.id, name: item.name, price: item.price, enabled: item.enabled });
}

export async function apiDeleteMealItem(id: string): Promise<void> {
  await request('POST', '/api/meal-items', { action: 'delete', id });
}

// ------------------------------------------------------------- settings ---
export async function apiGetSettings(): Promise<CanteenSettings> {
  return request('GET', '/api/settings');
}

export async function apiSaveSettings(changes: Partial<CanteenSettings>): Promise<void> {
  await request('POST', '/api/settings', changes);
}

// -------------------------------------------------------- transactions ---
export async function apiListTransactions(from?: string, to?: string): Promise<Transaction[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  const res = await request<{ transactions: Transaction[] }>('GET', `/api/transactions${qs ? `?${qs}` : ''}`);
  return res.transactions;
}

export async function apiListDailyEntries(from: string, to: string): Promise<DailyEntry[]> {
  const res = await request<{ entries: DailyEntry[] }>('GET', `/api/daily-entries?from=${from}&to=${to}`);
  return res.entries;
}

export async function apiManualEntry(input: { serial: string; meal: string; addonIds?: string[] }): Promise<Transaction> {
  const res = await request<{ transaction: Transaction }>('POST', '/api/transactions', { action: 'manual', ...input });
  return res.transaction;
}

export async function apiDeleteTransaction(id: string): Promise<void> {
  await request('POST', '/api/transactions', { id });
}

export async function apiCleanupOldTransactions(cutoff: string): Promise<number> {
  const res = await request<{ deleted: number }>('POST', '/api/settings', { action: 'cleanup', cutoff });
  return res.deleted;
}
