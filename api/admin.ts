import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import {
  getJSON,
  setJSON,
  del,
  keys,
  ensureSeeded,
  type EmployeeRecord,
  type MealItemRecord,
  type SettingsRecord,
  type TransactionRecord,
  type SessionRecord,
} from './lib/store';
import {
  createSession,
  getAdminSession,
  dropSession,
  getEmployeeSession,
  json,
  readBody,
  toDateString,
  toTimeString,
  canonicalSerial,
  mealSlot,
  minutesOf,
} from './lib/util';

interface UserRecord {
  uid: string;
  email: string;
  password: string;
  role: 'admin' | 'supervisor';
}

function todayLocal(): string {
  return toDateString(new Date());
}

// ---------------------------------------------------------------- auth ---
export async function login(req: VercelRequest, res: VercelResponse): Promise<void> {
  await ensureSeeded();
  const body = await readBody(req);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const users = (await getJSON<UserRecord[]>(keys.users)) ?? [];
  const user = users.find((u) => u.email.toLowerCase() === email && u.password === password);
  if (!user) return json(res, 401, { error: 'AUTH_FAILED', message: 'Incorrect email or password.' });
  const token = await createSession({ uid: user.uid, email: user.email, role: user.role });
  json(res, 200, { token, user: { uid: user.uid, email: user.email, role: user.role } });
}

export async function logout(req: VercelRequest, res: VercelResponse): Promise<void> {
  await dropSession(req);
  json(res, 200, { ok: true });
}

export async function me(req: VercelRequest, res: VercelResponse): Promise<void> {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  json(res, 200, { uid: s.uid, email: s.email, role: s.role });
}

async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<SessionRecord | null> {
  const s = await getAdminSession(req);
  if (!s) {
    json(res, 401, { error: 'UNAUTHENTICATED' });
    return null;
  }
  return s;
}

// ------------------------------------------------------------ employees ---
export async function listEmployees(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  // Serial set is stored as one JSON map (employees serials are few hundred).
  const all = (await getJSON<Record<string, EmployeeRecord>>('employees:index')) ?? {};
  const list = Object.entries(all).map(([serial, e]) => ({ serial, ...e }));
  list.sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
  json(res, 200, { employees: list });
}

export async function getEmployee(_req: VercelRequest, res: VercelResponse, serial: string): Promise<void> {
  const e = await getJSON<EmployeeRecord>(keys.employee(serial));
  if (!e) return json(res, 404, { error: 'NOT_FOUND' });
  json(res, 200, { serial, name: e.name, employeeNo: e.employeeNo || '', department: e.department || '', active: e.active });
}

export async function saveEmployee(req: VercelRequest, res: VercelResponse, serial: string): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  if (!/^[0-9A-Za-z-]{1,20}$/.test(serial)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { serial: 'Invalid serial.' } });
  }
  const body = await readBody(req);
  const existing = await getJSON<EmployeeRecord>(keys.employee(serial));
  const employeeNo = body.employeeNo !== undefined ? String(body.employeeNo).trim() : existing?.employeeNo ?? '';
  const name = body.name !== undefined ? String(body.name).trim() : existing?.name ?? '';
  const department = body.department !== undefined ? String(body.department).trim() : existing?.department ?? '';
  const active = body.active !== undefined ? body.active !== false : existing?.active !== false;

  if (employeeNo && !/^[0-9A-Za-z-]{1,20}$/.test(employeeNo)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'Invalid employee number format.' } });
  }
  // Employee number uniqueness across serials.
  if (employeeNo) {
    const index = (await getJSON<Record<string, string>>(keys.employeeNoIndex)) ?? {};
    const owner = index[employeeNo];
    if (owner && owner !== serial) {
      return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'This employee number is already used by another serial.' } });
    }
  }

  const now = Date.now();
  const record: EmployeeRecord = {
    employeeNo,
    name,
    department,
    active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await setJSON(keys.employee(serial), record);

  // Keep the admin list index and employeeNo ownership in sync.
  const all = (await getJSON<Record<string, EmployeeRecord>>('employees:index')) ?? {};
  all[serial] = record;
  await setJSON('employees:index', all);
  if (employeeNo) {
    const noIndex = (await getJSON<Record<string, string>>(keys.employeeNoIndex)) ?? {};
    noIndex[employeeNo] = serial;
    await setJSON(keys.employeeNoIndex, noIndex);
  }
  json(res, 200, { serial, ...record });
}

