import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './_lib/util';

/** Catches PUT / DELETE / PATCH etc. on /api so they get JSON 404/405, never an HTML page. */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  const path = (req.url || '/').split('?')[0];
  if (path === '/api' || path === '/api/') {
    return json(res, 200, { ok: true, mode: 'cloud' });
  }
  json(res, 405, { error: 'METHOD_NOT_ALLOWED', method: req.method, path });
}
