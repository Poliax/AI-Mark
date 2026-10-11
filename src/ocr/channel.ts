/**
 * 传统 OCR 通道（可插拔）。
 * 默认 tesseract.js（纯 JS，离线包首次运行需联网下载语言数据）。
 * 手写体识别中 Vision LLM 为主通道，OCR 仅作交叉校验；OCR 失败不影响流程。
 */

export interface OcrResult {
  text: string;
  /** 0-1 */
  confidence: number;
  engine: string;
}

export interface OcrChannel {
  readonly engine: string;
  recognize(image: Buffer | string): Promise<OcrResult | null>;
}

export class NoopOcrChannel implements OcrChannel {
  readonly engine = 'none';
  async recognize(): Promise<OcrResult | null> {
    return null;
  }
}

export class TesseractOcrChannel implements OcrChannel {
  readonly engine = 'tesseract.js';
  constructor(private readonly lang = 'eng') {}

  async recognize(image: Buffer | string): Promise<OcrResult | null> {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(this.lang);
      try {
        const { data } = await worker.recognize(image as never);
        const text = (data.text ?? '').trim();
        if (!text) return null;
        return { text, confidence: Math.min(1, Math.max(0, data.confidence / 100)), engine: this.engine };
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      console.warn(`[ocr] tesseract 识别失败（已跳过，不影响视觉主通道）: ${(e as Error).message}`);
      return null;
    }
  }
}

export function createOcrChannel(enabled: boolean, engine: string, lang: string): OcrChannel {
  if (!enabled || engine === 'none') return new NoopOcrChannel();
  if (engine === 'tesseract') return new TesseractOcrChannel(lang);
  return new NoopOcrChannel();
}
