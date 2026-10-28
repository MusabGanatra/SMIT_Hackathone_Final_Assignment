# HCM Lite - AI-assisted Human Capital Management

React + Vite frontend, Node/Express backend, PostgreSQL, JWT auth, Recharts, PDFKit payslips, and an AI assistant using LLM **tool calling** (Anthropic Messages API).
The app starts with an **empty database** - every number on every dashboard is aggregated from records created in the app.

```
hcm-lite/
├── server/
│   ├── sql/schema.sql            # all 17 tables, constraints, indexes, append-only audit trigger
│   ├── scripts/migrate.js        # applies schema.sql (safe to re-run)
│   ├── src/
│   │   ├── index.js              # Express app, global auth guard, error handler
│   │   ├── config.js, db.js      # env config, pg pool + transaction helper
│   │   ├── middleware/           # auth.js (JWT), roles.js (RBAC + ownership checks)
│   │   ├── routes/               # auth/setup, org, employees, attendance, leave, payroll, dashboard, ai, comms
│   │   ├── services/             # business logic (rules, payrollCalc, leaveCalc are pure + tested)
│   │   └── utils/                # dates, audit, http errors
│   └── tests/rules.test.js       # unit tests: attendance, leave, payroll, tax, permissions
└── client/
    └── src/ (App.jsx, api.js, ui.jsx, styles.css, pages/*)
```

## 1. Prerequisites
Node.js 18+ (22 recommended), a PostgreSQL database (local, or a free Supabase project), optionally an Anthropic API key.

## 2. Install
```bash
npm run install:all
```

## 3. Configure the database and AI key
```bash
cp server/.env.example server/.env
```
Edit `server/.env`:
| Variable | What to put |
|---|---|
| `DATABASE_URL` | Local: `postgresql://postgres:password@localhost:5432/hcm_lite` (create the DB first: `createdb hcm_lite`). Supabase: *Project Settings → Database → Connection string (URI)*, and set `DB_SSL=true`. |
| `JWT_SECRET` | 24+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. Leave empty to run without AI; AI endpoints then return a friendly "not configured" message and everything else works. |
| `AI_MODEL` | Defaults to `claude-sonnet-4-6`. |

The key lives only on the server; the browser never sees it.

Then create the tables:
```bash
npm run migrate
```

## 4. Run
Two terminals:
```bash
npm run dev:server     # API on http://localhost:4000
npm run dev:client     # UI  on http://localhost:5173
```

## 5. Create the first Admin
Open http://localhost:5173 - with an empty database you are redirected to **first-run setup**. Enter company name, admin name, email, password. This works exactly once (guarded by a table lock). Then:

1. Sign in as Admin → **Organization**: set office hours/timezone, add departments, designations, holidays; **review the tax slabs** (see Known limitations).
2. **Organization → Staff logins**: create an HR login (a one-time temporary password is shown).
3. Sign in as HR (change the temp password) → **Employees → Add employee** with a basic salary. A login is created automatically; the temp password is shown once. Employees must change it at first login.
4. Employees check in/out, apply for leave, etc. HR approves. HR creates a payroll draft; **only Admin finalizes**.

## 6. Tests
```bash
npm test
```
Covers the late rule (after 09:15), half-day (<5 h), absent vs. leave, HRA/medical/gross formulas, progressive tax, deductions, proration, leave-day counting (weekends/holidays), overlap and balance rules, and role/ownership guards. These are pure-logic tests and need no database.

## 7. Business rules where to find them
| Rule | File |
|---|---|
| Late / half-day / absent classification | `server/src/services/rules.js` |
| Salary parts, deductions, tax, proration | `server/src/services/payrollCalc.js` (+ `payroll.js` for DB assembly) |
| Leave validation (weekends, holidays, overlap, balance) | `server/src/services/leave.js`, `leaveCalc.js` |
| Payroll finalize/lock (Admin only) | `server/src/routes/payroll.js` + `generateDraft` refuses finalized months |
| Employee data scope | `server/src/middleware/roles.js` + per-route checks; payslip PDF returns 404 for others' ids |

## 8. AI assistant
`/api/ai/chat` runs a tool-calling loop. The model can only call: `get_headcount`, `get_attendance_summary`, `get_late_comers`, `get_leave_summary`, `get_my_leave_balance`, `get_payroll_summary`, `search_employees`. Each tool executes server-side through the same services as the REST API and is **role-scoped** (an employee asking for a colleague's salary gets a "Not permitted" tool result and a refusal; employee-scoped tools are forced to their own `employee_id`). The model never receives database access and never writes data.
- **Smart leave:** `/api/ai/parse-leave` → JSON validated with zod (one retry) → the form is *prefilled*; the employee must press Submit.
- **Dashboard summary:** `/api/ai/summary` builds 3-5 insights from the current dashboard filters.
- 15 s timeout, per-user rate limit (20/min), friendly fallback text, every call logged to `ai_logs`, replies labelled "AI-generated". Roman Urdu is accepted in prompts.

## 9. GitHub
```bash
cd hcm-lite
git init && git add . && git commit -m "HCM Lite"
git branch -M main
git remote add origin https://github.com/<you>/hcm-lite.git
git push -u origin main
```
`.gitignore` excludes `.env` and `node_modules`. Never commit real secrets.

## 10. Deployment
**Option A - one service (simplest):** Render / Railway / Fly.
1. Create a Postgres (Supabase or the host's) and run `npm run migrate` once with its `DATABASE_URL`.
2. New Web Service from your GitHub repo. Build: `npm run install:all && npm run build`. Start: `npm start`.
3. Env vars: `DATABASE_URL`, `DB_SSL=true`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `CLIENT_ORIGIN=https://<your-service-url>`.
The server serves `client/dist` automatically when it exists, so UI and API share one URL.

**Option B - split:** API on Render (as above, no build of the client); client on Vercel/Netlify with root `client`, build `npm run build`, output `dist`, env `VITE_API_URL=https://<api-host>/api`, and set the API's `CLIENT_ORIGIN` to the client URL. Add an SPA rewrite of all paths to `/index.html`.

## 11. Known limitations (please read)
- **Tax slabs are placeholders.** The challenge brief's slab table was not included in the prompt I received, so `company_settings.tax_slabs` defaults to an *illustrative* 0% / 5% / 15% scheme. Admin edits them in **Organization → Annual tax slabs (JSON)**, or change the default in `schema.sql`, to match the brief. Tax = progressive annual tax on (gross × 12) ÷ 12, scaled by days employed.
- **Not run end-to-end in the build sandbox** (no network or database there). Verified: server syntax, client JSX parse, import/export resolution, and the unit tests. The SQL, routes and UI have not been exercised against a live Postgres/browser; expect to fix small bugs on first run - please report them.
- Admin and HR accounts have no employee profile, so they cannot check in or apply for leave.
- A leave request cannot span two calendar years (split it in two).
- Missing-check-out days are shown as `missing_checkout` and treated as present for payroll.
- Absences are counted up to *today*; a draft for the current month should be regenerated before finalizing.
- Not implemented (optional bonus): camera/face/GPS attendance (only the office location/radius fields are stored), PWA, attrition-risk/anomaly flags, late-penalty rule. Dark mode follows the OS setting.
- Payroll run drafts delete and rebuild their payslips on refresh; finalized runs are immutable via the API.
- bcryptjs (pure JS, bcrypt-compatible) is used instead of native `bcrypt` to avoid build problems on Windows/hosting.
