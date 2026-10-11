import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { mkdtempSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/index.js';
import { createAdapter } from '../../src/automation/platform_adapter.js';
import { createLogger } from '../../src/logging/logger.js';
import { CalibrationStore } from '../../src/grading/calibration.js';
import { Agent } from '../../src/agent/agent.js';
import { StateMachine } from '../../src/state_machine/machine.js';
import { assertCanAutoSubmit, assertCanClickScore, assertCanSubmit } from '../../src/automation/gates.js';
import type { AppConfig } from '../../src/config/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/grading-page.html');

/**
 * 第一阶段验收（§22）—— 在模拟阅卷平台上验证 9 条标准：
 * 1 识别阅卷页面 2 定位作文区域 3 截取作文 4 识别作文 5 按评分标准评分
 * 6 输出分数 7 输出置信度 8 定位分数按钮 9 DRY RUN 准确指出建议点击的按钮（不真实点击）
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.goto(`file://${FIXTURE}`);
  await page.waitForSelector('#essay-canvas');
}, 30000);

afterAll(async () => {
  await browser?.close().catch(() => {});
});

function buildStack(cfgOverrides: Partial<AppConfig> = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'essay-agent-test-'));
  const cfg = loadConfig({ cwd: tmp, env: {} });
  cfg.ai.mock = true;
  cfg.ocr.enabled = false;
  cfg.platform.nextEssayTimeoutMs = 3000;
  cfg.safety.expectedQuestionNumber = 66;
  Object.assign(cfg, cfgOverrides);
  const logger = createLogger(path.join(tmp, 'logs'));
  const adapter = createAdapter(cfg.platform);
  const calibrationStore = new CalibrationStore(path.join(tmp, 'data', 'calibration.jsonl'));
  const agent = new Agent({ page, adapter, config: cfg, logger, calibrationStore });
  const machine = new StateMachine(agent, {}, () => new Promise((r) => setTimeout(r, 5)));
  return { cfg, logger, adapter, agent, machine };
}

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('等待超时');
}

describe('§4 页面识别（PageAnalyzer）', () => {
  it('正确识别模拟阅卷页面', async () => {
    const { adapter } = buildStack();
    const a = await adapter.analyze(page);
    expect(a.is_grading_page).toBe(true);
    expect(a.question_number).toBe(66);
    expect(a.current_score).toBeNull();
    expect(a.has_submission_button).toBe(true);
    expect(a.has_score_panel).toBe(true);
    expect(a.has_essay_image).toBe(true);
    expect(a.auto_submit_state).toBe('off');
    expect(a.score_panel_scores).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(a.student_identity).toContain('王小明');
    // 左上角考试信息与进度（模拟好分数「高三英语 题块2 五.66 进度：1/2」）
    expect(a.exam_info).toEqual({ subject: '高三英语', block: 2, part: 5, question_number: 66 });
    expect(a.progress).toEqual({ done: 1, total: 2 });
  });

  it('检测教师已填分数', async () => {
    const { adapter } = buildStack();
    await page.getByRole('button', { name: '9', exact: true }).click();
    const a = await adapter.analyze(page);
    expect(a.current_score).toBe(9);
    await page.evaluate(() => {
      document.querySelectorAll('.score-btn').forEach((b) => b.classList.remove('selected'));
      document.getElementById('current-score-display')!.textContent = '当前分数：未评分';
    });
  });

  it('出现验证码/登录过期时识别为需人工介入并禁止评分', async () => {
    const { adapter } = buildStack();
    // 情况1：弹窗里的验证码/登录过期提示 → 判定为需要人工介入
    await page.evaluate(() => {
      const dlg = document.createElement('div');
      dlg.className = 'el-dialog';
      dlg.innerHTML = '<div>您的登录已过期，请重新登录并输入验证码</div>';
      document.body.appendChild(dlg);
    });
    try {
      const a = await adapter.analyze(page);
      expect(a.is_grading_page).toBe(false);
      expect(a.intervention_needed).not.toBeNull();
    } finally {
      await page.evaluate(() => {
        document.body.lastElementChild?.remove();
      });
    }

    // 情况2：页面普通文字只是提到「验证码」（如帮助链接）→ 不误报
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.textContent = '常见问题：如何通过短信验证码找回密码';
      document.body.appendChild(d);
    });
    try {
      const a = await adapter.analyze(page);
      expect(a.is_grading_page).toBe(true);
      expect(a.intervention_needed).toBeNull();
    } finally {
      await page.evaluate(() => {
        document.body.lastElementChild?.remove();
      });
    }
  });
});

describe('§8/§9 分数按钮定位与安全闸门', () => {
  it('正确定位 13 分按钮（role/text，无固定坐标）', async () => {
    const { adapter } = buildStack();
    const hit = await adapter.locateScoreButton(page, 13);
    expect(hit).not.toBeNull();
    expect(hit!.info.label).toBe('13');
    expect(['role', 'text', 'aria', 'selector']).toContain(hit!.info.method);
    expect(await hit!.locator.textContent()).toBe('13');
  });

  it('不存在的分数（99）返回 null，绝不瞎猜', async () => {
    const { adapter } = buildStack();
    expect(await adapter.locateScoreButton(page, 99)).toBeNull();
  });

  it('定位确认按钮 ✓ 与提交按钮', async () => {
    const { adapter } = buildStack();
    const confirm = await adapter.locateConfirm(page);
    expect(confirm).not.toBeNull();
    expect(await confirm!.textContent()).toContain('✓');
    const submit = await adapter.locateSubmit(page);
    expect(submit).not.toBeNull();
    expect(await submit!.textContent()).toContain('提交');
  });

  it('安全闸门默认全关：phase=1 禁止点击/提交/无人值守', () => {
    const { cfg } = buildStack();
    expect(() => assertCanClickScore(cfg.safety)).toThrow(/phase/);
    expect(() => assertCanSubmit(cfg.safety, 'off')).toThrow(/phase/);
    try {
      assertCanAutoSubmit(cfg.safety);
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('auto_submit_disabled');
    }
  });
});

describe('第一阶段验收：DRY RUN 全流程（不真实点击）', () => {
  it('完成两份作文的识别→评分→按钮定位高亮，全程零点击，日志完整（§15）', async () => {
    const { cfg, logger, machine, agent } = buildStack();
    const run = machine.run();
    machine.enqueue('start');

    // 学生 1：等待 DRY RUN 建议出现
    await waitFor(() => logger.getRecord(1)?.suggested_button === 13, 20000);
    const rec1 = logger.getRecord(1)!;

    // 等待进入「等待下一份」PAUSE；此期间高亮保持显示供教师核对（§18）
    await waitFor(() => machine.state === 'PAUSE', 15000);

    // §18 DRY RUN：高亮存在、按钮未被点击
    const highlighted = page.locator('[data-essay-agent-target]');
    expect(await highlighted.count()).toBe(1);
    expect(await highlighted.textContent()).toBe('13');
    expect(await page.locator('#current-score-display').textContent()).toBe('当前分数：未评分');
    expect(await page.locator('.score-btn.selected').count()).toBe(0);

    // §15 日志字段完整性
    expect(rec1.student_index).toBe(1);
    expect(rec1.question_number).toBe(66);
    expect(rec1.essay_image).toMatch(/original-0001\.png$/);
    expect(existsSync(path.join(logger.sessionDir, 'original-0001.png'))).toBe(true);
    expect(existsSync(path.join(logger.sessionDir, 'preprocessed-0001.png'))).toBe(true);
    expect(rec1.ocr_text).toBeNull(); // OCR 通道关闭（Vision 主通道）
    expect(rec1.vision_text).toContain('Mid-Autumn');
    expect(rec1.final_text).toBe(rec1.vision_text);
    expect(rec1.ai_score).toBe(13);
    expect(rec1.max_score).toBe(15);
    expect(rec1.confidence).toBeCloseTo(0.95);
    expect(rec1.recognition_confidence).toBeCloseTo(0.92);
    expect(rec1.rubric_version).toBe('template-15');
    expect(rec1.model_version).toBe('mock-v1');
    expect(rec1.suggested_button).toBe(13);
    expect(rec1.score_button_method).toMatch(/^(role|text|aria|selector):/);
    expect(rec1.action_log.map((e) => e.action)).toContain('dry_run_highlight');
    expect(rec1.final_teacher_score).toBeNull();
    // 提交被安全闸门拦截 → 等待教师（phase=1 默认策略）
    expect(rec1.submission_status).toBe('pending_teacher');
    expect(rec1.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec1.verdict.kind).toBe('auto');

    // 教师点击「下一份作文」→ 继续 → 学生 2 全流程
    await page.getByRole('button', { name: '下一份作文（模拟切换学生）' }).click();
    machine.enqueue('continue');
    await waitFor(() => logger.getRecord(2)?.suggested_button === 13, 20000);

    // 再次进入等待下一份的 PAUSE：学生 2 的建议高亮保持显示供教师核对
    await waitFor(() => machine.state === 'PAUSE', 15000);
    expect(await page.locator('[data-essay-agent-target]').count()).toBe(1);
    machine.enqueue('stop');
    await run;
    expect(machine.state).toBe('STOPPED');
    expect(agent.completed).toBe(2);

    const rec2 = logger.getRecord(2)!;
    expect(rec2.student_index).toBe(2);
    expect(rec2.question_number).toBe(66);
    // 全程没有任何分数按钮被真实点击
    expect(await page.locator('.score-btn.selected').count()).toBe(0);
    expect(await page.locator('#current-score-display').textContent()).toBe('当前分数：未评分');
    void cfg;
  }, 90000);
});
