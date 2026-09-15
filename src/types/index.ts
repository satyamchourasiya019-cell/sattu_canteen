// ---------------------------------------------------------------------
// Core domain types — QR billing model
// ---------------------------------------------------------------------

export type MealType = 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export const MEALS: MealType[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snacks: 'Snacks',
  dinner: 'Dinner',
};

/** Which physical QR covers a meal. */
export function mealSlot(meal: MealType): 'breakfastSnacks' | 'lunchDinner' {
  return meal === 'lunch' || meal === 'dinner' ? 'lunchDinner' : 'breakfastSnacks';
}

export const QR_TYPE_LABELS: Record<QrType, string> = {
  breakfastSnacks: 'Breakfast + Snacks',
  lunchDinner: 'Lunch + Dinner',
};

export type QrType = 'breakfastSnacks' | 'lunchDinner';

/** A meal time window, 24h "HH:mm". May cross midnight (e.g. dinner 19:00→01:00). */
export interface MealWindow {
  from: string;
  to: string;
}

/** Addon menu item (admin-managed): Tea, Coffee, Curd, Sweet, Extra Roti… */
export interface MealItem {
  id: string;
  name: string;
  price: number;
  enabled: boolean;
}

/** Addon snapshot on a transaction. */
export interface Addon {
  id: string;
  name: string;
  price: number;
}

/**
 * One QR scan result. One record per employee per meal per day (id is
 * "<date>_<serial>_<meal>"), so duplicate scans can never double-charge.
 * A duplicate scan with extra items creates a separate "_addonN" record.
 */
export interface Transaction {
  id: string;
  employeeId: string; // = serial
  employeeNo: string;
  serial: string;
  name: string;
  department: string;
  date: string; // YYYY-MM-DD (local)
  time: string; // HH:mm (local, 24h)
  qrType: QrType;
  meal: MealType;
  mealAmount: number; // 0 on addon-only records
  addons: Addon[];
  addonAmount: number;
  amount: number; // mealAmount + addonAmount
  status: 'ok' | 'cancelled';
  mode: 'qr' | 'manual' | 'addon';
  createdAt: number;
  updatedAt: number;
}

/** Master data for a serial number. Created by admin or self-signup. */
export interface Employee {
  serial: string;
  employeeNo: string;
  name: string;
  department: string;
  /** Contact number entered at login (optional). */
  phone: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** True when a device is currently logged in with this serial. */
  loggedIn?: boolean;
  /** Timestamp of the current device login (ms epoch), null when logged out. */
  loginAt?: number | null;
}

/** One row of the Admin "Serial Number Page": a day's billing for one serial. */
export interface DailyEntry {
  serial: string;
  employeeNo: string;
  name: string;
  department: string;
  date: string;
  breakfast: number;
  snacks: number;
  lunch: number;
  dinner: number;
  addonAmount: number;
  addons: Addon[];
  total: number;
  lastTime: string;
}

/** Response of the scan-context API (time detection + duplicate check). */
export interface ScanContext {
  employee: Pick<Employee, 'serial' | 'employeeNo' | 'name' | 'department'>;
  qrType: QrType;
  meal: MealType;
  time: string;
  date: string;
  mealAmount: number;
  alreadyTaken: boolean;
  existingTransaction: Transaction | null;
  addons: MealItem[];
}

/** Result of confirming a scan. */
export interface ConfirmScanResult {
  transaction: Transaction;
  kind: 'created' | 'addon';
}

export type AdminRole = 'admin' | 'supervisor';

export interface AdminUser {
  uid: string;
  email: string;
  role: AdminRole;
}

export interface CanteenSettings {
  canteenName: string;
  retentionDays: number;
  lastCleanupAt: number | null;
  allowSelfRegistration: boolean;
  mealTimings: Record<MealType, MealWindow>;
}

export interface MealTimings {
  breakfast: MealWindow;
  lunch: MealWindow;
  snacks: MealWindow;
  dinner: MealWindow;
}

export const DEFAULT_MEAL_PRICES: Record<MealType, number> = {
  breakfast: 30,
  lunch: 50,
  snacks: 15,
  dinner: 50,
};
