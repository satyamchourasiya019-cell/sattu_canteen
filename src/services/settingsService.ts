import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { requireDb, BACKEND_MODE } from '../firebase/config';
import type { CanteenSettings, MealTimings } from '../types';
import * as api from './api';

const DOC_PATH = 'settings/general';

export const DEFAULT_SETTINGS: CanteenSettings = {
  canteenName: 'Company Canteen',
  retentionDays: 365,
  lastCleanupAt: null,
  allowSelfRegistration: true,
  mealTimings: {
    breakfast: { from: '06:00', to: '11:00' },
    lunch: { from: '11:00', to: '16:00' },
    snacks: { from: '16:00', to: '19:00' },
    dinner: { from: '19:00', to: '23:00' },
  },
};

function normTimings(t: unknown): MealTimings {
  const def = DEFAULT_SETTINGS.mealTimings;
  if (!t || typeof t !== 'object') return def;
  const src = t as Record<string, { from?: unknown; to?: unknown }>;
  const out = {} as MealTimings;
  for (const meal of Object.keys(def) as (keyof MealTimings)[]) {
    const w = src[meal];
    const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
    out[meal] = { from: ok(w?.from) ? w.from : def[meal].from, to: ok(w?.to) ? w.to : def[meal].to };
  }
  return out;
}

function toSettings(data: Record<string, unknown> | undefined): CanteenSettings {
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    canteenName: typeof data.canteenName === 'string' && data.canteenName.trim() ? data.canteenName : DEFAULT_SETTINGS.canteenName,
    retentionDays: typeof data.retentionDays === 'number' && data.retentionDays >= 30 ? data.retentionDays : 365,
    lastCleanupAt: typeof data.lastCleanupAt === 'number' ? data.lastCleanupAt : null,
    allowSelfRegistration: typeof data.allowSelfRegistration === 'boolean' ? data.allowSelfRegistration : true,
    mealTimings: normTimings(data.mealTimings),
  };
}

export function subscribeSettings(cb: (s: CanteenSettings) => void, onError?: (msg: string) => void): () => void {
  if (BACKEND_MODE === 'local') {
    const refresh = async () => {
      try {
        cb(await api.apiGetSettings());
      } catch {
        onError?.('Unable to load settings.');
      }
    };
    void refresh();
    const unsub = api.apiSubscribe('settings', () => void refresh());
    return () => unsub();
  }
  try {
    const db = requireDb();
    return onSnapshot(
      doc(db, DOC_PATH),
      (snap) => cb(toSettings(snap.data() as Record<string, unknown> | undefined)),
      () => onError?.('Unable to load settings.'),
    );
  } catch {
    onError?.('The system is not configured yet.');
    return () => undefined;
  }
}

export async function fetchSettings(): Promise<CanteenSettings> {
  if (BACKEND_MODE === 'local') return api.apiGetSettings();
  const db = requireDb();
  const snap = await getDoc(doc(db, DOC_PATH));
  return toSettings(snap.data() as Record<string, unknown> | undefined);
}

export async function saveSettings(changes: Partial<CanteenSettings>): Promise<void> {
  if (BACKEND_MODE === 'local') return api.apiSaveSettings(changes);
  const db = requireDb();
  await setDoc(doc(db, DOC_PATH), { ...changes, updatedAt: Date.now() }, { merge: true });
}

export async function markCleanupDone(atMs: number, deletedCount: number): Promise<void> {
  if (BACKEND_MODE === 'local') {
    void deletedCount;
    void atMs;
    return; // the demo server stamps lastCleanupAt during /api/cleanup
  }
  const db = requireDb();
  await setDoc(doc(db, DOC_PATH), { lastCleanupAt: atMs }, { merge: true });
}
