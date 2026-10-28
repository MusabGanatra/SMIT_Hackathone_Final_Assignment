import { z } from 'zod';
import { q } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../utils/http.js';
import { isValidDate } from '../utils/dates.js';
import { getSettings } from './settings.js';
import { todayLocal } from './attendance.js';
import * as A from './analytics.js';

const API = 'https://api.anthropic.com/v1/messages';
export const AI_LABEL = 'AI-generated';
export const FALLBACK = 'The AI assistant is temporarily unavailable. Please try again in a moment, or use the dashboard and reports directly.';

async function callLLM(body) {
  if (!config.aiKey) throw new HttpError(503, 'AI assistant is not configured. Ask an admin to set ANTHROPIC_API_KEY.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000); // 15-second timeout
  try {
    const r = await fetch(API, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.aiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.aiModel, max_tokens: 1024, ...body }),
    });
    if (!r.ok) throw new Error('LLM HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function logAi(user, kind, prompt, response, tools, status, started) {
  try {
    await q('INSERT INTO ai_logs (user_id, kind, prompt, response, tools, status, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [user.id, kind, String(prompt).slice(0, 2000), String(response || '').slice(0, 4000), JSON.stringify(tools || []), status, Date.now() - started]);
  } catch { /* logging must never break the request */ }
}

/* ---------- Tools: the model never touches the database; each tool calls an authorised service ---------- */
const range = { from: { type: 'string', description: 'YYYY-MM-DD, defaults to first of this month' }, to: { type: 'string', description: 'YYYY-MM-DD, defaults to today' } };
const dept = { department_id: { type: 'integer', description: 'optional department filter' } };
const TOOL_DEFS = [
  { name: 'get_headcount', description: 'Active employee count, total and by department (admin/hr only).', input_schema: { type: 'object', properties: { ...dept } } },
  { name: 'get_attendance_summary', description: 'Attendance totals (present, late, half-day, on-leave, absent) for a date range. Employees get only their own data.', input_schema: { type: 'object', properties: { ...range, ...dept } } },
  { name: 'get_late_comers', description: 'Employees with the most late arrivals in a range (admin/hr only).', input_schema: { type: 'object', properties: { ...range, ...dept } } },
  { name: 'get_leave_summary', description: 'Leave requests/days by type and status in a range. Employees get only their own.', input_schema: { type: 'object', properties: { ...range, ...dept } } },
  { name: 'get_my_leave_balance', description: "The signed-in employee's own leave balance.", input_schema: { type: 'object', properties: {} } },
  { name: 'get_payroll_summary', description: 'Payroll totals for a month YYYY-MM (admin/hr only). Defaults to latest run.', input_schema: { type: 'object', properties: { month: { type: 'string' } } } },
  { name: 'search_employees', description: 'Find employees by name/code/email (admin/hr only). Never returns salary.', input_schema: { type: 'object', properties: { query: { type: 'string' }, ...dept } } },
];
const STAFF = ['admin', 'hr'];
const deny = { error: 'Not permitted: you are not allowed to access this information.' };

export async function runTool(user, name, input = {}) {
  const s = await getSettings();
  const r = A.defaultRange(s, isValidDate(input.from || '') ? input.from : null, isValidDate(input.to || '') ? input.to : null);
  const deptId = Number.isInteger(input.department_id) ? input.department_id : null;
  const staff = STAFF.includes(user.role);
  switch (name) {
    case 'get_headcount': return staff ? A.headcount(deptId) : deny;
    case 'get_attendance_summary': {
      if (!staff && !user.employee_id) return deny;
      const { daily, ...sum } = await A.attendanceSummary({ ...r, deptId, employeeId: staff ? null : user.employee_id });
      return sum;
    }
    case 'get_late_comers': return staff ? A.lateComers({ ...r, deptId }) : deny;
    case 'get_leave_summary': return (staff || user.employee_id) ? A.leaveSummary({ ...r, deptId, employeeId: staff ? null : user.employee_id }) : deny;
    case 'get_my_leave_balance': return user.employee_id ? A.leaveBalance(user.employee_id, Number(todayLocal(s).slice(0, 4))) : { error: 'You have no employee profile.' };
    case 'get_payroll_summary': return staff ? A.payrollSummary(/^\d{4}-\d{2}$/.test(input.month || '') ? input.month : null) : deny;
    case 'search_employees': return staff ? (await A.searchEmployees({ query: String(input.query || '').slice(0, 80), deptId })).rows : deny;
    default: return { error: 'Unknown tool' };
  }
}

const POLICY = `Company policy facts you may state:
- Office starts 09:00 with a 15-minute grace period; arriving after 09:15 is late.
- Working under 5 hours in a day is a half-day. Saturday and Sunday are weekends.
- Annual leave 14 days/year, sick 8, casual 10, unpaid has no fixed quota. Leave excludes weekends and public holidays.
- Overlapping leave requests and requests above the available balance are rejected.
- A day with no attendance and no approved leave counts as absent.
- Payroll: HRA = 40% of basic, medical = 10% of basic, gross = 1.5 x basic; daily rate = gross / working days;
  absent and unpaid-leave days are deducted in full, half-days at half the daily rate; tax uses annual slabs. Only Admin can finalize payroll.`;

function systemPrompt(user, today) {
  return `You are the HCM Lite assistant. Today is ${today}. The signed-in user has the role "${user.role}".
Answer ONLY from tool results or the policy facts below; never invent numbers. If a tool returns a "Not permitted" error, politely refuse and explain you cannot share that information.
Employees must never receive other people's salary, attendance or leave details. You cannot change data; tell users to use the app screens.
You may reply in English or Roman Urdu, matching the user. Be concise.
${POLICY}`;
}

/** Chat with tool calling (max 5 rounds). messages = [{role:'user'|'assistant', content:string}] */
export async function chat(user, messages) {
  const started = Date.now();
  const s = await getSettings();
  const convo = messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  const used = [];
  try {
    for (let i = 0; i < 5; i++) {
      const res = await callLLM({ system: systemPrompt(user, todayLocal(s)), tools: TOOL_DEFS, messages: convo });
      if (res.stop_reason !== 'tool_use') {
        const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || FALLBACK;
        await logAi(user, 'chat', convo.at(-1).content, text, used, 'ok', started);
        return { reply: text, label: AI_LABEL, tools_used: used };
      }
      convo.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const b of res.content.filter((x) => x.type === 'tool_use')) {
        used.push(b.name);
        let out; try { out = await runTool(user, b.name, b.input); } catch { out = { error: 'Tool failed' }; }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
      }
      convo.push({ role: 'user', content: results });
    }
    throw new Error('Too many tool rounds');
  } catch (e) {
    await logAi(user, 'chat', messages.at(-1)?.content, e.message, used, 'error', started);
    if (e instanceof HttpError) throw e;
    return { reply: FALLBACK, label: AI_LABEL, fallback: true, tools_used: used };
  }
}

