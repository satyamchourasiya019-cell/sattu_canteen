import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readBody, json } from './_lib/util';
import { cloudEnabled, ensureSeeded } from './_lib/store';
import * as scan from './_handlers/scan';
import * as admin from './_handlers/admin';

/**
 * Shared API router. Vercel's Hobby plan allows 12 serverless functions, so
 * each top-level api/<file>.ts delegates here and dispatches on path.
 *
 * IMPORTANT: the request path MUST equal the serving function file's name
 * (api/auth.ts serves /api/auth, api/employees.ts serves /api/employees, …).
 * Vercel only routes /api/<file-name> to the function — any other path 404s
 * at the edge before our code runs. POST actions therefore carry an `action`
 * (or `count`) field in the JSON body instead of distinct paths.
 */
type Body = Record<string, unknown> & { action?: string; count?: number };

export default async function handle(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!cloudEnabled) {
    return json(res, 503, {
      error: 'STORAGE_NOT_CONFIGURED',
      message: 'Cloud storage is not connected. Add the Upstash Redis integration in Vercel.',
    });
  }
  const path = (req.url || '/').split('?')[0];
  await ensureSeeded();
  const body: Body = req.method === 'POST' ? { ...(await readBody(req)) } : {};
  try {
    switch (`${req.method} ${path}`) {
      // ---- api/index.ts ----
      case 'GET /api':
        return json(res, 200, { ok: true, mode: 'cloud', storage: 'upstash' });

      // ---- api/auth.ts ----
      case 'POST /api/auth':
        if (body.action === 'logout') return await admin.logout(req, res);
        return await admin.login(req, res);
      case 'GET /api/auth':
        return await admin.me(req, res);

      // ---- api/employees.ts ----
      case 'GET /api/employees':
        return req.query.serial
          ? await admin.getEmployeeQuery(req, res)
          : await admin.listEmployees(req, res);
      case 'POST /api/employees':
        if (typeof body.count === 'number' && body.count > 0) return await admin.bulkEmployees(req, res);
        if (body.action === 'delete') return await admin.deleteEmployee(req, res, String(body.serial ?? ''));
        return await admin.saveEmployee(req, res, String(body.serial ?? ''));

      // ---- api/employee-session.ts ----
      case 'GET /api/employee-session':
        return await scan.employeeMe(req, res);
      case 'POST /api/employee-session':
        if (body.action === 'logout') return await scan.employeeLogout(req, res);
        if (body.action === 'reset') return await admin.resetEmployeeLogin(req, res);
        return await scan.employeeRegister(req, res);

      // ---- api/scan.ts ----
      case 'GET /api/scan':
        return await scan.scanContext(req, res);
      case 'POST /api/scan':
        return await scan.scanConfirm(req, res);

      // ---- api/meal-items.ts ----
      case 'GET /api/meal-items':
        return await admin.listMealItems(req, res);
      case 'POST /api/meal-items':
        if (body.action === 'save') return await admin.saveMealItem(req, res, String(body.id ?? ''));
        if (body.action === 'delete') return await admin.deleteMealItem(req, res, String(body.id ?? ''));
        return await admin.createMealItem(req, res);

      // ---- api/settings.ts ----
      case 'GET /api/settings':
        return await admin.getSettings(req, res);
      case 'POST /api/settings':
        if (body.action === 'cleanup') return await admin.cleanup(req, res);
        return await admin.saveSettings(req, res);

      // ---- api/transactions.ts ----
      case 'GET /api/transactions':
        return await admin.listTransactions(req, res);
      case 'POST /api/transactions':
        if (body.action === 'manual') return await admin.manualEntry(req, res);
        return await admin.deleteTransaction(req, res, String(body.id ?? ''));

      // ---- api/daily-entries.ts ----
      case 'GET /api/daily-entries':
        return await admin.listDailyEntries(req, res);
    }
    json(res, 404, { error: 'NOT_FOUND', path });
  } catch (err) {
    console.error('[api] error:', err);
    if (!res.writableEnded) json(res, 500, { error: 'INTERNAL', message: 'Unexpected server error.' });
  }
}
