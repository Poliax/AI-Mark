import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/schema.js';

/**
 * 评分校准（学习教师评分尺度）—— 纯本地、无浏览器依赖：
 * 1. 持续记录「AI 原始分 vs 教师实际分」样本（按评分标准隔离）；
 * 2. 计算系统性偏差（老师分 − AI 分 的均值/标准差）；
 * 3. 把最近教师的评分示例注入评分提示词（few-shot），让模型学着老师的尺度；
 * 4. 用偏差对 AI 原始分做有界修正（封顶 ±maxAdjust，样本不足不修）。
 * 护栏：只调整「建议分」，不改变置信度裁决与提交闸门；换评分标准自动换数据集。
 */

export interface CalibrationSample {
  rubricId: string;
  /** 作文摘要（前 250 字符，用于 few-shot 示例与去重） */
  essayExcerpt: string;
  essayHash: string;
  /** AI 原始分（校准前） */
  aiScore: number;
  /** 教师实际分 */
  teacherScore: number;
  ts: string;
}

export interface CalibrationStats {
  count: number;
  avgDeviation: number;
  stdDev: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export class CalibrationStore {
  constructor(private readonly file: string) {}

  private ensureDir(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
  }

  load(): CalibrationSample[] {
    if (!existsSync(this.file)) return [];
    try {
      return readFileSync(this.file, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as CalibrationSample);
    } catch {
      return [];
    }
  }

  add(sample: CalibrationSample): void {
    this.ensureDir();
    appendFileSync(this.file, JSON.stringify(sample) + '\n', 'utf-8');
  }

  reset(rubricId?: string): void {
    if (!rubricId) {
      if (existsSync(this.file)) writeFileSync(this.file, '', 'utf-8');
      return;
    }
    const rest = this.load().filter((s) => s.rubricId !== rubricId);
    this.ensureDir();
    writeFileSync(this.file, rest.map((s) => JSON.stringify(s)).join('\n') + (rest.length ? '\n' : ''), 'utf-8');
  }

  statsFor(rubricId: string, window: number): CalibrationStats {
    const samples = this.load().filter((s) => s.rubricId === rubricId).slice(-window);
    if (samples.length === 0) return { count: 0, avgDeviation: 0, stdDev: 0 };
    const devs = samples.map((s) => s.teacherScore - s.aiScore);
    const avg = devs.reduce((a, b) => a + b, 0) / devs.length;
    const variance = devs.reduce((a, b) => a + (b - avg) ** 2, 0) / devs.length;
    return { count: devs.length, avgDeviation: avg, stdDev: Math.sqrt(variance) };
  }

  recentFor(rubricId: string, n: number): CalibrationSample[] {
    return this.load().filter((s) => s.rubricId === rubricId).slice(-n);
  }
}

/**
 * 有界偏差修正：样本数不足或偏差过小不修正。
 * 返回修正后的分数（钳制在 0..maxScore 的整数）与修正量。
 */
export function adjustScore(
  raw: number,
  maxScore: number,
  stats: CalibrationStats,
  cfg: AppConfig['calibration'],
): { score: number; adjustedBy: number; applied: boolean } {
  if (!cfg.enabled || stats.count < cfg.minSamples) {
    return { score: raw, adjustedBy: 0, applied: false };
  }
  if (Math.abs(stats.avgDeviation) < 0.5) {
    return { score: raw, adjustedBy: 0, applied: false };
  }
  const delta = clamp(stats.avgDeviation, -cfg.maxAdjust, cfg.maxAdjust);
  const adjusted = clamp(Math.round(raw + delta), 0, maxScore);
  return { score: adjusted, adjustedBy: adjusted - raw, applied: adjusted !== raw };
}

/** 生成注入评分提示词的教师示例块（few-shot） */
export function buildFewShotBlock(samples: CalibrationSample[], maxN: number): string {
  const picked = samples.slice(-maxN);
  if (picked.length === 0) return '';
  const lines = picked.map((s, i) => {
    const excerpt = s.essayExcerpt.replace(/\n/g, ' ').slice(0, 180);
    return `示例${i + 1}：作文片段「${excerpt}」→ 阅卷教师实际给分 ${s.teacherScore} 分。`;
  });
  return (
    `【教师评分示例（请仔细体会以下示例中阅卷教师的给分尺度，并在评分时保持一致）】\n` +
    lines.join('\n') +
    `\n`
  );
}
