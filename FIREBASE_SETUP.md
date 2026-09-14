# Firebase Setup — Step by Step (10 minutes)

Follow these steps exactly. At the end, your Vercel site
(https://sattucanteen.vercel.app) will save real data from any phone —
no Wi-Fi or laptop needed.

You will copy 6 values from Firebase into Vercel. That's the whole job.

---

## PART 1 — Create the Firebase project

1. Open **https://console.firebase.google.com** and sign in with your Google account
   (use `satyam.chourasiya019@gmail.com` if that's your Firebase login).
2. Click **"Create a project"** (or "Add project").
3. Project name: `sattu-canteen` → **Continue**.
4. Google Analytics: **Disable** (not needed) → **Create project**.
5. Wait ~30 seconds → **Continue**.

## PART 2 — Enable the two sign-in methods

1. In the left menu: **Build → Authentication → Get started**.
2. Tab **Sign-in method** → click **Email/Password** → toggle **Enable** → **Save**.
3. Click **Add new provider** → choose **Anonymous** → toggle **Enable** → **Save**.

(Employees use Anonymous; admins use Email/Password.)

## PART 3 — Create the Firestore database

1. Left menu: **Build → Firestore Database → Create database**.
2. Location: leave the default (asia-south1 if shown, otherwise whatever is offered) → **Next**.
3. Mode: choose **Start in production mode** → **Create**.

## PART 4 — Get the 6 config values

1. Project settings: click the **⚙ gear icon** (top-left, next to "Project Overview") → **Project settings**.
2. Scroll down to **"Your apps"** → click the **</>** (Web) icon.
3. App nickname: `canteen-web` → **Register app** (do NOT tick Firebase Hosting).
4. Firebase shows a code block with `firebaseConfig`. Copy these 6 values:

```
apiKey:            AIza...        ← VITE_FIREBASE_API_KEY
authDomain:        sattu-canteen...  ← VITE_FIREBASE_AUTH_DOMAIN
projectId:         sattu-canteen     ← VITE_FIREBASE_PROJECT_ID
storageBucket:     sattu-canteen...  ← VITE_FIREBASE_STORAGE_BUCKET
messagingSenderId: 123456789      ← VITE_FIREBASE_MESSAGING_SENDER_ID
appId:             1:1234567...   ← VITE_FIREBASE_APP_ID
```

## PART 5 — Paste them into Vercel

1. Open **https://vercel.com** → sign in → open your project **sattucanteen**.
2. **Settings → Environment Variables**.
3. Add all 6 variables, one by one:

| Name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | (paste apiKey) |
| `VITE_FIREBASE_AUTH_DOMAIN` | (paste authDomain) |
| `VITE_FIREBASE_PROJECT_ID` | (paste projectId) |
| `VITE_FIREBASE_STORAGE_BUCKET` | (paste storageBucket) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | (paste messagingSenderId) |
| `VITE_FIREBASE_APP_ID` | (paste appId) |

(Add for **Production, Preview and Development** — all three checkboxes.)

4. Click **Save** on each.

## PART 6 — Add the security rules

The rules protect your data (employees can only record their own meals; admin
data is protected). Copy the whole content of the file **`firestore.rules`**
from this project folder, then:

1. Firebase console → **Build → Firestore Database → Rules** tab.
2. Delete everything in the editor, **paste** the rules file content.
3. Click **Publish**.

## PART 7 — Add the indexes (makes the admin lists fast)

1. Firebase console → **Firestore Database → Indexes** tab → **Composite**.
2. Click **Create index** three times:

| Collection ID | Fields (in this order) | Query scope |
|---|---|---|
| `transactions` | `date` Ascending, `createdAt` Ascending | Collection |
| `transactions` | `date` Ascending, `serial` Ascending | Collection |
| `transactions` | `date` Descending, `createdAt` Descending | Collection |

(Indexes build in a few minutes — the app shows a friendly "index building"
message if you open it before they finish.)

## PART 8 — Create the admin accounts

1. Firebase console → **Authentication → Users → Add user**.
2. Email: `admin@canteen.local` — Password: (choose a strong one) → **Add user**.
3. Add two more if you want supervisors: `supervisor1@canteen.local`, `supervisor2@canteen.local`.
4. For each user, copy their **User UID** (the long code in the user list).
5. Firebase console → **Firestore Database → Start collection**:
   - Collection ID: `users` → **Next**
   - Document ID: **paste the first user's UID**
   - Field: `role` (string) → Value: `admin`
   - Add one more field: `email` (string) → the email
   - **Save**
6. Repeat a doc for each supervisor with role `supervisor`.

## PART 9 — Deploy the app with the new config

Tell me when Parts 1–8 are done — I will redeploy from here with one command
(or run this yourself in the project folder):

```
vercel --prod
```

## PART 10 — First-run data setup

Open the deployed site → **/admin** → log in with the admin email/password
from Part 8, then:

1. **Meals & Items** → confirm meal prices (Breakfast 30, Lunch 50, Snacks 15, Dinner 50) — click Update once per meal to save them.
2. **Employees** → **Create serials 1…N** (e.g. 500).
3. **Settings** → print the two QR codes and stick them at the counters.

Done! Employees scan the QR on their phone → register once → meal recorded
→ dashboard updates live, from anywhere.

---

## How it works after setup

- **Mode auto-switch**: with the env vars present, the app uses Firebase
  Auth + Firestore everywhere. Without them, it uses the local demo server.
- **Security**: employees (anonymous) can only write today's transactions
  with their own serial in the id, and can only fill empty employee fields.
  Everything else needs an admin login.
- **Data**: transactions live in Firestore's `transactions` collection with
  ids like `2026-09-14_025_dinner` — one meal charge per serial per day by design.
