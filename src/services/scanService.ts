import { BACKEND_MODE, requireDb, requireAuth } from '../firebase/config';
import type { ConfirmScanResult, MealItem, ScanContext, Transaction } from '../types';
import { DEFAULT_MEAL_PRICES, MEALS, mealSlot } from '../types';
import { detectMeal } from '../utils/meals';
import { toDateString, toTimeString } from '../utils/format';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import * as api from './api';
import { fetchSettings } from './settingsService';
import { fetchMealItems } from './mealItemService';
import { checkSerial } from './employeeService';

const MEAL_IDS = new Set<string>(MEALS);

/** Admin-set meal price from mealItems (falls back to the default). */
function priceForMeal(items: MealItem[], meal: string): number {
  const entry = items.find((i) => i.id === meal);
  return entry && typeof entry.price === 'number' ? entry.price : DEFAULT_MEAL_PRICES[meal as keyof typeof DEFAULT_MEAL_PRICES] ?? 0;
}

function isAddon(item: MealItem): boolean {
  return item.enabled && !MEAL_IDS.has(item.id);
}

/**
 * Employee QR scan flow.
 *
 * Local mode: the demo server performs time detection, duplicate checks and
 * pricing — the phone clock is never trusted.
 *
 * Firebase mode: the device signs in anonymously, the serial is stored on the
 * device, and transactions are written with the deterministic id
 * "<date>_<serial>_<meal>" so a duplicate scan can never double-charge
 * (the second write updates the same document).
 */

/** Sign the device in (anonymous in Firebase mode) and remember the serial. */
export async function ensureEmployeeIdentity(serial: string): Promise<void> {
  if (BACKEND_MODE === 'firebase') {
    const auth = requireAuth();
    if (!auth.currentUser) await signInAnonymously(auth);
  }
  api.storeEmployeeSerial(serial);
}

export function currentEmployeeSerial(): string | null {
  return api.storedEmployeeSerial();
}

export function clearEmployeeIdentity(): void {
  api.storeEmployeeSerial(null);
  if (BACKEND_MODE === 'local') void api.apiEmployeeLogout();
}

function todayTxnId(date: string, serial: string, meal: string): string {
  return `${date}_${serial}_${meal}`;
}

export async function getScanContext(qrType: ScanContext['qrType']): Promise<ScanContext> {
  if (BACKEND_MODE === 'local') return api.apiScanContext(qrType);

  const serial = api.storedEmployeeSerial();
  if (!serial) throw new Error('UNAUTHENTICATED');
  const check = await checkSerial(serial);
  if (!check.ok) throw new Error('UNAUTHENTICATED');

  const settings = await fetchSettings();
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const meal = detectMeal(mins, settings.mealTimings);
  const time = toTimeString(d);
  const date = toDateString(d);

  if (!meal || mealSlot(meal) !== qrType) {
    const err = new Error('WRONG_TIME') as Error & { code: string };
    err.code = 'WRONG_TIME';
    throw err;
  }

  const [addons, existingSnap] = await Promise.all([
    fetchMealItems(),
    getDoc(doc(requireDb(), 'transactions', todayTxnId(date, serial, meal))),
  ]);

  return {
    employee: { serial, employeeNo: '', name: '', department: '' },
    qrType,
    meal,
    time,
    date,
    mealAmount: priceForMeal(addons, meal),
    alreadyTaken: existingSnap.exists(),
    existingTransaction: existingSnap.exists() ? ({ ...(existingSnap.data() as Transaction), id: existingSnap.id } as Transaction) : null,
    addons: addons.filter(isAddon),
  };
}

export async function confirmScan(meal: string, addonIds: string[]): Promise<ConfirmScanResult> {
  if (BACKEND_MODE === 'local') return api.apiScanConfirm(meal, addonIds);

  const serial = api.storedEmployeeSerial();
  if (!serial) throw new Error('UNAUTHENTICATED');

  const [settings, items] = await Promise.all([fetchSettings(), fetchMealItems()]);
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const active = detectMeal(mins, settings.mealTimings);
  if (!active || active !== meal || mealSlot(active) !== mealSlot(meal as ScanContext['meal'])) {
    const err = new Error('WRONG_MEAL') as Error & { code: string };
    err.code = 'WRONG_MEAL';
    throw err;
  }

  const addons = addonIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is MealItem => Boolean(i))
    .filter(isAddon)
    .map((i) => ({ id: i.id, name: i.name, price: i.price }));

  const date = toDateString(d);
  const time = toTimeString(d);
  const mealAmount = priceForMeal(items, meal);
  const addonAmount = addons.reduce((s, a) => s + a.price, 0);
  const id = todayTxnId(date, serial, meal);
  const existing = await getDoc(doc(requireDb(), 'transactions', id));

  if (existing.exists()) {
    // Duplicate scan: addon-only top-up record, never a second meal charge.
    if (addons.length === 0) {
      const err = new Error('ALREADY_TAKEN') as Error & { code: string };
      err.code = 'ALREADY_TAKEN';
      throw err;
    }
    const suffix = Date.now().toString(36);
    const topUpId = `${id}_addon${suffix}`;
    const txn = {
      employeeId: serial,
      serial,
      date,
      time,
      qrType: mealSlot(meal as ScanContext['meal']),
      meal,
      mealAmount: 0,
      addons,
      addonAmount,
      amount: addonAmount,
      status: 'ok',
      mode: 'addon',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setDoc(doc(requireDb(), 'transactions', topUpId), txn);
    return { transaction: { ...txn, id: topUpId } as Transaction, kind: 'addon' };
  }

  const txn = {
    employeeId: serial,
    serial,
    date,
    time,
    qrType: mealSlot(meal as ScanContext['meal']),
    meal,
    mealAmount,
    addons,
    addonAmount,
    amount: mealAmount + addonAmount,
    status: 'ok',
    mode: 'qr',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(doc(requireDb(), 'transactions', id), txn);
  return { transaction: { ...txn, id } as Transaction, kind: 'created' };
}
