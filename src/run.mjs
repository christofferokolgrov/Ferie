// Production entrypoint — wires the sources, store and mailer from env, then runs
// one sweep→dedup→email pass across ALL enabled sources. This is what the GitHub
// Actions cron invokes once a day at 12:00 Norwegian time (`node src/run.mjs`).

import { sweepAllSources } from './sources.mjs';
import { createStoreFromEnv } from './storage.mjs';
import { createMailerFromEnv } from './email.mjs';
import { runPipeline } from './pipeline.mjs';

async function main() {
  const [store, mailer] = await Promise.all([
    createStoreFromEnv(),
    Promise.resolve(createMailerFromEnv()),
  ]);

  const result = await runPipeline({
    sweep: () => sweepAllSources(),
    store,
    mailer,
  });

  console.error(`[run] done: ${result.qualifying} qualifying, ${result.fresh} new, notified=${result.notified}`);
}

main().catch((err) => {
  console.error('[run] failed:', err);
  process.exit(1);
});
