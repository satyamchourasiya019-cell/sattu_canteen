import { toDateString, todayDateString } from './format';

export interface DateRange {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

export function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateString(dt);
}

export function yesterdayDateString(): string {
  return shiftDays(todayDateString(), -1);
}

/** Epoch ms bounds covering an entire local day. */
export function dayBounds(dateStr: string): { startMs: number; endMs: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function rangeBounds(range: DateRange): { startMs: number; endMs: number } {
  const s = dayBounds(range.from);
  const e = dayBounds(range.to);
  return { startMs: s.startMs, endMs: e.endMs };
}

/** "N days ago" cutoff as YYYY-MM-DD (for the one-year retention cleanup). */
export function cutoffDateString(retentionDays: number): string {
  return shiftDays(todayDateString(), -Math.max(0, Math.floor(retentionDays)));
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
