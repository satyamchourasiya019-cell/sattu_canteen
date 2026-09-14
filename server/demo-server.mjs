/*
 * Local demo API for the QR-based Canteen app.
 *
 * Runs when Firebase env vars are not configured (demo/dev mode).
 * Zero dependencies: plain Node http + JSON file persistence (data/db.json).
 * The client auto-detects this mode and talks to /api (proxied by Vite).
 * The API shape mirrors the Firestore collections in firestore.rules so the
 * same frontend works unchanged in production mode.
 *
 * SECURITY: development convenience, seeded with demo credentials.
 * Production deployments use Firebase Auth + Firestore rules.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const PORT = Number(process.env.DEMO_API_PORT || 8787);
const HOST = process.env.DEMO_API_HOST || '127.0.0.1';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h admin sessions

// ---------------------------------------------------------------- data ---
const now = () => Date.now();

function toDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toTimeString(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function todayStr() { return toDateString(new Date()); }

let db = null;

function defaultDb() {
  const t = now();
  return {
    users: [
      { uid: 'demo-admin-uid', email: 'admin@canteen.local', password: 'admin123', role: 'admin' },
      { uid: 'demo-super-1', email: 'supervisor1@canteen.local', password: 'super123', role: 'supervisor' },
      { uid: 'demo-super-2', email: 'supervisor2@canteen.local', password: 'super123', role: 'supervisor' },
    ],
    employees: {
      // serial -> master record. Serials must exist (admin adds, or self-signup
      // with the "allow self registration" toggle ON).
    },
    mealItems: {
      // Meal price entries (id = meal name). Prices are editable by admins;
      // these four ids are NOT shown in the addon dropdowns.
      'breakfast': { id: 'breakfast', name: 'Breakfast', price: 30, enabled: true, isMeal: true },
      'lunch': { id: 'lunch', name: 'Lunch', price: 50, enabled: true, isMeal: true },
      'snacks': { id: 'snacks', name: 'Snacks', price: 15, enabled: true, isMeal: true },
      'dinner': { id: 'dinner', name: 'Dinner', price: 50, enabled: true, isMeal: true },
      // Addon menu (admin-managed): Tea, Coffee, Milk, Juice, Curd, Sweet, ...
      'tea': { id: 'tea', name: 'Tea', price: 10, enabled: true },
      'coffee': { id: 'coffee', name: 'Coffee', price: 15, enabled: true },
      'milk': { id: 'milk', name: 'Milk', price: 20, enabled: true },
      'juice': { id: 'juice', name: 'Juice', price: 25, enabled: true },
      'extra-roti': { id: 'extra-roti', name: 'Extra Roti', price: 5, enabled: true },
      'extra-sabzi': { id: 'extra-sabzi', name: 'Extra Sabzi', price: 20, enabled: true },
      'curd': { id: 'curd', name: 'Curd', price: 10, enabled: true },
      'sweet': { id: 'sweet', name: 'Sweet', price: 15, enabled: true },
      'salad': { id: 'salad', name: 'Salad', price: 10, enabled: true },
      'buttermilk': { id: 'buttermilk', name: 'Buttermilk', price: 10, enabled: true },
      'other': { id: 'other', name: 'Other', price: 10, enabled: true },
    },
    transactions: {
      // id "<date>_<serial>_<mealslot>" -> one record per serial per meal per
      // day. Duplicate scan protection lives at the database level.
    },
    settings: {
      canteenName: 'Company Canteen',
      retentionDays: 365,
      lastCleanupAt: null,
      allowSelfRegistration: true, // employees can sign themselves up
      mealTimings: {
        breakfast: { from: '06:00', to: '11:00' },
        lunch: { from: '11:00', to: '16:00' },
        snacks: { from: '16:00', to: '19:00' },
        dinner: { from: '19:00', to: '23:00' },
      },
    },
    sessions: {}, // admin session token -> payload
    employeeSessions: {}, // employee token -> { serial }
  };
}

const DEFAULT_MEAL_PRICES = { breakfast: 30, lunch: 50, snacks: 15, dinner: 50 };

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const fresh = defaultDb();
    for (const key of Object.keys(fresh)) {
      if (db[key] === undefined) db[key] = fresh[key];
    }
    if (!db.settings.mealTimings) db.settings.mealTimings = fresh.settings.mealTimings;
    if (typeof db.settings.allowSelfRegistration !== 'boolean') {
      db.settings.allowSelfRegistration = true;
    }
    // Migration: ensure the 4 meal-price entries exist in older data files.
    let mealMigrationNeeded = false;
    for (const [id, item] of Object.entries(fresh.mealItems)) {
      if (item.isMeal && !db.mealItems[id]) {
        db.mealItems[id] = item;
        mealMigrationNeeded = true;
      }
    }
    if (mealMigrationNeeded) saveDb();
  } catch {
    db = defaultDb();
    saveDb();
  }
}

let saveTimer = null;
function saveDb() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db));
    } catch (err) {
      console.error('[demo-api] save failed:', err.message);
    }
  }, 50);
}

// ------------------------------------------------------------- helpers ---
function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function getSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const s = db.sessions[token];
  if (!s) return null;
  if (s.expiresAt < now()) { delete db.sessions[token]; saveDb(); return null; }
  return { token, ...s };
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { uid: user.uid, email: user.email, role: user.role, expiresAt: now() + SESSION_TTL_MS };
  saveDb();
  return { token, user: { uid: user.uid, email: user.email, role: user.role } };
}

function canonicalSerial(raw) {
  return String(raw || '').trim().replace(/\s+/g, '');
}

function employeeToken() {
  return crypto.randomBytes(20).toString('hex');
}

// --------------------------------------------- meal / time computation ---
/** "14:05" -> minutes since midnight. */
function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Find which meal covers `mins` (minutes since midnight) from the admin's
 * configured timings. Handles windows that cross midnight.
 */