export async function deleteEmployee(req: VercelRequest, res: VercelResponse, serial: string): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const existing = await getJSON<EmployeeRecord>(keys.employee(serial));
  await del(keys.employee(serial));
  const all = (await getJSON<Record<string, EmployeeRecord>>('employees:index')) ?? {};
  if (all[serial]) {
    delete all[serial];
    await setJSON('employees:index', all);
  }
  if (existing?.employeeNo) {
    const noIndex = (await getJSON<Record<string, string>>(keys.employeeNoIndex)) ?? {};
    if (noIndex[existing.employeeNo] === serial) {
      delete noIndex[existing.employeeNo];
      await setJSON(keys.employeeNoIndex, noIndex);
    }
  }
  json(res, 200, { ok: true });
}

export async function bulkEmployees(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const body = await readBody(req);
  const count = Math.min(2000, Math.max(1, Math.floor(Number(body.count) || 0)));
  const pad = count <= 999 ? 3 : String(count).length;
  const now = Date.now();
  const all = (await getJSON<Record<string, EmployeeRecord>>('employees:index')) ?? {};
  let added = 0;
  for (let i = 1; i <= count; i++) {
    const serial = String(i).padStart(pad, '0');
    if (!all[serial]) {
      const record: EmployeeRecord = { employeeNo: '', name: '', department: '', active: true, createdAt: now, updatedAt: now };
      all[serial] = record;
      await setJSON(keys.employee(serial), record);
      added++;
    }
  }
  await setJSON('employees:index', all);
  json(res, 200, { added });
}

