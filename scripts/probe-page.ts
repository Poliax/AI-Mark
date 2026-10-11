/** 真实平台全链路试跑：截作文 → glm-4v-flash 识别 → glm-4-flash 评分（只读，无任何点击） */
import { chromium } from 'playwright-core';
import path from 'node:path';
import { loadConfig } from '../src/config/index.js';
import { pickTargetPage } from '../src/browser/manager.js';
import { createAdapter } from '../src/automation/platform_adapter.js';
import { createLogger } from '../src/logging/logger.js';
import { captureEssay } from '../src/essay_capture/capture.js';
import { createVisionClient } from '../src/vision/client.js';
import { createOcrChannel } from '../src/ocr/channel.js';
import { recognizeEssay } from '../src/vision/pipeline.js';
import { createGradingModel } from '../src/grading/engine.js';

const ROOT = process.cwd();
const cfg = loadConfig({ cwd: ROOT });

const browser = await chromium.connectOverCDP(cfg.browser.cdpUrl);
const page = pickTargetPage(browser.contexts()[0]!, {
  gradingUrlHint: cfg.browser.gradingUrlHint,
  urlPatterns: cfg.platform.urlPatterns,
});
if (!page) throw new Error('没有找到目标页面');
console.log('[1] 目标页面:', page.url());

const adapter = createAdapter(cfg.platform);
const analysis = await adapter.analyze(page);
console.log('[2] 页面识别: is_grading_page=', analysis.is_grading_page, ' 自动提交=', analysis.auto_submit_state);
if (!analysis.is_grading_page) throw new Error('页面未识别为阅卷页');

const logger = createLogger(path.join(ROOT, cfg.logging.dir));
console.log('[3] 截取作文区域…');
const capture = await captureEssay({
  page, analysis, platform: cfg.platform, config: cfg, logger, studentIndex: 1,
});
console.log('    区域:', capture.region, '定位方法:', capture.method, '占视口:', (capture.viewport_fraction * 100).toFixed(0) + '%');
console.log('    已保存:', capture.preprocessed_image);

console.log('[4] glm-4v-flash 识别手写作文…（约 10-40 秒）');
const vision = createVisionClient(cfg.ai);
const ocr = createOcrChannel(cfg.ocr.enabled, cfg.ocr.engine, cfg.ocr.lang);
const recognition = await recognizeEssay({
  imageBase64: capture.preprocessed_data_url.split(',')[1]!,
  originalImagePath: capture.original_image,
  vision, ocr,
});
console.log('    识别置信度:', recognition.confidence.toFixed(2), '警告:', recognition.warnings.length ? recognition.warnings : '无');
console.log('--- 识别文本 ---');
console.log(recognition.final_text);
console.log('----------------');

console.log('[5] glm-4-flash 按评分标准评分…（约 10-40 秒）');
const model = createGradingModel({ mock: false, grading: cfg.ai.grading, timeoutMs: cfg.ai.timeoutMs });
const rubric = {
  id: cfg.rubric.id, title: cfg.rubric.title, max_score: cfg.rubric.max_score,
  description: cfg.rubric.description, question: cfg.rubric.question,
};
const result = await model.grade({ essay: recognition.final_text, question: rubric.question, rubric });
console.log('    AI 分数:', result.score + '/' + result.max_score, ' 置信度:', result.confidence.toFixed(2), ' 档位:', result.level);
console.log('    内容:', result.content_analysis);
console.log('    语言:', result.language_analysis);
console.log('    结构:', result.organization_analysis);
console.log('    语法错误数:', result.grammar_errors.length);
console.log('    评语:', result.teacher_comment);
console.log('[6] 试跑完成（全程只读，未点击任何按钮）。截图保存在:', logger.sessionDir);
await browser.close().catch(() => {});
