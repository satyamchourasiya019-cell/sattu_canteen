/**
 * Serverless data layer for the deployed cloud mode (Vercel + Upstash Redis).
 * Mirrors the entity model of server/demo-server.mjs so the same frontend
 * works against both.
 *
 * Uses the plain Upstash REST API with fetch — no SDK dependency.
 */
const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const cloudEnabled = Boolean(REST_URL && REST_TOKEN);

async function redis(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`redis ${res.status}`);
  }
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const raw = (await redis(['GET', key])) as string | null;
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  await redis(['SET', key, JSON.stringify(value)]);
}

export async function del(key: string): Promise<void> {
  await redis(['DEL', key]);
}

/**
 * Execute many Redis commands in one REST roundtrip (Upstash pipeline).
 * Critical for list endpoints: a day with hundreds of transactions must not
 * pay one HTTP roundtrip per record.
 */
export async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`redis pipeline ${res.status}`);
  }
  const data = (await res.json()) as { result: unknown[] };
  return data.result;
}

/** GET many keys in batched pipelines, preserving order. Null for missing keys. */
export async function getMany<T>(keysToGet: string[]): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  const CHUNK = 50;
  for (let i = 0; i < keysToGet.length; i += CHUNK) {
    const chunk = keysToGet.slice(i, i + CHUNK);
    const results = await pipeline(chunk.map((k) => ['GET', k]));
    for (const raw of results) {
      if (raw === null || raw === undefined) {
        out.push(null);
        continue;
      }
      try {
        out.push(JSON.parse(String(raw)) as T);
      } catch {
        out.push(null);
      }
    }
  }
  return out;
}

/** Atomic check-and-set using a WATCH-free optimistic loop via GET then SET with NX semantics handled by caller. */
export async function setIfAbsent(key: string, value: unknown): Promise<boolean> {
  const result = (await redis(['SET', key, JSON.stringify(value), 'NX'])) as unknown;
  return result === 'OK';
}

// ------------------------------------------------------------- entities ---
export interface EmployeeRecord {
  employeeNo: string;
  name: string;
  department: string;
  phone?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** Device currently logged in as this employee (login persists until the
   *  admin resets it or the employee logs out on the device itself). */
  loginDevice?: string | null;
  loginAt?: number | null;
}

export interface MealItemRecord {
  id: string;
  name: string;
  price: number;
  enabled: boolean;
  isMeal?: boolean;
}

export interface Addon {
  id: string;
  name: string;
  price: number;
}

export interface TransactionRecord {
  id: string;
  employeeId: string;
  employeeNo: string;
  serial: string;
  name: string;
  department: string;
  date: string;
  time: string;
  qrType: 'breakfastSnacks' | 'lunchDinner';
  meal: string;
  mealAmount: number;
  addons: Addon[];
  addonAmount: number;
  amount: number;
  status: 'ok' | 'cancelled';
  mode: 'qr' | 'manual' | 'addon';
  createdAt: number;
  updatedAt: number;
}

export interface SettingsRecord {
  canteenName: string;
  retentionDays: number;
  lastCleanupAt: number | null;
  allowSelfRegistration: boolean;
  mealTimings: Record<string, { from: string; to: string }>;
}

export interface SessionRecord {
  uid: string;
  email: string;
  role: 'admin' | 'supervisor';
  expiresAt: number;
}

export interface EmployeeSessionRecord {
  serial: string;
  createdAt: number;
  deviceId?: string | null;
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  canteenName: 'Company Canteen',
  retentionDays: 365,
  lastCleanupAt: null,
  allowSelfRegistration: true,
  mealTimings: {
    breakfast: { from: '06:00', to: '11:00' },
    lunch: { from: '11:00', to: '16:00' },
    snacks: { from: '16:00', to: '19:00' },
    dinner: { from: '19:00', to: '23:00' },
  },
};

const DEFAULT_MEAL_ITEMS: MealItemRecord[] = [
  { id: 'breakfast', name: 'Breakfast', price: 30, enabled: true, isMeal: true },
  { id: 'lunch', name: 'Lunch', price: 50, enabled: true, isMeal: true },
  { id: 'snacks', name: 'Snacks', price: 15, enabled: true, isMeal: true },
  { id: 'dinner', name: 'Dinner', price: 50, enabled: true, isMeal: true },
  { id: 'tea', name: 'Tea', price: 10, enabled: true },
  { id: 'coffee', name: 'Coffee', price: 15, enabled: true },
  { id: 'milk', name: 'Milk', price: 20, enabled: true },
  { id: 'juice', name: 'Juice', price: 25, enabled: true },
  { id: 'extra-roti', name: 'Extra Roti', price: 5, enabled: true },
  { id: 'extra-sabzi', name: 'Extra Sabzi', price: 20, enabled: true },
  { id: 'curd', name: 'Curd', price: 10, enabled: true },
  { id: 'sweet', name: 'Sweet', price: 15, enabled: true },
  { id: 'salad', name: 'Salad', price: 10, enabled: true },
  { id: 'buttermilk', name: 'Buttermilk', price: 10, enabled: true },
  { id: 'other', name: 'Other', price: 10, enabled: true },
];

/** Seed defaults once. Called lazily on first request. */
export async function ensureSeeded(): Promise<void> {
  const seeded = await getJSON<boolean>('seeded:v1');
  if (seeded) return;
  await setJSON('settings', DEFAULT_SETTINGS);
  await setJSON(
    'mealItems',
    Object.fromEntries(DEFAULT_MEAL_ITEMS.map((i) => [i.id, i])),
  );
  await setJSON('users', [
    { uid: 'admin-1', email: 'admin@canteen.local', password: 'admin123', role: 'admin' },
    { uid: 'super-1', email: 'supervisor1@canteen.local', password: 'super123', role: 'supervisor' },
    { uid: 'super-2', email: 'supervisor2@canteen.local', password: 'super123', role: 'supervisor' },
  ]);
  await setJSON('seeded:v1', true);
}

/** Redis key helpers. */
export const keys = {
  settings: 'settings',
  mealItems: 'mealItems',
  users: 'users',
  sessions: 'sessions', // hash field = token
  employeeSessions: 'employeeSessions',
  employee: (serial: string) => `employee:${serial}`,
  employeesIndex: 'employees:index', // map serial -> record (admin list)
  employeeNoIndex: 'employeeNoIndex', // hash field = employeeNo -> serial
  transaction: (id: string) => `txn:${id}`,
  txnByDate: (date: string) => `txns:date:${date}`, // set of txn ids
};
