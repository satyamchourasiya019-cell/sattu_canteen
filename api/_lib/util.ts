import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { getJSON, setJSON, del, keys, type SessionRecord, type EmployeeSessionRecord } from './store';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

export function detectMeal(mins: number, timings: Record<string, { from: string; to: string }>): string | null {
  for (const [meal, w] of Object.entries(timings || {})) {
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    if (from < 0 || to < 0) continue;
    if (from <= to ? mins >= from && mins <= to : mins >= from || mins <= to) return meal;
  }
  return null;
}

export function mealSlot(meal: string): 'breakfastSnacks' | 'lunchDinner' {
  return meal === 'lunch' || meal === 'dinner' ? 'lunchDinner' : 'breakfastSnacks';
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatTime12(hhmm: string): string {
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Reserved hook (kept so handlers can grow without signature churn). */
export async function ensureUtil(): Promise<void> {
  // no-op
}

export function canonicalSerial(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, '');
}

// ------------------------------------------------------------ sessions ---
export async function createSession(user: { uid: string; email: string; role: 'admin' | 'supervisor' }): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = (await getJSON<Record<string, SessionRecord>>(keys.sessions)) ?? {};
  sessions[token] = { ...user, expiresAt: Date.now() + SESSION_TTL_MS };
  await setJSON(keys.sessions, sessions);
  return token;
}

export async function getAdminSession(req: VercelRequest): Promise<SessionRecord | null> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const sessions = (await getJSON<Record<string, SessionRecord>>(keys.sessions)) ?? {};
  const s = sessions[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    delete sessions[token];
    await setJSON(keys.sessions, sessions);
    return null;
  }
  return s;
}

export async function dropSession(req: VercelRequest): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return;
  const sessions = (await getJSON<Record<string, SessionRecord>>(keys.sessions)) ?? {};
  if (sessions[token]) {
    delete sessions[token];
    await setJSON(keys.sessions, sessions);
  }
}

export async function createEmployeeSession(serial: string): Promise<string> {
  const token = crypto.randomBytes(20).toString('hex');
  const sessions = (await getJSON<Record<string, EmployeeSessionRecord>>(keys.employeeSessions)) ?? {};
  sessions[token] = { serial, createdAt: Date.now() };
  await setJSON(keys.employeeSessions, sessions);
  return token;
}

export async function getEmployeeSession(req: VercelRequest): Promise<EmployeeSessionRecord | null> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const sessions = (await getJSON<Record<string, EmployeeSessionRecord>>(keys.employeeSessions)) ?? {};
  return sessions[token] ?? null;
}

export async function dropEmployeeSession(req: VercelRequest): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return;
  const sessions = (await getJSON<Record<string, EmployeeSessionRecord>>(keys.employeeSessions)) ?? {};
  if (sessions[token]) {
    delete sessions[token];
    await setJSON(keys.employeeSessions, sessions);
  }
}

export async function readBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  return {};
}

/** Rate-limit style cleanup of expired sessions (called occasionally). */
export async function gcSessions(): Promise<void> {
  const sessions = (await getJSON<Record<string, SessionRecord>>(keys.sessions)) ?? {};
  let changed = false;
  for (const [tok, s] of Object.entries(sessions)) {
    if (s.expiresAt < Date.now()) {
      delete sessions[tok];
      changed = true;
    }
  }
  if (changed) await setJSON(keys.sessions, sessions);
}

export { del };
