import type { GradeResult, ScoreValidation, ScoreVerdict } from '../types/contracts.js';
import type { SafetyConfig } from '../config/schema.js';

/**
 * 评分校验（§8）—— 安全机制的中枢：
 * - 分数必须是 0..max 整数，越界直接钳制并记录原因；
 * - 综合置信度 = min(识别置信度, 评分置信度)（保守策略）；
 * - >= minConfidenceAuto        → 可自动提交
 * - [minConfidenceTeacherConfirm, minConfidenceAuto) → 需教师确认
 * - <  minConfidenceTeacherConfirm                    → 强制人工
 * - 多模型分差 >= maxModelDisagreement                 → 强制人工复核
 */

export interface ValidateInput {
  result: GradeResult;
  safety: SafetyConfig;
  recognitionConfidence: number;
  /** 多模型最大分差（单模型为 null） */
  disagreement: number | null;
}

export function validateScore(input: ValidateInput): ScoreValidation {
  const { result, safety, recognitionConfidence, disagreement } = input;
  const reasons: string[] = [];

  const maxScore = result.max_score;
  let score = result.score;
  if (!Number.isInteger(score)) {
    reasons.push(`分数非整数（${score}），已取整`);
    score = Math.round(score);
  }
  if (score < 0 || score > maxScore) {
    reasons.push(`分数越界（${score}），已钳制到 0-${maxScore}`);
    score = Math.min(maxScore, Math.max(0, score));
  }

  const combinedConfidence = Math.min(result.confidence, recognitionConfidence);

  let verdict: ScoreVerdict;
  if (disagreement !== null && disagreement >= safety.maxModelDisagreement) {
    verdict = {
      kind: 'manual',
      reason: `多模型分差 ${disagreement} >= ${safety.maxModelDisagreement}，强制人工复核`,
    };
    reasons.push(`多模型分差 ${disagreement}，强制人工复核`);
  } else if (combinedConfidence >= safety.minConfidenceAuto) {
    verdict = { kind: 'auto' };
  } else if (combinedConfidence >= safety.minConfidenceTeacherConfirm) {
    verdict = {
      kind: 'teacher_confirm',
      reason: `综合置信度 ${combinedConfidence.toFixed(2)} 处于 ${safety.minConfidenceTeacherConfirm}-${safety.minConfidenceAuto} 区间，需教师确认`,
    };
  } else {
    verdict = {
      kind: 'manual',
      reason: `综合置信度 ${combinedConfidence.toFixed(2)} < ${safety.minConfidenceTeacherConfirm}，强制人工处理`,
    };
    reasons.push(`置信度 ${combinedConfidence.toFixed(2)} 过低，强制人工处理`);
  }

  return {
    ok: score >= 0 && score <= maxScore,
    score,
    max_score: maxScore,
    combined_confidence: combinedConfidence,
    verdict,
    reasons,
    disagreement,
  };
}
