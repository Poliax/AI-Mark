import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]!.pages().find((p) => p.url().includes('/mark/'))!;
const info = await page.evaluate(() => {
  const out: Array<{ t: string; tag: string; cls: string }> = [];
  for (const el of Array.from(document.querySelectorAll('span,div,b,i,p'))) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/进度|已评|未评|\d+\/\d+/.test(t) && t.length <= 40) {
      out.push({ t, tag: el.tagName, cls: String(el.className).slice(0, 50) });
    }
  }
  return out.slice(0, 20);
});
console.log(JSON.stringify(info, null, 2));
await browser.close().catch(() => {});
