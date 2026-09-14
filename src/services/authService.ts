import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { requireAuth, requireDb, BACKEND_MODE } from '../firebase/config';
import type { AdminRole, AdminUser } from '../types';
import { AppError, ERR_NOT_AUTHORIZED } from '../utils/errors';
import * as api from './api';

/**
 * A signed-in account is only an admin/supervisor if a users/{uid}
 * document exists with role "admin" or "supervisor". Accounts without
 * this profile doc are signed out immediately.
 */
async function loadProfile(user: User): Promise<AdminUser | null> {
  const db = requireDb();
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  const role = data.role === 'admin' ? 'admin' : data.role === 'supervisor' ? 'supervisor' : null;
  if (!role) return null;
  return { uid: user.uid, email: user.email ?? '', role: role as AdminRole };
}

export function watchAdminAuth(cb: (user: AdminUser | null, loading: boolean) => void): () => void {
  if (BACKEND_MODE !== 'firebase') {
    cb(null, true);
    api
      .apiFetchSession()
      .then((user) => cb(user, false))
      .catch(() => cb(null, false));
    return () => undefined;
  }
  try {
    const auth = requireAuth();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        cb(null, false);
        return;
      }
      try {
        const profile = await loadProfile(user);
        if (!profile) {
          await signOut(auth);
          cb(null, false);
          return;
        }
        cb(profile, false);
      } catch {
        cb(null, false);
      }
    });
  } catch {
    cb(null, false);
    return () => undefined;
  }
}

export async function adminSignIn(email: string, password: string): Promise<AdminUser> {
  if (BACKEND_MODE !== 'firebase') return api.apiLogin(email, password);
  const auth = requireAuth();
  await setPersistence(auth, browserLocalPersistence);
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const profile = await loadProfile(cred.user);
    if (!profile) {
      await signOut(auth);
      throw new AppError(ERR_NOT_AUTHORIZED, 'This account is not authorized for the admin dashboard.');
    }
    return profile;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      throw new AppError('AUTH_FAILED', 'Incorrect email or password.');
    }
    if (code === 'auth/too-many-requests') {
      throw new AppError('AUTH_FAILED', 'Too many attempts. Please try again later.');
    }
    if (code === 'auth/network-request-failed') {
      throw new AppError('NETWORK', 'No internet connection. Please check your network.');
    }
    throw new AppError('AUTH_FAILED', 'Could not sign in. Please try again.');
  }
}

export async function adminSignOut(): Promise<void> {
  if (BACKEND_MODE !== 'firebase') return api.apiLogout();
  const auth = requireAuth();
  await signOut(auth);
}

/** One-time bootstrap: create the first admin account + profile (run from Setup). */
export async function bootstrapAdmin(email: string, password: string, role: AdminRole): Promise<void> {
  const auth = requireAuth();
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const db = requireDb();
  await setDoc(doc(db, 'users', cred.user.uid), { email: email.trim(), role, createdAt: Date.now() });
}

export async function sendReset(email: string): Promise<void> {
  if (BACKEND_MODE !== 'firebase') {
    throw new AppError('NO_RESET', 'Password reset email is not available in local demo mode. Use one of the demo accounts shown on the login page.');
  }
  const auth = requireAuth();
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Legacy anonymous-device helpers kept for the admin-side session bootstrap.
 * The employee flow now uses its own identity helpers in scanService.
 */
export async function ensureAnonymousDevice(): Promise<string> {
  if (BACKEND_MODE === 'firebase') {
    const auth = requireAuth();
    if (auth.currentUser) return auth.currentUser.uid;
    const { signInAnonymously } = await import('firebase/auth');
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  }
  // Local mode: no anonymous device concept needed outside the scan flow.
  return 'local-device';
}

export function currentDeviceUid(): string | null {
  if (BACKEND_MODE === 'firebase') {
    try {
      const auth = requireAuth();
      return auth.currentUser?.uid ?? null;
    } catch {
      return null;
    }
  }
  return 'local-device';
}
