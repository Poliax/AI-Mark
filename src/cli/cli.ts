#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig, saveRubricToLocal, saveAiToLocal, writeExampleConfig } from '../config/index.js';
import { connectBrowser, pickTargetPage, injectScriptAllPages } from '../browser/manager.js';
import { createAdapter } from '../automation/platform_adapter.js';
import { createLogger } from '../logging/logger.js';
import { CalibrationStore } from '../grading/calibration.js';
import { Agent } from '../agent/agent.js';
import { StateMachine } from '../state_machine/machine.js';
import { ControlServer } from '../server/server.js';
import { buildPanelScript } from '../ui/panel_script.js';
import type { AppConfig } from '../config/schema.js';

const CWD = process.cwd();

interface CommonOpts {
  config?: string;
  mode?: 'attach' | 'managed';
  cdp?: string;
  url?: string;
  port?: number;
  mock?: boolean;
  headless?: boolean;
  phase?: number;
  live?: boolean;
}

function parseCommonArgs(): CommonOpts {
  const { values } = parseArgs({
    args: process.argv.slice(3), // 跳过 node、脚本路径、子命令
    options: {
      config: { type: 'string' },
      mode: { type: 'string' },
      cdp: { type: 'string' },
      url: { type: 'string' },
      port: { type: 'string' },
      mock: { type: 'boolean', default: false },
      headless: { type: 'boolean', default: false },
      phase: { type: 'string' },
      live: { type: 'boolean', default: false }, // 关闭 DRY RUN（危险）
    },
  });
  return {
    config: values.config,
    mode: values.mode as CommonOpts['mode'],
    cdp: values.cdp,
    url: values.url,
    port: values.port ? Number(values.port) : undefined,
    mock: values.mock,
    headless: values.headless,
    phase: values.phase ? Number(values.phase) : undefined,
    live: values.live,
  };
}

function buildConfig(opts: CommonOpts): AppConfig {
  const cfg = loadConfig({ cwd: CWD, configFile: opts.config });
  if (opts.mode) cfg.browser.mode = opts.mode;
  if (opts.cdp) cfg.browser.cdpUrl = opts.cdp;
  if (opts.url) cfg.browser.gradingUrlHint = opts.url;
  if (opts.headless) cfg.browser.headless = true;
  if (opts.port) cfg.server.port = opts.port;
  if (opts.mock) cfg.ai.mock = true;
  if (opts.phase !== undefined) {
    if (![1, 2, 3, 4, 5].includes(opts.phase)) throw new Error('--phase 必须是 1-5');
    cfg.safety.phase = opts.phase as 1 | 2 | 3 | 4 | 5;
  }
  if (opts.live) {
    console.warn('⚠️  已关闭 DRY RUN（--live）。请确认已经过 DRY RUN 验收且页面元素定位完全正确。');
    cfg.safety.dryRun = false;
  }
  return cfg;
}

async function main(): Promise<void> {
  const [cmd] = process.argv.slice(2);
  if (!cmd || cmd.startsWith('-')) {
    console.log(usage());
    return;
  }
  switch (cmd) {
    case 'init':
      return init();
    case 'check':
      return checkEnv();
    case 'start':
      return start(parseCommonArgs());
    case 'analyze':
      return analyzeOnce(parseCommonArgs());
    default:
      console.log(`未知命令: ${cmd}\n${usage()}`);
  }
}

function usage(): string {
  return `AI 英语作文阅卷助手（essay-agent）

用法:
  npm run init            生成 config.local.json 配置
  npm run check           环境自检
  npm run start [选项]    启动自动阅卷 Agent
  npm run analyze [选项]  一次性分析当前页面（第一阶段验收用）
  npm run demo            本地模拟平台演示（DRY RUN，无需 API Key）

start/analyze 选项:
  --mode attach|managed   接管已登录 Chrome(attach, 默认) / 程序自开 Chrome(managed)
  --cdp <url>             Chrome 调试端口地址（默认 http://127.0.0.1:9222）
  --url <片段>            阅卷页 URL 提示，用于自动选择目标标签页
  --port <n>              本地控制面板端口（默认 8766）
  --mock                  演示模式：不调用真实大模型 API
  --headless              无头模式（调试用）
  --phase <1-5>           覆盖开发阶段（默认 1：只读识别评分，不点击）
  --live                  ⚠️ 关闭 DRY RUN（仅当 DRY RUN 验收通过后使用）`;
}

