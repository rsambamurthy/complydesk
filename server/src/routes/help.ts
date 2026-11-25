/** Help pages and the help assistant — every signed-in user (client users included). */
import { Router } from 'express';
import { z } from 'zod';
import { h, HttpError } from '../lib/core.js';
import { parse } from '../lib/parse.js';
import { askHelp, helpIndex, helpSearch, helpSection, rateAnswer } from '../services/help.js';

export const helpRouter = Router();
const page = (v: unknown) => (typeof v === 'string' && v.startsWith('/') ? v.slice(0, 200) : null);

helpRouter.get('/', h(async (req, res) => res.json(helpIndex(page(req.query.page)))));
helpRouter.get('/search', h(async (req, res) => res.json(helpSearch(String(req.query.q ?? '').slice(0, 200)))));
helpRouter.get('/sections/:id', h(async (req, res) => res.json(helpSection(req.params.id))));

const askInput = z.object({
  question: z.string().trim().min(2, 'Type a question').max(500, 'Keep the question under 500 characters'),
  page: z.string().max(200).nullish(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(10).optional(),
});
helpRouter.post('/ask', h(async (req, res) => {
  const body = parse(askInput, req.body);
  res.json(await askHelp(req.staff!, { ...body, page: page(body.page) }));
}));
helpRouter.post('/ask/:id/rate', h(async (req, res) => {
  if (typeof req.body?.helpful !== 'boolean') throw new HttpError(400, 'helpful must be true or false');
  await rateAnswer(req.staff!, req.params.id, req.body.helpful);
  res.json({ ok: true });
}));
