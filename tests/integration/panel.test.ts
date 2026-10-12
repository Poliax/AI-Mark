import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlServer } from '../../src/server/server.js';
import { buildPanelScript } from '../../src/ui/panel_script.js';
import type { AgentStatus, Rubric } from '../../src/types/contracts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/grading-page.html');

/** §16 控制面板：注入式悬浮面板 + 独立面板页 + 命令通道 */
describe('ControlServer + 悬浮面板', () => {
  let browser: Browser;
  let page: Page;
  let server: ControlServer;
  const commands: string[] = [];
  let statusPayload: AgentStatus;
  let rubric: Rubric;
  let aiView: { mock: boolean; vision: { baseUrl: string; model: string; apiKey: string }; grading: { baseUrl: string; model: string; apiKey: string } };
  let aiSet: unknown = null;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(`file://${FIXTURE}`);

    statusPayload = {
      state: 'GRADE',
      mode: 'dry-run',
      phase: 1,
      dry_run: true,
      student_index: 3,
      total_students: 100,
      completed: 2,
      question_number: 66,
      current_score: null,
      ai_score: 13,
      max_score: 15,
      confidence: 0.94,
      verdict: 'auto',
      suggestion: '建议点击：13',
      last_message: null,
      auto_submit_state: 'off',
      progress: null,
      exam_info: null,
      teacher_score: null,
      student_kaohao: null,
      page_ready: true,
      auto_watch: false,
      ai_key_configured: true,
      calibration: { enabled: true, sample_count: 12, avg_deviation: 0.5, min_samples: 10 },
      target: { url: page.url(), title: '', student_identity: '考生：王小明　考号：20260001' },
      last_record_id: '0003',
      records: [],
    };
    rubric = { id: 'r1', title: '测试', max_score: 15, description: '标准描述', question: '题目' };
    aiView = {
      mock: false,
      vision: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash', apiKey: '433416…3rtv' },
      grading: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: '433416…3rtv' },
    };

    server = new ControlServer(
      {
        getStatus: () => ({ ...statusPayload, paused_reason: null, last_error: null }),
        getRubric: () => rubric,
        setRubric: (r) => {
          rubric = r;
        },
        getAi: () => aiView,
        setAi: (p) => {
          aiSet = p;
        },
        getCalibration: () => ({ enabled: true, sample_count: 12, avg_deviation: 0.5, min_samples: 10 }),
        resetCalibration: () => {
          commands.push('calibration_reset');
        },
        setAutoWatch: (enabled) => {
          commands.push(enabled ? 'auto_watch_on' : 'auto_watch_off');
        },
        onCommand: (c) => commands.push(c),
        getRecordImage: () => null,
        listRecords: () => [],
        onLog: () => {},
      },
      0,
      '127.0.0.1',
    );
    await server.start();
  });

  afterAll(async () => {
    await server.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it('注入 shadow DOM 面板，状态正确渲染，不遮挡右侧评分区（左上角）', async () => {
    await page.evaluate(buildPanelScript(server.origin));
    await page.waitForFunction(
      () => document.getElementById('__essay_agent_panel_host__')?.shadowRoot?.getElementById('st'),
      undefined,
      { timeout: 5000 },
    );
    await page.waitForFunction(
      (want) => {
        const el = document
          .getElementById('__essay_agent_panel_host__')
          ?.shadowRoot?.getElementById('st');
        return el && el.textContent === want;
      },
      'AI 评分',
      { timeout: 5000 },
    );
    const host = page.locator('#__essay_agent_panel_host__');
    const box = await host.boundingBox();
    expect(box).not.toBeNull();
    // 默认左上角（不遮挡右侧评分区）
    expect(box!.x).toBeLessThan(300);
    expect(box!.y).toBeLessThan(200);
    // DRY RUN 徽标
    expect(
      await page.evaluate(() => {
        const root = document.getElementById('__essay_agent_panel_host__')!.shadowRoot!;
        return { mode: root.getElementById('mode')!.textContent, score: root.getElementById('score')!.textContent };
      }),
    ).toEqual({ mode: 'DRY RUN', score: '13 / 15' });
  });

  it('面板按钮通过 /api/command 送达控制服务', async () => {
    await page.evaluate(() => {
      const root = document.getElementById('__essay_agent_panel_host__')!.shadowRoot!;
      (root.getElementById('b-pause') as HTMLButtonElement).click();
    });
    await page.waitForFunction(() => true, undefined, { timeout: 0 });
    const deadline = Date.now() + 5000;
    while (!commands.includes('pause') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(commands).toContain('pause');
  });

  it('评分标准可通过面板保存到服务端', async () => {
    await page.evaluate(() => {
      const root = document.getElementById('__essay_agent_panel_host__')!.shadowRoot!;
      (root.getElementById('rd') as HTMLTextAreaElement).value = '新的评分标准描述';
      (root.getElementById('rq') as HTMLInputElement).value = '新的题目';
      (root.getElementById('rsave') as HTMLButtonElement).click();
    });
    const deadline = Date.now() + 5000;
    while (rubric.description !== '新的评分标准描述' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(rubric.description).toBe('新的评分标准描述');
    expect(rubric.question).toBe('新的题目');
  });

  it('独立面板页可访问且包含全部控制按钮', async () => {
    const html = await (await fetch(`${server.origin}/panel`)).text();
    for (const id of ['b-start', 'b-pause', 'b-cont', 'b-manual', 'b-reid', 'b-regrade', 'b-skip', 'b-stop', 'rsave']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('AI 英语作文阅卷助手');
  });

  it('/api/status 与 /api/records 正常响应', async () => {
    const s = (await (await fetch(`${server.origin}/api/status`)).json()) as AgentStatus;
    expect(s.state).toBe('GRADE');
    expect(s.dry_run).toBe(true);
    const r = (await (await fetch(`${server.origin}/api/records`)).json()) as { records: unknown[] };
    expect(r.records).toEqual([]);
  });

  it('面板可读取并修改大模型设置（/api/ai，Key 脱敏）', async () => {
    const view = (await (await fetch(`${server.origin}/api/ai`)).json()) as typeof aiView;
    expect(view.vision.model).toBe('glm-4v-flash');
    expect(view.vision.apiKey).toContain('…'); // 脱敏
    expect(view.vision.apiKey).not.toContain('43341659d7fe4d49943bb050f4ae5e4c');

    const body = {
      vision: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max', apiKey: 'sk-new-key' },
      grading: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', apiKey: 'sk-new-key' },
    };
    const res = await fetch(`${server.origin}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.ok).toBe(true);
    expect(aiSet).toEqual(body);
  });
});
