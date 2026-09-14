import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { requireDb, BACKEND_MODE } from '../firebase/config';
import type { MealItem } from '../types';
import * as api from './api';

const COLLECTION = 'mealItems';

function toMealItem(id: string, data: Record<string, unknown>): MealItem {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : id,
    price: typeof data.price === 'number' ? data.price : 0,
    enabled: data.enabled !== false,
  };
}

/** Public menu subscription (employee scan flow + admin management). */
export function subscribeMealItems(cb: (items: MealItem[]) => void, onError?: (msg: string) => void): () => void {
  if (BACKEND_MODE === 'local') {
    const refresh = async () => {
      try {
        cb(await api.apiListMealItems());
      } catch {
        onError?.('Unable to load the items. Please check your connection.');
      }
    };
    void refresh();
    const unsub = api.apiSubscribe('mealItems', () => void refresh());
    return () => unsub();
  }
  try {
    const db = requireDb();
    return onSnapshot(
      collection(db, COLLECTION),
      (snap) => {
        const items: MealItem[] = [];
        snap.forEach((d) => items.push(toMealItem(d.id, d.data() as Record<string, unknown>)));
        items.sort((a, b) => a.name.localeCompare(b.name));
        cb(items);
      },
      () => onError?.('Unable to load the items. Please check your connection.'),
    );
  } catch {
    onError?.('The system is not configured yet.');
    return () => undefined;
  }
}

/** One-time fetch (admin). */
export async function fetchMealItems(): Promise<MealItem[]> {
  if (BACKEND_MODE === 'local') return api.apiListMealItems();
  const db = requireDb();
  const snap = await getDocs(collection(db, COLLECTION));
  const items: MealItem[] = [];
  snap.forEach((d) => items.push(toMealItem(d.id, d.data() as Record<string, unknown>)));
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export async function createMealItem(item: { id?: string; name: string; price: number; enabled?: boolean }): Promise<void> {
  if (BACKEND_MODE === 'local') return api.apiCreateMealItem(item);
  const db = requireDb();
  const id = (item.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 30) || `item-${Date.now()}`;
  await setDoc(doc(db, COLLECTION, id), {
    name: item.name.trim().slice(0, 40),
    price: Math.max(0, Math.round(item.price)),
    enabled: item.enabled !== false,
    createdAt: Date.now(),
  });
}

export async function saveMealItem(item: MealItem): Promise<void> {
  if (BACKEND_MODE === 'local') return api.apiSaveMealItem(item);
  const db = requireDb();
  await updateDoc(doc(db, COLLECTION, item.id), {
    name: item.name.trim().slice(0, 40),
    price: Math.max(0, Math.round(item.price)),
    enabled: item.enabled,
    updatedAt: Date.now(),
  });
}

export async function deleteMealItem(id: string): Promise<void> {
  if (BACKEND_MODE === 'local') return api.apiDeleteMealItem(id);
  const db = requireDb();
  await deleteDoc(doc(db, COLLECTION, id));
}
