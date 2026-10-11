import { describe, it, expect } from 'vitest';
import { LlmGradingModel, GradingError, MockGradingModel } from '../../src/grading/engine.js';
import type { GradeInput } from '../../src/grading/engine.js';

const input: GradeInput = {
  essay: 'Dear Peter, I am glad to introduce the Mid-Autumn Festival to you.',
  question: '给笔友写一封信介绍中国传统节日',
  rubric: {
    id: 'r1',
    title: '测试评分标准',
    max_score: 15,
    description: '第四档 13-15 分：完全完成任务……',
    question: '',
  },
};

describe('LlmGradingModel.parse（评分引擎纯函数）', () => {
  const model = new LlmGradingModel(
    { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'x', model: 'test', temperature: 0.2 },
    1000,
  );

  it('解析合法 JSON 输出', () => {
    const r = model.parse(
      '```json\n{"score":13,"level":"第三档(好)(10-12分)","confidence":0.94,"content_analysis":"完成","language_analysis":"良好","organization_analysis":"紧凑","grammar_errors":[{"sentence":"x","issue":"y","suggestion":"z"}],"teacher_comment":"不错"}\n```',
      input,
    );
    expect(r.score).toBe(13);
    expect(r.max_score).toBe(15);
    expect(r.confidence).toBeCloseTo(0.94);
    expect(r.grammar_errors).toHaveLength(1);
    expect(r.rubric_version).toBe('r1');
  });

  it('分数越界钳制到 0..max', () => {
    const r = model.parse('{"score":20,"confidence":0.9}', input);
    expect(r.score).toBe(15);
    const r2 = model.parse('{"score":-3,"confidence":0.9}', input);
    expect(r2.score).toBe(0);
  });

  it('缺失可选字段不报错', () => {
    const r = model.parse('{"score":10,"confidence":0.8}', input);
    expect(r.score).toBe(10);
    expect(r.level).toContain('档位未标注');
  });

  it('无法解析时抛 GradingError（绝不猜分）', () => {
    expect(() => model.parse('抱歉，我无法评分。', input)).toThrow(GradingError);
    expect(() => model.parse('{"score": "abc"}', input)).toThrow(GradingError);
  });

  it('自动修复 LLM 常见 JSON 瑕疵（未转义换行/尾逗号）', () => {
    const broken =
      '{"score": 12, "level": "第三档", "confidence": 0.88,\n' +
      '"teacher_comment": "优点明显。\n不足之处在于语法。"\n}';
    const r = model.parse(broken, input);
    expect(r.score).toBe(12);
    expect(r.teacher_comment).toContain('优点明显');
    const trailing = '{"score": 10, "confidence": 0.9,}';
    expect(model.parse(trailing, input).score).toBe(10);
  });

  it('mock 评分模型确定性输出', async () => {
    const m = new MockGradingModel(13, 0.95);
    const r = await m.grade(input);
    expect(r.score).toBe(13);
    expect(r.confidence).toBe(0.95);
    expect(r.model_version).toBe('mock-v1');
  });
});
