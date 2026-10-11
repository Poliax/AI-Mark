import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CalibrationStore,
  adjustScore,
  buildFewShotBlock,
  hashText,
  type CalibrationSample,
} from '../../src/grading/calibration.js';
import type { AppConfig } from '../../src/config/schema.js';

function sample(ai: number, teacher: number, rubricId = 'r1'): CalibrationSample {
  return {
    rubricId,
    essayExcerpt: `essay excerpt ${ai}-${teacher}`,
    essayHash: hashText(`essay-${ai}-${teacher}`),
    aiScore: ai,
    teacherScore: teacher,
    ts: new Date().toISOString(),
  };
}

const cfg: AppConfig['calibration'] = { enabled: true, minSamples: 10, maxAdjust: 3, fewShotN: 5, window: 50 };

describe('评分校准（学习教师打分尺度）', () => {
  it('记录样本并按评分标准隔离统计偏差', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cal-'));
    const store = new CalibrationStore(path.join(dir, 'calibration.jsonl'));
    for (let i = 0; i < 10; i++) store.add(sample(10, 11)); // 老师平均比 AI 高 1 分
    store.add(sample(10, 12, 'other-rubric')); // 别的评分标准不参与
    const stats = store.statsFor('r1', 50);
    expect(stats.count).toBe(10);
    expect(stats.avgDeviation).toBeCloseTo(1);
    expect(stats.stdDev).toBeCloseTo(0);
    expect(store.statsFor('other-rubric', 50).count).toBe(1);
    expect(existsSync(path.join(dir, 'calibration.jsonl'))).toBe(true);
  });

  it('样本不足 minSamples 不修正；偏差 <0.5 不修正', () => {
    const few: AppConfig['calibration'] = { ...cfg, minSamples: 10 };
    const stats = { count: 9, avgDeviation: 2, stdDev: 0.3 };
    const r1 = adjustScore(10, 15, stats, few);
    expect(r1.applied).toBe(false);
    expect(r1.score).toBe(10);

    const stats2 = { count: 20, avgDeviation: 0.3, stdDev: 0.2 };
    const r2 = adjustScore(10, 15, stats2, cfg);
    expect(r2.applied).toBe(false);
  });

  it('偏差修正：老师偏严（AI 高 1.5）→ 分数下调，且有 ±maxAdjust 上限', () => {
    const stats = { count: 30, avgDeviation: -1.5, stdDev: 0.5 }; // teacher - ai = -1.5
    const r = adjustScore(10, 15, stats, cfg);
    expect(r.applied).toBe(true);
    expect(r.score).toBe(9); // 10 - 1.5 = 8.5 → 四舍五入 9
    expect(r.adjustedBy).toBe(-1);

    const bigStats = { count: 30, avgDeviation: -8, stdDev: 1 };
    const r2 = adjustScore(13, 15, bigStats, cfg);
    expect(r2.score).toBe(10); // 封顶 -3
  });

  it('修正后分数钳制在 0..maxScore', () => {
    const stats = { count: 30, avgDeviation: 3, stdDev: 1 };
    expect(adjustScore(14, 15, stats, cfg).score).toBe(15); // 14+3=17 → 15
    const stats2 = { count: 30, avgDeviation: -3, stdDev: 1 };
    expect(adjustScore(1, 15, stats2, cfg).score).toBe(0);
  });

  it('few-shot 示例块包含教师给分', () => {
    const block = buildFewShotBlock([sample(10, 11), sample(8, 9)], 5);
    expect(block).toContain('教师实际给分 11 分');
    expect(block).toContain('教师实际给分 9 分');
    expect(buildFewShotBlock([], 5)).toBe('');
  });

  it('reset 按评分标准清空', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cal-'));
    const store = new CalibrationStore(path.join(dir, 'calibration.jsonl'));
    store.add(sample(10, 11, 'r1'));
    store.add(sample(10, 12, 'r2'));
    store.reset('r1');
    const left = JSON.parse(readFileSync(path.join(dir, 'calibration.jsonl'), 'utf-8').trim().split('\n')[0]!);
    expect(left.rubricId).toBe('r2');
  });
});
