import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './lib/util';
import { cloudEnabled, ensureSeeded } from './lib/store';
import * as scan from './scan';
import * as admin from './admin';

export const config = { api: { bodyParser: true } };

type Handler = (req: VercelRequest, res: VercelResponse, m: RegExpMatchArray) => Promise<void> | void;

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
  // health
  { method: 'GET', pattern: /^\/api\/health$/, handler: (_req, res) => json(res, 200, { ok: true, mode: 'cloud', storage: cloudEnabled ? 'upstash' : 'not-configured', time: new Date().toISOString() }) },

  // admin auth
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: admin.login },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: admin.logout },
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: admin.me },

  // employees
  { method: 'GET', pattern: /^\/api\/employees$/, handler: admin.listEmployees },
  { method: 'POST', pattern: /^\/api\/employees\/bulk$/, handler: admin.bulkEmployees },
  { method: 'GET', pattern: /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, handler: (req, res, m) => admin.getEmployee(req, res, m[1]) },
  { method: 'PUT', pattern: /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, handler: (req, res, m) => admin.saveEmployee(req, res, m[1]) },
  { method: 'DELETE', pattern: /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, handler: (req, res, m) => admin.deleteEmployee(req, res, m[1]) },

  // employee self-service
  { method: 'POST', pattern: /^\/api\/employee\/register$/, handler: scan.employeeRegister },
  { method: 'GET', pattern: /^\/api\/employee\/me$/, handler: scan.employeeMe },
  { method: 'POST', pattern: /^\/api\/employee\/logout$/, handler: scan.employeeLogout },

  // scan flow
  { method: 'GET', pattern: /^\/api\/scan\/context$/, handler: scan.scanContext },
  { method: 'POST', pattern: /^\/api\/scan\/confirm$/, handler: scan.scanConfirm },

  // meal items
  { method: 'GET', pattern: /^\/api\/meal-items$/, handler: admin.listMealItems },
  { method: 'POST', pattern: /^\/api\/meal-items$/, handler: admin.createMealItem },
  { method: 'PUT', pattern: /^\/api\/meal-items\/([a-z0-9-]+)$/, handler: (req, res, m) => admin.saveMealItem(req, res, m[1]) },
  { method: 'DELETE', pattern: /^\/api\/meal-items\/([a-z0-9-]+)$/, handler: (req, res, m) => admin.deleteMealItem(req, res, m[1]) },

  // settings
  { method: 'GET', pattern: /^\/api\/settings$/, handler: admin.getSettings },
  { method: 'PUT', pattern: /^\/api\/settings$/, handler: admin.saveSettings },

  // transactions & daily entries
  { method: 'GET', pattern: /^\/api\/transactions$/, handler: admin.listTransactions },
  { method: 'GET', pattern: /^\/api\/daily-entries$/, handler: admin.listDailyEntries },
  { method: 'POST', pattern: /^\/api\/manual-entry$/, handler: admin.manualEntry },
  { method: 'DELETE', pattern: /^\/api\/transactions\/(.+)$/, handler: (req, res, m) => admin.deleteTransaction(req, res, decodeURIComponent(m[1])) },
  { method: 'POST', pattern: /^\/api\/cleanup$/, handler: admin.cleanup },
];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // The catch-all receives the full original path (e.g. /api/settings), so
  // the same regexes as the demo server work unchanged.
  const path = (req.url || '/').split('?')[0];
  if (!cloudEnabled) {
    return json(res, 503, {
      error: 'STORAGE_NOT_CONFIGURED',
      message: 'Cloud storage is not connected. Add the Upstash Redis integration in Vercel.',
    });
  }
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
