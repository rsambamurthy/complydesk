/** Integrata platform console: every workspace, approvals, trials, platform settings. Platform admins only. */
import { Router } from 'express';
import { recentQuestions } from '../services/help.js';
import { h } from '../lib/core.js';
import { requirePlatformAdmin } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { applyTenantAction, getSettings, platformEventsList, settingsInput, tenantAction, tenantList, updateSettings } from '../services/platform.js';
import { mailConfigured, sendMail, mailSummary, verifyMail } from '../lib/mailer.js';
import { HttpError } from '../lib/core.js';
import { platformRules, savePlatformRule, createPlatformRule, resetPlatformRule, ruleHistoryFor, ruleInput, newRuleInput } from '../services/rules.js';

export const platformRouter = Router();
platformRouter.use(requirePlatformAdmin);

platformRouter.get('/settings', h(async (_req, res) => res.json({ ...(await getSettings()), mailConfigured: mailConfigured() })));
platformRouter.put('/settings', h(async (req, res) => res.json(await updateSettings(parse(settingsInput, req.body)))));
platformRouter.get('/tenants', h(async (_req, res) => res.json(await tenantList())));
platformRouter.post('/tenants/:id', h(async (req, res) => res.json(await applyTenantAction(req.params.id, parse(tenantAction, req.body), req.staff!.user.email))));
platformRouter.get('/help-questions', h(async (req, res) => res.json(await recentQuestions({ onlyGaps: req.query.gaps === '1' }))));
platformRouter.get('/events', h(async (_req, res) => res.json(await platformEventsList())));

// Built-in rules for every firm (a firm's own change to a rule still wins for that firm).
platformRouter.get('/rules', h(async (_req, res) => res.json(await platformRules())));
platformRouter.get('/rules/:code/history', h(async (req, res) => res.json(await ruleHistoryFor(req.params.code, null))));
platformRouter.post('/rules', h(async (req, res) => res.status(201).json(await createPlatformRule(parse(newRuleInput, req.body), req.staff!.user.email))));
platformRouter.put('/rules/:code', h(async (req, res) => res.json(await savePlatformRule(req.params.code, parse(ruleInput, req.body), req.staff!.user.email))));
platformRouter.delete('/rules/:code', h(async (req, res) => { await resetPlatformRule(req.params.code, req.staff!.user.email); res.json({ ok: true }); }));

/** Sends a test email to the signed-in platform admin and reports the mail server's exact answer. */
platformRouter.post('/test-email', h(async (req, res) => {
  if (!mailConfigured()) throw new HttpError(400, 'Email isn’t set up: SMTP_HOST, SMTP_USER and SMTP_PASS are needed.');
  const m = mailSummary();
  const using = `Using ${m.host}:${m.port}, user “${m.user}”, password of ${m.passwordLength} characters.`;
  try { await verifyMail(); } catch (e: any) { throw new HttpError(502, `Sign-in to the mail server failed: ${e.response ?? e.message}. ${using}`); }
  try { await sendMail(req.staff!.user.email, 'ComplyDesk test email', 'Email from ComplyDesk is working.\n\n— Integrata'); }
  catch (e: any) { throw new HttpError(502, `Signed in, but sending failed: ${e.response ?? e.message}. ${using}`); }
  res.json({ ok: true, to: req.staff!.user.email });
}));