function detectMeal(mins) {
  const timings = db.settings.mealTimings || {};
  for (const [meal, w] of Object.entries(timings)) {
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    if (from < 0 || to < 0) continue;
    if (from <= to) {
      if (mins >= from && mins <= to) return meal;
    } else {
      // crosses midnight e.g. dinner 19:00 -> 01:00
      if (mins >= from || mins <= to) return meal;
    }
  }
  return null;
}

function mealSlot(meal) {
  return meal === 'lunch' || meal === 'dinner' ? 'lunchDinner' : 'breakfastSnacks';
}

function currentMealNow() {
  const d = new Date();
  return {
    meal: detectMeal(minutesOf(`${toTimeString(d)}`)),
    time: toTimeString(d),
  };
}

function mealPrice(meal) {
  const base = DEFAULT_MEAL_PRICES[meal] ?? 0;
  const item = db.mealItems[meal];
  // Admins may override the meal price by editing the mealItems entry.
  if (item && typeof item.price === 'number' && item.enabled !== false) return item.price;
  return base;
}

function addonById(id) {
  const item = db.mealItems[id];
  // Meal-price entries (breakfast/lunch/...) are never selectable as addons.
  return item && item.enabled !== false && !item.isMeal ? item : null;
}

// ------------------------------------------------------- realtime (SSE) ---
const sseClients = new Set();

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch { /* dropped */ }
  }
}

// ------------------------------------------------------------ routing ---
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

// ---- admin auth ----
route('POST', /^\/api\/auth\/login$/, async (req, res, m, body) => {
  const user = db.users.find(
    (u) => u.email.toLowerCase() === String(body.email || '').trim().toLowerCase() && u.password === body.password,
  );
  if (!user) return json(res, 401, { error: 'AUTH_FAILED', message: 'Incorrect email or password.' });
  json(res, 200, createSession(user));
});

route('POST', /^\/api\/auth\/logout$/, async (req, res) => {
  const s = getSession(req);
  if (s) { delete db.sessions[s.token]; saveDb(); }
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/auth\/me$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  json(res, 200, { uid: s.uid, email: s.email, role: s.role });
});

