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
    const res = await request<{ token: string; user: AdminUser }>('POST', '/api/auth/login', { email, password });
    localStorage.setItem(ADMIN_TOKEN_KEY, res.token);
    return res.user;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'AUTH_FAILED') throw err;
    throw new ApiError('NETWORK', 'Could not reach the server. Is it running?');
  }
}

export async function apiLogout(): Promise<void> {
  try {
    await request('POST', '/api/auth/logout');
  } finally {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

export async function apiFetchSession(): Promise<AdminUser | null> {
  const t = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!t) return null;
  try {
    return await request<AdminUser | null>('GET', '/api/auth/me');
  } catch {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    return null;
  }
}

// ------------------------------------------------------------ realtime ---
type Listener = (event: string) => void;
let es: EventSource | null = null;
const listeners = new Set<Listener>();

function ensureEventSource(): void {
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
  ensureEventSource();
  const l: Listener = (name) => {
    if (name === entity) cb();
  };
  listeners.add(l);
  return () => listeners.delete(l);
}

// ------------------------------------------------- employee self-service ---
export interface RegisterInput {
  serial: string;
  employeeNo: string;
  name: string;
  department: string;
}

export async function apiEmployeeRegister(input: RegisterInput): Promise<{ token: string; employee: Employee }> {
  const res = await request<{ token: string; employee: Employee }>('POST', '/api/employee/register', input, { employee: true });
  storeEmployeeToken(res.token);
  storeEmployeeSerial(res.employee.serial);
  return res;
}

export async function apiEmployeeMe(): Promise<Employee | null> {
  if (!storedEmployeeToken()) return null;
  try {
    const me = await request<Employee>('GET', '/api/employee/me', undefined, { employee: true });
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
    await request('POST', '/api/employee/logout', undefined, { employee: true });
  } finally {
    storeEmployeeToken(null);
  }
}

export async function apiScanContext(qrType: 'breakfastSnacks' | 'lunchDinner'): Promise<ScanContext> {
  return request<ScanContext>('GET', `/api/scan/context?qr=${qrType}`, undefined, { employee: true });
}

export async function apiScanConfirm(meal: string, addonIds: string[]): Promise<ConfirmScanResult> {
  return request<ConfirmScanResult>('POST', '/api/scan/confirm', { meal, addonIds }, { employee: true });
}

// ---------------------------------------------------------- employees ----
export async function apiListEmployees(): Promise<Employee[]> {
  const res = await request<{ employees: Employee[] }>('GET', '/api/employees');
  return res.employees;
}

export async function apiGetEmployee(serial: string): Promise<{ exists: boolean; active: boolean; employeeNo?: string; name?: string; department?: string }> {
  try {
    const e = await request<{ serial: string; active: boolean; employeeNo?: string; name?: string; department?: string }>('GET', `/api/employees/${encodeURIComponent(serial)}`);
    return { exists: true, active: e.active, employeeNo: e.employeeNo, name: e.name, department: e.department };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') return { exists: false, active: false };
    throw err;
  }
}

export async function apiSaveEmployee(serial: string, data: Partial<Employee>): Promise<void> {
  await request('PUT', `/api/employees/${encodeURIComponent(serial)}`, data);
}

export async function apiDeleteEmployee(serial: string): Promise<void> {
  await request('DELETE', `/api/employees/${encodeURIComponent(serial)}`);
}

export async function apiBulkEmployees(count: number): Promise<number> {
  const res = await request<{ added: number }>('POST', '/api/employees/bulk', { count });
  return res.added;
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
  await request('PUT', `/api/meal-items/${item.id}`, { name: item.name, price: item.price, enabled: item.enabled });
}

export async function apiDeleteMealItem(id: string): Promise<void> {
  await request('DELETE', `/api/meal-items/${id}`);
}

// ------------------------------------------------------------- settings ---
export async function apiGetSettings(): Promise<CanteenSettings> {
  return request('GET', '/api/settings');
}

export async function apiSaveSettings(changes: Partial<CanteenSettings>): Promise<void> {
  await request('PUT', '/api/settings', changes);
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
  const res = await request<{ transaction: Transaction }>('POST', '/api/manual-entry', input);
  return res.transaction;
}

export async function apiDeleteTransaction(id: string): Promise<void> {
  await request('DELETE', `/api/transactions/${encodeURIComponent(id)}`);
}

export async function apiCleanupOldTransactions(cutoff: string): Promise<number> {
  const res = await request<{ deleted: number }>('POST', '/api/cleanup', { cutoff });
  return res.deleted;
}
