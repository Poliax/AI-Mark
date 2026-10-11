/**
 * 本地演示（DRY RUN）—— 模拟阅卷平台 + mock 模型，无需任何 API Key。
 * 运行: npm run demo
 * 产出: artifacts/demo/ 截图与页面分析 JSON；logs/<session>/ 完整阅卷日志。
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config/index.js';
import { createAdapter } from '../src/automation/platform_adapter.js';
import { createLogger } from '../src/logging/logger.js';
import { CalibrationStore } from '../src/grading/calibration.js';
import { Agent } from '../src/agent/agent.js';
import { StateMachine } from '../src/state_machine/machine.js';

// 以项目根目录为基准（npm run demo 从项目根执行；编译后运行于 dist/）
const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'tests/fixtures/grading-page.html');
const ART = path.join(ROOT, 'artifacts/demo');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(50);
  }
  throw new Error(`等待超时: ${label}`);
}

async function main(): Promise<void> {
  mkdirSync(ART, { recursive: true });
  console.log('=== AI 英语作文阅卷助手 · DRY RUN 演示（模拟平台，无真实点击）===\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`file://${FIXTURE}`);
  await page.waitForSelector('#essay-canvas');

  const cfg = loadConfig({ cwd: ROOT, env: {} });
  cfg.ai.mock = true;
  cfg.ocr.enabled = false;
  cfg.platform.nextEssayTimeoutMs = 4000;
  cfg.safety.expectedQuestionNumber = 66;
  const logger = createLogger(path.join(ROOT, cfg.logging.dir));
  const adapter = createAdapter(cfg.platform);
  const calibrationStore = new CalibrationStore(path.join(ROOT, 'data', 'calibration.jsonl'));
  const agent = new Agent({ page, adapter, config: cfg, logger, calibrationStore });
  const machine = new StateMachine(agent, {
    onState: (s) => console.log(`  状态 → ${s}`),
    onPause: (reason) => console.log(`  ⏸ 暂停原因: ${reason}`),
  });

  console.log('[1] 打开模拟阅卷平台页面');
  const analysis = await adapter.analyze(page);
  writeFileSync(path.join(ART, 'page-analysis.json'), JSON.stringify(analysis, null, 2));
  console.log(`[2] 页面识别: is_grading_page=${analysis.is_grading_page} 题号=${analysis.question_number} 分数按钮=${analysis.score_panel_scores.length} 个 学生="${analysis.student_identity}"`);
  if (!analysis.is_grading_page) throw new Error('页面识别失败');

  const run = machine.run();
  machine.enqueue('start');

  console.log('[3] DRY RUN 流程: 截取作文 → 识别 → 评分 → 定位分数按钮（只高亮）');
  await waitFor(() => logger.getRecord(1)?.suggested_button === 13, 20000, '学生1评分');

  const rec1 = logger.getRecord(1)!;
  console.log(`     识别: "${rec1.final_text.slice(0, 60).replace(/\n/g, ' ')}…"`);
  console.log(`     AI 评分: ${rec1.ai_score}/${rec1.max_score}  置信度: ${(rec1.confidence * 100).toFixed(0)}%  识别置信度: ${(rec1.recognition_confidence * 100).toFixed(0)}%`);
  console.log(`     建议点击: ${rec1.suggested_button}（按钮定位方法: ${rec1.score_button_method}）`);
  console.log(`     安全校验: 提交被闸门拦截 → ${rec1.submission_status}（phase=1 默认等待教师）`);

  await page.screenshot({ path: path.join(ART, '01-dry-run-highlight.png'), fullPage: false });
  console.log('     已保存高亮截图: artifacts/demo/01-dry-run-highlight.png（橙色高亮即建议点击的按钮）');

  await waitFor(() => machine.state === 'PAUSE', 20000, '进入等待下一份');
  console.log('[4] 等待教师切换下一份（模拟平台点击「下一份作文」）');
  await page.getByRole('button', { name: '下一份作文（模拟切换学生）' }).click();
  machine.enqueue('continue');
  await waitFor(() => logger.getRecord(2)?.suggested_button === 13, 20000, '学生2评分');
  const rec2 = logger.getRecord(2)!;
  console.log(`     学生2: AI 评分 ${rec2.ai_score}/${rec2.max_score}，建议点击 ${rec2.suggested_button}`);

  await waitFor(() => machine.state === 'PAUSE', 20000, '学生2等待下一份');
  machine.enqueue('stop');
  await run;

  const records = logger.listRecords();
  writeFileSync(path.join(ART, 'records-summary.json'), JSON.stringify(records, null, 2));
  logger.writeManifest();

  console.log('[5] 完成。全程零真实点击：');
  const untouched = (await page.locator('.score-btn.selected').count()) === 0;
  console.log(`     ✓ 分数按钮未被点击: ${untouched}`);
  console.log(`     ✓ 已完成 ${agent.completed} 份，日志: ${logger.sessionDir}/`);
  console.log(`     ✓ 作文原图/预处理图: ${path.join(logger.sessionDir, 'original-0001.png')} 等`);
  console.log(`     ✓ 页面分析: artifacts/demo/page-analysis.json`);
  console.log('\n下一步: 在真实阅卷平台运行 npm run start（默认 attach 已登录的 Chrome，仍为 DRY RUN）。');

  await browser.close();
}

main().catch((e) => {
  console.error(`演示失败: ${(e as Error).message}`);
  process.exit(1);
});