// ---- employees (admin CRUD) ----
route('GET', /^\/api\/employees$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const list = Object.entries(db.employees).map(([serial, e]) => ({ serial, ...e }));
  list.sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
  json(res, 200, { employees: list });
});

route('GET', /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, async (req, res, m) => {
  const e = db.employees[m[1]];
  if (!e) return json(res, 404, { error: 'NOT_FOUND' });
  json(res, 200, { serial: m[1], name: e.name, employeeNo: e.employeeNo || '', department: e.department || '', active: e.active });
});

function validateEmployeeBody(body) {
  const errors = {};
  const empNo = String(body.employeeNo ?? '').trim();
  const name = String(body.name ?? '').trim();
  const department = String(body.department ?? '').trim();
  if (!name) errors.name = 'Name is required.';
  if (department.length > 40) errors.department = 'Department is too long.';
  if (empNo && !/^[0-9A-Za-z-]{1,20}$/.test(empNo)) errors.employeeNo = 'Invalid employee number format.';
  return { errors, empNo, name, department };
}

function employeeNoTaken(empNo, exceptSerial) {
  if (!empNo) return false;
  return Object.entries(db.employees).some(([serial, e]) => serial !== exceptSerial && e.employeeNo === empNo);
}

route('PUT', /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const serial = m[1];
  const existing = db.employees[serial];
  const { errors, empNo, name, department } = validateEmployeeBody(body);
  if (Object.keys(errors).length) return json(res, 400, { error: 'VALIDATION', fieldErrors: errors });
  if (employeeNoTaken(empNo, serial)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'This employee number is already used by another serial.' } });
  }
  const t = now();
  db.employees[serial] = {
    employeeNo: empNo,
    name,
    department,
    active: body.active === undefined ? (existing?.active !== false) : body.active !== false,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  };
  saveDb();
  broadcast('employees', { serial });
  json(res, 200, { serial, ...db.employees[serial] });
});

route('DELETE', /^\/api\/employees\/([0-9A-Za-z-]{1,20})$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  delete db.employees[m[1]];
  // Remove any stored employee session for this serial.
  for (const [tok, es] of Object.entries(db.employeeSessions)) {
    if (es.serial === m[1]) delete db.employeeSessions[tok];
  }
  saveDb();
  broadcast('employees', { serial: m[1] });
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/employees\/bulk$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const count = Math.min(2000, Math.max(1, Math.floor(Number(body.count) || 0)));
  const pad = count <= 999 ? 3 : String(count).length;
  const t = now();
  let added = 0;
  for (let i = 1; i <= count; i++) {
    const serial = String(i).padStart(pad, '0');
    if (!db.employees[serial]) {
      db.employees[serial] = { employeeNo: '', name: '', department: '', active: true, createdAt: t, updatedAt: t };
      added++;
    }
  }
  saveDb();
  broadcast('employees', {});
  json(res, 200, { added });
});

