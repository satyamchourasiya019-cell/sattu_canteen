import type { VercelRequest, VercelResponse } from '@vercel/node';
import router from './_router';

/** GET /api/order (menu | feed | mine) and POST /api/order (place | action). */
export default function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  return router(req, res);
}
