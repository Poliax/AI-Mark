import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]!.pages().find((p) => p.url().includes('/mark/'))!;
const info = await page.evaluate(() => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (el.children.length > 0) continue; // 只看叶子节点
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 30 || seen.has(t)) continue;
    seen.add(t);
    // 数字、分数、状态类文本
    if (/\d/.test(t) || /(分|评|状态|完成|提交)/.test(t)) out.push(t);
    if (out.length >= 40) break;
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close().catch(() => {});