// ---- employee self-service (no login) ----
// Sign up / log in by serial. When the serial already exists, name/dept are
// only accepted from the admin record; the employee just gets a session.
route('POST', /^\/api\/employee\/register$/, async (req, res) => {
  const serial = canonicalSerial(req.body.serial);
  const name = String(req.body.name ?? '').trim().slice(0, 60);
  const employeeNo = canonicalSerial(req.body.employeeNo);
  const department = String(req.body.department ?? '').trim().slice(0, 40);

  if (!serial || !/^[0-9A-Za-z-]{1,20}$/.test(serial)) {
    return json(res, 400, { error: 'SERIAL_INVALID', message: 'Please enter a valid serial number.' });
  }
  if (!name) return json(res, 400, { error: 'VALIDATION', fieldErrors: { name: 'Name is required.' } });
  if (employeeNo && !/^[0-9A-Za-z-]{1,20}$/.test(employeeNo)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'Invalid employee number format.' } });
  }

  const existing = db.employees[serial];
  if (existing && existing.active === false) {
    return json(res, 400, { error: 'SERIAL_INACTIVE', message: 'This serial number is inactive. Please contact the canteen supervisor.' });
  }
  // One employee per serial: a claimed serial (has a name) can never be
  // registered by a different person. Same name = the same employee logging in.
  if (existing && existing.name && existing.name !== name) {
    return json(res, 409, {
      error: 'SERIAL_TAKEN',
      message: `Serial ${serial} is already registered to ${existing.name}. One serial number can be used by only one employee. If this is your serial, please just log in with your own name, or contact the canteen supervisor.`,
    });
  }
  if (employeeNoTaken(employeeNo, serial)) {
    return json(res, 400, { error: 'VALIDATION', fieldErrors: { employeeNo: 'This employee number is already used by another serial.' } });
  }

  const t = now();
  if (!existing) {
    if (!db.settings.allowSelfRegistration) {
      return json(res, 400, { error: 'SERIAL_NOT_FOUND', message: 'Serial number not found. Ask the canteen supervisor to add you first.' });
    }
    db.employees[serial] = { employeeNo, name, department, active: true, createdAt: t, updatedAt: t };
  } else {
    // Serial exists: update missing fields only (admin data wins).
    db.employees[serial] = {
      ...existing,
      employeeNo: existing.employeeNo || employeeNo,
      name: existing.name || name,
      department: existing.department || department,
      updatedAt: t,
    };
  }
  const token = employeeToken();
  db.employeeSessions[token] = { serial, createdAt: t };
  saveDb();
  broadcast('employees', { serial });
  json(res, 200, { token, employee: { serial, ...db.employees[serial] } });
});

route('GET', /^\/api\/employee\/me$/, async (req, res) => {
  const s = getEmployeeSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const e = db.employees[s.serial];
  if (!e || e.active === false) {
    delete db.employeeSessions[req.headers.authorization?.slice(7)];
    saveDb();
    return json(res, 401, { error: 'UNAUTHENTICATED' });
  }
  json(res, 200, { serial: s.serial, ...e });
});

function getEmployeeSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const s = db.employeeSessions[token];
  return s || null;
}

route('POST', /^\/api\/employee\/logout$/, async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && db.employeeSessions[token]) {
    delete db.employeeSessions[token];
    saveDb();
  }
  json(res, 200, { ok: true });
});

// ---- meal items (addons menu) ----
route('GET', /^\/api\/meal-items$/, async (req, res) => {
  const list = Object.values(db.mealItems)
    .filter((i) => i.enabled !== false || req.headers['x-include-disabled'] === '1')
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, 200, { items: list });
});

route('POST', /^\/api\/meal-items$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const id = String(body.id ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30)
    || `item-${crypto.randomBytes(3).toString('hex')}`;
  if (db.mealItems[id]) return json(res, 400, { error: 'EXISTS', message: 'An item with this id already exists.' });
  db.mealItems[id] = {
    id,
    name: String(body.name ?? '').trim().slice(0, 40) || 'Item',
    price: Math.max(0, Math.round(Number(body.price) || 0)),
    enabled: body.enabled !== false,
  };
  saveDb();
  broadcast('mealItems', { id });
  json(res, 200, db.mealItems[id]);
});

route('PUT', /^\/api\/meal-items\/([a-z0-9-]+)$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const cur = db.mealItems[m[1]];
  if (!cur) return json(res, 404, { error: 'NOT_FOUND' });
  db.mealItems[m[1]] = {
    ...cur,
    name: String(body.name ?? cur.name).trim().slice(0, 40) || cur.name,
    price: Math.max(0, Math.round(Number(body.price ?? cur.price))),
    enabled: body.enabled !== undefined ? body.enabled !== false : cur.enabled,
  };
  saveDb();
  broadcast('mealItems', { id: m[1] });
  json(res, 200, db.mealItems[m[1]]);
});

