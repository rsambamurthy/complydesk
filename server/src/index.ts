import { createApp } from './app.js';
import { env } from './lib/core.js';
import { migrate, seedCatalogue } from './db/migrate.js';
import { startJobs } from './jobs.js';
import { bootstrapWorkspace } from './services/tenants.js';

if (env.migrateOnStart) await migrate();
await seedCatalogue();
await bootstrapWorkspace();
if (process.env.SEED_DEMO === 'true') await (await import('./db/seed.js')).seedDemo();
createApp().listen(env.port, () => console.log(`API on :${env.port}`));
startJobs();
