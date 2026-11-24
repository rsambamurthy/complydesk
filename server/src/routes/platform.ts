/** Integrata platform console: every workspace, approvals, trials, platform settings. Platform admins only. */
import { Router } from 'express';
import { h } from '../lib/core.js';
import { requirePlatformAdmin } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { applyTenantAction, getSettings, platformEventsList, settingsInput, tenantAction, tenantList, updateSettings } from '../services/platform.js';
import { mailConfigured } from '../lib/mailer.js';
import { platformRules, savePlatformRule, createPlatformRule, resetPlatformRule, ruleHistoryFor, ruleInput, newRuleInput } from '../services/rules.js';

export const platformRouter = Router();
platformRouter.use(requirePlatformAdmin);

platformRouter.get('/settings', h(async (_req, res) => res.json({ ...(await getSettings()), mailConfigured: mailConfigured() })));
platformRouter.put('/settings', h(async (req, res) => res.json(await updateSettings(parse(settingsInput, req.body)))));
platformRouter.get('/tenants', h(async (_req, res) => res.json(await tenantList())));
platformRouter.post('/tenants/:id', h(async (req, res) => res.json(await applyTenantAction(req.params.id, parse(tenantAction, req.body), req.staff!.user.email))));
platformRouter.get('/events', h(async (_req, res) => res.json(await platformEventsList())));

// Built-in rules for every firm (a firm's own change to a rule still wins for that firm).
platformRouter.get('/rules', h(async (_req, res) => res.json(await platformRules())));
platformRouter.get('/rules/:code/history', h(async (req, res) => res.json(await ruleHistoryFor(req.params.code, null))));
platformRouter.post('/rules', h(async (req, res) => res.status(201).json(await createPlatformRule(parse(newRuleInput, req.body), req.staff!.user.email))));
platformRouter.put('/rules/:code', h(async (req, res) => res.json(await savePlatformRule(req.params.code, parse(ruleInput, req.body), req.staff!.user.email))));
platformRouter.delete('/rules/:code', h(async (req, res) => { await resetPlatformRule(req.params.code, req.staff!.user.email); res.json({ ok: true }); }));
