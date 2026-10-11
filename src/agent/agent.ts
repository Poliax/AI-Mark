import type { Locator, Page, Response } from 'playwright-core';
import type {
  ActionLogEntry,
  AgentStatus,
  EssayCapture,
  EssayRecord,
  PageAnalysis,
  SafetyCheck,
  ScoreButtonLocation,
} from '../types/contracts.js';
import type { AppConfig } from '../config/schema.js';
import type { Logger } from '../logging/logger.js';
import type { PlatformAdapter } from '../automation/platform_adapter.js';
import { createVisionClient } from '../vision/client.js';
import { createOcrChannel } from '../ocr/channel.js';
import { createGradingModel } from '../grading/engine.js';
import { hashText, type CalibrationStore } from '../grading/calibration.js';
import { arbitrate } from '../arbiter/arbiter.js';
import { validateScore } from '../scoring/validate.js';
import { captureEssay, EssayCaptureError } from '../essay_capture/capture.js';
import { recognizeEssay } from '../vision/pipeline.js';
import { highlightLocator, removeHighlight } from '../automation/dry_run.js';
import {
  assertCanAutoSubmit,
  assertCanClickScore,
  assertCanSubmit,
  buildSafetyChecks,
  allChecksPass,
  SafetyGateError,
} from '../automation/gates.js';

/**
 * Agent —— 状态机每个状态的实际执行者。
 * 浏览器操作与 AI 评分在这里汇合但互不耦合：评分依赖只有文本，页面操作依赖只有分析结果。
 */

export class InterventionError extends Error {
  constructor(
    public readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = 'InterventionError';
  }
}

export class PageNotGradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageNotGradingError';
  }
}

export interface AgentDeps {
  page: Page;
  adapter: PlatformAdapter;
  config: AppConfig;
  logger: Logger;
  /** 教师尺度校准数据存储（学习教师实际打分） */
  calibrationStore: CalibrationStore;
}

interface StudentContext {
  index: number;
  record: EssayRecord;
  analysis: PageAnalysis | null;
  capture: EssayCapture | null;
  recognition: Awaited<ReturnType<typeof recognizeEssay>> | null;
  gradeResult: Awaited<ReturnType<typeof arbitrate>> | null;
  validation: ReturnType<typeof validateScore> | null;
  snapshotBefore: { identity: string | null; questionNumber: number | null; currentScore: number | null } | null;
  targetLocator: Locator | null;
  targetInfo: ScoreButtonLocation | null;
  checks: SafetyCheck[];
  highlightLabel: string | null;
  /** NEXT_ESSAY 等待的基准快照（重试时保持，教师切换后能立即检测到变化） */
  nextBeforeSnapshot: Awaited<ReturnType<PlatformAdapter['snapshot']>> | null;
}

export class Agent {
  private ctx: StudentContext | null = null;
  /** 空闲时（未开始/未选中学生）的页面分析快照，供面板显示「本页考试/进度/题号」 */
  private idleAnalysis: PageAnalysis | null = null;
  /** 教师实际打分（从平台 review/history 接口读取，翻页时自动更新） */
  private lastTeacherScore: number | null = null;
  /** 学生考号（从平台接口读取） */
  private lastKaohao: string | null = null;
  /** 启动时已主动拉取过一次学生数据 */
  private fetchedOnce = false;
  /** 平台学生数据监听器（换绑页面时跟随迁移） */
  private platformHandler: ((res: Response) => void) | null = null;
  /** 当前进行中的 AI 调用中止控制器（暂停按钮立即中止） */
  private currentAbort: AbortController | null = null;
  /** 平台数据更新回调（教师打分/考号变化时立即推送面板） */
  private platformUpdateHandler: (() => void) | null = null;

  /** 设置平台数据更新回调（由 CLI 注入 server.broadcast，实现教师打分实时推送） */
  setPlatformUpdateHandler(fn: (() => void) | null): void {
    this.platformUpdateHandler = fn;
  }
  /** 已完成（含跳过）的学生数 */
  completed = 0;
  totalStudents: number | null;
  private interruptCheck: (() => boolean) | null = null;

  constructor(private deps: AgentDeps) {
    this.totalStudents = deps.config.platform.totalStudents > 0 ? deps.config.platform.totalStudents : null;
  }