route('DELETE', /^\/api\/meal-items\/([a-z0-9-]+)$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  if (!db.mealItems[m[1]]) return json(res, 404, { error: 'NOT_FOUND' });
  delete db.mealItems[m[1]];
  saveDb();
  broadcast('mealItems', { id: m[1] });
  json(res, 200, { ok: true });
});

// ---- settings & meal timings ----
route('GET', /^\/api\/settings$/, async (req, res) => json(res, 200, db.settings));

route('PUT', /^\/api\/settings$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  if (typeof body.canteenName === 'string' && body.canteenName.trim()) {
    db.settings.canteenName = body.canteenName.trim().slice(0, 60);
  }
  if (typeof body.retentionDays === 'number' && body.retentionDays >= 30) {
    db.settings.retentionDays = Math.floor(body.retentionDays);
  }
  if (typeof body.allowSelfRegistration === 'boolean') {
    db.settings.allowSelfRegistration = body.allowSelfRegistration;
  }
  if (body.mealTimings && typeof body.mealTimings === 'object') {
    const ok = {};
    for (const meal of ['breakfast', 'lunch', 'snacks', 'dinner']) {
      const w = body.mealTimings[meal];
      if (w && /^\d{2}:\d{2}$/.test(String(w.from)) && /^\d{2}:\d{2}$/.test(String(w.to))) {
        ok[meal] = { from: String(w.from), to: String(w.to) };
      }
    }
    if (Object.keys(ok).length === 4) db.settings.mealTimings = ok;
  }
  saveDb();
  broadcast('settings', {});
  json(res, 200, db.settings);
});

// ---- QR scan flow ----

/** One-time contextual scan: meal detection + duplicate check, no charge. */
route('GET', /^\/api\/scan\/context$/, async (req, res) => {
  const s = getEmployeeSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED', message: 'Please register/log in first.' });
  const emp = db.employees[s.serial];
  if (!emp || emp.active === false) return json(res, 401, { error: 'UNAUTHENTICATED' });

  const qrType = req.query.qr === 'lunchDinner' ? 'lunchDinner' : 'breakfastSnacks';
  const { meal, time } = currentMealNow();

  if (!meal || mealSlot(meal) !== qrType) {
    return json(res, 409, {
      error: 'WRONG_TIME',
      message:
        qrType === 'breakfastSnacks'
          ? `It is ${time} now — this QR is only for Breakfast & Snacks. Please scan the Lunch/Dinner QR for the current meal.`
          : `It is ${time} now — this QR is only for Lunch & Dinner. Please scan the Breakfast/Snacks QR for the current meal.`,
      time,
    });
  }

  const dateStr = todayStr();
  const id = `${dateStr}_${s.serial}_${meal}`;
  const existing = db.transactions[id] || null;

  json(res, 200, {
    employee: { serial: s.serial, ...emp },
    qrType,
    meal,
    time,
    date: dateStr,
    mealAmount: mealPrice(meal),
    alreadyTaken: Boolean(existing),
    existingTransaction: existing,
    addons: Object.values(db.mealItems).filter((i) => i.enabled !== false && !i.isMeal).sort((a, b) => a.name.localeCompare(b.name)),
  });
});

/**
 * Confirm the scan. Body: { meal, addonIds?, note? }
 * - First scan of this meal today -> transaction with meal + selected addons.
 * - Duplicate scan of the same meal -> ADDON-ONLY transaction (never re-charges
 *   the meal) as a separate record, e.g. "Lunch already recorded" + Curd ₹10.
 */
