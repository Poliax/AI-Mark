import { describe, it, expect } from 'vitest';
import { recognizeEssay, wordOverlap } from '../../src/vision/pipeline.js';
import { MockVisionClient } from '../../src/vision/client.js';

const fakeOcr = (text: string) => ({
  engine: 'fake',
  recognize: async () => ({ text, confidence: 0.8, engine: 'fake' }),
});

describe('作文识别管线（§6）', () => {
  it('保留 original_image/ocr_text/vision_text/final_text/confidence 五要素', async () => {
    const vision = new MockVisionClient('Dear Peter, I am glad to hear from you.', 0.92);
    const r = await recognizeEssay({
      imageBase64: Buffer.from('fake').toString('base64'),
      originalImagePath: 'logs/x/original-0001.png',
      vision,
      ocr: null,
    });
    expect(r.original_image).toBe('logs/x/original-0001.png');
    expect(r.ocr_text).toBeNull();
    expect(r.vision_text).toContain('Dear Peter');
    expect(r.final_text).toBe(r.vision_text);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('OCR 与视觉一致 → 置信度上调；分歧大 → 压低并告警', async () => {
    const essayText = 'Dear Peter, I am glad to hear from you. This is my plan for the holiday.';
    const vision = new MockVisionClient(essayText, 0.9);
    const agree = await recognizeEssay({
      imageBase64: 'fake',
      originalImagePath: 'p',
      vision,
      ocr: fakeOcr(essayText),
    });
    expect(agree.agreement!).toBeGreaterThan(0.8);
    expect(agree.confidence).toBeGreaterThan(0.8);

    const disagree = await recognizeEssay({
      imageBase64: 'fake',
      originalImagePath: 'p',
      vision,
      ocr: fakeOcr('completely different words about mathematics and physics'),
    });
    expect(disagree.warnings.length).toBeGreaterThan(0);
    expect(disagree.confidence).toBeLessThan(0.5);
    // 最终文本仍以视觉通道为准
    expect(disagree.final_text).toBe(essayText);
  });

  it('wordOverlap 计算两段文本词级重合度', () => {
    expect(wordOverlap('a b c', 'a b c')).toBe(1);
    expect(wordOverlap('a b c', 'x y z')).toBe(0);
    expect(wordOverlap('', 'x')).toBe(0);
  });
});
