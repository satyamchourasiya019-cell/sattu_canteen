import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './_lib/util';
import { cloudEnabled, ensureSeeded } from './_lib/store';
import * as scan from './_handlers/scan';
import * as admin from './_handlers/admin';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

/**
 * Shared API router. Vercel's Hobby plan allows 12 serverless functions, so
 * each top-level api/<file>.ts delegates here and dispatches on path.
 * All endpoints are single-segment; action endpoints use POST bodies.
 */
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
  // basics (served by api/index.ts)
  { method: 'GET', pattern: /^\/api$/, handler: (_req, res) => json(res, 200, { ok: true, mode: 'cloud', storage: cloudEnabled ? 'upstash' : 'not-configured' }) },
  { method: 'GET', pattern: /^\/api\/health$/, handler: (_req, res) => json(res, 200, { ok: true, mode: 'cloud', storage: cloudEnabled ? 'upstash' : 'not-configured', time: new Date().toISOString() }) },
  { method: 'POST', pattern: /^\/api\/cleanup$/, handler: admin.cleanup },
  { method: 'POST', pattern: /^\/api\/manual-entry$/, handler: admin.manualEntry },
  { method: 'POST', pattern: /^\/api\/transaction-delete$/, handler: (req, res) => admin.deleteTransaction(req, res, idOf(req)) },
  { method: 'POST', pattern: /^\/api\/employees-bulk$/, handler: admin.bulkEmployees },

  // admin auth (served by api/auth.ts)
  { method: 'POST', pattern: /^\/api\/auth-login$/, handler: admin.login },
  { method: 'POST', pattern: /^\/api\/auth-logout$/, handler: admin.logout },
  { method: 'GET', pattern: /^\/api\/auth-me$/, handler: admin.me },

  // employees (served by api/employees.ts) — with ?serial= it is the public
  // single-serial check used by registration and the scan pre-check.
  { method: 'GET', pattern: /^\/api\/employees$/, handler: (req, res) => (req.query.serial ? admin.getEmployeeQuery(req, res) : admin.listEmployees(req, res)) },
  { method: 'POST', pattern: /^\/api\/employee-save$/, handler: (req, res) => admin.saveEmployee(req, res, serialOf(req)) },
  { method: 'POST', pattern: /^\/api\/employee-delete$/, handler: (req, res) => admin.deleteEmployee(req, res, serialOf(req)) },

  // employee self-service (served by api/employee-session.ts)
  { method: 'POST', pattern: /^\/api\/employee-register$/, handler: scan.employeeRegister },
  { method: 'GET', pattern: /^\/api\/employee-me$/, handler: scan.employeeMe },
  { method: 'POST', pattern: /^\/api\/employee-logout$/, handler: scan.employeeLogout },
  // Admin action: sign the employee out of their device (they can log in again).
  { method: 'POST', pattern: /^\/api\/employee-reset$/, handler: admin.resetEmployeeLogin },

  // scan flow (served by api/scan.ts)
  { method: 'GET', pattern: /^\/api\/scan-context$/, handler: scan.scanContext },
  { method: 'POST', pattern: /^\/api\/scan-confirm$/, handler: scan.scanConfirm },

  // meal items (served by api/meal-items.ts)
  { method: 'GET', pattern: /^\/api\/meal-items$/, handler: admin.listMealItems },
  { method: 'POST', pattern: /^\/api\/meal-item-create$/, handler: admin.createMealItem },
  { method: 'POST', pattern: /^\/api\/meal-item-save$/, handler: (req, res) => admin.saveMealItem(req, res, idOf(req)) },
  { method: 'POST', pattern: /^\/api\/meal-item-delete$/, handler: (req, res) => admin.deleteMealItem(req, res, idOf(req)) },

  // settings (served by api/settings.ts)
  { method: 'GET', pattern: /^\/api\/settings$/, handler: admin.getSettings },
  { method: 'POST', pattern: /^\/api\/settings-save$/, handler: admin.saveSettings },

  // transactions (served by api/transactions.ts)
  { method: 'GET', pattern: /^\/api\/transactions$/, handler: admin.listTransactions },

  // daily entries (served by api/daily-entries.ts)
  { method: 'GET', pattern: /^\/api\/daily-entries$/, handler: admin.listDailyEntries },
];

/** Serial from ?serial= or body.serial (trimmed). */
function serialOf(req: VercelRequest): string {
  const q = req.query.serial;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const b = req.body as Record<string, unknown> | undefined;
  return String(b?.serial ?? '').trim();
}

/** Item id from ?id= or body.id. */
function idOf(req: VercelRequest): string {
  const q = req.query.id;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const b = req.body as Record<string, unknown> | undefined;
  return String(b?.id ?? '').trim();
}

export default async function handle(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!cloudEnabled) {
    return json(res, 503, {
      error: 'STORAGE_NOT_CONFIGURED',
      message: 'Cloud storage is not connected. Add the Upstash Redis integration in Vercel.',
    });
  }
  const path = (req.url || '/').split('?')[0];
  await ensureSeeded();
  for (const { method, pattern, handler } of routes) {
    if (req.method !== method) continue;
    if (!pattern.test(path)) continue;
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[api] error:', err);
      if (!res.writableEnded) json(res, 500, { error: 'INTERNAL', message: 'Unexpected server error.' });
    }
    return;
  }
  json(res, 404, { error: 'NOT_FOUND', path });
}