  /** 状态机注入中断检测（暂停/停止命令） */
  setInterruptCheck(fn: (() => boolean) | null): void {
    this.interruptCheck = fn;
  }

  /** 重新绑定目标页面（启动时选错标签页时，由巡护自动纠正；仅限空闲/暂停时调用） */
  setPage(page: Page): void {
    if (this.deps.page === page) return;
    // 监听器跟随页面迁移（否则新页面上的平台数据请求捕获不到）
    if (this.platformHandler) {
      this.deps.page.off('response', this.platformHandler);
      this.deps.page = page;
      this.deps.page.on('response', this.platformHandler);
    } else {
      this.deps.page = page;
    }
    this.idleAnalysis = null;
    this.fetchedOnce = false; // 新页面允许再主动拉取一次
  }

  /** 读取当前页面信息（只读），供面板随时与页面左上角信息对应 */
  async refreshPageInfo(): Promise<void> {
    try {
      this.idleAnalysis = await this.deps.adapter.analyze(this.page);
    } catch {
      /* 页面切换中忽略 */
    }
    // 启动时主动拉取一次当前学生数据（教师打分/考号）；之后靠页面请求监听实时更新
    if (!this.fetchedOnce && this.deps.config.platform.historyApi) {
      this.fetchedOnce = true;
      try {
        const m = /\/subject\/(\d+)\/mark\/(\d+)/.exec(this.page.url());
        const reviewed = this.idleAnalysis?.progress?.done;
        if (m && reviewed != null) {
          const url = this.deps.config.platform.historyApi
            .replace('{subjectId}', m[1]!)
            .replace('{blockId}', m[2]!)
            .replace('{index}', String(reviewed));
          const json = await this.page.evaluate(async (u) => {
            const r = await fetch(u, { credentials: 'include' });
            return r.json().catch(() => null);
          }, url);
          const d = (json as { data?: { kaohao?: string; finalScore?: number } })?.data;
          if (d && typeof d.finalScore === 'number') {
            this.lastTeacherScore = d.finalScore;
            this.lastKaohao = typeof d.kaohao === 'string' ? d.kaohao : null;
            this.platformUpdateHandler?.();
          }
        }
      } catch {
        /* 平台接口不可用时忽略 */
      }
    }
  }

  /**
   * 监听平台接口：好分数 review/history 返回当前学生的考号与教师打分。
   * 教师翻页时页面会重新请求，监听器实时更新 → 面板「教师打分」与页面同步。
   */
  attachPlatformListener(): void {
    const handler = async (res: Response) => {
      try {
        if (!/subject\/block\/review\/history/.test(res.url())) return;
        console.log(`[agent] 捕获平台学生数据请求: ${res.url()}`);
        const json = (await res.json()) as { data?: { kaohao?: string; finalScore?: number; errorCode?: unknown } };
        const d = json?.data;
        if (!d) {
          console.log('[agent] 平台学生数据为空，跳过');
          return;
        }
        // 只接受带有效分数字段的有效响应（平台偶发返回 errorCode 的错误响应）
        if (typeof d.finalScore !== 'number') {
          console.log('[agent] 平台学生数据异常（无 finalScore），跳过');
          return;
        }
        console.log(`[agent] 教师打分=${d.finalScore} 考号=${d.kaohao}`);
        this.lastTeacherScore = d.finalScore;
        this.lastKaohao = typeof d.kaohao === 'string' ? d.kaohao : null;
        // 立即推送面板（教师翻页时实时显示新分数）
        this.platformUpdateHandler?.();
        // 正在批改中的学生：把教师分数写入日志记录
        const ctx = this.ctx;
        if (ctx && this.lastTeacherScore !== null && ctx.record.final_teacher_score === null) {
          ctx.record.final_teacher_score = this.lastTeacherScore;
          this.log('PLATFORM', 'teacher_score_read', {
            teacherScore: this.lastTeacherScore,
            kaohao: this.lastKaohao,
          });
        }
      } catch (e) {
        console.warn(`[agent] 平台学生数据解析失败: ${(e as Error).message}`);
      }
    };
    this.platformHandler = handler;
    this.page.on('response', handler);
  }

  get page(): Page {
    return this.deps.page;
  }

