# QR-Based Canteen Management & Billing

Internal company canteen app. Employees scan one of **two permanent QR codes** at the
canteen counters; the system detects the current meal from the time, charges it against
their serial number once, and the admin dashboard updates live. **Works out of the box
in local demo mode — no Firebase setup needed to try it.** Production deployments switch
to Firebase by adding env vars (see the end).

## Quick start (local demo mode, zero configuration)

```
npm install
npm run dev
```

- Employee page: `http://localhost:5173/user-ordering` (open on the phone)
- Admin page: `http://localhost:5173/admin`
- Demo logins: `admin@canteen.local / admin123`, `supervisor1@canteen.local / super123`,
  `supervisor2@canteen.local / super123`
- Serials `001…500` are pre-seeded; the addon menu (Tea, Coffee, Curd, Sweet, …) has defaults
- **Test from a phone (same Wi-Fi):** open `http://<your-pc-ip>:5173/user-ordering`
- Data persists in `data/db.json` (delete that file to reset the demo)

Local mode runs a bundled zero-dependency API (`server/demo-server.mjs`, auto-started by
`npm run dev`) with session auth, SSE realtime and the same rules as production. It is
for development/demo — use Firebase mode in production.

## How the QR system works

1. **Two QR codes** (print from Admin → Settings):
   - QR 1 → `/qr/breakfastSnacks` — Breakfast + Snacks counter ("Other" dropdown for Tea/Coffee/Milk/…)
   - QR 2 → `/qr/lunchDinner` — Lunch + Dinner counter ("With" dropdown for Extra Roti/Curd/Sweet/…)
2. Employee registers once on the phone (serial, name, employee no, department) — the device
   remembers them; no repeated typing. Self-registered employees appear automatically in
   Admin → Employees.
3. On scan, the **server clock** (never the phone's) is matched against the admin-configured
   meal windows (Admin → Meals & Items) and the correct meal is identified automatically.
   Wrong counter / outside hours → clear message, no charge.
4. Employee confirms; amount is added to their serial. **Duplicate scans of the same meal
   are never double-charged** — the page instead offers extra items, recorded as an
   "addon" transaction (e.g. Dinner ₹50 already taken + Curd ₹10).
5. Admin → **Serial Numbers** shows the live billing sheet: one row per employee
   (Breakfast | Snacks | Lunch | Dinner | Additional | Total) plus manual entry/correction.

## Admin sections

| Section | What it does |
|---|---|
| Dashboard | Today's totals, per-meal counts, live transaction feed (auto-updates) |
| Serial Numbers | Daily billing per serial, manual entries, delete corrections |
| Transactions | Full history, quick/custom date filters, search, CSV export |
| Employees | Add/edit/delete/reassign serials, bulk-create 1…N, activate/deactivate |
| Meals & Items | Meal time windows (drives QR detection), addon items + prices |
| Reports | Daily / Monthly / Employee / Department / Meal-wise + CSV export |
| Settings | Both printable QR codes, self-registration toggle, 1-year retention cleanup |

Prices are snapshotted into each transaction, so historical records never change when
prices change later.

## Firebase production mode

1. Create a Firebase project → enable **Firestore** and **Authentication**
   (Email/Password for admins + **Anonymous** for employee devices).
2. Fill the `VITE_FIREBASE_*` vars in `.env` (copy `.env.example`). The app auto-switches
   from the local API to Firebase — no code changes.
3. Create the admin accounts in Firebase Auth and add `users/{uid}` docs with role
   `admin` or `supervisor`.
4. Deploy `firestore.rules` (Firebase console or `firebase deploy --only firestore:rules`).

Collections: `employees` (serial master), `mealItems` (addons), `transactions`
(`<date>_<serial>_<meal>` ids), `settings/general` (timings etc.), `users` (roles).

Security (enforced in rules, not by hidden buttons): employees can only read the menu,
verify a serial, and write today's transactions whose id embeds **their own serial**;
all lists, settings and corrections are admin-only.
