import { z } from 'zod';

/** 配置 schema —— 所有安全参数、selector、模型预设全部可配置 */

export const scoreRangeSchema = z.object({
  min: z.number().int().min(0),
  max: z.number().int().min(1),
});

export const platformSelectorsSchema = z.object({
  /** 作文图像区域（img/canvas 等）候选 selector */
  essayImage: z.array(z.string()).default([]),
  /** 右侧评分面板候选 selector */
  scorePanel: z.array(z.string()).default([]),
  /** 分数按钮容器候选 selector */
  scoreButtonContainer: z.array(z.string()).default([]),
  /** 确认按钮（✓）候选 selector */
  confirmButton: z.array(z.string()).default([]),
  /** 提交按钮候选 selector */
  submitButton: z.array(z.string()).default([]),
  /** 平台「自动提交」开关候选 selector */
  autoSubmitToggle: z.array(z.string()).default([]),
  /** 题号区域候选 selector */
  questionNumber: z.array(z.string()).default([]),
  /** 学生标识区域候选 selector */
  studentIdentity: z.array(z.string()).default([]),
  /** 当前已填分数显示区域候选 selector */
  currentScore: z.array(z.string()).default([]),
});

export const platformSchema = z.object({
  adapter: z.string().default('generic'),
  /** 阅卷页 URL 匹配规则（正则字符串）；命中会增强页面识别置信度 */
  urlPatterns: z.array(z.string()).default([]),
  /** 本次考试作文分数区间（默认 0-15） */
  scoreRange: scoreRangeSchema.default({ min: 0, max: 15 }),
  selectors: platformSelectorsSchema.default({}),
  /** 确认按钮文本（如 ✓ / 确认） */
  confirmTexts: z.array(z.string()).default(['✓', '确认']),
  /** 提交按钮文本 */
  submitTexts: z.array(z.string()).default(['提交']),
  /** 平台自动提交开关文本 */
  autoSubmitTexts: z.array(z.string()).default(['自动提交']),
  /** 学生总数（可选，用于面板显示 82/100；0 或缺失显示 ?） */
  totalStudents: z.number().int().min(0).default(0),
  /** 等待下一份作文的最大时长 ms */
  nextEssayTimeoutMs: z.number().int().positive().default(120000),
  /**
   * 学生数据接口模板（读取教师打分/考号，占位符 {subjectId}/{blockId}/{index}）。
   * 留空则仅靠页面请求监听。
   */
  historyApi: z.string().default(''),
});

export const aiProviderSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string().default(''),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.1),
});

export const aiSchema = z.object({
  vision: aiProviderSchema,
  grading: aiProviderSchema,
  /** 视觉识别开关（关闭时作文文本需要人工粘贴，本阶段默认开启） */
  visionEnabled: z.boolean().default(true),
  /** mock 模式：不调用真实 API（演示/测试用） */
  mock: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(120000),
});

/** §8 安全参数（全部可配置；默认值=规格默认，闸门默认全关） */
export const safetySchema = z.object({
  /**
   * DRY RUN：只读+识别+评分+定位高亮，禁止真实点击。
   * 开发阶段硬性默认 true；只有经过验收确认后才可关闭。
   */
  dryRun: z.boolean().default(true),
  /** 开发阶段：1=只读识别评分 / 2=允许点分数 / 3=确认+教师确认后提交 / 4=批量 / 5=多模型仲裁 */
  phase: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(1),
  /** 置信度 >= 此值可自动提交（默认 0.90） */
  minConfidenceAuto: z.number().min(0).max(1).default(0.9),
  /** 置信度在此区间需教师确认（默认 0.75-0.90） */
  minConfidenceTeacherConfirm: z.number().min(0).max(1).default(0.75),
  /** 多模型分差 >= 此值强制人工复核（默认 3） */
  maxModelDisagreement: z.number().min(0).default(3),
  /** 允许程序点击「提交」（phase>=3 且本项为 true 才生效） */
  allowSubmit: z.boolean().default(false),
  /** 允许完全无人值守提交（开发阶段禁止；默认 false） */
  allowAutoSubmit: z.boolean().default(false),
  /** 操作前必须先检测平台「自动提交」状态；绝不修改用户设置 */
  checkAutoSubmitFirst: z.boolean().default(true),
  /** 作文区域占视口比例超过此值视为「定位错误」，禁止发送与评分 */
  maxRegionFraction: z.number().min(0.1).max(1).default(0.75),
  /** 评分前必须确认的题号（可选；设置后题号不符直接 STOP） */
  expectedQuestionNumber: z.number().int().nullable().default(null),
});

export const browserSchema = z.object({
  /** attach=接管教师已打开的 Chrome（推荐，默认）；managed=程序自开 Chrome 窗口由教师手动登录 */
  mode: z.enum(['attach', 'managed']).default('attach'),
  /** attach 模式的 CDP 地址 */
  cdpUrl: z.string().default('http://127.0.0.1:9222'),
  /** 浏览器通道（chrome=本机 Google Chrome，无需下载浏览器） */
  channel: z.string().default('chrome'),
  headless: z.boolean().default(false),
  /** managed 模式的用户数据目录（教师在此窗口内自行登录） */
  userDataDir: z.string().default('./chrome-profile'),
  /** 阅卷页 URL 提示（可选）：attach 时优先选择匹配的标签页 */
  gradingUrlHint: z.string().default(''),
});

export const ocrSchema = z.object({
  /** 是否启用传统 OCR 通道（tesseract.js，首次使用需联网下载语言包） */
  enabled: z.boolean().default(false),
  engine: z.enum(['tesseract', 'none']).default('tesseract'),
  lang: z.string().default('eng'),
});

export const captureSchema = z.object({
  /** 预处理后最长边像素 */
  maxDimension: z.number().int().positive().default(2048),
  grayscale: z.boolean().default(true),
  /** 对比度增益（1=不变，1.3-1.5 对手写增强明显） */
  contrastBoost: z.number().min(0).max(2).default(1.35),
  sharpen: z.boolean().default(true),
});

export const rubricSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  max_score: z.number().int().min(1),
  description: z.string().min(1),
  question: z.string().default(''),
});

/** 校准（学习教师评分尺度）：记录老师实际打分，修正 AI 建议分 */
export const calibrationSchema = z.object({
  enabled: z.boolean().default(true),
  /** 最少样本数：不足时不校准 */
  minSamples: z.number().int().min(2).default(10),
  /** 分数修正上限（分），防过度拟合 */
  maxAdjust: z.number().min(0.5).max(5).default(3),
  /** 注入评分提示词的教师评分示例数量 */
  fewShotN: z.number().int().min(0).max(10).default(5),
  /** 只统计最近 N 份样本的偏差 */
  window: z.number().int().min(5).max(200).default(50),
});

export const serverSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1024).max(65535).default(8766),
});

export const loggingSchema = z.object({
  dir: z.string().default('logs'),
  keepImages: z.boolean().default(true),
});

export const appConfigSchema = z.object({
  browser: browserSchema.default({}),
  platform: platformSchema.default({}),
  ai: aiSchema,
  safety: safetySchema.default({}),
  ocr: ocrSchema.default({}),
  capture: captureSchema.default({}),
  calibration: calibrationSchema.default({}),
  rubric: rubricSchema,
  server: serverSchema.default({}),
  logging: loggingSchema.default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type SafetyConfig = z.infer<typeof safetySchema>;
export type PlatformConfig = z.infer<typeof platformSchema>;
export type AiProviderConfig = z.infer<typeof aiProviderSchema>;
