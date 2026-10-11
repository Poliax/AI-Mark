import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appConfigSchema, type AppConfig } from './schema.js';
import { defaultConfig } from './defaults.js';

/** 深度合并：仅覆盖提供的键 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || Array.isArray(override)) {
    return (Array.isArray(override) ? override : base) as T;
  }
  if (typeof base === 'object' && typeof override === 'object' && !Array.isArray(override)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = deepMerge((base as Record<string, unknown>)[k], v);
    }
    return out as T;
  }
  return (override as T) ?? base;
}

export interface LoadConfigOptions {
  /** 工作目录（config.local.json 与 logs/ 等相对路径的基准） */
  cwd?: string;
  /** 额外的 JSON 配置文件路径 */
  configFile?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 加载配置：默认值 → config.local.json → 传入 configFile → .env 环境变量 → zod 校验。
 * 校验失败会抛出带中文说明的错误。
 */
export function loadConfig(opts: LoadConfigOptions = {}): AppConfig {
  const cwd = opts.cwd ?? process.cwd();
  // 未显式传入 env 时，加载项目根目录的 .env（Node >= 20.12 内置）
  if (opts.env === undefined) {
    const envFile = path.join(cwd, '.env');
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* 无 .env 文件时忽略 */
    }
  }
  const env = opts.env ?? process.env;

  let cfg: unknown = defaultConfig();

  // 1. .env 环境变量（作为回退层；面板保存到 config.local.json 的值优先）
  const genericKey = env.DASHSCOPE_API_KEY?.trim() || env.ZHIPU_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  {
    const vision = (cfg as AppConfig).ai.vision;
    const grading = (cfg as AppConfig).ai.grading;
    if (genericKey) {
      vision.apiKey = env.AI_VISION_API_KEY?.trim() || vision.apiKey || genericKey;
      grading.apiKey = env.AI_GRADING_API_KEY?.trim() || grading.apiKey || genericKey;
    }
    if (env.AI_VISION_BASE_URL) vision.baseUrl = env.AI_VISION_BASE_URL;
    if (env.AI_VISION_MODEL) vision.model = env.AI_VISION_MODEL;
    if (env.AI_VISION_API_KEY) vision.apiKey = env.AI_VISION_API_KEY;
    if (env.AI_GRADING_BASE_URL) grading.baseUrl = env.AI_GRADING_BASE_URL;
    if (env.AI_GRADING_MODEL) grading.model = env.AI_GRADING_MODEL;
    if (env.AI_GRADING_API_KEY) grading.apiKey = env.AI_GRADING_API_KEY;
  }

  // 2. config.local.json（优先级最高：面板保存的 AI 设置写在这里）
  const localFile = opts.configFile ?? path.join(cwd, 'config.local.json');
  if (opts.configFile || existsSync(localFile)) {
    if (!existsSync(localFile)) {
      throw new Error(`配置文件不存在: ${localFile}（可运行 npm run init 生成示例配置）`);
    }
    try {
      cfg = deepMerge(cfg, JSON.parse(readFileSync(localFile, 'utf-8')));
    } catch (e) {
      throw new Error(`配置文件解析失败 ${localFile}: ${(e as Error).message}`);
    }
  }

  // 3. 文件里为空的 apiKey 回退到环境变量
  {
    const ai = (cfg as AppConfig).ai;
    ai.vision.apiKey = ai.vision.apiKey || env.AI_VISION_API_KEY?.trim() || genericKey || '';
    ai.grading.apiKey = ai.grading.apiKey || env.AI_GRADING_API_KEY?.trim() || genericKey || '';
  }

  const parsed = appConfigSchema.safeParse(cfg);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`配置校验失败:\n${issues}`);
  }
  return parsed.data;
}

/** 将更新后的评分标准写回 config.local.json（保留其他配置） */
export function saveRubricToLocal(cwd: string, rubric: AppConfig['rubric']): string {
  const file = path.join(cwd, 'config.local.json');
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
  existing.rubric = rubric;
  writeFileSync(file, JSON.stringify(existing, null, 2), 'utf-8');
  return file;
}

/** 将更新后的 AI 设置写回 config.local.json（面板修改后持久化，重启仍生效） */
export function saveAiToLocal(cwd: string, ai: AppConfig['ai']): string {
  const file = path.join(cwd, 'config.local.json');
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
  existing.ai = ai;
  writeFileSync(file, JSON.stringify(existing, null, 2), 'utf-8');
  return file;
}

/** 生成示例配置文件（不含 ai 段：让 .env 控制模型与 Key；面板保存时会自动写入 ai 段） */
export function writeExampleConfig(cwd: string, overwrite = false): string {
  const file = path.join(cwd, 'config.local.json');
  if (existsSync(file) && !overwrite) return file;
  const base = defaultConfig() as unknown as Record<string, unknown>;
  delete base.ai;
  writeFileSync(file, JSON.stringify(base, null, 2), 'utf-8');
  return file;
}
