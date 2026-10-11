import { z } from 'zod';
import type { GradeResult, GrammarError, Rubric } from '../types/contracts.js';
import type { AiProviderConfig, AppConfig } from '../config/schema.js';
import { GRADING_SYSTEM_PROMPT, buildGradingPrompt } from './prompts.js';
import { extractJsonObject } from '../vision/client.js';
import { adjustScore, buildFewShotBlock, type CalibrationSample, type CalibrationStats } from './calibration.js';

/**
 * 评分引擎 —— 完全独立于浏览器自动化（§7）。
 * 本目录不 import 任何 playwright 相关模块；输入 essay + question + rubric，输出 GradeResult。
 * 支持「教师尺度校准」：few-shot 示例注入 + 有界偏差修正（见 calibration.ts）。
 */

export interface GradeInput {
  essay: string;
  question: string;
  rubric: Rubric;
  /** 教师尺度校准数据（可选） */
  calibration?: {
    stats: CalibrationStats;
    samples: CalibrationSample[];
    cfg: AppConfig['calibration'];
  };
}

export interface GradingModel {
  readonly id: string;
  readonly version: string;
  grade(input: GradeInput, externalSignal?: AbortSignal): Promise<GradeResult>;
}

export class GradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingError';
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const rawGradeSchema = z.object({
  score: z.number(),
  level: z.string().optional(),
  confidence: z.number().optional(),
  content_analysis: z.string().optional(),
  language_analysis: z.string().optional(),
  organization_analysis: z.string().optional(),
  grammar_errors: z
    .array(
      z.object({
        sentence: z.string().optional(),
        issue: z.string().optional(),
        suggestion: z.string().optional(),
      }),
    )
    .optional(),
  teacher_comment: z.string().optional(),
});

/** 基于 OpenAI 兼容文本模型的评分实现 */
export class LlmGradingModel implements GradingModel {
  readonly id = 'llm-grading';
  readonly version: string;
  constructor(
    private readonly cfg: AiProviderConfig,
    private readonly timeoutMs: number,
  ) {
    this.version = cfg.model;
  }

  async grade(input: GradeInput, externalSignal?: AbortSignal): Promise<GradeResult> {
    if (!this.cfg.apiKey && !this.cfg.baseUrl.includes('127.0.0.1') && !this.cfg.baseUrl.includes('localhost')) {
      throw new GradingError(
        `未配置评分模型 API Key（模型 ${this.cfg.model}）。请在 .env 中填写 DASHSCOPE_API_KEY 或 AI_GRADING_API_KEY，或使用演示模式（--mock）。`,
      );
    }
    const prompt = buildGradingPrompt({
      question: input.question,
      rubricDescription: input.rubric.description,
      essay: input.essay,
      maxScore: input.rubric.max_score,
      // 教师尺度校准：注入教师实际评分示例，让模型学习老师的给分尺度
      fewShotBlock: input.calibration
        ? buildFewShotBlock(input.calibration.samples, input.calibration.cfg.fewShotN)
        : '',
    });
    const body = {
      model: this.cfg.model,
      temperature: this.cfg.temperature,
      messages: [
        { role: 'system', content: GRADING_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    };

    // 超时信号 + 外部中止信号（暂停按钮可立即中止评分）
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw new GradingError('已中止（教师请求暂停或超时）');
      throw new GradingError(`评分模型请求失败（${this.cfg.model}）: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new GradingError(`评分模型接口返回 ${res.status}（${this.cfg.model}）: ${errText.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : '')).join('\n')
          : String(content ?? '');

    return this.parse(text, input);
  }

  /** 解析与校验模型输出；失败抛错（由状态机转入 PAUSE），绝不猜分 */
  parse(raw: string, input: GradeInput): GradeResult {
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw new GradingError(
        `评分模型输出无法解析为 JSON（已停止，不会猜测分数）。原始输出前 500 字符:\n${raw.slice(0, 500)}`,
      );
    }
    const v = rawGradeSchema.safeParse(parsed);
    if (!v.success) {
      throw new GradingError(`评分模型输出字段不合法: ${v.error.issues.map((i) => i.message).join('; ')}`);
    }
    const d = v.data;
    const maxScore = input.rubric.max_score;
    const rawScore = Math.min(maxScore, Math.max(0, Math.round(d.score)));
    const grammarErrors: GrammarError[] = (d.grammar_errors ?? [])
      .map((e) => ({
        sentence: e.sentence ?? '',
        issue: e.issue ?? '',
        suggestion: e.suggestion ?? '',
      }))
      .filter((e) => e.sentence || e.issue);

    // 教师尺度校准：有界偏差修正（只改建议分，不动置信度）
    let score = rawScore;
    let calibration: GradeResult['calibration'] = null;
    if (input.calibration) {
      const adj = adjustScore(rawScore, maxScore, input.calibration.stats, input.calibration.cfg);
      score = adj.score;
      calibration = {
        sample_count: input.calibration.stats.count,
        avg_deviation: Number(input.calibration.stats.avgDeviation.toFixed(2)),
        adjusted_by: adj.adjustedBy,
      };
    }

    return {
      score,
      max_score: maxScore,
      confidence: clamp01(d.confidence ?? 0.7),
      level: d.level ?? `档位未标注（分数 ${score}/${maxScore}）`,
      content_analysis: d.content_analysis ?? '',
      language_analysis: d.language_analysis ?? '',
      organization_analysis: d.organization_analysis ?? '',
      grammar_errors: grammarErrors,
      teacher_comment: d.teacher_comment ?? '',
      rubric_version: input.rubric.id,
      model_version: this.version,
      raw_score: rawScore,
      calibration,
      raw: parsed,
    };
  }
}

/** mock 评分模型（演示/测试）：按字数与关键词给出确定性结果 */
export class MockGradingModel implements GradingModel {
  readonly id = 'mock-grading';
  readonly version = 'mock-v1';
  constructor(
    private readonly score = 13,
    private readonly confidence = 0.95,
  ) {}

  async grade(input: GradeInput): Promise<GradeResult> {
    const words = input.essay.split(/\s+/).filter(Boolean).length;
    return {
      score: Math.min(this.score, input.rubric.max_score),
      max_score: input.rubric.max_score,
      confidence: this.confidence,
      level: `第三档(好)(${Math.max(0, input.rubric.max_score - 3)}-${input.rubric.max_score}分)`,
      content_analysis: `完成了试题规定的任务，覆盖主要内容要点；全文约 ${words} 词。`,
      language_analysis: '词汇与语法结构基本满足任务要求，有个别不影响理解的小错误。',
      organization_analysis: '使用了简单的连接成分，结构紧凑、格式完整。',
      grammar_errors: [
        { sentence: 'It is one of the most beautiful legends in China.', issue: '无明显问题', suggestion: '' },
      ],
      teacher_comment: '（演示评语）内容完整、结构清晰、语言基本准确。可进一步丰富高级词汇与复杂句式。',
      rubric_version: input.rubric.id,
      model_version: this.version,
      raw_score: null,
      calibration: null,
      raw: { mock: true },
    };
  }
}

export function createGradingModel(cfg: { mock: boolean; grading: AiProviderConfig; timeoutMs: number }): GradingModel {
  return cfg.mock ? new MockGradingModel() : new LlmGradingModel(cfg.grading, cfg.timeoutMs);
}
