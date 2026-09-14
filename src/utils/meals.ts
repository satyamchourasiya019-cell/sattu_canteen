import type { MealType, MealTimings, QrType } from '../types';

/** "14:05" -> 845 minutes since midnight. Returns -1 on malformed input. */
export function minutesOf(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

/** 845 -> "14:05". */
export function minutesToHHMM(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Which meal covers `mins` given the admin-configured windows (may cross midnight). */
export function detectMeal(mins: number, timings: MealTimings): MealType | null {
  for (const meal of Object.keys(timings) as MealType[]) {
    const w = timings[meal];
    if (!w) continue;
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    if (from < 0 || to < 0) continue;
    if (from <= to ? mins >= from && mins <= to : mins >= from || mins <= to) return meal;
  }
  return null;
}

/** The meal whose window covers "now" on the client clock. */
export function currentMeal(timings: MealTimings): MealType | null {
  const d = new Date();
  return detectMeal(d.getHours() * 60 + d.getMinutes(), timings);
}

/**
 * Server is the source of truth for time (employee phones can have wrong
 * clocks), so employee pages rely on the scan-context API. This helper is
 * for immediate UI hints before the server responds.
 */
export function mealForQrHint(qr: QrType, meal: MealType | null): string {
  if (!meal) return 'Outside meal hours — please ask canteen staff.';
  return meal === 'lunch' || meal === 'dinner'
    ? (qr === 'lunchDinner' ? meal : 'wrong-qr')
    : (qr === 'breakfastSnacks' ? meal : 'wrong-qr');
}