  private ensureCtx(): StudentContext {
    if (!this.ctx) throw new Error('内部错误：尚无学生上下文');
    return this.ctx;
  }

  /**
   * 运行可中止的 AI 长调用：教师点暂停 → 中断信号立即中止识别/评分（而非等 20-40 秒完成）。
   */
  private async runGradable<T>(fn: (signal: AbortSignal) => Promise<T>, abortMessage: string): Promise<T> {
    const ac = new AbortController();
    this.currentAbort = ac;
    const poll = setInterval(() => {
      if (this.interruptCheck?.()) ac.abort();
    }, 300);
    try {
      return await fn(ac.signal);
    } catch (e) {
      if (ac.signal.aborted) throw new Error(`已按教师请求暂停（${abortMessage}）`);
      throw e;
    } finally {
      clearInterval(poll);
      this.currentAbort = null;
    }
  }

  private log(state: string, action: string, detail?: unknown): void {
    const ctx = this.ctx;
    if (ctx) this.deps.logger.appendAction(ctx.record, state, action, detail);
  }

  // ---------------- CHECK_PAGE ----------------
  async checkPage(): Promise<void> {
    const analysis = await this.deps.adapter.analyze(this.page);
    this.ensureCtx().analysis = analysis;

    if (analysis.intervention_needed) {
      const it = analysis.intervention_needed;
      throw new InterventionError(
        it.type,
        `检测到需要人工处理：${it.detail}。已暂停自动化；请教师处理后点击[继续]。程序不会绕过任何验证码/安全验证。`,
      );
    }
    if (!analysis.is_grading_page) {
      const ev = JSON.stringify(analysis.evidence);
      throw new PageNotGradingError(
        `无法确认当前是阅卷页面（作文图像=${analysis.has_essay_image}，评分面板=${analysis.has_score_panel}，提交按钮=${analysis.has_submission_button}）。禁止自动评分。证据: ${ev}`,
      );
    }

    const ctx = this.ensureCtx();
    ctx.record.question_number = analysis.question_number;
    // 平台接口读取到的教师打分/考号写入日志（§15 final_teacher_score）
    if (this.lastTeacherScore !== null && ctx.record.final_teacher_score === null) {
      ctx.record.final_teacher_score = this.lastTeacherScore;
    }
    ctx.snapshotBefore = {
      identity: analysis.student_identity,
      questionNumber: analysis.question_number,
      currentScore: analysis.current_score,
    };

    // 题号硬校验（配置了 expectedQuestionNumber 时）
    if (
      this.deps.config.safety.expectedQuestionNumber !== null &&
      analysis.question_number !== this.deps.config.safety.expectedQuestionNumber
    ) {
      throw new SafetyGateError(
        'question_mismatch',
        `题号不匹配：页面=${analysis.question_number ?? '未知'}，期望=${this.deps.config.safety.expectedQuestionNumber}。已 STOP，防止误打分。`,
      );
    }

    // §13 七项保护的第一轮检查
    ctx.checks = buildSafetyChecks({
      analysis,
      expectedQuestionNumber: this.deps.config.safety.expectedQuestionNumber,
      expectedIdentity: ctx.snapshotBefore.identity,
      submitStateKnown: analysis.auto_submit_state !== 'unknown' || analysis.has_submission_button,
    });
    this.log('CHECK_PAGE', 'check_page', { evidence: analysis.evidence, checks: ctx.checks });
    if (!allChecksPass(ctx.checks)) {
      const failed = ctx.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
      throw new SafetyGateError('safety_check_failed', `关键状态无法确认，已 STOP：${failed.join('；')}`);
    }
  }

  // ---------------- CAPTURE_ESSAY ----------------
  async captureEssay(): Promise<void> {
    const ctx = this.ensureCtx();
    const capture = await captureEssay({
      page: this.page,
      analysis: ctx.analysis!,
      platform: this.deps.config.platform,
      config: this.deps.config,
      logger: this.deps.logger,
      studentIndex: ctx.index,
    });
    ctx.capture = capture;
    ctx.record.essay_image = capture.original_image;
    ctx.record.essay_image_preprocessed = capture.preprocessed_image;
    this.log('CAPTURE_ESSAY', 'capture_essay', {
      method: capture.method,
      region: capture.region,
      viewportFraction: Number(capture.viewport_fraction.toFixed(3)),
    });
  }

