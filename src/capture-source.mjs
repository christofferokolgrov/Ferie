import { openBrowserSession } from './browser.mjs';
import { finalizeDeal } from './dealrule.mjs';
import { heuristicDeals, summarizeCaptured } from './heuristic.mjs';

// A source that rides a site's own search XHRs: load the page, capture the JSON
// it fetches, parse deals out of it. Used by Ving and TUI, whose request
// contracts aren't confirmed yet — the captured-endpoint logging is how we learn
// them, after which `parse` can be swapped for an exact parser.

/**
 * @param {object} cfg
 * @param {string} cfg.name              source name / operator (e.g. 'ving')
 * @param {string} cfg.pageUrl           search/restplass page to load
 * @param {string[]} cfg.capturePatterns URL substrings to capture as JSON
 * @param {(captured, ctx) => object[]} [cfg.parse]  override the heuristic parser
 */
export function makeCaptureSource(cfg) {
  const { name, pageUrl, capturePatterns, parse = heuristicDeals } = cfg;
  return {
    name,
    async run() {
      const session = await openBrowserSession({ pageUrl, capturePatterns });
      try {
        const { captured } = session;
        // Contract discovery: always log what endpoints/shapes we saw.
        console.error(`[${name}] captured ${captured.length} JSON response(s): ${JSON.stringify(summarizeCaptured(captured)).slice(0, 1600)}`);

        const products = parse(captured, { operator: name }) ?? [];
        const deals = products
          .filter((p) => p.currentPricePerPerson != null || p.currentPrice != null)
          .map(finalizeDeal)
          .filter((d) => d.qualifies);

        if (deals.length === 0 && captured[0]) {
          console.error(`[${name}] 0 qualifying. sample response (1600c): ${JSON.stringify(captured[0].json).slice(0, 1600)}`);
        }
        return { deals, stats: { source: name, captured: captured.length, candidates: products.length, qualifying: deals.length } };
      } finally {
        await session.close();
      }
    },
  };
}