async function init(): Promise<void> {
  const f = writeExampleConfig(CWD, false);
  console.log(`已生成示例配置: ${path.relative(CWD, f)}`);
  console.log('请编辑该文件（评分标准/平台 selector/安全参数），并在 .env 中填写 API Key（参考 .env.example）。');
  console.log('注意：默认 DRY RUN 开启、阶段=1，不会发生任何真实点击或提交。');
}

async function checkEnv(): Promise<void> {
  const cfg = loadConfig({ cwd: CWD });
  const ok = (label: string, pass: boolean, detail: string) =>
    console.log(`${pass ? '✓' : '✗'} ${label}: ${detail}`);
  // 浏览器
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    await browser.close();
    ok('本机 Chrome', true, '可启动（channel=chrome）');
  } catch (e) {
    ok('本机 Chrome', false, (e as Error).message);
  }
  // API Key / mock
  if (cfg.ai.mock) ok('大模型', true, 'mock 演示模式');
  else {
    const key = cfg.ai.vision.apiKey || cfg.ai.grading.apiKey;
    ok('API Key', !!key, key ? `已配置（视觉=${cfg.ai.vision.model}，评分=${cfg.ai.grading.model}）` : '未配置 ZHIPU_API_KEY / DASHSCOPE_API_KEY / AI_*_API_KEY');
  }
  // 安全状态
  ok('DRY RUN', cfg.safety.dryRun, cfg.safety.dryRun ? '开启（只高亮不点击）' : '已关闭（--live）');
  ok('开发阶段', true, `phase=${cfg.safety.phase}（${['', '只读识别评分', '允许点击分数', '确认+教师确认后提交', '批量阅卷', '多模型仲裁'][cfg.safety.phase] ?? ''}）`);
  ok('无人值守提交', !cfg.safety.allowAutoSubmit, cfg.safety.allowAutoSubmit ? '已开启（开发阶段禁止）' : '禁止');
  // 夹具
  const fixture = path.join(CWD, 'tests/fixtures/grading-page.html');
  ok('测试夹具', existsSync(fixture), existsSync(fixture) ? '存在' : '缺失');
  ok('配置文件', existsSync(path.join(CWD, 'config.local.json')), 'config.local.json');
}

async function analyzeOnce(opts: CommonOpts): Promise<void> {
  const cfg = buildConfig(opts);
  const connected = await connectBrowser(cfg.browser);
  try {
    let page = pickTargetPage(connected.context, {
      gradingUrlHint: cfg.browser.gradingUrlHint,
      urlPatterns: cfg.platform.urlPatterns,
    });
    if (!page && connected.mode === 'managed') {
      // managed 模式自开窗口：直接导航到提示 URL（测试/本地文件场景）
      page = await connected.context.newPage();
      await page.goto(cfg.browser.gradingUrlHint || 'about:blank').catch(() => {});
    }
    if (!page) throw new Error('没有找到可分析的页面。请先打开阅卷平台页面。');
    const adapter = createAdapter(cfg.platform);
    const analysis = await adapter.analyze(page);
    console.log(JSON.stringify(analysis, null, 2));
    console.log(`\n结论: ${analysis.is_grading_page ? '✓ 确认为阅卷页面' : '✗ 无法确认为阅卷页面（禁止自动评分）'}`);
    if (analysis.intervention_needed) {
      console.log(`⚠️ 需要人工处理: ${analysis.intervention_needed.detail}`);
    }
  } finally {
    await connected.close();
  }
}