  // ---------------- OCR ----------------
  async recognize(): Promise<void> {
    const ctx = this.ensureCtx();
    // 每次调用按当前配置创建客户端：面板修改 AI 设置后下一次识别/评分立即生效
    const vision = createVisionClient(this.deps.config.ai);
    const ocr = createOcrChannel(
      this.deps.config.ocr.enabled,
      this.deps.config.ocr.engine,
      this.deps.config.ocr.lang,
    );
    const ac = new AbortController();
    this.currentAbort = ac;
    const poll = setInterval(() => {
      if (this.interruptCheck?.()) ac.abort();
    }, 300);
    try {
      const recognition = await recognizeEssay({
        imageBase64: ctx.capture!.preprocessed_data_url.split(',')[1]!,
        originalImagePath: ctx.capture!.original_image,
        vision,
        ocr,
        signal: ac.signal,
      });
      ctx.recognition = recognition;
      ctx.record.ocr_text = recognition.ocr_text;
      ctx.record.vision_text = recognition.vision_text;
      ctx.record.final_text = recognition.final_text;
      ctx.record.recognition_confidence = recognition.confidence;
      this.deps.logger.saveText('final_text', ctx.index, recognition.final_text);
      this.log('OCR', 'recognize', {
        confidence: recognition.confidence,
        agreement: recognition.agreement,
        warnings: recognition.warnings,
        models: recognition.model_versions,
      });
    } catch (e) {
      if (ac.signal.aborted) throw new Error('已按教师请求暂停（识别已中止）');
      throw e;
    } finally {
      clearInterval(poll);
      this.currentAbort = null;
    }
  }

  // ---------------- GRADE ----------------
  async grade(): Promise<void> {
    const ctx = this.ensureCtx();
    const input = {
      essay: ctx.record.final_text,
      question: this.deps.config.rubric.question,
      rubric: {
        id: this.deps.config.rubric.id,
        title: this.deps.config.rubric.title,
        max_score: this.deps.config.rubric.max_score,
        description: this.deps.config.rubric.description,
        question: this.deps.config.rubric.question,
      },
      // 教师尺度校准：统计 + 最近评分示例
      calibration: {
        stats: this.deps.calibrationStore.statsFor(
          this.deps.config.rubric.id,
          this.deps.config.calibration.window,
        ),
        samples: this.deps.calibrationStore.recentFor(this.deps.config.rubric.id, this.deps.config.calibration.fewShotN),
        cfg: this.deps.config.calibration,
      },
    };
    const arbitration = await this.runGradable(
      (signal) =>
        arbitrate(
          [
            createGradingModel({
              mock: this.deps.config.ai.mock,
              grading: this.deps.config.ai.grading,
              timeoutMs: this.deps.config.ai.timeoutMs,
            }),
          ],
          input,
          signal,
        ),
      '评分已中止',
    );
    ctx.gradeResult = arbitration;
    const g = arbitration.final;
    ctx.record.ai_score = g.score;
    ctx.record.ai_raw_score = g.raw_score;
    ctx.record.max_score = g.max_score;
    ctx.record.confidence = g.confidence;
    ctx.record.level = g.level;
    ctx.record.content_analysis = g.content_analysis;
    ctx.record.language_analysis = g.language_analysis;
    ctx.record.organization_analysis = g.organization_analysis;
    ctx.record.grammar_errors = g.grammar_errors;
    ctx.record.teacher_comment = g.teacher_comment;
    ctx.record.rubric_version = g.rubric_version;
    ctx.record.model_version = g.model_version;
    this.log('GRADE', 'grade', {
      score: g.score,
      maxScore: g.max_score,
      confidence: g.confidence,
      modelsUsed: arbitration.modelsUsed,
      disagreement: arbitration.disagreement,
      rawScore: g.raw_score,
      calibration: g.calibration,
    });
  }

  // ---------------- VALIDATE_SCORE ----------------
  async validate(): Promise<void> {
    const ctx = this.ensureCtx();
    const validation = validateScore({
      result: ctx.gradeResult!.final,
      safety: this.deps.config.safety,
      recognitionConfidence: ctx.recognition!.confidence,
      disagreement: ctx.gradeResult!.disagreement,
    });
    ctx.validation = validation;
    ctx.record.verdict = { kind: validation.verdict.kind, reason: validation.verdict.reason };
    this.log('VALIDATE_SCORE', 'validate_score', {
      verdict: validation.verdict,
      combinedConfidence: validation.combined_confidence,
      reasons: validation.reasons,
    });
  }

