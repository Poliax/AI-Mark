import type { Locator, Page } from 'playwright-core';
import type { PageAnalysis, PageSnapshot, ScoreButtonLocation } from '../types/contracts.js';
import type { PlatformConfig } from '../config/schema.js';
import { analyzePage } from '../page_analyzer/analyzer.js';

/**
 * PlatformAdapter —— 换平台只换这个实现（§21）。
 * 定位优先级（§3/§19）：role/text/aria/DOM selector，禁止固定坐标；
 * Canvas 纯图平台才允许视觉坐标兜底（visual 方法，后续阶段实现，本阶段返回 null 并明确记录）。
 */

export interface PlatformAdapter {
  readonly id: string;
  /** 页面识别（§4） */
  analyze(page: Page): Promise<PageAnalysis>;
  /** 定位目标分数按钮（0..15），找不到返回 null（绝不抛错由调用方决定如何处理） */
  locateScoreButton(page: Page, score: number): Promise<{ locator: Locator; info: ScoreButtonLocation } | null>;
  /** 定位确认按钮 ✓ */
  locateConfirm(page: Page): Promise<Locator | null>;
  /** 定位提交按钮 */
  locateSubmit(page: Page): Promise<Locator | null>;
  /** 读取平台「自动提交」状态（绝不修改） */
  getAutoSubmitState(page: Page): Promise<'on' | 'off' | 'unknown'>;
  /** 页面快照（学生标识/题号/当前分数），用于页面变化检测 */
  snapshot(page: Page): Promise<PageSnapshot>;
  /** 注册「学生标识提供者」（如平台接口读到的考号），用于廉价且精准的页面变化检测 */
  setIdentityProvider(fn: (() => string | null) | null): void;
  /** 等待页面变化（如学生切换），返回新快照；超时返回 null（§11：不用固定 sleep） */
  waitForPageChange(page: Page, before: PageSnapshot, timeoutMs: number): Promise<PageSnapshot | null>;
}

export class GenericPlatformAdapter implements PlatformAdapter {
  readonly id = 'generic';
  /** 学生标识提供者（由 Agent 注入：优先用平台接口读到的考号，廉价且精准） */
  private identityProvider: (() => string | null) | null = null;
  constructor(private readonly platform: PlatformConfig) {}

  setIdentityProvider(fn: (() => string | null) | null): void {
    this.identityProvider = fn;
  }

  analyze(page: Page): Promise<PageAnalysis> {
    return analyzePage(page, this.platform);
  }