route('POST', /^\/api\/scan\/confirm$/, async (req, res) => {
  const s = getEmployeeSession(req);
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED', message: 'Please register/log in first.' });
  const emp = db.employees[s.serial];
  if (!emp || emp.active === false) return json(res, 401, { error: 'UNAUTHENTICATED' });

  const meal = String(req.body.meal || '');
  if (!['breakfast', 'lunch', 'snacks', 'dinner'].includes(meal)) {
    return json(res, 400, { error: 'BAD_MEAL', message: 'Unknown meal.' });
  }
  const expectedMeal = detectMeal(minutesOf(toTimeString(new Date())));
  if (!expectedMeal || mealSlot(expectedMeal) !== mealSlot(meal)) {
    return json(res, 409, { error: 'WRONG_TIME', message: 'This meal is not being served at this time.' });
  }
  if (meal !== expectedMeal) {
    return json(res, 409, { error: 'WRONG_MEAL', message: `It is ${expectedMeal} time now — you cannot record ${meal}.` });
  }

  const addonIds = Array.isArray(req.body.addonIds) ? req.body.addonIds.slice(0, 6) : [];
  const addons = [];
  for (const raw of addonIds) {
    const a = addonById(String(raw));
    if (!a) return json(res, 400, { error: 'BAD_ADDON', message: `Unknown additional item: ${raw}` });
    addons.push({ id: a.id, name: a.name, price: a.price });
  }

  const dateStr = todayStr();
  const nowTime = toTimeString(new Date());
  const baseId = `${dateStr}_${s.serial}_${meal}`;
  const existing = db.transactions[baseId];

  if (!existing) {
    const amount = mealPrice(meal) + addons.reduce((sum, a) => sum + a.price, 0);
    const txn = {
      id: baseId,
      employeeId: s.serial,
      employeeNo: emp.employeeNo || '',
      serial: s.serial,
      name: emp.name || '',
      department: emp.department || '',
      date: dateStr,
      time: nowTime,
      qrType: mealSlot(meal),
      meal,
      mealAmount: mealPrice(meal),
      addons,
      addonAmount: addons.reduce((sum, a) => sum + a.price, 0),
      amount,
      status: 'ok',
      mode: 'qr',
      createdAt: now(),
      updatedAt: now(),
    };
    db.transactions[baseId] = txn;
    saveDb();
    broadcast('transactions', { id: baseId, date: dateStr });
    return json(res, 200, { transaction: txn, kind: 'created' });
  }

  // Duplicate scan of the same meal: addon-only transaction (separate record).
  if (addons.length === 0) {
    return json(res, 409, {
      error: 'ALREADY_TAKEN',
      message: `${capitalize(meal)} already recorded for today (at ${formatTime(existing.time)}). No extra charge.`,
    });
  }
  let suffix = 2;
  while (db.transactions[`${baseId}_addon${suffix}`]) suffix++;
  const amount = addons.reduce((sum, a) => sum + a.price, 0);
  const txn = {
    id: `${baseId}_addon${suffix}`,
    employeeId: s.serial,
    employeeNo: emp.employeeNo || '',
    serial: s.serial,
    name: emp.name || '',
    department: emp.department || '',
    date: dateStr,
    time: nowTime,
    qrType: mealSlot(meal),
    meal,
    mealAmount: 0,
    addons,
    addonAmount: amount,
    amount,
    status: 'ok',
    mode: 'addon',
    createdAt: now(),
    updatedAt: now(),
  };
  db.transactions[txn.id] = txn;
  saveDb();
  broadcast('transactions', { id: txn.id, date: dateStr });
  json(res, 200, { transaction: txn, kind: 'addon' });
});

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ---- transactions (admin) ----
route('GET', /^\/api\/transactions$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const url = new URL(req.url, 'http://x');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  let txns = Object.values(db.transactions);
  if (from) txns = txns.filter((t) => t.date >= from);
  if (to) txns = txns.filter((t) => t.date <= to);
  txns.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  json(res, 200, { transactions: txns });
});

/**
 * Daily billing sheet: one row per employee per day (aggregate of their
 * transactions) — the Admin "Serial Number Page".
 */