  // ---------------- INPUT_SCORE ----------------
  async inputScore(): Promise<void> {
    const ctx = this.ensureCtx();
    const target = ctx.validation!.score;
    const located = await this.deps.adapter.locateScoreButton(this.page, target);
    if (!located) {
      throw new SafetyGateError(
        'score_button_not_found',
        `未找到分数按钮「${target}」。为避免误打分已停止；请检查平台 selector 配置，或[人工评分]。`,
      );
    }
    ctx.targetLocator = located.locator;
    ctx.targetInfo = located.info;
    ctx.record.score_button_method = `${located.info.method}:${located.info.selector}`;

    if (this.deps.config.safety.dryRun) {
      // §18 DRY RUN：只高亮，绝不点击
      ctx.highlightLabel = `建议点击：${target}`;
      await highlightLocator(this.page, located.locator, { label: ctx.highlightLabel, score: target });
      ctx.record.suggested_button = target;
      this.log('INPUT_SCORE', 'dry_run_highlight', {
        suggested: target,
        method: located.info,
        clicked: false,
      });
      return;
    }
    // 真实点击（阶段 2+，dryRun=false）
    assertCanClickScore(this.deps.config.safety);
    await located.locator.click({ timeout: 5000 });
    ctx.record.suggested_button = target;
    this.log('INPUT_SCORE', 'click_score', { score: target, method: located.info });
  }

  // ---------------- VERIFY_SCORE ----------------
  async verifyScore(): Promise<void> {
    const ctx = this.ensureCtx();
    const before = ctx.snapshotBefore!;
    const after = await this.deps.adapter.analyze(this.page);
    ctx.analysis = after;
    const dryRun = this.deps.config.safety.dryRun;

    const checks: SafetyCheck[] = [
      {
        id: 'question_number',
        label: '题号未变化',
        ok: before.questionNumber === null || after.question_number === before.questionNumber,
        detail: `${before.questionNumber ?? '未知'} → ${after.question_number ?? '未知'}`,
      },
      {
        id: 'student_identity',
        label: '学生未变化',
        ok: before.identity === null || after.student_identity === before.identity,
        detail: `${before.identity ?? '未知'} → ${after.student_identity ?? '未知'}`,
      },
      {
        id: 'essay_area',
        label: '作文区域存在',
        ok: after.has_essay_image,
        detail: after.has_essay_image ? '存在' : '不存在',
      },
      {
        id: 'score_panel',
        label: '评分区域存在',
        ok: after.has_score_panel,
        detail: after.has_score_panel ? '存在' : '不存在',
      },
      {
        id: 'current_score_state',
        label: dryRun ? '分数未被意外修改' : '分数已正确填入',
        ok: dryRun ? after.current_score === before.currentScore : after.current_score === ctx.validation!.score,
        detail: `页面当前分数=${after.current_score ?? '未评分'}，${dryRun ? `操作前=${before.currentScore ?? '未评分'}` : `目标=${ctx.validation!.score}`}`,
      },
      {
        id: 'submission_state',
        label: '提交状态可确认',
        ok: after.auto_submit_state !== 'unknown' || after.has_submission_button,
        detail: `自动提交=${after.auto_submit_state}`,
      },
    ];
    ctx.checks = checks;
    this.log('VERIFY_SCORE', 'verify_score', { checks });
    if (!allChecksPass(checks)) {
      const failed = checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
      throw new SafetyGateError('verify_failed', `评分校验失败，已 STOP 防止误打分：${failed.join('；')}`);
    }
  }

