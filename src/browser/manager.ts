import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { AppConfig } from '../config/schema.js';

/**
 * 浏览器连接管理 —— 两种模式（§2/§3）：
 * - attach：接管教师已经打开并登录的 Chrome（教师自行用 --remote-debugging-port 启动）。
 *   程序绝不接触账号密码、绝不自动登录；遇到验证码/登录过期由状态机暂停人工处理。
 * - managed：程序启动一个独立配置目录的 Chrome 窗口，教师在其中自行登录。
 */

export interface ConnectedBrowser {
  browser: Browser;
  context: BrowserContext;
  mode: 'attach' | 'managed';
  close(): Promise<void>;
}

export async function connectBrowser(cfg: AppConfig['browser']): Promise<ConnectedBrowser> {
  if (cfg.mode === 'attach') {
    return attachToChrome(cfg.cdpUrl);
  }
  const context = await chromium.launchPersistentContext(cfg.userDataDir, {
    channel: cfg.channel as 'chrome',
    headless: cfg.headless,
    viewport: null,
    args: ['--start-maximized'],
  });
  return {
    browser: context.browser()!,
    context,
    mode: 'managed',
    close: () => context.close(),
  };
}

export async function attachToChrome(cdpUrl: string): Promise<ConnectedBrowser> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (e) {
    throw new Error(
      `无法连接到已打开的 Chrome（${cdpUrl}）。请先以调试端口启动 Chrome：\n` +
        `  macOS: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\\n` +
        `         --remote-debugging-port=9222 --user-data-dir="$HOME/essay-agent-chrome"\n` +
        `（建议使用独立的 --user-data-dir 配置文件，保护您日常浏览数据；启动后在 Chrome 里自行登录阅卷平台）\n` +
        `原始错误: ${(e as Error).message}`,
    );
  }
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error('Chrome 已连接但没有可用上下文，请打开阅卷平台页面后重试');
  }
  return {
    browser,
    context,
    mode: 'attach',
    close: () => browser.close().catch(() => {}),
  };
}

/** 选择目标页面：优先 URL 匹配（hint/平台规则/阅卷关键词），否则取最后一个非空白页 */
export function pickTargetPage(context: BrowserContext, opts: { gradingUrlHint: string; urlPatterns: string[] }): Page | null {
  const pages = context.pages().filter((p) => !p.url().startsWith('about:') && !p.url().startsWith('chrome://'));
  if (pages.length === 0) return null;
  if (opts.gradingUrlHint) {
    const hit = pages.find((p) => p.url().includes(opts.gradingUrlHint));
    if (hit) return hit;
  }
  if (opts.urlPatterns.length > 0) {
    for (const pat of opts.urlPatterns) {
      const re = new RegExp(pat);
      const hit = pages.find((p) => re.test(p.url()));
      if (hit) return hit;
    }
  }
  // 无配置时用阅卷关键词启发式（mark/grade/score/paper 等）
  const KEYWORDS = ['mark', 'grade', 'score', 'paper', 'yue'];
  const kwHit = pages.find((p) => KEYWORDS.some((k) => p.url().toLowerCase().includes(k)));
  if (kwHit) return kwHit;
  return pages[pages.length - 1]!;
}

/** 把面板脚本注入所有上下文与所有已打开页面（避免教师看错标签页时找不到面板） */
export async function injectScriptAllPages(browser: Browser, script: string): Promise<void> {
  for (const ctx of browser.contexts()) {
    ctx.addInitScript(script).catch(() => {});
    for (const p of ctx.pages()) {
      try {
        await p.evaluate(script);
      } catch {
        /* 单个页面注入失败不阻塞整体 */
      }
    }
  }
}