route('GET', /^\/api\/daily-entries$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const url = new URL(req.url, 'http://x');
  const from = url.searchParams.get('from') || todayStr();
  const to = url.searchParams.get('to') || from;
  const entries = [];
  const bySerial = {};
  for (const t of Object.values(db.transactions)) {
    if (t.date < from || t.date > to) continue;
    let e = bySerial[t.serial];
    if (!e) {
      e = {
        serial: t.serial,
        employeeNo: t.employeeNo || '',
        name: t.name || '',
        department: t.department || '',
        date: t.date,
        breakfast: 0, snacks: 0, lunch: 0, dinner: 0,
        addonAmount: 0, addons: [], total: 0,
        lastTime: t.time,
      };
      bySerial[t.serial] = e;
      entries.push(e);
    }
    if (t.meal === 'breakfast') e.breakfast += t.mealAmount;
    else if (t.meal === 'snacks') e.snacks += t.mealAmount;
    else if (t.meal === 'lunch') e.lunch += t.mealAmount;
    else if (t.meal === 'dinner') e.dinner += t.mealAmount;
    e.addonAmount += t.addonAmount || 0;
    for (const a of t.addons || []) e.addons.push(a);
    e.total += t.amount;
    if (t.time > e.lastTime) e.lastTime = t.time;
  }
  // Attach live master data (renames reflect immediately).
  for (const e of entries) {
    const emp = db.employees[e.serial];
    if (emp) {
      e.employeeNo = emp.employeeNo || e.employeeNo;
      e.name = emp.name || e.name;
      e.department = emp.department || e.department;
    }
  }
  entries.sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
  json(res, 200, { entries });
});

// ---- manual entries / corrections (admin) ----
/**
 * Manual entry or correction. Body:
 * { serial, meal, addons?: [{id,name,price}] | addonIds?, mode: 'add' }
 * Creates a manual transaction for today (admin override), duplicate-safe by
 * id. mode 'delete' removes a transaction by id.
 */
route('POST', /^\/api\/manual-entry$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const serial = canonicalSerial(req.body.serial);
  const emp = db.employees[serial];
  if (!emp) return json(res, 400, { error: 'SERIAL_NOT_FOUND', message: 'Serial number not found. Add the employee first.' });
  const meal = String(req.body.meal || '');
  if (!['breakfast', 'lunch', 'snacks', 'dinner'].includes(meal)) {
    return json(res, 400, { error: 'BAD_MEAL', message: 'Choose a meal.' });
  }
  const addonIds = Array.isArray(req.body.addonIds) ? req.body.addonIds : [];
  const addons = addonIds.map((id) => addonById(id)).filter(Boolean)
    .map((a) => ({ id: a.id, name: a.name, price: a.price }));

  const dateStr = todayStr();
  const baseId = `${dateStr}_${serial}_${meal}`;
  let id = baseId;
  let suffix = 2;
  while (db.transactions[id]) id = `${baseId}_m${suffix++}`;
  const mealAmt = mealPrice(meal);
  const addonAmt = addons.reduce((sum, a) => sum + a.price, 0);
  const txn = {
    id,
    employeeId: serial,
    employeeNo: emp.employeeNo || '',
    serial,
    name: emp.name || '',
    department: emp.department || '',
    date: dateStr,
    time: toTimeString(new Date()),
    qrType: mealSlot(meal),
    meal,
    mealAmount: mealAmt,
    addons,
    addonAmount: addonAmt,
    amount: mealAmt + addonAmt,
    status: 'ok',
    mode: 'manual',
    createdAt: now(),
    updatedAt: now(),
  };
  db.transactions[id] = txn;
  saveDb();
  broadcast('transactions', { id, date: dateStr });
  json(res, 200, { transaction: txn });
});

route('DELETE', /^\/api\/transactions\/(.+)$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const t = db.transactions[m[1]];
  if (!t) return json(res, 404, { error: 'NOT_FOUND' });
  delete db.transactions[m[1]];
  saveDb();
  broadcast('transactions', { id: m[1], date: t.date });
  json(res, 200, { ok: true });
});