  // ---------------- SUBMIT ----------------
  async submit(): Promise<boolean> {
    const ctx = this.ensureCtx();
    const analysis = ctx.analysis!;
    const autoSubmit = analysis.auto_submit_state;

    // DRY RUN：不执行任何提交动作，仅记录平台状态供教师参考
    if (this.deps.config.safety.dryRun) {
      ctx.record.submission_status = 'pending_teacher';
      this.log('SUBMIT', 'dry_run_noop', {
        autoSubmitState: autoSubmit,
        note: 'DRY RUN 未执行任何提交操作；平台自动提交状态仅记录，绝不修改',
      });
      return false;
    }

    // §10：平台已开启自动提交 → 平台自行处理，我们绝不修改设置
    if (autoSubmit === 'on') {
      ctx.record.submission_status = 'platform_auto';
      this.log('SUBMIT', 'platform_auto_submit', { note: '平台已开启自动提交，确认后由平台提交；程序未修改任何设置' });
      return true;
    }

    // 低置信度/需教师确认 → 等待教师
    if (ctx.validation!.verdict.kind !== 'auto') {
      ctx.record.submission_status = 'pending_teacher';
      this.log('SUBMIT', 'wait_teacher', { verdict: ctx.validation!.verdict });
      return false;
    }

    try {
      assertCanSubmit(this.deps.config.safety, autoSubmit);
    } catch (e) {
      // 闸门拦截：默认策略=评分→确认→等待教师确认→提交（§10）
      ctx.record.submission_status = 'pending_teacher';
      this.log('SUBMIT', 'blocked_by_gate', {
        reason: (e as Error).message,
        code: e instanceof SafetyGateError ? e.code : undefined,
      });
      return false;
    }
    assertCanAutoSubmit(this.deps.config.safety);

    const submitBtn = await this.deps.adapter.locateSubmit(this.page);
    if (!submitBtn) {
      throw new SafetyGateError('submit_button_not_found', '未找到提交按钮，已停止。');
    }
    await submitBtn.click({ timeout: 5000 });
    ctx.record.submission_status = 'submitted_auto';
    this.log('SUBMIT', 'click_submit', {});
    return true;
  }

  // ---------------- VERIFY_SUBMISSION ----------------
  async verifySubmission(): Promise<void> {
    const ctx = this.ensureCtx();
    const before = await this.deps.adapter.snapshot(this.page);
    const after = await this.deps.adapter.waitForPageChange(this.page, before, 15000);
    if (!after) {
      throw new SafetyGateError('submission_not_confirmed', '提交后未检测到页面变化，无法确认提交成功。已暂停，请教师核验。');
    }
    this.log('VERIFY_SUBMISSION', 'submission_confirmed', { before, after });
  }

