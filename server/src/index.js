import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config.js';
import { authenticate, requirePasswordChanged } from './middleware/auth.js';
import { setupRouter, authRouter } from './routes/auth.js';
import org from './routes/org.js';
import employees from './routes/employees.js';
import attendance from './routes/attendance.js';
import leave from './routes/leave.js';
import payroll from './routes/payroll.js';
import dashboard from './routes/dashboard.js';
import ai from './routes/ai.js';
import comms from './routes/comms.js';

if (config.jwtSecret.length < 24) { console.error('JWT_SECRET must be set (24+ characters). See .env.example'); process.exit(1); }
if (!config.databaseUrl) { console.error('DATABASE_URL must be set. See .env.example'); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.clientOrigin.split(','), credentials: false }));
app.use(express.json({ limit: '2.5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/setup', setupRouter);
app.use('/api/auth', authRouter);

// Everything below requires a valid login AND a changed temporary password.
app.use('/api', authenticate, requirePasswordChanged);
app.use('/api/org', org);
app.use('/api/employees', employees);
app.use('/api/attendance', attendance);
app.use('/api/leave', leave);
app.use('/api/payroll', payroll);
app.use('/api/dashboard', dashboard);
app.use('/api/ai', ai);
app.use('/api/comms', comms);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Optional: serve the built React app from the same server (single-host deployment).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Central error handler: consistent JSON, no stack traces or secrets.
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.code === '23505') return res.status(409).json({ error: 'A record with these details already exists' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(config.port, () => console.log(`HCM Lite API listening on :${config.port}`));
