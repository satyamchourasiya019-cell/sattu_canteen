import type { VercelRequest, VercelResponse } from '@vercel/node';
import router from './_router';

export default function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  return router(req, res);
}
