/**
 * Order doc id: "<YYYY-MM-DD>_<serial>".
 * This makes "one order per serial per day" a database-level guarantee:
 * writing the same id again UPDATES the existing order instead of
 * creating a duplicate record.
 */
export function orderDocId(dateStr: string, serial: string): string {
  return `${dateStr}_${serial}`;
}

export function parseOrderDocId(id: string): { date: string; serial: string } | null {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
  if (!m) return null;
  return { date: m[1], serial: m[2] };
}

/** Serial as stored in documents/ids: trimmed, internal whitespace removed. */
export function canonicalSerial(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}
