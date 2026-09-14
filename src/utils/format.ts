const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ₹1,234 style currency (Indian grouping). */
export function formatCurrency(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/** Local date as YYYY-MM-DD (the canonical "order date" key). */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayDateString(): string {
  return toDateString(new Date());
}

/** Local time as HH:mm (24h). */
export function toTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "2026-09-12" -> "12 Sep 2026" (falls back to the input if malformed). */
export function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "14:05" -> "2:05 PM". */
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Epoch ms -> "12 Sep 2026, 2:05 PM". */
export function formatEpoch(ms: number): string {
  const d = new Date(ms);
  return `${formatDisplayDate(toDateString(d))}, ${formatTime12h(toTimeString(d))}`;
}

/** Pad a serial like 1 -> "001" (keeps letters/leading zeros as typed). */
export function normalizeSerialInput(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}
