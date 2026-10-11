import type { SafetyConfig } from '../config/schema.js';
import type { PageAnalysis, SafetyCheck } from '../types/contracts.js';

/**
 * 安全闸门（§8/§10/§13/§22）—— 防止误打分是系统最高优先级。
 * 所有「真实操作」能力（点击分数/确认/提交）都被以下闸门默认锁死：
 * - DRY RUN 默认开启：禁止一切点击；
 * - phase=1（只读识别评分）时点击分数直接拒绝；
 * - 提交需要 phase>=3 且 allowSubmit=true；完全无人值守需要 allowAutoSubmit=true；
 * - 平台「自动提交」开关状态只检测、绝不修改（§10）。
 */

export class SafetyGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SafetyGateError';
  }
}

/** 点击分数按钮需要 phase>=2 且 dryRun=false */
export function assertCanClickScore(safety: SafetyConfig): void {
  if (safety.phase < 2) {
    throw new SafetyGateError(
      'phase_gate',
      `当前开发阶段 phase=${safety.phase}：禁止真实点击分数按钮（阶段 2 才开放）。DRY RUN 下只会高亮目标按钮。`,
    );
  }
  if (safety.dryRun) {
    throw new SafetyGateError('dry_run', 'DRY RUN 模式开启：禁止真实点击。请先关闭 dryRun 并确认页面元素定位完全正确。');
  }
}

/** 提交前检查：自动提交开关状态 + 阶段 + 显式开关 */
export function assertCanSubmit(safety: SafetyConfig, autoSubmitState: 'on' | 'off' | 'unknown'): void {
  if (safety.phase < 3) {
    throw new SafetyGateError(
      'phase_gate',
      `当前开发阶段 phase=${safety.phase}：禁止提交（阶段 3 才开放，且默认仍需教师确认）。`,
    );
  }
  if (!safety.allowSubmit) {
    throw new SafetyGateError(
      'submit_not_allowed',
      'allowSubmit=false：评分与确认完成后将等待教师手动提交（默认策略）。',
    );
  }
  if (safety.checkAutoSubmitFirst && autoSubmitState === 'unknown') {
    throw new SafetyGateError(
      'auto_submit_unknown',
      '无法确认平台「自动提交」开关状态，禁止程序自行提交。',
    );
  }
  if (safety.dryRun) {
    throw new SafetyGateError('dry_run', 'DRY RUN 模式开启：禁止真实提交。');
  }
}

/** 无人值守提交开关（默认 false，开发阶段禁止开启） */
export function assertCanAutoSubmit(safety: SafetyConfig): void {
  if (!safety.allowAutoSubmit) {
    throw new SafetyGateError(
      'auto_submit_disabled',
      'allowAutoSubmit=false：开发阶段禁止完全无人值守提交。低置信度/异常作文必须教师处理。',
    );
  }
}

/** §13 七项防误打保护 —— 生成检查清单，任一失败即 STOP/PAUSE */
export function buildSafetyChecks(opts: {
  analysis: PageAnalysis;
  expectedQuestionNumber: number | null;
  expectedIdentity: string | null;
  submitStateKnown: boolean;
}): SafetyCheck[] {
  const { analysis, expectedQuestionNumber, expectedIdentity, submitStateKnown } = opts;
  const checks: SafetyCheck[] = [];

  checks.push({
    id: 'question_number',
    label: '当前题号识别',
    // 配置了期望题号时硬校验；未配置且页面能识别题号时仅记录；平台不显示题号时依赖其他保护
    ok:
      expectedQuestionNumber === null
        ? true
        : analysis.question_number !== null && analysis.question_number === expectedQuestionNumber,
    detail:
      expectedQuestionNumber !== null
        ? `题号=${analysis.question_number ?? '未知'}（期望 ${expectedQuestionNumber}）`
        : `题号=${analysis.question_number ?? '未知（平台未显示，未配置期望题号）'}`,
  });
  checks.push({
    id: 'student_identity',
    label: '当前学生识别',
    ok: expectedIdentity === null ? true : analysis.student_identity === expectedIdentity,
    detail: `学生=${analysis.student_identity ?? '未知'}${expectedIdentity ? `（期望 ${expectedIdentity}）` : '（本页未配置学生标识 selector）'}`,
  });
  checks.push({
    id: 'essay_area',
    label: '作文区域存在检测',
    ok: analysis.has_essay_image,
    detail: analysis.has_essay_image ? '作文图像区域存在' : '未检测到作文图像区域',
  });
  checks.push({
    id: 'score_panel',
    label: '评分区域存在检测',
    ok: analysis.has_score_panel,
    detail: analysis.has_score_panel
      ? `评分面板存在（分数按钮 ${analysis.score_panel_scores.length} 个）`
      : '未检测到评分面板',
  });
  checks.push({
    id: 'current_score_state',
    label: '当前分数状态检测',
    ok: analysis.current_score === null || (analysis.current_score >= 0 && Number.isInteger(analysis.current_score)),
    detail: `当前分数=${analysis.current_score ?? '未评分'}`,
  });
  checks.push({
    id: 'submission_state',
    label: '提交状态检测',
    ok: submitStateKnown || analysis.has_submission_button,
    detail: `自动提交=${analysis.auto_submit_state}，提交按钮=${analysis.has_submission_button ? '有' : '无'}`,
  });
  return checks;
}

export function allChecksPass(checks: SafetyCheck[]): boolean {
  return checks.every((c) => c.ok);
}
