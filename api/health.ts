import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './lib/util';
import { cloudEnabled } from './lib/store';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  json(res, 200, { ok: true, mode: 'cloud', storage: cloudEnabled ? 'upstash' : 'not-configured', time: new Date().toISOString() });
}
