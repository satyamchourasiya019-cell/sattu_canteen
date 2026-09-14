/** Stable app error codes. */
export const ERR_FIREBASE_NOT_CONFIGURED = 'FIREBASE_NOT_CONFIGURED';
export const ERR_SERIAL_INVALID = 'SERIAL_INVALID';
export const ERR_SERIAL_INACTIVE = 'SERIAL_INACTIVE';
export const ERR_NO_ITEMS = 'NO_ITEMS';
export const ERR_ORDER_EXISTS = 'ORDER_EXISTS'; // submitted from another device; cannot overwrite
export const ERR_NOT_AUTHORIZED = 'NOT_AUTHORIZED';
export const ERR_NETWORK = 'NETWORK';

export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isOfflineLike(code: string): boolean {
  return ['unavailable', 'network-request-failed', 'deadline-exceeded', 'cancelled'].includes(code);
}

/** Map any thrown error to an employee-safe message (no raw Firebase text). */
export function friendlyMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;

  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  const msg = err instanceof Error ? err.message : '';

  if (code === ERR_FIREBASE_NOT_CONFIGURED || msg === ERR_FIREBASE_NOT_CONFIGURED) {
    return 'The ordering system is not configured yet. Please contact the administrator.';
  }
  if (code === 'permission-denied') {
    return 'You do not have permission for this action.';
  }
  if (isOfflineLike(code) || code === ERR_NETWORK) {
    return 'No internet connection. Please check your network and try again.';
  }
  if (code === 'too-many-requests') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return 'Something went wrong. Please try again.';
}
