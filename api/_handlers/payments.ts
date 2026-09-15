import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getJSON,
  setJSON,
  keys,
  getMany,
  ensureSeeded,
  type EmployeeRecord,
  type TransactionRecord,
} from '../_lib/store';
import { json, readBody, getAdminSession, toDateString, appNow } from '../_lib/util';

export interface PaymentRow {
  serial: string;
  name: string;
  department: string;
  billed: number; // total canteen usage for the month
  paid: number; // payments recorded for the month
  carryIn: number; // unpaid balance brought from previous months
  status: 'fully' | 'partial' | 'none' | null;
  updatedAt: number | null;
}

export interface PaymentsIndex {
  month: string; // YYYY-MM
  rows: Record<string, { paid: number; status: 'fully' | 'partial' | 'none'; remaining?: number; updatedAt: number }>;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * GET /api/payments?month=YYYY-MM (admin) — per-serial month billing + payment status.
 * Carry-forward: unpaid (or partly paid) balances from ALL previous months
 * (since records exist, capped at one year) are added to carryIn.
 * POST /api/payments { serial, month?, status } (admin) — record a payment.
 */
export async function paymentsHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await getAdminSession(req))) return json(res, 401, { error: 'UNAUTHENTICATED' });
  await ensureSeeded();

  const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? ''))
    ? String(req.query.month)
    : monthKey(toDateString(appNow()));

  // ---- month billed totals from transactions ----
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ids: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const dayIds = (await getJSON<string[]>(`txns:date:${dateStr}`)) ?? [];
    ids.push(...dayIds);
  }
  const records = await getMany<TransactionRecord>(ids.map((id) => keys.transaction(id)));
  const billedBySerial = new Map<string, number>();
  for (const t of records) {
    if (!t || t.status === 'cancelled') continue;
    billedBySerial.set(t.serial, (billedBySerial.get(t.serial) ?? 0) + t.amount);
  }

  // ---- carry-forward from previous months ----
  // savePayment stores `remaining` (unpaid balance) for each serial each
  // month; we sum the stored remainders of all earlier months.
  const carryBySerial = new Map<string, number>();
  let pm = prevMonthKey(month);
  for (let i = 0; i < 12; i += 1) {
    const idx = await getJSON<PaymentsIndex>(`payments:${pm}`);
    if (idx) {
      for (const [serial, row] of Object.entries(idx.rows)) {
        const remaining = Math.max(0, (row as { remaining?: number }).remaining ?? 0);
        if (remaining > 0) carryBySerial.set(serial, (carryBySerial.get(serial) ?? 0) + remaining);
      }
    }
    pm = prevMonthKey(pm);
  }

  // ---- employees master ----
  const empIndex = (await getJSON<Record<string, EmployeeRecord>>(keys.employeesIndex)) ?? {};

  // ---- build rows ----
  const saved = (await getJSON<PaymentsIndex>(`payments:${month}`)) ?? { month, rows: {} };
  const rows: PaymentRow[] = [];
  for (const [serial, billedRaw] of [...billedBySerial.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  )) {
    const billed = billedRaw;
    const savedRow = saved.rows[serial];
    const paid = savedRow?.paid ?? 0;
    const carryIn = carryBySerial.get(serial) ?? 0;
    const emp = empIndex[serial];
    rows.push({
      serial,
      name: emp?.name ?? '',
      department: emp?.department ?? '',
      billed,
      paid,
      carryIn,
      status: savedRow?.status ?? null,
      updatedAt: savedRow?.updatedAt ?? null,
    });
  }
  // Serials with a saved payment or a pending carry-in but no billing this
  // month still need a row so the pending amount is visible and settleable.
  const extraSerials = new Set([...Object.keys(saved.rows), ...carryBySerial.keys()]);
  for (const serial of extraSerials) {
    if (rows.some((r) => r.serial === serial)) continue;
    const emp = empIndex[serial];
    const savedRow = saved.rows[serial];
    rows.push({
      serial,
      name: emp?.name ?? '',
      department: emp?.department ?? '',
      billed: 0,
      paid: savedRow?.paid ?? 0,
      carryIn: carryBySerial.get(serial) ?? 0,
      status: savedRow?.status ?? null,
      updatedAt: savedRow?.updatedAt ?? null,
    });
  }
  rows.sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));

  json(res, 200, { month, rows });
}

/** POST /api/payments { serial, month?, status: 'fully'|'partial'|'none', paid? } */
export async function savePayment(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await getAdminSession(req))) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const body = await readBody(req);
  const month = /^\d{4}-\d{2}$/.test(String(body.month ?? '')) ? String(body.month) : monthKey(toDateString(appNow()));
  const serial = String(body.serial ?? '').trim();
  const status = body.status;
  if (!serial) return json(res, 400, { error: 'VALIDATION', message: 'Serial is required.' });
  if (status !== 'fully' && status !== 'partial' && status !== 'none') {
    return json(res, 400, { error: 'VALIDATION', message: 'Status must be fully, partial or none.' });
  }
  const saved = (await getJSON<PaymentsIndex>(`payments:${month}`)) ?? { month, rows: {} };
  const current = saved.rows[serial] ?? { paid: 0, status: status, updatedAt: 0 };
  const paid =
    status === 'none'
      ? 0
      : typeof body.paid === 'number'
        ? Math.max(0, Math.round(body.paid))
        : current.paid;
  // remaining = this month's unpaid balance that carries forward. The caller
  // sends `remaining` (computed on the page as billed + carryIn - paid) so
  // the next month's carry-in is exact even if the bill grows later today.
  const remaining = Math.max(0, Math.round(Number(body.remaining) || 0));
  saved.rows[serial] = { paid, status, remaining, updatedAt: Date.now() };
  await setJSON(`payments:${month}`, saved);
  json(res, 200, { ok: true, month, serial, ...saved.rows[serial] });
}
