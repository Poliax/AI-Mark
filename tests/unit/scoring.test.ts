import { describe, it, expect } from 'vitest';
import { validateScore } from '../../src/scoring/validate.js';
import type { GradeResult } from '../../src/types/contracts.js';
import type { SafetyConfig } from '../../src/config/schema.js';

function grade(score: number, confidence: number): GradeResult {
  return {
    score,
    max_score: 15,
    confidence,
    level: '',
    content_analysis: '',
    language_analysis: '',
    organization_analysis: '',
    grammar_errors: [],
    teacher_comment: '',
    rubric_version: 'r1',
    model_version: 'm1',
    raw_score: null,
    calibration: null,
    raw: {},
  };
}

const safety: SafetyConfig = {
  dryRun: true,
  phase: 1,
  minConfidenceAuto: 0.9,
  minConfidenceTeacherConfirm: 0.75,
  maxModelDisagreement: 3,
  allowSubmit: false,
  allowAutoSubmit: false,
  checkAutoSubmitFirst: true,
  maxRegionFraction: 0.75,
  expectedQuestionNumber: null,
};

describe('validateScore（§8 安全机制）', () => {
  it('置信度 >= 0.90 → 可自动提交', () => {
    const v = validateScore({ result: grade(13, 0.96), safety, recognitionConfidence: 0.95, disagreement: null });
    expect(v.verdict.kind).toBe('auto');
    expect(v.combined_confidence).toBeCloseTo(0.95);
  });

  it('0.75-0.90 → 教师确认', () => {
    const v = validateScore({ result: grade(13, 0.9), safety, recognitionConfidence: 0.8, disagreement: null });
    expect(v.verdict.kind).toBe('teacher_confirm');
  });

  it('< 0.75 → 强制人工', () => {
    const v = validateScore({ result: grade(13, 0.6), safety, recognitionConfidence: 0.9, disagreement: null });
    expect(v.verdict.kind).toBe('manual');
  });

  it('多模型分差 >= 3 → 强制人工复核（即使置信度高）', () => {
    const v = validateScore({ result: grade(13, 0.98), safety, recognitionConfidence: 0.98, disagreement: 3 });
    expect(v.verdict.kind).toBe('manual');
    expect(v.reasons.join('')).toContain('人工复核');
  });

  it('分差 2 → 不触发强制人工', () => {
    const v = validateScore({ result: grade(13, 0.98), safety, recognitionConfidence: 0.98, disagreement: 2 });
    expect(v.verdict.kind).toBe('auto');
  });

  it('分数越界被钳制并记录原因', () => {
    const v = validateScore({ result: grade(18, 0.99), safety, recognitionConfidence: 0.99, disagreement: null });
    expect(v.score).toBe(15);
    expect(v.reasons.join('')).toContain('越界');
  });

  it('综合置信度取识别与评分置信度的较小值', () => {
    const v = validateScore({ result: grade(13, 0.95), safety, recognitionConfidence: 0.6, disagreement: null });
    expect(v.combined_confidence).toBeCloseTo(0.6);
    expect(v.verdict.kind).toBe('manual');
  });
});
