import type { Page } from 'playwright-core';
import type { EssayCapture, PageAnalysis } from '../types/contracts.js';
import type { AppConfig, PlatformConfig } from '../config/schema.js';
import type { Logger } from '../logging/logger.js';
import { preprocessImage } from './preprocess.js';

/**
 * 作文区域定位与截图（§5）：
 * 1. 按平台 selector 定位 → 2. 启发式（左半屏最大 img/canvas/svg）→ 3. 视觉定位（后续阶段）。
 * 区域占视口比例超过 maxRegionFraction（默认 0.75）视为定位错误，拒绝继续 —— 防止把整页发给 AI。
 * 不使用固定坐标；region 只记录用于审计。
 */

export class EssayCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EssayCaptureError';
  }
}

export async function captureEssay(opts: {
  page: Page;
  analysis: PageAnalysis;
  platform: PlatformConfig;
  config: AppConfig;
  logger: Logger;
  studentIndex: number;
}): Promise<EssayCapture> {
  const { page, analysis, platform, config, logger, studentIndex } = opts;

  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const vwArea = viewport.width * viewport.height;

  // 1. selector
  let method: EssayCapture['method'] = 'selector';
  let locator = page.locator('xpath=//nonexistent'); // 占位
  for (const sel of platform.selectors.essayImage) {
    const cand = page.locator(sel).first();
    if ((await cand.count()) > 0 && (await cand.isVisible().catch(() => false))) {
      locator = cand;
      method = 'selector';
      break;
    }
  }

  // 2. 启发式：左半屏最大 img/canvas/svg
  if (method === 'selector' && (await locator.count()) === 0) {
    let best: { loc: ReturnType<Page['locator']>; area: number; box: { x: number; y: number; width: number; height: number } } | null = null;
    const count = await page.locator('img, canvas, svg').count();
    for (let i = 0; i < count; i++) {
      const loc = page.locator('img, canvas, svg').nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      const box = await loc.boundingBox().catch(() => null);
      if (!box || box.width < 8 || box.height < 8) continue;
      if (box.x >= viewport.width * 0.6) continue;
      const area = box.width * box.height;
      if (area > vwArea * 0.04 && (!best || area > best.area)) {
        best = { loc, area, box };
      }
    }
    if (best) {
      locator = best.loc;
      method = 'heuristic';
    }
  }

  if ((await locator.count()) === 0) {
    throw new EssayCaptureError(
      '无法定位作文区域：selector 与启发式定位均失败。请检查平台 selector 配置，或在面板中[人工评分]。',
    );
  }

  const box = await locator.boundingBox();
  if (!box) throw new EssayCaptureError('作文区域不可见或尺寸为 0，无法截图');
  const viewportFraction = (box.width * box.height) / vwArea;
  if (viewportFraction > config.safety.maxRegionFraction) {
    throw new EssayCaptureError(
      `作文区域占视口 ${(viewportFraction * 100).toFixed(0)}% > 上限 ${(config.safety.maxRegionFraction * 100).toFixed(0)}%，疑似定位错误，已停止（不会把整页发给 AI）。`,
    );
  }

  const original = await locator.screenshot({ type: 'png' });
  if (!original || original.length === 0) throw new EssayCaptureError('作文区域截图为空');
  const preprocessed = await preprocessImage(original, config.capture);

  const originalPath = logger.saveImage('original', studentIndex, original);
  const preprocessedPath = logger.saveImage('preprocessed', studentIndex, preprocessed);

  return {
    original_image: originalPath,
    preprocessed_image: preprocessedPath,
    original_data_url: `data:image/png;base64,${original.toString('base64')}`,
    preprocessed_data_url: `data:image/png;base64,${preprocessed.toString('base64')}`,
    region: box,
    method,
    viewport_fraction: viewportFraction,
  };
}
