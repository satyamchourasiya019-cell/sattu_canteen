import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getJSON,
  setJSON,
  keys,
  type EmployeeRecord,
  type MealItemRecord,
  type SettingsRecord,
  type TransactionRecord,
} from '../_lib/store';
import {
  createEmployeeSession,
  detectMeal,
  dropEmployeeSessionsForSerial,
  formatTime12,
  getEmployeeSession,
  json,
  mealSlot,
  readBody,
  toDateString,
  toTimeString,
  canonicalSerial,
} from '../_lib/util';

interface EmployeeSessionPayload {
  token: string;
  serial: string;
}

async function sessionFrom(req: VercelRequest): Promise<EmployeeSessionPayload | null> {
  const s = await getEmployeeSession(req);
  return s ? { token: 'x', serial: s.serial } : null;
}

/**
 * POST /api/employee-register  { serial, employeeNo?, name, department?, phone?, deviceId }
 *
 * Acts as login + one-time registration:
 *  - A claimed serial (has a name) can only be logged into with that name.
 *  - One device per serial: logging in from a new device/phone clears the
 *    previous login for that serial (old phone is signed out).
 *  - The login persists until the admin resets it or the employee logs out.
 */
export async function employeeRegister(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = await readBody(req);
  const serial = canonicalSerial(body.serial);
  const name = String(body.name ?? '').trim().slice(0, 60);
  const employeeNo = canonicalSerial(body.employeeNo);
  const department = String(body.department ?? '').trim().slice(0, 40);
  const phone = String(body.phone ?? '').trim().slice(0, 20);
  const deviceId = String(body.deviceId ?? '').trim().slice(0, 64) || null;

  if (!serial || !/^[0-9A-Za-z-]{1,20}$/.test(serial)) {
    return json(res, 400, { error: 'SERIAL_INVALID', message: 'Please enter a valid serial number.' });
  }
  if (!name) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { name: 'Name is required.' } });
  }
  if (phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { phone: 'Please enter a valid phone number.' } });
  }
  if (employeeNo && !/^[0-9A-Za-z-]{1,20}$/.test(employeeNo)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'Invalid employee number format.' } });
  }

  const settings = (await getJSON<SettingsRecord>(keys.settings))!;
  const existing = await getJSON<EmployeeRecord>(keys.employee(serial));

  if (existing && existing.active === false) {
    return json(res, 400, { error: 'SERIAL_INACTIVE', message: 'This serial number is inactive. Please contact the canteen supervisor.' });
  }
  if (existing && existing.name && existing.name !== name) {
    return json(res, 409, {
      error: 'SERIAL_TAKEN',
      message: `Serial ${serial} is already registered to ${existing.name}. One serial number can be used by only one employee. If this is your serial, please just log in with your own name, or contact the canteen supervisor.`,
    });
  }
  if (existing && existing.name && existing.name === name) {
    // Same employee logging in again — allow.
  }
  if (employeeNo) {
    // employeeNo uniqueness across serials
    const index = (await getJSON<Record<string, string>>(keys.employeeNoIndex)) ?? {};
    const owner = index[employeeNo];
    if (owner && owner !== serial) {
      return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'This employee number is already used by another serial.' } });
    }
  }
  if (!existing && !settings.allowSelfRegistration) {
    return json(res, 400, { error: 'SERIAL_NOT_FOUND', message: 'Serial number not found. Ask the canteen supervisor to add you first.' });
  }

  // One serial = one logged-in device. Logging in on a new phone invalidates
  // the previous phone's session automatically.
  if (existing?.loginDevice && deviceId && existing.loginDevice !== deviceId) {
    await dropEmployeeSessionsForSerial(serial);
  }

  const now = Date.now();
  const record: EmployeeRecord = existing
    ? {
        ...existing,
        name: existing.name || name,
        employeeNo: existing.employeeNo || employeeNo,
        department: existing.department || department,
        phone: existing.phone || phone,
        // This device is now the logged-in device for the serial. Any previous
        // session was invalidated above — one serial, one active login.
        loginDevice: deviceId,
        loginAt: now,
        updatedAt: now,
      }
    : { employeeNo, name, department, phone, active: true, createdAt: now, updatedAt: now, loginDevice: deviceId, loginAt: now };

  await setJSON(keys.employee(serial), record);
  // Keep the admin employee list in sync with self-registrations.
  const listIndex = (await getJSON<Record<string, EmployeeRecord>>(keys.employeesIndex)) ?? {};
  listIndex[serial] = record;
  await setJSON(keys.employeesIndex, listIndex);
  if (employeeNo) {
    const index = (await getJSON<Record<string, string>>(keys.employeeNoIndex)) ?? {};
    if (!index[employeeNo]) {
      index[employeeNo] = serial;
      await setJSON(keys.employeeNoIndex, index);
    }
  }
  const token = await createEmployeeSession(serial, deviceId);
  json(res, 200, { token, employee: { serial, ...record } });
}

