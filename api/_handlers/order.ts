import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getJSON,
  setJSON,
  keys,
  getMany,
  ensureSeeded,
  type EmployeeRecord,
  type MealItemRecord,
  type TransactionRecord,
} from '../_lib/store';
import {
  json,
  readBody,
  getEmployeeSession,
  getAdminSession,
  toDateString,
  toTimeString,
  appNow,
} from '../_lib/util';

interface OrderLineInput {
  id: string;
  qty: number;
}

type OrderLine = { id: string; name: string; price: number; qty: number };

/** Maximum distinct lines per order — keeps payloads small and abuse away. */
const MAX_LINES = 12;

async function requireAdmin(req: VercelRequest): Promise<boolean> {
  return (await getAdminSession(req)) !== null;
}

/** Employee's open online order for a day (mode 'order', not done). */
async function findOpenOrder(serial: string, date: string): Promise<TransactionRecord | null> {
  const ids = (await getJSON<string[]>(`txns:date:${date}`)) ?? [];
  const records = await getMany<TransactionRecord>(ids.map((id) => keys.transaction(id)));
  return (
    records.find(
      (t) => t !== null && t.serial === serial && t.mode === 'order' && t.orderStatus !== 'done',
    ) ?? null
  );
}

function publicMenu(items: MealItemRecord[]): MealItemRecord[] {
  return items.filter((i) => i.enabled).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GET /api/order?menu=1        → public menu for the employee ordering page
 * GET /api/order   (admin)     → today's online-order feed, newest first
 * GET /api/order   (employee)  → { mine } — this employee's open order
 */
export async function listOrders(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.query.menu) {
    await ensureSeeded();
    const items = Object.values((await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {});
    return json(res, 200, { items: publicMenu(items) });
  }
  const date = toDateString(appNow());
  if (await requireAdmin(req)) {
    const ids = (await getJSON<string[]>(`txns:date:${date}`)) ?? [];
    const records = await getMany<TransactionRecord>(ids.map((id) => keys.transaction(id)));
    const orders = records
      .filter((t): t is TransactionRecord => t !== null && t.mode === 'order')
      .sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, { date, orders });
  }
  const s = await getEmployeeSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const mine = await findOpenOrder(s.serial, date);
  json(res, 200, { date, orders: [], mine });
}

/**
 * POST /api/order — place (or extend) the employee's online food order.
 * One open order per serial per day: re-ordering merges into it, so the
 * money automatically accumulates on the serial's row without admin work.
 *
 * POST /api/order { id, action: 'preparing' | 'done' } — admin updates.
 */
export async function placeOrder(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = await readBody(req);
  if (body.action === 'done' || body.action === 'preparing') {
    if (!(await requireAdmin(req))) return json(res, 401, { error: 'UNAUTHENTICATED' });
    const id = String(body.id ?? '');
    const order = await getJSON<TransactionRecord>(keys.transaction(id));
    if (!order || order.mode !== 'order') {
      return json(res, 404, { error: 'NOT_FOUND', message: 'Order not found.' });
    }
    const status = body.action === 'preparing' ? 'preparing' : 'done';
    await setJSON(keys.transaction(id), { ...order, orderStatus: status, updatedAt: Date.now() });
    return json(res, 200, { ok: true, id, orderStatus: status });
  }

  const s = await getEmployeeSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED', message: 'Please log in first.' });
  const emp = await getJSON<EmployeeRecord>(keys.employee(s.serial));
  if (!emp || emp.active === false) {
    return json(res, 401, { error: 'UNAUTHENTICATED', message: 'Your login is no longer active. Please log in again.' });
  }

  const rawLines = Array.isArray(body.lines) ? (body.lines as OrderLineInput[]) : [];
  if (rawLines.length === 0 || rawLines.length > MAX_LINES) {
    return json(res, 400, { error: 'VALIDATION', message: 'Select between 1 and 12 items.' });
  }
  const items = Object.values((await getJSON<Record<string, MealItemRecord>>(keys.mealItems)) ?? {});
  const lines: OrderLine[] = [];
  for (const raw of rawLines) {
    const item = items.find((i) => i.id === String(raw.id) && i.enabled);
    if (!item) return json(res, 400, { error: 'VALIDATION', message: 'One of the selected items is no longer available.' });
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 10) {
      return json(res, 400, { error: 'VALIDATION', message: 'Each item quantity must be between 1 and 10.' });
    }
    lines.push({ id: item.id, name: item.name, price: item.price, qty });
  }
  const note = String(body.note ?? '').trim().slice(0, 140);
  const added = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

  const d = appNow();
  const date = toDateString(d);
  const time = toTimeString(d);
  const existing = await findOpenOrder(s.serial, date);

  if (existing) {
    const merged = new Map<string, OrderLine>();
    for (const l of existing.addons) {
      merged.set(l.id, { id: l.id, name: l.name, price: l.price, qty: (l as { qty?: number }).qty ?? 1 });
    }
    for (const l of lines) {
      const cur = merged.get(l.id);
      if (cur) cur.qty += l.qty;
      else merged.set(l.id, { ...l });
    }
    const all = [...merged.values()];
    if (all.length > MAX_LINES) {
      return json(res, 400, { error: 'VALIDATION', message: 'This order already has too many items.' });
    }
    const addonAmount = all.reduce((sum, l) => sum + l.price * l.qty, 0);
    const updated: TransactionRecord = {
      ...existing,
      addons: all,
      addonAmount,
      amount: existing.mealAmount + addonAmount,
      orderNote: [existing.orderNote, note].filter(Boolean).join(' | ').slice(0, 200) || undefined,
      updatedAt: Date.now(),
    };
    await setJSON(keys.transaction(existing.id), updated);
    return json(res, 200, { order: updated, extended: true, added });
  }

  // New order record. mealAmount stays 0 — online orders are separate from
  // canteen meal scans. The id keeps the date prefix so the one-year cleanup
  // removes it together with the day's other records.
  let n = 1;
  let id = `${date}_${s.serial}_order`;
  while (await getJSON<TransactionRecord>(keys.transaction(id))) {
    n += 1;
    id = `${date}_${s.serial}_order${n}`;
  }
  const order: TransactionRecord = {
    id,
    employeeId: s.serial,
    employeeNo: emp.employeeNo || '',
    serial: s.serial,
    name: emp.name || '',
    department: emp.department || '',
    date,
    time,
    qrType: 'breakfastSnacks',
    meal: 'snacks',
    mealAmount: 0,
    addons: lines,
    addonAmount: added,
    amount: added,
    status: 'ok',
    mode: 'order',
    orderStatus: 'new',
    orderNote: note || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setJSON(keys.transaction(id), order);
  const dateIndex = (await getJSON<string[]>(`txns:date:${date}`)) ?? [];
  if (!dateIndex.includes(id)) {
    dateIndex.push(id);
    await setJSON(`txns:date:${date}`, dateIndex);
  }
  json(res, 201, { order, extended: false, added });
}
