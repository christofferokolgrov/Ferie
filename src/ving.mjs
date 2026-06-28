import { makeCaptureSource } from './capture-source.mjs';

// Ving (ving.no) — no bot wall, JS-rendered; the search results page fires a
// JSON search (NOTES found a `/websearchresult` reference). We load the
// restplass page and capture that response. The exact OSL/date/pax filtering +
// precise field mapping will be finalized from the first CI run's captured
// sample (logged by capture-source); until then the heuristic parser applies.
export const ving = makeCaptureSource({
  name: 'ving',
  pageUrl: 'https://www.ving.no/restplass',
  capturePatterns: ['websearchresult', 'search', 'product', 'offer', 'restplass', 'api'],
});

export const runVing = () => ving.run();
