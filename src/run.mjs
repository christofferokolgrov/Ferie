// Production entrypoint — wires the real adapter, store and mailer from env,
// then runs one sweep→dedup→email pass. This is what the GitHub Actions cron
// invokes every 30 minutes (`node src/run.mjs`).

import { runApollo } from './apollo.mjs';
import { createStoreFromEnv } from './storage.mjs';
import { createMailerFromEnv } from './email.mjs';
import { runPipeline } from './pipeline.mjs';

async function main() {
  const [store, mailer] = await Promise.all([
    createStoreFromEnv(),
    Promise.resolve(createMailerFromEnv()),
  ]);

  const result = await runPipeline({
    sweep: () => runApollo(),
    store,
    mailer,
  });

  console.error(`[run] done: ${result.qualifying} qualifying, ${result.fresh} new, notified=${result.notified}`);
}

main().catch((err) => {
  console.error('[run] failed:', err);
  process.exit(1);
});
