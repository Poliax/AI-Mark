import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/index.js';

describe('config', () => {
  it('默认配置：DRY RUN 开启、无人值守提交禁止、phase=1、0-15 分', () => {
    const cfg = loadConfig({ cwd: mkdtempSync(path.join(os.tmpdir(), 'ea-')), env: {} });
    expect(cfg.safety.dryRun).toBe(true);
    expect(cfg.safety.phase).toBe(1);
    expect(cfg.safety.allowSubmit).toBe(false);
    expect(cfg.safety.allowAutoSubmit).toBe(false);
    expect(cfg.safety.minConfidenceAuto).toBeCloseTo(0.9);
    expect(cfg.safety.minConfidenceTeacherConfirm).toBeCloseTo(0.75);
    expect(cfg.safety.maxModelDisagreement).toBe(3);
    expect(cfg.platform.scoreRange).toEqual({ min: 0, max: 15 });
    expect(cfg.rubric.max_score).toBe(15);
    // Qwen 预设
    expect(cfg.ai.vision.model).toBe('qwen-vl-max');
    expect(cfg.ai.grading.model).toBe('qwen-plus');
  });

  it('config.local.json 合并覆盖 + 校验错误时抛中文错误', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ea-'));
    writeFileSync(
      path.join(dir, 'config.local.json'),
      JSON.stringify({ safety: { phase: 2, minConfidenceAuto: 0.95 }, platform: { totalStudents: 100 } }),
    );
    const cfg = loadConfig({ cwd: dir, env: {} });
    expect(cfg.safety.phase).toBe(2);
    expect(cfg.safety.minConfidenceAuto).toBeCloseTo(0.95);
    expect(cfg.safety.dryRun).toBe(true); // 未覆盖的保持默认
    expect(cfg.platform.totalStudents).toBe(100);

    writeFileSync(path.join(dir, 'config.local.json'), JSON.stringify({ safety: { phase: 9 } }));
    expect(() => loadConfig({ cwd: dir, env: {} })).toThrow(/配置校验失败/);
  });

  it('.env 环境变量覆盖模型与 Key', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ea-'));
    const cfg = loadConfig({
      cwd: dir,
      env: {
        DASHSCOPE_API_KEY: 'sk-test',
        AI_VISION_MODEL: 'qwen-vl-max-0809',
        AI_GRADING_BASE_URL: 'http://127.0.0.1:11434/v1',
      },
    });
    expect(cfg.ai.vision.apiKey).toBe('sk-test');
    expect(cfg.ai.grading.apiKey).toBe('sk-test');
    expect(cfg.ai.vision.model).toBe('qwen-vl-max-0809');
    expect(cfg.ai.grading.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('面板保存到 config.local.json 的 AI 设置优先于 .env（支持面板改 Key/模型）', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ea-'));
    writeFileSync(
      path.join(dir, 'config.local.json'),
      JSON.stringify({
        ai: {
          vision: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'file-key', model: 'glm-4v-flash' },
          grading: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'file-key', model: 'glm-4-flash' },
        },
      }),
    );
    const cfg = loadConfig({
      cwd: dir,
      env: { ZHIPU_API_KEY: 'env-key', AI_VISION_MODEL: 'env-model' },
    });
    expect(cfg.ai.vision.apiKey).toBe('file-key'); // 文件优先
    expect(cfg.ai.grading.apiKey).toBe('file-key');
    expect(cfg.ai.vision.model).toBe('glm-4v-flash');
  });

  it('config.local.json 的 ai.apiKey 为空时回退到 .env（init 生成的默认文件兼容）', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ea-'));
    writeFileSync(path.join(dir, 'config.local.json'), JSON.stringify({ ai: { vision: { apiKey: '' }, grading: { apiKey: '' } } }));
    const cfg = loadConfig({ cwd: dir, env: { ZHIPU_API_KEY: 'env-key' } });
    expect(cfg.ai.vision.apiKey).toBe('env-key');
    expect(cfg.ai.grading.apiKey).toBe('env-key');
  });
});
