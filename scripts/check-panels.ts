import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const results: unknown[] = [];
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    const info = await p
      .evaluate(() => ({
        url: location.href,
        host: !!document.getElementById('__essay_agent_panel_host__'),
        scriptGuard: !!(window as unknown as Record<string, unknown>).__essayAgentPanel,
        bodyChildren: document.body ? document.body.children.length : -1,
      }))
      .catch(() => ({ url: p.url(), error: 'evaluate failed' }));
    results.push(info);
  }
}
console.log(JSON.stringify(results, null, 2));
await browser.close().catch(() => {});
