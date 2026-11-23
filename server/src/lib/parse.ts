import type { z } from 'zod';
import { HttpError } from './core.js';
import { fieldErrors } from './validators.js';

/** Validates a request body; a 400 with { field: message } details when it doesn't pass. */
export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'Please check the highlighted fields', fieldErrors(r.error));
  return r.data;
}
