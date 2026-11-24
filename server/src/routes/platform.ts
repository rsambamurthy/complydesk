/** Integrata platform console: every workspace, approvals, trials, platform settings. Platform admins only. */
import { Router } from 'express';
import { h } from '../lib/core.js';
import { requirePlatformAdmin } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { applyTenantAction, getSettings, platformEventsList, settingsInput, tenantAction, tenantList, updateSettings } from '../services/platform.js';
import { mailConfigured } from '../lib/mailer.js';

export const platformRouter = Router();
platformRouter.use(requirePlatformAdmin);

platformRouter.get('/settings', h(async (_req, res) => res.json({ ...(await getSettings()), mailConfigured: mailConfigured() })));
platformRouter.put('/settings', h(async (req, res) => res.json(await updateSettings(parse(settingsInput, req.body)))));
platformRouter.get('/tenants', h(async (_req, res) => res.json(await tenantList())));
platformRouter.post('/tenants/:id', h(async (req, res) => res.json(await applyTenantAction(req.params.id, parse(tenantAction, req.body), req.staff!.user.email))));
platformRouter.get('/events', h(async (_req, res) => res.json(await platformEventsList())));