// ------------------------------------------------------------ meal items ---
export async function listMealItems(_req: VercelRequest, res: VercelResponse): Promise<void> {
  await ensureSeeded();
  const items = Object.values((await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {});
  json(res, 200, { items });
}

export async function createMealItem(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const body = await readBody(req);
  const name = String(body.name ?? '').trim().slice(0, 40) || 'Item';
  const id =
    String(body.id ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30) ||
    `item-${crypto.randomBytes(3).toString('hex')}`;
  const items = (await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {};
  if (items[id]) return json(res, 400, { error: 'EXISTS', message: 'An item with this id already exists.' });
  items[id] = { id, name, price: Math.max(0, Math.round(Number(body.price) || 0)), enabled: body.enabled !== false };
  await setJSON(keys.mealItems, items);
  json(res, 200, items[id]);
}

export async function saveMealItem(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const items = (await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {};
  const cur = items[id];
  if (!cur) return json(res, 404, { error: 'NOT_FOUND' });
  const body = await readBody(req);
  items[id] = {
    ...cur,
    name: String(body.name ?? cur.name).trim().slice(0, 40) || cur.name,
    price: Math.max(0, Math.round(Number(body.price ?? cur.price))),
    enabled: body.enabled !== undefined ? body.enabled !== false : cur.enabled,
  };
  await setJSON(keys.mealItems, items);
  json(res, 200, items[id]);
}

export async function deleteMealItem(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const items = (await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {};
  if (!items[id]) return json(res, 404, { error: 'NOT_FOUND' });
  delete items[id];
  await setJSON(keys.mealItems, items);
  json(res, 200, { ok: true });
}

// -------------------------------------------------------------- settings ---
export async function getSettings(_req: VercelRequest, res: VercelResponse): Promise<void> {
  await ensureSeeded();
  json(res, 200, (await getJSON<SettingsRecord>(keys.settings))!);
}

export async function saveSettings(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const body = await readBody(req);
  const settings = (await getJSON<SettingsRecord>(keys.settings))!;
  if (typeof body.canteenName === 'string' && body.canteenName.trim()) {
    settings.canteenName = body.canteenName.trim().slice(0, 60);
  }
  if (typeof body.retentionDays === 'number' && body.retentionDays >= 30) {
    settings.retentionDays = Math.floor(body.retentionDays);
  }
  if (typeof body.allowSelfRegistration === 'boolean') settings.allowSelfRegistration = body.allowSelfRegistration;
  if (body.mealTimings && typeof body.mealTimings === 'object') {
    const ok: Record<string, { from: string; to: string }> = {};
    for (const meal of ['breakfast', 'lunch', 'snacks', 'dinner']) {
      const w = (body.mealTimings as Record<string, { from?: unknown; to?: unknown }>)[meal];
      if (w && /^\d{2}:\d{2}$/.test(String(w.from)) && /^\d{2}:\d{2}$/.test(String(w.to))) {
        ok[meal] = { from: String(w.from), to: String(w.to) };
      }
    }
    if (Object.keys(ok).length === 4) settings.mealTimings = ok;
  }
  await setJSON(keys.settings, settings);
  json(res, 200, settings);
}

// ---------------------------------------------------------- transactions ---
async function txnIdsForRange(from: string, to: string): Promise<string[]> {
  const ids: string[] = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d <= end) {
    const dayIds = (await getJSON<string[]>(`txns:date:${toDateString(d)}`)) ?? [];
    ids.push(...dayIds);
    d.setDate(d.getDate() + 1);
  }
  return ids;
}

export async function listTransactions(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const from = (req.query.from as string) || todayLocal();
  const to = (req.query.to as string) || from;
  const ids = await txnIdsForRange(from, to);
  const txns: TransactionRecord[] = [];
  for (const id of ids) {
    const t = await getJSON<TransactionRecord>(keys.transaction(id));
    if (t) txns.push(t);
  }
  txns.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  json(res, 200, { transactions: txns });
}

export async function listDailyEntries(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const from = (req.query.from as string) || todayLocal();
  const to = (req.query.to as string) || from;
  const ids = await txnIdsForRange(from, to);
  const bySerial = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const t = await getJSON<TransactionRecord>(keys.transaction(id));
    if (!t) continue;
    let e = bySerial.get(t.serial) as
      | { serial: string; employeeNo: string; name: string; department: string; date: string; breakfast: number; snacks: number; lunch: number; dinner: number; addonAmount: number; addons: { id: string; name: string; price: number }[]; total: number; lastTime: string }
      | undefined;
    if (!e) {
      e = {
        serial: t.serial,
        employeeNo: t.employeeNo || '',
        name: t.name || '',
        department: t.department || '',
        date: t.date,
        breakfast: 0, snacks: 0, lunch: 0, dinner: 0,
        addonAmount: 0, addons: [], total: 0, lastTime: t.time,
      };
      bySerial.set(t.serial, e);
    }
    if (t.meal === 'breakfast') e.breakfast += t.mealAmount;
    else if (t.meal === 'snacks') e.snacks += t.mealAmount;
    else if (t.meal === 'lunch') e.lunch += t.mealAmount;
    else if (t.meal === 'dinner') e.dinner += t.mealAmount;
    e.addonAmount += t.addonAmount || 0;
    for (const a of t.addons || []) e.addons.push(a);
    e.total += t.amount;
    if (t.time > e.lastTime) e.lastTime = t.time;
    // Live master data for renamed employees.
    const emp = await getJSON<EmployeeRecord>(keys.employee(t.serial));
    if (emp) {
      e.employeeNo = emp.employeeNo || e.employeeNo;
      e.name = emp.name || e.name;
      e.department = emp.department || e.department;
    }
  }
  const entries = [...bySerial.values()].sort((a, b) =>
    (a as { serial: string }).serial.localeCompare((b as { serial: string }).serial, undefined, { numeric: true }),
  );
  json(res, 200, { entries });
}

export async function manualEntry(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return; // auth check
  const body = await readBody(req);
  const serial = canonicalSerial(body.serial);
  const emp = await getJSON<EmployeeRecord>(keys.employee(serial));
  if (!emp) return json(res, 400, { error: 'SERIAL_NOT_FOUND', message: 'Serial number not found. Add the employee first.' });
  const meal = String(body.meal || '');
  if (!['breakfast', 'lunch', 'snacks', 'dinner'].includes(meal)) {
    return json(res, 400, { error: 'BAD_MEAL', message: 'Choose a meal.' });
  }
  const mealItems = Object.values((await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {});
  const addonIds = Array.isArray(body.addonIds) ? (body.addonIds as unknown[]).map(String) : [];
  const addons = addonIds
    .map((id) => mealItems.find((i) => i.id === id && i.enabled && !i.isMeal))
    .filter((i): i is MealItemRecord => Boolean(i))
    .map((i) => ({ id: i.id, name: i.name, price: i.price }));

  const d = new Date();
  const date = toDateString(d);
  const baseId = `${date}_${serial}_${meal}`;
  let id = baseId;
  let suffix = 2;
  while (await getJSON<TransactionRecord>(keys.transaction(id))) {
    id = `${baseId}_m${suffix++}`;
  }
  const mealAmt = mealItems.find((i) => i.id === meal && i.enabled)?.price ?? 0;
  const addonAmt = addons.reduce((s, a) => s + a.price, 0);
  const txn: TransactionRecord = {
    id,
    employeeId: serial,
    employeeNo: emp.employeeNo || '',
    serial,
    name: emp.name || '',
    department: emp.department || '',
    date,
    time: toTimeString(d),
    qrType: mealSlot(meal),
    meal,
    mealAmount: mealAmt,
    addons,
    addonAmount: addonAmt,
    amount: mealAmt + addonAmt,
    status: 'ok',
    mode: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setJSON(keys.transaction(id), txn);
  const dateIndex = (await getJSON<string[]>(`txns:date:${date}`)) ?? [];
  if (!dateIndex.includes(id)) {
    dateIndex.push(id);
    await setJSON(`txns:date:${date}`, dateIndex);
  }
  json(res, 200, { transaction: txn });
}

export async function deleteTransaction(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const t = await getJSON<TransactionRecord>(keys.transaction(id));
  if (!t) return json(res, 404, { error: 'NOT_FOUND' });
  await del(keys.transaction(id));
  const dateIndex = (await getJSON<string[]>(`txns:date:${t.date}`)) ?? [];
  const idx = dateIndex.indexOf(id);
  if (idx >= 0) {
    dateIndex.splice(idx, 1);
    await setJSON(`txns:date:${t.date}`, dateIndex);
  }
  json(res, 200, { ok: true });
}

export async function cleanup(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return; // auth check
  const body = await readBody(req);
  const cutoff = String(body.cutoff || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return json(res, 400, { error: 'BAD_CUTOFF' });
  // Walk dates from a reasonable floor to the cutoff.
  const settings = (await getJSON<SettingsRecord>(keys.settings))!;
  let deleted = 0;
  const d = new Date();
  d.setDate(d.getDate() - Math.max(400, settings.retentionDays + 35));
  while (toDateString(d) < cutoff) {
    const dateStr = toDateString(d);
    const ids = (await getJSON<string[]>(`txns:date:${dateStr}`)) ?? [];
    for (const id of ids) {
      await del(keys.transaction(id));
      deleted++;
    }
    if (ids.length) await del(`txns:date:${dateStr}`);
    d.setDate(d.getDate() + 1);
  }
  settings.lastCleanupAt = Date.now();
  await setJSON(keys.settings, settings);
  json(res, 200, { deleted });
}

// re-export for the router
export { getEmployeeSession, minutesOf };
