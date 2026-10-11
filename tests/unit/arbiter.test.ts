import { describe, it, expect } from 'vitest';
import { arbitrate } from '../../src/arbiter/arbiter.js';
import { MockGradingModel } from '../../src/grading/engine.js';
import type { GradeInput } from '../../src/grading/engine.js';

const input: GradeInput = {
  essay: 'test essay',
  question: '',
  rubric: { id: 'r1', title: 't', max_score: 15, description: 'd', question: '' },
};

describe('arbiter 多模型仲裁（§8/§17）', () => {
  it('单模型：直接采用，分差为 null', async () => {
    const r = await arbitrate([new MockGradingModel(13, 0.95)], input);
    expect(r.modelsUsed).toBe(1);
    expect(r.final.score).toBe(13);
    expect(r.disagreement).toBeNull();
  });

  it('三模型：取中位数，计算最大分差', async () => {
    const r = await arbitrate(
      [new MockGradingModel(13, 0.95), new MockGradingModel(12, 0.9), new MockGradingModel(14, 0.92)],
      input,
    );
    expect(r.modelsUsed).toBe(3);
    expect(r.final.score).toBe(13);
    expect(r.disagreement).toBe(2);
    expect(r.final.confidence).toBeCloseTo(0.9); // 取最小置信度
  });

  it('分差 >= 3 由仲裁结果暴露（validateScore 负责强制人工）', async () => {
    const r = await arbitrate(
      [new MockGradingModel(10, 0.95), new MockGradingModel(14, 0.93), new MockGradingModel(12, 0.9)],
      input,
    );
    expect(r.disagreement).toBe(4);
    expect(r.final.score).toBe(12);
  });

  it('全部模型失败 → 抛错（状态机转入 PAUSE）', async () => {
    const broken = new MockGradingModel(10, 0.9);
    (broken as unknown as { grade: () => Promise<never> }).grade = () => Promise.reject(new Error('boom'));
    await expect(arbitrate([broken], input)).rejects.toThrow(/全部评分模型失败/);
  });
});
