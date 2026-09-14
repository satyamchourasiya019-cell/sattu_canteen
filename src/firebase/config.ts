import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Firebase web config comes from environment variables (.env / Vercel).
 * These values identify the project - real security is enforced by
 * Firebase Authentication + Firestore Security Rules (see firestore.rules).
 */
const env = import.meta.env;

interface EnvPair {
  key: string;
  value: unknown;
}

const requiredEnv: EnvPair[] = [
  { key: 'VITE_FIREBASE_API_KEY', value: env.VITE_FIREBASE_API_KEY },
  { key: 'VITE_FIREBASE_AUTH_DOMAIN', value: env.VITE_FIREBASE_AUTH_DOMAIN },
  { key: 'VITE_FIREBASE_PROJECT_ID', value: env.VITE_FIREBASE_PROJECT_ID },
  { key: 'VITE_FIREBASE_APP_ID', value: env.VITE_FIREBASE_APP_ID },
];

export interface FirebaseEnvStatus {
  configured: boolean;
  missing: string[];
}

export const firebaseEnvStatus: FirebaseEnvStatus = {
  configured: requiredEnv.every((e) => typeof e.value === 'string' && e.value.trim() !== ''),
  missing: requiredEnv.filter((e) => !(typeof e.value === 'string' && e.value.trim() !== '')).map((e) => e.key),
};

/**
 * 'firebase' - Firebase env vars present: Auth + Firestore.
 * 'cloud'    - deployed with the serverless API + Upstash Redis backend
 *              (production hostname, no Firebase vars).
 * 'local'    - development: bundled zero-dependency demo backend
 *              (server/demo-server.mjs, proxied under /api).
 */
const isProdHost = typeof window !== 'undefined' && !window.location.hostname.startsWith('localhost') && window.location.hostname !== '127.0.0.1';

export const BACKEND_MODE: 'firebase' | 'cloud' | 'local' = firebaseEnvStatus.configured
  ? 'firebase'
  : isProdHost
    ? 'cloud'
    : 'local';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseEnvStatus.configured) {
  app = initializeApp({
    apiKey: String(env.VITE_FIREBASE_API_KEY),
    authDomain: String(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: String(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ? String(env.VITE_FIREBASE_STORAGE_BUCKET) : undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ? String(env.VITE_FIREBASE_MESSAGING_SENDER_ID) : undefined,
    appId: String(env.VITE_FIREBASE_APP_ID),
  });
  auth = getAuth(app);
  db = getFirestore(app);
}

/** Throws a stable error code when Firebase has not been configured yet. */
export const FIREBASE_NOT_CONFIGURED = 'FIREBASE_NOT_CONFIGURED';

export function requireDb(): Firestore {
  if (!db) throw new Error(FIREBASE_NOT_CONFIGURED);
  return db;
}

export function requireAuth(): Auth {
  if (!auth) throw new Error(FIREBASE_NOT_CONFIGURED);
  return auth;
}