  async locateScoreButton(
    page: Page,
    score: number,
  ): Promise<{ locator: Locator; info: ScoreButtonLocation } | null> {
    const label = String(score);
    const exactName = /^\d+$/;
    // 1) 容器 selector + 精确文本
    for (const sel of this.platform.selectors.scoreButtonContainer) {
      const container = page.locator(sel).first();
      if ((await container.count()) > 0 && (await container.isVisible().catch(() => false))) {
        const inContainer = container.getByRole('button', { name: label, exact: true }).first();
        if ((await inContainer.count()) > 0 && (await inContainer.isVisible().catch(() => false))) {
          return { locator: inContainer, info: { selector: sel, method: 'role', label } };
        }
        const byText = container
          .locator('button, [role="button"], a')
          .filter({ hasText: new RegExp(`^${label}$`) })
          .first();
        if ((await byText.count()) > 0 && (await byText.isVisible().catch(() => false))) {
          return { locator: byText, info: { selector: sel, method: 'text', label } };
        }
      }
    }
    // 2) 全页 role 精确匹配（accessibility name）
    const byRole = page.getByRole('button', { name: label, exact: true }).first();
    if ((await byRole.count()) > 0 && (await byRole.isVisible().catch(() => false))) {
      return { locator: byRole, info: { selector: `role=button[name="${label}"][exact]`, method: 'role', label } };
    }
    // 3) aria-label
    const byAria = page.locator(`[aria-label="${label}"], [aria-valuenow="${label}"]`).first();
    if ((await byAria.count()) > 0 && (await byAria.isVisible().catch(() => false))) {
      return { locator: byAria, info: { selector: `[aria-label="${label}"]`, method: 'aria', label } };
    }
    // 4) 全页文本精确匹配（顺序扫描，仅作兜底）
    const all = page.locator('button, [role="button"], a');
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const el = all.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const text = ((await el.textContent().catch(() => '')) ?? '').trim();
      if (exactName.test(text) && text === label) {
        return { locator: el, info: { selector: `nth=${i}`, method: 'text', label } };
      }
    }
    // 5) 视觉坐标兜底（Canvas 纯图平台）：本阶段未实现，明确返回 null
    return null;
  }

  async locateConfirm(page: Page): Promise<Locator | null> {
    for (const sel of this.platform.selectors.confirmButton) {
      const cand = page.locator(sel).first();
      if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) return cand;
    }
    for (const t of this.platform.confirmTexts) {
      const cand = page.getByRole('button', { name: t, exact: true }).first();
      if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) return cand;
    }
    return null;
  }

  async locateSubmit(page: Page): Promise<Locator | null> {
    for (const sel of this.platform.selectors.submitButton) {
      const cand = page.locator(sel).first();
      if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) return cand;
    }
    for (const t of this.platform.submitTexts) {
      const cand = page.getByRole('button', { name: t, exact: true }).first();
      if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) return cand;
    }
    return null;
  }

  async getAutoSubmitState(page: Page): Promise<'on' | 'off' | 'unknown'> {
    const analysis = await this.analyze(page);
    return analysis.auto_submit_state;
  }

  async snapshot(page: Page): Promise<PageSnapshot> {
    const analysis = await this.analyze(page);
    return {
      // 优先使用平台接口读到的学生标识（考号）：无需 DOM 扫描即可精准判断切换
      identity: this.identityProvider?.() ?? analysis.student_identity,
      questionNumber: analysis.question_number,
      currentScore: analysis.current_score,
      essaySignature: await this.essaySignature(page),
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * 作文区域内容签名：取作文元素的 src/内容片段做轻量指纹。
   * 学生切换时 SVG/图片内容必然变化 → 用于页面变化检测（平台不显示学生信息时的兜底）。
   */
  /**
   * 作文区域轻量指纹：只用标签/尺寸/src/子节点数等廉价信息（绝不序列化 outerHTML，
   * 大 SVG 上序列化会拖慢页面与 Agent）。学生切换时内容/尺寸/子节点数必然变化。
   */
  private async essaySignature(page: Page): Promise<string | null> {
    const sels = this.platform.selectors.essayImage;
    return page
      .evaluate((candidates) => {
        const visible = (el: Element | null): el is Element => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 8 && r.height >= 8;
        };
        let el: Element | null = null;
        for (const sel of candidates) {
          try {
            const found = document.querySelector(sel);
            if (visible(found)) {
              el = found;
              break;
            }
          } catch {
            /* 非法 selector 跳过 */
          }
        }
        if (!el) {
          // 启发式：左半屏最大 img/canvas/svg/iframe
          let best: Element | null = null;
          let bestArea = 0;
          const vw = window.innerWidth || 1;
          const vh = window.innerHeight || 1;
          for (const e of Array.from(document.querySelectorAll('img, canvas, svg, iframe'))) {
            if (!visible(e)) continue;
            const r = e.getBoundingClientRect();
            const area = r.width * r.height;
            if (r.left < vw * 0.6 && area > vw * vh * 0.04 && area > bestArea) {
              best = e;
              bestArea = area;
            }
          }
          el = best;
        }
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        const src = el.getAttribute('src') ?? '';
        const r = el.getBoundingClientRect();
        // 廉价指纹：标签 + src + 直接子节点数 + 首个子节点结构 + 尺寸
        const first = el.firstElementChild;
        const firstSig = first
          ? `${first.tagName}|${first.childElementCount}|${first.getAttribute('d')?.length ?? 0}`
          : '';
        return `${tag}|${src.slice(0, 80)}|${el.childElementCount}|${firstSig}|${Math.round(r.width)}x${Math.round(r.height)}`;
      }, sels)
      .catch(() => null);
  }

  /** 廉价读取学生身份：优先平台接口（考号），否则按 selector/启发式取（扫描量有上限） */
  private async cheapIdentity(page: Page): Promise<string | null> {
    const fromApi = this.identityProvider?.() ?? null;
    if (fromApi) return fromApi;
    const sels = this.platform.selectors.studentIdentity;
    return page
      .evaluate((candidates: string[]) => {
        for (const sel of candidates) {
          try {
            const el = document.querySelector(sel);
            const t = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (t) return t.slice(0, 64);
          } catch {
            /* 非法 selector 跳过 */
          }
        }
        // 启发式兜底：扫描量限制在前 400 个候选元素内，避免拖慢页面
        let scanned = 0;
        for (const el of Array.from(document.querySelectorAll('div,span,td,li,p,b'))) {
          if (++scanned > 400) break;
          const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (t.length > 0 && t.length <= 64 && /(考生|考号|姓名|学号)/.test(t)) return t;
        }
        return null;
      }, sels)
      .catch(() => null);
  }

  /** 轻量探测：只读分数选中态 + 作文指纹 + 学生身份（不做全页分析），用于高频轮询 */
  private async cheapProbe(
    page: Page,
  ): Promise<{ identity: string | null; score: number | null; sig: string | null }> {
    const sig = await this.essaySignature(page);
    const score = await page
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const b of btns) {
          const t = (b.textContent ?? '').trim();
          if (!/^\d{1,2}$/.test(t)) continue;
          const cls = String(b.className ?? '');
          const pressed = b.getAttribute('aria-pressed');
          if (pressed === 'true' || /(active|selected|checked|current|is-checked)/i.test(cls)) {
            return parseInt(t, 10);
          }
        }
        return null;
      })
      .catch(() => null);
    return { identity: await this.cheapIdentity(page), score, sig };
  }

  /** §11：轮询检测页面变化（学生切换/分数复位），不使用固定 sleep 后盲点 */
  async waitForPageChange(page: Page, before: PageSnapshot, timeoutMs: number): Promise<PageSnapshot | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        // 高频轮询只用轻量探测（不做全页 DOM 扫描），显著降低页面与 CPU 负担
        const now = await this.cheapProbe(page);
        const identityChanged =
          before.identity !== null && now.identity !== null && before.identity !== now.identity;
        const sigChanged =
          before.essaySignature !== null && now.sig !== null && before.essaySignature !== now.sig;
        const scoreReset = before.currentScore !== null && now.score === null;
        if (identityChanged || sigChanged || scoreReset) {
          // 确认变化后做一次完整快照返回（低频，代价可接受）
          return await this.snapshot(page);
        }
      } catch {
        /* 页面切换过程中的瞬时异常忽略 */
      }
      await page.waitForTimeout(700);
    }
    return null;
  }
}

export function createAdapter(config: PlatformConfig): PlatformAdapter {
  if (config.adapter === 'generic') return new GenericPlatformAdapter(config);
  throw new Error(`未知平台适配器: ${config.adapter}`);
}
