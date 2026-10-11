# 开发阶段（§17）与 22 节规格映射

## 五阶段进度

| 阶段 | 内容 | 实现状态 | 开闸条件 |
|---|---|---|---|
| **1** | 读取页面 + 截图作文 + AI 识别 + AI 评分，**禁止自动点击** | ✅ 完成（本交付） | 默认即此状态 |
| 2 | AI 评分 + 自动点击分数，**禁止自动提交** | 已实现 | `safety.dryRun=false` + `safety.phase>=2` |
| 3 | 评分 + 确认 + 教师确认后提交 | 已实现 | `safety.phase>=3` + `safety.allowSubmit=true` |
| 4 | 批量自动阅卷 | 已实现（NEXT_ESSAY 自动循环） | 同上（批量能力随阶段 3 开闸） |
| 5 | 多模型仲裁 | 仲裁器已实现（中位数+分差），模型列表可扩展 | `agent.models` 配置多个评分模型 |

**当前默认：DRY RUN 开启、phase=1、allowSubmit=false、allowAutoSubmit=false。** 在任何真实点击/提交发生前，必须先通过第一阶段验收（§22）。

## 22 节规格 → 代码位置

| 规格 | 实现 |
|---|---|
| §1 核心工作模式 | `state_machine/` + `agent/`（读页→截作文→识别→评分→校验→填分→确认→提交→下一份循环） |
| §2 不接管登录 | `browser/manager.ts`（attach/managed，无任何凭证处理）；`page_analyzer/` 干预检测 → PAUSE；README 安全声明 |
| §3 浏览器自动化 | `browser/`（Playwright + Chrome channel）；定位优先级见 `automation/platform_adapter.ts` |
| §4 页面识别 | `page_analyzer/analyzer.ts` → `PageAnalysis`（字段与规格一致；无法确认即禁评） |
| §5 作文区域识别 | `essay_capture/capture.ts`（区域截图，不整页发给 AI）+ `preprocess.ts`（增强） |
| §6 作文识别 | `vision/pipeline.ts`（保留 original/ocr_text/vision_text/final_text/confidence） |
| §7 评分引擎 | `grading/engine.ts`（纯文本输入，输出规格契约） |
| §8 评分安全机制 | `scoring/validate.ts`（0.90/0.75 阈值、分差≥3 人工；全部可配置） |
| §9 评分页面操作 | `automation/platform_adapter.ts`（0-15 按钮定位）→ 点击 → ✓ 确认 → 状态变化校验 |
| §10 提交 | `agent.submit()` + `automation/gates.ts`（先检测平台自动提交状态；默认等待教师提交） |
| §11 下一份 | `waitForPageChange` 轮询快照变化（无固定 sleep） |
| §12 状态机 | `state_machine/machine.ts`（全部状态 + 失败→PAUSE→CONTINUE） |
| §13 防止误打分 | 7 项检查 `automation/gates.ts buildSafetyChecks` + `verifyScore` 前后对比；任一失败 STOP |
| §14 人工接管 | 面板按钮 暂停/继续/人工评分/重新识别/重新评分/跳过/停止 → `/api/command` → 状态机命令 |
| §15 阅卷日志 | `logging/logger.ts`（§15 全字段 + 图片/文本存档） |
| §16 界面 | `ui/panel_script.ts`（shadow DOM 悬浮面板，左上角）+ `server/panel_page.ts`（独立页） |
| §17 开发顺序 | 本文件；阶段闸门 `config.safety.phase` |
| §18 录制模式 DRY RUN | `automation/dry_run.ts`（高亮+建议，绝不点击）+ 默认开启 |
| §19 不依赖固定坐标 | 定位方法链 + `method` 证据；测试断言；坐标仅记录 |
| §20 最终目标 | 阶段 1 已闭环；2-5 逐级开闸 |
| §21 代码质量 | 模块化目录 + 契约类型 + 解耦纯度测试 |
| §22 第一阶段验收 | `tests/integration/phase1.test.ts`（9 条标准断言） |

## 后续阶段验收建议

进入阶段 2 前（在真实平台）：

1. `npm run analyze` 确认 `is_grading_page=true`、题号/学生/按钮全部正确；
2. 检查 `logs/<session>/essay-XXXX.json` 的 `score_button_method` 确为 role/text 定位；
3. 观察 DRY RUN 高亮是否落在正确按钮上；
4. 全部确认后 → `config.local.json`：`phase: 2`，仍保持 `dryRun: true` 试运行；
5. 再次确认无误 → `dryRun: false`（或 `--live`），先少量试批；
6. 阶段 3 提交能力单独开闸 `phase: 3 + allowSubmit: true`，保持 `allowAutoSubmit: false`（教师确认后提交）。