  // ---------------- NEXT_ESSAY ----------------
  async nextEssay(): Promise<boolean> {
    const ctx = this.ensureCtx();
    // 当前学生处理收尾（重试时通过 max 保证只计一次）
    this.completed = Math.max(this.completed, ctx.index);
    this.deps.logger.commitRecord(ctx.record);
    // 教师尺度校准：有 AI 原始分 + 教师实际分时记录样本（持续学习教师的打分尺度）
    if (
      this.deps.config.calibration.enabled &&
      ctx.record.ai_raw_score !== null &&
      ctx.record.final_teacher_score !== null &&
      ctx.record.final_text
    ) {
      this.deps.calibrationStore.add({
        rubricId: ctx.record.rubric_version || this.deps.config.rubric.id,
        essayExcerpt: ctx.record.final_text.slice(0, 250),
        essayHash: hashText(ctx.record.final_text),
        aiScore: ctx.record.ai_raw_score,
        teacherScore: ctx.record.final_teacher_score,
        ts: new Date().toISOString(),
      });
      this.log('NEXT_ESSAY', 'calibration_sample_recorded', {
        aiRaw: ctx.record.ai_raw_score,
        teacher: ctx.record.final_teacher_score,
      });
    }
    // 基准快照保持到检测到切换为止（支持 PAUSE→CONTINUE 重试）
    if (!ctx.nextBeforeSnapshot) {
      ctx.nextBeforeSnapshot = await this.deps.adapter.snapshot(this.page);
    }
    const before = ctx.nextBeforeSnapshot;
    const timeout = this.deps.config.platform.nextEssayTimeoutMs;

    // §11：轮询等待页面变化（学生切换），不使用固定 sleep 后盲点；期间响应暂停/停止
    // 注意：高亮在此期间保持显示 —— 等待教师切换时，教师正需要核对「建议点击」提示
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const after = await this.deps.adapter.waitForPageChange(this.page, before, 5000);
      if (after) {
        if (ctx.highlightLabel) {
          await removeHighlight(this.page).catch(() => {});
          ctx.highlightLabel = null;
        }
        this.log('NEXT_ESSAY', 'student_changed', { before, after });
        this.ctx = null; // 学生上下文清空，下一轮 CHECK_PAGE 重建
        return true;
      }
      if (this.interruptCheck?.()) {
        this.log('NEXT_ESSAY', 'wait_interrupted', {});
        return false;
      }
    }
    return false;
  }

  // ---------------- 人工介入 ----------------
  async manualGrade(): Promise<void> {
    const ctx = this.ensureCtx();
    await removeHighlight(this.page).catch(() => {});
    this.log('PAUSE', 'manual_grade_started', { note: '教师人工评分，AI 停止操作当前学生' });
  }

  async readTeacherScore(): Promise<void> {
    const ctx = this.ensureCtx();
    const analysis = await this.deps.adapter.analyze(this.page);
    ctx.record.final_teacher_score = analysis.current_score;
    ctx.record.submission_status = 'teacher_manual';
    this.log('PAUSE', 'teacher_score_read', { teacherScore: analysis.current_score });
    this.deps.logger.commitRecord(ctx.record);
  }

  async skip(): Promise<void> {
    const ctx = this.ensureCtx();
    await removeHighlight(this.page).catch(() => {});
    ctx.record.submission_status = 'skipped';
    this.log('PAUSE', 'skip_student', {});
  }

  /** 供状态机在每份作文开始时建立上下文 */
  beginStudent(): void {
    const index = this.completed + 1;
    const record = this.deps.logger.createRecord(index);
    this.ctx = {
      index,
      record,
      analysis: null,
      capture: null,
      recognition: null,
      gradeResult: null,
      validation: null,
      snapshotBefore: null,
      targetLocator: null,
      targetInfo: null,
      checks: [],
      highlightLabel: null,
      nextBeforeSnapshot: null,
    };
  }

  /** 当前记录（面板/日志用） */
  currentRecord(): EssayRecord | null {
    return this.ctx?.record ?? null;
  }

  currentActionLog(): ActionLogEntry[] {
    return this.ctx?.record.action_log ?? [];
  }

  // ---------------- 状态汇总 ----------------
  status(state: string): AgentStatus {
    const ctx = this.ctx;
    const cfg = this.deps.config;
    const analysis = ctx?.analysis ?? this.idleAnalysis;
    return {
      state,
      mode: cfg.safety.dryRun ? 'dry-run' : 'live',
      phase: cfg.safety.phase,
      dry_run: cfg.safety.dryRun,
      student_index: ctx?.index ?? this.completed + 1,
      total_students: this.totalStudents,
      completed: this.completed,
      question_number: ctx?.record.question_number ?? analysis?.question_number ?? null,
      current_score: analysis?.current_score ?? null,
      ai_score: ctx?.record.ai_score || null,
      max_score: ctx?.record.max_score || null,
      confidence: ctx?.record.confidence ?? null,
      verdict: ctx?.record.verdict.kind ?? null,
      suggestion: ctx?.highlightLabel ?? null,
      last_message: null,
      auto_submit_state: analysis?.auto_submit_state ?? 'unknown',
      progress: analysis?.progress ?? null,
      exam_info: analysis?.exam_info ?? null,
      teacher_score: this.lastTeacherScore,
      student_kaohao: this.lastKaohao,
      page_ready: analysis?.is_grading_page ?? false,
      calibration: (() => {
        if (!cfg.calibration.enabled) return null;
        const stats = this.deps.calibrationStore.statsFor(cfg.rubric.id, cfg.calibration.window);
        return {
          enabled: true,
          sample_count: stats.count,
          avg_deviation: Number(stats.avgDeviation.toFixed(2)),
          min_samples: cfg.calibration.minSamples,
        };
      })(),
      target: {
        url: this.page.url(),
        title: '',
        student_identity: analysis?.student_identity ?? null,
      },
      last_record_id: ctx ? String(ctx.index).padStart(4, '0') : null,
      records: this.deps.logger
        .listRecords()
        .map((r) => ({
          student_index: r.student_index,
          ai_score: r.ai_score,
          max_score: r.max_score,
          confidence: r.confidence,
          submission_status: r.submission_status,
          timestamp: r.timestamp,
        })),
    };
  }
}
