import { TRANSCRIBE_JSON_PROMPT } from './prompts.js';
import type { AiProviderConfig } from '../config/schema.js';
import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';

/** 视觉模型转录结果 */
export interface VisionTranscript {
  text: string;
  /** 模型自评转录置信度 0-1 */
  confidence: number;
  raw: string;
  model: string;
}

export interface VisionClient {
  readonly model: string;
  transcribeEssay(imageBase64: string, externalSignal?: AbortSignal): Promise<VisionTranscript>;
}

const transcriptSchema = z.object({
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 从模型输出中尽量提取 JSON（模型可能加 markdown 围栏、前后缀，或输出有瑕疵的 JSON） */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates: string[] = [];
  // 剥掉 ```json ... ``` 围栏
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]!.trim());
  candidates.push(trimmed);
  for (const c of candidates) {
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const slice = c.slice(start, end + 1);
      try {
        return JSON.parse(slice) as Record<string, unknown>;
      } catch {
        try {
          // 自动修复 LLM 常见 JSON 瑕疵（未转义换行、尾逗号、缺失引号等）
          return JSON.parse(jsonrepair(slice)) as Record<string, unknown>;
        } catch {
          /* 继续尝试下一个候选 */
        }
      }
    }
  }
  return null;
}

/**
 * OpenAI 兼容接口的视觉客户端。
 * 适配 DashScope(qwen-vl-max)/智谱 GLM-4V/OpenAI/Ollama 等所有 /chat/completions 兼容服务。
 */
export class OpenAICompatVisionClient implements VisionClient {
  readonly model: string;
  constructor(
    private readonly cfg: AiProviderConfig,
    private readonly timeoutMs: number,
  ) {
    this.model = cfg.model;
  }

  async transcribeEssay(imageBase64: string, externalSignal?: AbortSignal): Promise<VisionTranscript> {
    if (!this.cfg.apiKey && !this.cfg.baseUrl.includes('127.0.0.1') && !this.cfg.baseUrl.includes('localhost')) {
      throw new Error(
        `未配置视觉模型 API Key（模型 ${this.cfg.model}）。请在 .env 中填写 DASHSCOPE_API_KEY 或 AI_VISION_API_KEY，或使用演示模式（--mock）。`,
      );
    }
    const body = {
      model: this.cfg.model,
      temperature: this.cfg.temperature,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: TRANSCRIBE_JSON_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
    };

    // 超时信号 + 外部中止信号（暂停按钮可立即中止识别）
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
      if (signal.aborted) throw new Error('已中止（教师请求暂停或超时）');
      throw new Error(`视觉模型请求失败（${this.cfg.model}）: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `视觉模型接口返回 ${res.status}（${this.cfg.model}）: ${errText.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : normalizeContentParts(content);
    const raw = text.trim();
    const parsed = extractJsonObject(raw);
    if (parsed) {
      const v = transcriptSchema.safeParse(parsed);
      if (v.success) {
        return { text: v.data.text.trim(), confidence: clamp01(v.data.confidence ?? 0.9), raw, model: this.cfg.model };
      }
    }
    // 兜底：把整个返回当作作文正文（纯文本输出），置信度保守取 0.7
    if (raw.length > 0) {
      return { text: raw, confidence: 0.7, raw, model: this.cfg.model };
    }
    throw new Error(`视觉模型未返回可用内容（${this.cfg.model}）`);
  }
}

function normalizeContentParts(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'object' && p !== null && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('\n');
  }
  return String(content ?? '');
}

/** mock 视觉客户端（演示/测试；返回固定作文，模拟识别结果） */
export class MockVisionClient implements VisionClient {
  readonly model = 'mock-vision';
  constructor(private readonly text: string = MOCK_ESSAY_TEXT, private readonly confidence = 0.92) {}
  async transcribeEssay(): Promise<VisionTranscript> {
    return { text: this.text, confidence: this.confidence, raw: '', model: this.model };
  }
}

/** 创建视觉客户端（mock 或 OpenAI 兼容实现） */
export function createVisionClient(cfg: { mock: boolean; vision: AiProviderConfig; timeoutMs: number }): VisionClient {
  return cfg.mock ? new MockVisionClient() : new OpenAICompatVisionClient(cfg.vision, cfg.timeoutMs);
}

export const MOCK_ESSAY_TEXT = `Dear Peter,

I'm glad to hear that you are interested in traditional Chinese festivals. Let me introduce the Mid-Autumn Festival to you.

The Mid-Autumn Festival falls on the 15th day of the eighth lunar month. On that day, family members get together and enjoy a big dinner. After dinner, we usually sit in the yard, eating mooncakes and admiring the full moon. Mooncakes are round, which stands for reunion and happiness.

Besides, people often tell the story of Chang'e to children. It is one of the most beautiful legends in China.

I hope you can come to China and celebrate the festival with us one day.

Yours,
Li Hua`;
