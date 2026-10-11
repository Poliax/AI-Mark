import type { AppConfig } from './schema.js';

/**
 * 默认配置 —— 通义千问（Qwen）预设 + 通用阅卷平台适配器。
 * 所有值均可被 config.local.json 与 .env 覆盖。
 */

export const AI_PRESETS = {
  qwen: {
    name: '通义千问 Qwen（推荐）',
    vision: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-vl-max',
    },
    grading: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    },
  },
  glm: {
    name: '智谱 GLM（glm-4v-flash 视觉免费）',
    vision: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
    grading: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  },
  openai: {
    name: 'OpenAI',
    vision: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    grading: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  },
  ollama: {
    name: '本地 Ollama（免费离线）',
    vision: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-vl' },
    grading: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5' },
  },
} as const;

/**
 * 15 分制英语作文评分标准（通用模板）。
 * 强烈建议教师在启动前替换为本次考试的真实评分标准（面板或 config.local.json 中修改）。
 */
export const DEFAULT_RUBRIC = {
  id: 'template-15',
  title: '15 分制英语作文评分标准（通用模板，请替换为本次考试标准）',
  max_score: 15,
  question: '',
  description: `英语书面表达评分标准（满分 15 分）:
第四档（很好，13-15 分）：完全完成试题规定的任务。覆盖所有内容要点；应用了较多的语法结构和词汇；语法结构或词汇方面有些许错误，但为尽力使用较复杂结构或较高级词汇所致；有效地使用了语句间的连接成分，使全文结构紧凑；完全达到了预期的写作目的。
第三档（好，10-12 分）：完成了试题规定的任务。虽漏掉一两个次重点，但覆盖所有主要内容；应用的语法结构和词汇能满足任务要求；语法结构或词汇方面应用基本准确，些许错误主要因尝试较复杂结构或词汇所致；应用简单的语句间连接成分，使全文结构紧凑；达到了预期的写作目的。
第二档（适当，6-9 分）：基本完成试题规定的任务。虽漏掉一些内容，但覆盖所有主要内容；有一些语法结构或词汇方面的错误，但不影响理解；应用简单的语句间连接成分，使全文内容连贯；基本达到了预期的写作目的。
第一档（较差，3-5 分）：未恰当完成试题规定的任务。漏掉或未描述清楚一些主要内容，写了一些无关内容；语法结构单调，词汇项目有限；有一些语法或词汇错误影响理解；较少使用连接成分，内容缺少连贯性。
0-2 分：未完成试题规定的任务；明显遗漏主要内容；语法结构单调、词汇有限；较多错误严重影响理解；信息未能传达给读者；或内容太少、无法看清、与题目要求无关。
说明：总分取整数；书写较差以致影响交际的酌情降低一档。`,
};

export function defaultConfig(): AppConfig {
  const preset = AI_PRESETS.qwen;
  return {
    browser: {
      mode: 'attach',
      cdpUrl: 'http://127.0.0.1:9222',
      channel: 'chrome',
      headless: false,
      userDataDir: './chrome-profile',
      gradingUrlHint: '',
    },
    platform: {
      adapter: 'generic',
      // 内置好分数（yue.haofenshu.com）阅卷页规则；其他平台可改 config.local.json
      urlPatterns: ['yue\\.haofenshu\\.com.*mark'],
      scoreRange: { min: 0, max: 15 },
      selectors: {
        essayImage: ['.subjectmark_content_svg svg', '.images-box', '.subjectmark_content_svg'],
        scorePanel: [],
        scoreButtonContainer: [],
        confirmButton: [],
        submitButton: [],
        autoSubmitToggle: [],
        questionNumber: [],
        studentIdentity: [],
        currentScore: [],
      },
      confirmTexts: ['确 定', '确定', '✓'],
      submitTexts: ['提交'],
      autoSubmitTexts: ['自动提交'],
      totalStudents: 0,
      nextEssayTimeoutMs: 120000,
      historyApi:
        'https://yue.haofenshu.com/filter/yue/v353/subject/block/review/history?subjectId={subjectId}&blockId={blockId}&type=normal&index={index}&isQuiz=false',
    },
    ai: {
      vision: {
        baseUrl: preset.vision.baseUrl,
        apiKey: '',
        model: preset.vision.model,
        temperature: 0.1,
      },
      grading: {
        baseUrl: preset.grading.baseUrl,
        apiKey: '',
        model: preset.grading.model,
        temperature: 0.2,
      },
      visionEnabled: true,
      mock: false,
      timeoutMs: 120000,
    },
    safety: {
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
    },
    ocr: { enabled: false, engine: 'tesseract', lang: 'eng' },
    capture: { maxDimension: 2048, grayscale: true, contrastBoost: 1.35, sharpen: true },
    calibration: { enabled: true, minSamples: 10, maxAdjust: 3, fewShotN: 5, window: 50 },
    rubric: { ...DEFAULT_RUBRIC },
    server: { host: '127.0.0.1', port: 8766 },
    logging: { dir: 'logs', keepImages: true },
  };
}