/** GET /api/employee-me */
export async function employeeMe(req: VercelRequest, res: VercelResponse): Promise<void> {
  const s = await getEmployeeSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const emp = await getJSON<EmployeeRecord>(keys.employee(s.serial));
  if (!emp || emp.active === false) return json(res, 401, { error: 'UNAUTHENTICATED' });
  // The admin can reset the login remotely — that removes loginDevice. A live
  // session whose serial is no longer marked as logged in is signed out.
  if (!emp.loginDevice) {
    await dropEmployeeSessionsForSerial(s.serial);
    return json(res, 401, { error: 'LOGIN_RESET', message: 'Your login was reset by the canteen supervisor. Please log in again.' });
  }
  json(res, 200, { serial: s.serial, ...emp });
}

/** POST /api/employee-logout — voluntary logout on the device. */
export async function employeeLogout(req: VercelRequest, res: VercelResponse): Promise<void> {
  const s = await getEmployeeSession(req);
  if (s) {
    const emp = await getJSON<EmployeeRecord>(keys.employee(s.serial));
    if (emp && emp.loginDevice && emp.loginDevice === s.deviceId) {
      await setJSON(keys.employee(s.serial), { ...emp, loginDevice: null, loginAt: null, updatedAt: Date.now() });
    }
  }
  const { dropEmployeeSession } = await import('../_lib/util');
  await dropEmployeeSession(req);
  json(res, 200, { ok: true });
}

