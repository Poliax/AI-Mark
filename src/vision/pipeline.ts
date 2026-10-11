import type { EssayRecognition } from '../types/contracts.js';
import type { VisionClient } from './client.js';
import type { OcrChannel } from '../ocr/channel.js';

/**
 * 作文识别管线：图像 → (OCR) + Vision LLM 复核 → 最终文本 + 置信度。
 * Vision 为主通道（手写体识别强），OCR 为交叉校验通道（可关闭）。
 * 必须保留 original_image / ocr_text / vision_text / final_text / confidence（§6）。
 */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 归一化模型文本：把字面 \n 还原为换行（GLM 常见输出习惯），统一换行符 */
export function normalizeText(t: string): string {
  return t.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

/** 词级重合度（Jaccard），用于衡量 OCR 与 Vision 两个通道的一致性 */
export function wordOverlap(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z']+/g) ?? []);
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface RecognizeInput {
  imageBase64: string;
  originalImagePath: string;
  vision: VisionClient;
  ocr: OcrChannel | null;
  /** 外部中止信号（暂停按钮立即中止识别） */
  signal?: AbortSignal;
}

export async function recognizeEssay(input: RecognizeInput): Promise<EssayRecognition> {
  const [visionResult, ocrResult] = await Promise.all([
    input.vision.transcribeEssay(input.imageBase64, input.signal),
    input.ocr ? input.ocr.recognize(Buffer.from(input.imageBase64, 'base64')) : Promise.resolve(null),
  ]);

  const warnings: string[] = [];
  const visionText = normalizeText(visionResult.text);
  let confidence = visionResult.confidence;
  let agreement: number | null = null;

  if (ocrResult && ocrResult.text.trim()) {
    agreement = wordOverlap(ocrResult.text, visionText);
    if (agreement >= 0.4) {
      // 两通道基本一致：信任视觉通道，置信度小幅上调
      confidence = clamp01(visionResult.confidence * (0.7 + 0.3 * agreement));
    } else {
      // 两通道分歧大：以视觉通道为准，但强制压低置信度并告警
      confidence = clamp01(visionResult.confidence * 0.5);
      warnings.push(`OCR 与视觉模型分歧较大（重合度 ${agreement.toFixed(2)}），请人工核对转录文本`);
    }
  }

  if (visionText.includes('未识别到作文内容')) {
    confidence = 0;
    warnings.push('视觉模型报告：图片中未识别到作文内容');
  }

  return {
    original_image: input.originalImagePath,
    ocr_text: ocrResult?.text ?? null,
    vision_text: visionText,
    final_text: visionText,
    confidence: clamp01(confidence),
    agreement,
    model_versions: { ocr: ocrResult?.engine ?? null, vision: visionResult.model },
    warnings,
  };
}
