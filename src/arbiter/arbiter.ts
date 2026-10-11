import type { GradeResult } from '../types/contracts.js';
import type { GradingModel, GradeInput } from '../grading/engine.js';

/**
 * 多模型仲裁（§17 第五阶段）—— 接口与仲裁逻辑先行：
 * - 单模型（默认）：直接采用；
 * - 多模型：全部评分后取中位数（就近取整），并计算最大分差；
 * - 分差 >= 阈值（默认 3）由 scoring/validate 强制人工复核。
 */

export interface ArbitrationResult {
  results: GradeResult[];
  final: GradeResult;
  /** 多模型最大分差（单模型为 null） */
  disagreement: number | null;
  modelsUsed: number;
}

export async function arbitrate(
  models: GradingModel[],
  input: GradeInput,
  externalSignal?: AbortSignal,
): Promise<ArbitrationResult> {
  if (models.length === 0) throw new Error('arbitrate: 至少需要一个评分模型');
  const settled = await Promise.allSettled(models.map((m) => m.grade(input, externalSignal)));
  const results: GradeResult[] = [];
  const failures: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(s.value);
    else failures.push(`${models[i]!.id}: ${(s.reason as Error).message}`);
  });

  if (results.length === 0) {
    throw new Error(`全部评分模型失败，无法评分: ${failures.join(' | ')}`);
  }
  if (results.length === 1) {
    return { results, final: results[0]!, disagreement: null, modelsUsed: 1 };
  }

  const scores = results.map((r) => r.score);
  const disagreement = Math.max(...scores) - Math.min(...scores);

  // 中位数（就近取整），取与中位数最接近的模型结果作为最终结果载体
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const mid = Math.floor(sorted.length / 2);
  const medianScore = sorted.length % 2 === 1 ? sorted[mid]!.score : Math.round((sorted[mid - 1]!.score + sorted[mid]!.score) / 2);
  const carrier = results.reduce((best, r) =>
    Math.abs(r.score - medianScore) < Math.abs(best.score - medianScore) ? r : best,
  );
  const final: GradeResult = {
    ...carrier,
    score: medianScore,
    confidence: Math.min(...results.map((r) => r.confidence)),
    model_version: results.map((r) => r.model_version).join(' + '),
  };

  return { results, final, disagreement, modelsUsed: results.length };
}