/** GET /api/scan/context?qr=breakfastSnacks|lunchDinner */
export async function scanContext(req: VercelRequest, res: VercelResponse): Promise<void> {
  const s = await sessionFrom(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED', message: 'Please register/log in first.' });
  const emp = await getJSON<EmployeeRecord>(keys.employee(s.serial));
  if (!emp || emp.active === false) return json(res, 401, { error: 'UNAUTHENTICATED' });

  const qrType = req.query.qr === 'lunchDinner' ? 'lunchDinner' : 'breakfastSnacks';
  const settings = (await getJSON<SettingsRecord>(keys.settings))!;
  const d = new Date();
  const meal = detectMeal(d.getHours() * 60 + d.getMinutes(), settings.mealTimings);
  const time = toTimeString(d);

  if (!meal || mealSlot(meal) !== qrType) {
    return json(res, 409, {
      error: 'WRONG_TIME',
      message:
        qrType === 'breakfastSnacks'
          ? `It is ${formatTime12(time)} now — this QR is only for Breakfast & Snacks. Please scan the Lunch/Dinner QR for the current meal.`
          : `It is ${formatTime12(time)} now — this QR is only for Lunch & Dinner. Please scan the Breakfast/Snacks QR for the current meal.`,
      time,
    });
  }

  const date = toDateString(d);
  const mealItems = Object.values((await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {});
  const mealEntry = mealItems.find((i) => i.id === meal);
  const mealAmount = mealEntry && mealEntry.enabled ? mealEntry.price : 0;
  const existing = await getJSON<TransactionRecord>(keys.transaction(`${date}_${s.serial}_${meal}`));

  json(res, 200, {
    employee: { serial: s.serial, employeeNo: emp.employeeNo, name: emp.name, department: emp.department },
    qrType,
    meal,
    time,
    date,
    mealAmount,
    alreadyTaken: Boolean(existing),
    existingTransaction: existing,
    addons: mealItems.filter((i) => i.enabled && !i.isMeal).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/** POST /api/scan/confirm { meal, addonIds } */
export async function scanConfirm(req: VercelRequest, res: VercelResponse): Promise<void> {
  const s = await sessionFrom(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED', message: 'Please register/log in first.' });
  const emp = await getJSON<EmployeeRecord>(keys.employee(s.serial));
  if (!emp || emp.active === false) return json(res, 401, { error: 'UNAUTHENTICATED' });

  const body = await readBody(req);
  const meal = String(body.meal || '');
  if (!['breakfast', 'lunch', 'snacks', 'dinner'].includes(meal)) {
    return json(res, 400, { error: 'BAD_MEAL', message: 'Unknown meal.' });
  }
  const settings = (await getJSON<SettingsRecord>(keys.settings))!;
  const expected = detectMeal(new Date().getHours() * 60 + new Date().getMinutes(), settings.mealTimings);
  if (!expected || mealSlot(expected) !== mealSlot(meal)) {
    return json(res, 409, { error: 'WRONG_TIME', message: 'This meal is not being served at this time.' });
  }
  if (meal !== expected) {
    return json(res, 409, { error: 'WRONG_MEAL', message: `It is ${expected} time now — you cannot record ${meal}.` });
  }

  const mealItems = Object.values((await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {});
  const addonIds = Array.isArray(body.addonIds) ? (body.addonIds as unknown[]).slice(0, 6).map(String) : [];
  const addons = [];
  for (const id of addonIds) {
    const item = mealItems.find((i) => i.id === id);
    if (!item || !item.enabled || item.isMeal) {
      return json(res, 400, { error: 'BAD_ADDON', message: `Unknown additional item: ${id}` });
    }
    addons.push({ id: item.id, name: item.name, price: item.price });
  }

  const d = new Date();
  const date = toDateString(d);
  const time = toTimeString(d);
  const now = Date.now();
  const baseId = `${date}_${s.serial}_${meal}`;
  const mealEntry = mealItems.find((i) => i.id === meal);
  const mealAmount = mealEntry && mealEntry.enabled ? mealEntry.price : 0;
  const existing = await getJSON<TransactionRecord>(keys.transaction(baseId));

  if (!existing) {
    const txn: TransactionRecord = {
      id: baseId,
      employeeId: s.serial,
      employeeNo: emp.employeeNo || '',
      serial: s.serial,
      name: emp.name || '',
      department: emp.department || '',
      date,
      time,
      qrType: mealSlot(meal),
      meal,
      mealAmount,
      addons,
      addonAmount: addons.reduce((sum, a) => sum + a.price, 0),
      amount: mealAmount + addons.reduce((sum, a) => sum + a.price, 0),
      status: 'ok',
      mode: 'qr',
      createdAt: now,
      updatedAt: now,
    };
    await setJSON(keys.transaction(baseId), txn);
    const dateIndex = (await getJSON<string[]>(`txns:date:${date}`)) ?? [];
    if (!dateIndex.includes(baseId)) {
      dateIndex.push(baseId);
      await setJSON(`txns:date:${date}`, dateIndex);
    }
    return json(res, 200, { transaction: txn, kind: 'created' });
  }

  // Duplicate scan of the same meal: addon-only record, never a second charge.
  if (addons.length === 0) {
    return json(res, 409, {
      error: 'ALREADY_TAKEN',
      message: `${meal.charAt(0).toUpperCase() + meal.slice(1)} already recorded for today (at ${formatTime12(existing.time)}). No extra charge.`,
    });
  }
  let suffix = 2;
  let topUpId = `${baseId}_addon${suffix}`;
  while (await getJSON<TransactionRecord>(keys.transaction(topUpId))) {
    suffix += 1;
    topUpId = `${baseId}_addon${suffix}`;
  }
  const amount = addons.reduce((sum, a) => sum + a.price, 0);
  const txn: TransactionRecord = {
    id: topUpId,
    employeeId: s.serial,
    employeeNo: emp.employeeNo || '',
    serial: s.serial,
    name: emp.name || '',
    department: emp.department || '',
    date,
    time,
    qrType: mealSlot(meal),
    meal,
    mealAmount: 0,
    addons,
    addonAmount: amount,
    amount,
    status: 'ok',
    mode: 'addon',
    createdAt: now,
    updatedAt: now,
  };
  await setJSON(keys.transaction(topUpId), txn);
  const dateIndex = (await getJSON<string[]>(`txns:date:${date}`)) ?? [];
  if (!dateIndex.includes(topUpId)) {
    dateIndex.push(topUpId);
    await setJSON(`txns:date:${date}`, dateIndex);
  }
  json(res, 200, { transaction: txn, kind: 'addon' });
}