async function start(opts: CommonOpts): Promise<void> {
  const cfg = buildConfig(opts);
  console.log(`[agent] 浏览器模式: ${cfg.browser.mode}（${cfg.browser.mode === 'attach' ? cfg.browser.cdpUrl : cfg.browser.userDataDir}）`);
  console.log(`[agent] 安全: DRY RUN=${cfg.safety.dryRun} phase=${cfg.safety.phase} 提交=${cfg.safety.allowSubmit} 无人值守=${cfg.safety.allowAutoSubmit}`);
  console.log(`[agent] 模型: 视觉=${cfg.ai.mock ? 'mock' : cfg.ai.vision.model} 评分=${cfg.ai.mock ? 'mock' : cfg.ai.grading.model}${cfg.ai.mock ? '' : (cfg.ai.vision.apiKey ? '（已配置 Key）' : '（未配置 Key！）')}`);
  console.log(`[agent] 评分标准: ${cfg.rubric.title}（满分 ${cfg.rubric.max_score}）`);
  if (!cfg.ai.mock && !cfg.ai.vision.apiKey && !cfg.ai.grading.apiKey) {
    throw new Error('未配置大模型 API Key。请填写 .env（参考 .env.example），或用 --mock 演示。');
  }

  const connected = await connectBrowser(cfg.browser);
  let page = pickTargetPage(connected.context, {
    gradingUrlHint: cfg.browser.gradingUrlHint,
    urlPatterns: cfg.platform.urlPatterns,
  });
  if (!page) throw new Error('没有找到目标页面。请先在浏览器中打开阅卷平台页面。');
  console.log(`[agent] 目标页面: ${page.url()}`);

  const logger = createLogger(path.join(CWD, cfg.logging.dir));
  const adapter = createAdapter(cfg.platform);
  // 教师尺度校准数据（学习教师实际打分；按评分标准隔离，见 data/calibration-*.jsonl）
  const calibrationStore = new CalibrationStore(path.join(CWD, 'data', 'calibration.jsonl'));

  const agent = new Agent({ page, adapter, config: cfg, logger, calibrationStore });
  // 监听平台接口：实时读取当前学生的教师打分/考号（翻页自动更新）
  agent.attachPlatformListener();
  // 启动即读取页面信息：面板「本页考试/平台进度」与页面左上角对应
  await agent.refreshPageInfo().catch(() => {});
  // 刷新一次页面：让平台自己发起学生数据请求，监听器借此拿到当前学生的教师打分/考号
  const syncStudentInfo = async () => {
    try {
      await page!.reload({ waitUntil: 'domcontentloaded' });
    } catch {
      /* 刷新失败不影响使用 */
    }
    await new Promise((r) => setTimeout(r, 3000));
  };
  await syncStudentInfo();
  if (agent.status('IDLE').teacher_score === null) {
    console.log('[agent] 未读到教师打分，重试一次…');
    await syncStudentInfo();
  }
  console.log(
    agent.status('IDLE').teacher_score !== null
      ? `[agent] 已同步当前学生信息（考号 ${agent.status('IDLE').student_kaohao}，教师打分 ${agent.status('IDLE').teacher_score}）`
      : '[agent] 当前页面暂无教师打分（翻页后会自动读取）',
  );
  const machine = new StateMachine(agent, {
    onState: (s) => {
      server.broadcast();
      if (s === 'PAUSE') console.log(`[agent] ⏸ 已暂停: ${machine.lastError ?? machine.pausedReasonText ?? ''}`);
      else console.log(`[agent] → ${s}`);
    },
    onPause: (reason) => console.warn(`[agent] ⚠️ ${reason}`),
    onMessage: (m) => console.log(`[agent] ${m}`),
  });

  const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k ? '••••' : '');
  const server = new ControlServer(
    {
      getStatus: () => ({
        ...agent.status(machine.state),
        paused_reason: machine.pausedReasonText,
        last_error: machine.lastError,
      }),
      getRubric: () => cfg.rubric,
      setRubric: (r) => {
        cfg.rubric = r;
        saveRubricToLocal(CWD, r);
      },
      getAi: () => ({
        mock: cfg.ai.mock,
        vision: { baseUrl: cfg.ai.vision.baseUrl, model: cfg.ai.vision.model, apiKey: maskKey(cfg.ai.vision.apiKey) },
        grading: { baseUrl: cfg.ai.grading.baseUrl, model: cfg.ai.grading.model, apiKey: maskKey(cfg.ai.grading.apiKey) },
      }),
      setAi: (p) => {
        const v = (p as { vision?: { baseUrl?: string; model?: string; apiKey?: string } }).vision ?? {};
        const g = (p as { grading?: { baseUrl?: string; model?: string; apiKey?: string } }).grading ?? {};
        if (v.baseUrl) cfg.ai.vision.baseUrl = v.baseUrl;
        if (v.model) cfg.ai.vision.model = v.model;
        if (g.baseUrl) cfg.ai.grading.baseUrl = g.baseUrl;
        if (g.model) cfg.ai.grading.model = g.model;
        const k = String(v.apiKey ?? '').trim();
        if (k && !k.includes('…')) {
          cfg.ai.vision.apiKey = k;
          cfg.ai.grading.apiKey = k;
        }
        saveAiToLocal(CWD, cfg.ai);
        console.log(`[agent] AI 设置已更新（立即生效）: 视觉=${cfg.ai.vision.model}@${cfg.ai.vision.baseUrl} 评分=${cfg.ai.grading.model}@${cfg.ai.grading.baseUrl}`);
      },
      getCalibration: () => {
        const stats = calibrationStore.statsFor(cfg.rubric.id, cfg.calibration.window);
        return {
          enabled: cfg.calibration.enabled,
          sample_count: stats.count,
          avg_deviation: Number(stats.avgDeviation.toFixed(2)),
          min_samples: cfg.calibration.minSamples,
        };
      },
      resetCalibration: () => {
        calibrationStore.reset(cfg.rubric.id);
        console.log('[agent] 校准数据已重置（学习教师打分尺度重新开始）');
      },
      onCommand: (c) => machine.enqueue(c as never),
      getRecordImage: (kind, idx) => {
        const i = idx ?? agent.status(machine.state).records.at(-1)?.student_index ?? 1;
        const p = path.join(logger.sessionDir, `${kind}-${String(i).padStart(4, '0')}.png`);
        return existsSync(p) ? { data: readFileSync(p), mime: 'image/png' } : null;
      },
      listRecords: () => logger.listRecords(),
      onLog: (m) => console.log(`[agent] ${m}`),
    },
    cfg.server.port,
    cfg.server.host,
  );

  const origin = await server.start();
  console.log(`[agent] 控制面板: ${origin}/panel（阅卷页面内也已注入悬浮面板）`);
  // 教师打分/考号等平台数据变化时，立即推送面板（无需等 5 秒轮询）
  agent.setPlatformUpdateHandler(() => server.broadcast());
  // 注入悬浮面板：所有标签页（shadow DOM，默认左上角，不遮挡右侧评分区）
  const panelScript = buildPanelScript(origin);
  try {
    await injectScriptAllPages(connected.browser, panelScript);
    console.log('[agent] 悬浮面板已注入所有已打开的标签页（新开的标签页也会自动注入）');
  } catch (e) {
    console.warn(`[agent] 注入悬浮面板失败（可改用独立面板页 ${origin}/panel）: ${(e as Error).message}`);
  }
  // 面板巡护：每 5 秒检查所有标签页，缺面板的自动补注入（页面加载时序/SPA 差异兜底）
  const panelKeeper = setInterval(() => {
    for (const ctx of connected.browser.contexts()) {
      for (const p of ctx.pages()) {
        p.evaluate(() => !!document.getElementById('__essay_agent_panel_host__'))
          .then((has) => {
            if (!has) p.evaluate(panelScript).catch(() => {});
          })
          .catch(() => {});
      }
    }
    // 重新绑定：启动时选错标签页（如绑到 review 页）时，空闲/暂停状态下自动纠正到阅卷页
    const better = pickTargetPage(connected.context, {
      gradingUrlHint: cfg.browser.gradingUrlHint,
      urlPatterns: cfg.platform.urlPatterns,
    });
    if (better && better !== page && (machine.state === 'IDLE' || machine.state === 'PAUSE')) {
      page = better;
      agent.setPage(better);
      console.log(`[agent] 已重新绑定目标页面: ${better.url()}`);
      // 绑定后立即读取该页学生数据（刷新触发平台请求，监听器捕获教师打分/考号）
      if (agent.status(machine.state).teacher_score === null) {
        better
          .reload({ waitUntil: 'domcontentloaded' })
          .catch(() => {})
          .finally(() => {
            setTimeout(() => agent.refreshPageInfo().catch(() => {}), 2500);
          });
      }
    }
    // 同步刷新页面信息（题号/进度/考试信息），供面板实时对应
    agent.refreshPageInfo().catch(() => {});
    server.broadcast();
  }, 5000);
  panelKeeper.unref?.();

  console.log('[agent] 在面板中填写/选择评分标准后点击「开始」；DRY RUN 下只会高亮建议按钮，绝不点击。');

  const shutdown = async () => {
    console.log('\n[agent] 正在停止…');
    machine.enqueue('stop');
    await new Promise((r) => setTimeout(r, 500));
    await server.close().catch(() => {});
    await connected.close().catch(() => {});
    logger.writeManifest();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await machine.run();
  logger.writeManifest();
  await shutdown();
}

main().catch((e) => {
  console.error(`[agent] 启动失败: ${(e as Error).message}`);
  process.exit(1);
});