// ---- cleanup ----
route('POST', /^\/api\/cleanup$/, async (req, res, m, body, s) => {
  if (!s) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const cutoffDate = String(body.cutoff || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) return json(res, 400, { error: 'BAD_CUTOFF' });
  let deleted = 0;
  for (const [id, t] of Object.entries(db.transactions)) {
    if (t.date < cutoffDate) { delete db.transactions[id]; deleted++; }
  }
  db.settings.lastCleanupAt = now();
  saveDb();
  broadcast('transactions', {});
  json(res, 200, { deleted });
});

// ---- realtime stream ----
route('GET', /^\/api\/events$/, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ------------------------------------------------------------ server ---
/**
 * Canonical single-segment endpoint → internal REST form.
 * The cloud API (Vercel) only guarantees single-segment /api/<name> routes,
 * so the client speaks that dialect everywhere; the demo server accepts it too.
 */
function normalizeRequest(req, body) {
  let method = req.method;
  let urlPath = new URL(req.url || '/', 'http://x').pathname;
  const canonical = [
    { path: '/api/auth-login', to: '/api/auth/login' },
    { path: '/api/auth-logout', to: '/api/auth/logout' },
    { path: '/api/auth-me', to: '/api/auth/me' },
    { path: '/api/employee-register', to: '/api/employee/register' },
    { path: '/api/employee-me', to: '/api/employee/me' },
    { path: '/api/employee-logout', to: '/api/employee/logout' },
    { path: '/api/scan-context', to: '/api/scan/context' },
    { path: '/api/scan-confirm', to: '/api/scan/confirm' },
    { path: '/api/employees-bulk', to: '/api/employees/bulk' },
    { path: '/api/employee', to: () => `/api/employees/${encodeURIComponent(String(req.query.serial ?? ''))}` },
    { path: '/api/employee-save', to: () => `/api/employees/${encodeURIComponent(String(body.serial ?? ''))}`, method: 'PUT' },
    { path: '/api/employee-delete', to: () => `/api/employees/${encodeURIComponent(String(body.serial ?? ''))}`, method: 'DELETE' },
    { path: '/api/meal-item-create', to: '/api/meal-items' },
    { path: '/api/meal-item-save', to: () => `/api/meal-items/${encodeURIComponent(String(body.id ?? ''))}`, method: 'PUT' },
    { path: '/api/meal-item-delete', to: () => `/api/meal-items/${encodeURIComponent(String(body.id ?? ''))}`, method: 'DELETE' },
    { path: '/api/settings-save', to: '/api/settings', method: 'PUT' },
    { path: '/api/transaction-delete', to: () => `/api/transactions/${encodeURIComponent(String(body.id ?? ''))}`, method: 'DELETE' },
  ];
  for (const c of canonical) {
    if (urlPath === c.path) {
      urlPath = typeof c.to === 'function' ? c.to() : c.to;
      if (c.method) method = c.method;
      break;
    }
  }
  return { method, urlPath };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  req.query = Object.fromEntries(url.searchParams);
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) body = (await readBody(req)) || {};
  Object.defineProperty(req, 'body', { value: body, configurable: true });
  const { method, urlPath } = normalizeRequest(req, body);
  for (const { method: rMethod, pattern, handler } of routes) {
    if (method !== rMethod) continue;
    const m = urlPath.match(pattern);
    if (!m) continue;
    try {
      const session = getSession(req);
      await handler(req, res, m, body, session);
    } catch (err) {
      console.error('[demo-api] error:', err);
      if (!res.headersSent) json(res, 500, { error: 'INTERNAL', message: 'Unexpected server error.' });
    }
    return;
  }
  json(res, 404, { error: 'NOT_FOUND', path: urlPath });
});

// Session GC + daily auto-cleanup of records older than retentionDays.
setInterval(() => {
  let changed = false;
  for (const [tok, s] of Object.entries(db.sessions)) {
    if (s.expiresAt < now()) { delete db.sessions[tok]; changed = true; }
  }
  if (changed) saveDb();
}, 60 * 60 * 1000).unref();

loadDb();
server.listen(PORT, HOST, () => {
  console.log(`[demo-api] listening on http://${HOST}:${PORT} (data: ${DB_FILE})`);
});
