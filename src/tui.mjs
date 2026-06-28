import { makeCaptureSource } from './capture-source.mjs';

// TUI (tui.no) — behind Akamai Bot Manager (the hardest source). A headless
// browser from a datacenter IP MAY be challenged; if the page load 403s, this
// source throws and the multi-source runner skips it (Apollo/Ving still run).
// If it loads, we capture the search XHRs like Ving. Field mapping + possible
// residential-proxy need are finalized from the first CI run's captured sample.
export const tui = makeCaptureSource({
  name: 'tui',
  pageUrl: 'https://www.tui.no/siste-liten/',
  capturePatterns: ['search', 'product', 'offer', 'rest', 'api', 'graphql', 'siste-liten'],
});

export const runTui = () => tui.run();
