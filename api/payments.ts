import type { VercelRequest, VercelResponse } from '@vercel/node';
import router from './_router';

/** GET /api/payments?month=YYYY-MM and POST /api/payments (record payment). */
export default function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  return router(req, res);
}
