import { createApp } from './app.js';
import { env } from './lib/core.js';
import { migrate, seedCatalogue } from './db/migrate.js';
import { startJobs } from './jobs.js';

if (env.migrateOnStart) await migrate();
await seedCatalogue();
createApp().listen(env.port, () => console.log(`API on :${env.port}`));
startJobs();
