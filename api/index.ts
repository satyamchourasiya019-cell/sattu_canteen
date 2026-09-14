import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './_lib/util';
import { cloudEnabled, ensureSeeded } from './_lib/store';
import * as scan from './_handlers/scan';
import * as admin from './_handlers/admin';

type Handler = (req: VercelRequest, res: VercelResponse, m: RegExpMatchArray) => Promise<void> | void;

/**
 * All routes are SINGLE-SEGMENT (/api/<name>): Vercel's function routing on
 * this project only guarantees /api/index.* for those. Multi-segment forms
 * (/employee/register) are kept as aliases in case routing changes, but the
 * canonical client always calls the single-segment names.
 * Mutations (save/delete) use POST bodies rather than PUT/DELETE for the
 * same reason.
 */
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
  // health
  { method: 'GET', pattern: /^\/api\/health$/, handler: (_req, res) => json(res, 200, { ok: true, mode: 'cloud', storage: cloudEnabled ? 'upstash' : 'not-configured', time: new Date().toISOString() }) },

  // admin auth
  { method: 'POST', pattern: /^\/api\/auth-login$/, handler: admin.login },
  { method: 'POST', pattern: /^\/api\/auth-logout$/, handler: admin.logout },
  { method: 'GET', pattern: /^\/api\/auth-me$/, handler: admin.me },
  // aliases (legacy two-segment)
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: admin.login },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: admin.logout },
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: admin.me },

  // employees (admin)
  { method: 'GET', pattern: /^\/api\/employees$/, handler: admin.listEmployees },
  { method: 'POST', pattern: /^\/api\/employees-bulk$/, handler: admin.bulkEmployees },
  { method: 'POST', pattern: /^\/api\/employees\/bulk$/, handler: admin.bulkEmployees },
  { method: 'GET', pattern: /^\/api\/employee$/, handler: (req, res) => admin.getEmployee(req, res, serialOf(req)) },
  { method: 'POST', pattern: /^\/api\/employee-save$/, handler: (req, res) => admin.saveEmployee(req, res, serialOf(req)) },
  { method: 'POST', pattern: /^\/api\/employee-delete$/, handler: (req, res) => admin.deleteEmployee(req, res, serialOf(req)) },
  // aliases (legacy REST style)
  { method: 'GET', pattern: /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, handler: (req, res, m) => admin.getEmployee(req, res, m[1]) },
  { method: 'PUT', pattern: /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, handler: (req, res, m) => admin.saveEmployee(req, res, m[1]) },
  { method: 'DELETE', pattern: /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, handler: (req, res, m) => admin.deleteEmployee(req, res, m[1]) },

  // employee self-service
  { method: 'POST', pattern: /^\/api\/employee-register$/, handler: scan.employeeRegister },
  { method: 'GET', pattern: /^\/api\/employee-me$/, handler: scan.employeeMe },
  { method: 'POST', pattern: /^\/api\/employee-logout$/, handler: scan.employeeLogout },
  { method: 'POST', pattern: /^\/api\/employee\/register$/, handler: scan.employeeRegister },
  { method: 'GET', pattern: /^\/api\/employee\/me$/, handler: scan.employeeMe },
  { method: 'POST', pattern: /^\/api\/employee\/logout$/, handler: scan.employeeLogout },

  // scan flow
  { method: 'GET', pattern: /^\/api\/scan-context$/, handler: scan.scanContext },
  { method: 'POST', pattern: /^\/api\/scan-confirm$/, handler: scan.scanConfirm },
  { method: 'GET', pattern: /^\/api\/scan\/context$/, handler: scan.scanContext },
  { method: 'POST', pattern: /^\/api\/scan\/confirm$/, handler: scan.scanConfirm },

  // meal items
  { method: 'GET', pattern: /^\/api\/meal-items$/, handler: admin.listMealItems },
  { method: 'POST', pattern: /^\/api\/meal-item-create$/, handler: admin.createMealItem },
  { method: 'POST', pattern: /^\/api\/meal-item-save$/, handler: (req, res) => admin.saveMealItem(req, res, idOf(req)) },
  { method: 'POST', pattern: /^\/api\/meal-item-delete$/, handler: (req, res) => admin.deleteMealItem(req, res, idOf(req)) },
  { method: 'PUT', pattern: /^\/api\/meal-items\/([a-z0-9-]+)$/, handler: (req, res, m) => admin.saveMealItem(req, res, m[1]) },
  { method: 'DELETE', pattern: /^\/api\/meal-items\/([a-z0-9-]+)$/, handler: (req, res, m) => admin.deleteMealItem(req, res, m[1]) },

  // settings
  { method: 'GET', pattern: /^\/api\/settings$/, handler: admin.getSettings },
  { method: 'POST', pattern: /^\/api\/settings-save$/, handler: admin.saveSettings },
  { method: 'PUT', pattern: /^\/api\/settings$/, handler: admin.saveSettings },

  // transactions & daily entries
  { method: 'GET', pattern: /^\/api\/transactions$/, handler: admin.listTransactions },
  { method: 'GET', pattern: /^\/api\/daily-entries$/, handler: admin.listDailyEntries },
  { method: 'POST', pattern: /^\/api\/manual-entry$/, handler: admin.manualEntry },
  { method: 'POST', pattern: /^\/api\/transaction-delete$/, handler: (req, res) => admin.deleteTransaction(req, res, idOf(req)) },
  { method: 'POST', pattern: /^\/api\/cleanup$/, handler: admin.cleanup },
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const m = path.match(pattern);
    if (!m) continue;
    try {
      await handler(req, res, m);
    } catch (err) {
      console.error('[api] error:', err);
      if (!res.writableEnded) json(res, 500, { error: 'INTERNAL', message: 'Unexpected server error.' });
    }
    return;
  }
  json(res, 404, { error: 'NOT_FOUND', path });
}
