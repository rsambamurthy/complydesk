/** A workspace's settings with their defaults — the one place defaults live. */
import type { Tenant, TenantSettings } from '../db/schema.js';
import { z } from 'zod';

export const DEFAULT_SETTINGS: Required<Omit<TenantSettings, 'sessionHours'>> = {
  reminderDays: [15, 7, 1], reminderOverdue: true, reminderClientUsers: false,
  requireReview: true, requireClientApproval: false,
};
export const settingsOf = (t: Pick<Tenant, 'settings'>) => ({ ...DEFAULT_SETTINGS, ...t.settings });

export const settingsInput = z.object({
  reminderDays: z.array(z.coerce.number().int().min(0).max(90)).max(6).transform((d) => [...new Set(d)].sort((a, b) => b - a)),
  reminderOverdue: z.boolean(), reminderClientUsers: z.boolean(),
  requireReview: z.boolean(), requireClientApproval: z.boolean(),
}).partial();
