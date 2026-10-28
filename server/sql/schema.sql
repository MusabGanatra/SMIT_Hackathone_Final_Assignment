-- HCM Lite schema. Safe to re-run (IF NOT EXISTS everywhere).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','hr','employee')),
  display_name TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  office_start TEXT NOT NULL DEFAULT '09:00',
  grace_minutes INT NOT NULL DEFAULT 15,
  halfday_hours NUMERIC NOT NULL DEFAULT 5,
  weekends INT[] NOT NULL DEFAULT '{0,6}',
  office_lat NUMERIC, office_lng NUMERIC, radius_m INT,
  -- Progressive ANNUAL gross-income slabs. REPLACE with the slabs from your challenge brief.
  tax_slabs JSONB NOT NULL DEFAULT '[{"upTo":600000,"rate":0},{"upTo":1200000,"rate":0.05},{"upTo":null,"rate":0.15}]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS designations (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id),
  emp_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT, address TEXT,
  department_id INT REFERENCES departments(id),
  designation_id INT REFERENCES designations(id),
  join_date DATE NOT NULL,
  leave_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_dept ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_emp_status ON employees(status);

CREATE TABLE IF NOT EXISTS leave_types (
  id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  annual_quota INT CHECK (annual_quota IS NULL OR annual_quota >= 0), -- NULL = no fixed quota
  paid BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  work_date DATE NOT NULL,
  check_in TIMESTAMPTZ NOT NULL,
  check_out TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('present','late','half_day')),
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(work_date);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  work_date DATE NOT NULL,
  requested_check_in TEXT NOT NULL, requested_check_out TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INT REFERENCES users(id), review_comment TEXT, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  leave_type_id INT NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL, end_date DATE NOT NULL,
  days NUMERIC NOT NULL CHECK (days > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by INT REFERENCES users(id), review_comment TEXT, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id, status);

CREATE TABLE IF NOT EXISTS salary_structures (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL UNIQUE REFERENCES employees(id),
  basic NUMERIC NOT NULL CHECK (basic >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL UNIQUE CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_by INT REFERENCES users(id),
  finalized_by INT REFERENCES users(id), finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payslips (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id),
  basic NUMERIC NOT NULL, hra NUMERIC NOT NULL, medical NUMERIC NOT NULL, gross NUMERIC NOT NULL,
  working_days INT NOT NULL, active_days INT NOT NULL,
  absent_days NUMERIC NOT NULL, unpaid_days NUMERIC NOT NULL, half_days NUMERIC NOT NULL,
  deductions NUMERIC NOT NULL, tax NUMERIC NOT NULL, net NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  created_by INT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT, read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INT REFERENCES users(id), actor_email TEXT,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  before JSONB, after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Audit history is append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_logs;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

CREATE TABLE IF NOT EXISTS ai_logs (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), kind TEXT NOT NULL,
  prompt TEXT, response TEXT, tools JSONB, status TEXT NOT NULL, duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