/** 3-5 insight bullets about the current dashboard filters, computed from real data. */
export async function dashboardSummary(user, { from, to, deptId }) {
  const started = Date.now();
  const s = await getSettings();
  const r = A.defaultRange(s, from, to);
  const data = {
    range: r,
    attendance: await runTool(user, 'get_attendance_summary', { ...r, department_id: deptId }),
    late_comers: await runTool(user, 'get_late_comers', { ...r, department_id: deptId }),
    leave: await runTool(user, 'get_leave_summary', { ...r, department_id: deptId }),
    headcount: await runTool(user, 'get_headcount', { department_id: deptId }),
  };
  const prompt = 'Using ONLY this JSON, write 3 to 5 short, specific insights for the dashboard. Respond with a JSON array of strings and nothing else.\n' + JSON.stringify(data);
  try {
    const out = await withJsonRetry(prompt, z.array(z.string().min(5)).min(3).max(5), 'Return only a JSON array of 3-5 strings.');
    await logAi(user, 'summary', prompt, JSON.stringify(out), [], 'ok', started);
    return { insights: out, label: AI_LABEL };
  } catch (e) {
    await logAi(user, 'summary', prompt, e.message, [], 'error', started);
    if (e instanceof HttpError) throw e;
    return { insights: [], label: AI_LABEL, fallback: true, message: FALLBACK };
  }
}

/** Ask for JSON, validate with zod, retry once with the validation error. */
async function withJsonRetry(prompt, schema, system) {
  let msgs = [{ role: 'user', content: prompt }], lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callLLM({ system, messages: msgs });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').replace(/```json|```/g, '').trim();
    try { return schema.parse(JSON.parse(text)); }
    catch (e) {
      lastErr = e.message;
      msgs = [...msgs, { role: 'assistant', content: text || '{}' }, { role: 'user', content: 'That was invalid (' + lastErr.slice(0, 300) + '). Return ONLY corrected JSON.' }];
    }
  }
  throw new Error('AI returned invalid JSON');
}

/** Plain language -> validated leave JSON. NEVER saves anything: the client prefills the form for confirmation. */
export async function parseLeave(user, text) {
  const started = Date.now();
  const s = await getSettings();
  const { rows: types } = await q('SELECT code, name FROM leave_types ORDER BY id');
  const codes = types.map((t) => t.code);
  const today = todayLocal(s);
  const day = new Date(today + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const schema = z.object({
    leave_type: z.enum(codes.length ? codes : ['annual']),
    start_date: z.string().refine(isValidDate, 'invalid start_date'),
    end_date: z.string().refine(isValidDate, 'invalid end_date'),
    reason: z.string().max(300),
  }).refine((v) => v.start_date <= v.end_date, 'start_date after end_date');
  const system = `Convert the user's leave request into JSON: {"leave_type": one of ${JSON.stringify(codes)}, "start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","reason":"short text"}. Today is ${today} (${day}). The user may write English or Roman Urdu. Return ONLY JSON.`;
  try {
    const out = await withJsonRetry(String(text).slice(0, 500), schema, system);
    await logAi(user, 'parse_leave', text, JSON.stringify(out), [], 'ok', started);
    return { draft: out, label: AI_LABEL, note: 'Please review and confirm; nothing has been submitted yet.' };
  } catch (e) {
    await logAi(user, 'parse_leave', text, e.message, [], 'error', started);
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Could not understand that request. Please fill in the leave form manually.');
  }
}
