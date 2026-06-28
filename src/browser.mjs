// Shared headless-browser primitives for the Playwright-based source adapters
// (Apollo, Ving). Keeping the launch/stealth/retry config in one place means a
// fix (UA bump, new evasion flag, sandbox arg) applies to every source at once
// instead of drifting per adapter.

/**
 * Launch headless Chromium with the standard stealth setup and return the
 * browser + a ready page. Caller does its own navigation / capture / fetch.
 * @param {object} opts
 * @param {string} opts.userAgent
 * @param {{width:number,height:number}} [opts.viewport]
 */
export async function launchClearedContext({ userAgent, viewport } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent,
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
    ...(viewport ? { viewport } : {}),
  });
  await ctx.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined }),
  );
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

/**
 * Wrap an async call with retry + exponential backoff. Returns a function with
 * the same args. `sleep(ms)` lets callers use page.waitForTimeout.
 */
export function withRetry(fn, { attempts = 3, baseMs = 1000, sleep }) {
  return async (...args) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(baseMs * 2 ** i);
      }
    }
    throw lastErr;
  };
}
