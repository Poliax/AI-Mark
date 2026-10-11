# 架构设计

## 分层与数据流

```
┌─────────────────────────── 浏览器自动化层（与平台相关）───────────────────────────┐
│ browser/ (attach CDP | managed)                                                  │
│   └─ Page ─┬─ page_analyzer/  → PageAnalysis（§4：is_grading_page/题号/学生/…）  │
│            ├─ essay_capture/  → EssayCapture（区域截图 + 预处理，拒绝整页）       │
│            └─ automation/     → PlatformAdapter（定位/快照/页面变化检测/闸门）    │
├──────────────────────────────── AI 层（与平台无关）───────────────────────────────┤
│ vision/  (OpenAI 兼容视觉模型)   ocr/ (tesseract 可选)                            │
│   └─ pipeline → EssayRecognition（§6 五要素 + 置信度合并）                         │
│ grading/ 评分引擎（纯文本）→ GradeResult（§7 契约）                                │
│ scoring/ 校验（阈值/分差/钳制）→ ScoreValidation（§8）                             │
│ arbiter/ 多模型仲裁（中位数 + 分差）                                               │
├────────────────────────── 编排层 ─────────────────────────────────────────────────┤
│ state_machine/（§12 状态机，失败→PAUSE→CONTINUE）  ←─ agent/（各状态执行）        │
│ server/（HTTP+WS 本机控制服务） ←─ ui/（悬浮面板：注入 shadow DOM + /panel 兜底）  │
│ logging/（§15 阅卷日志）      config/（zod 校验的配置）   cli/（入口）             │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## 关键设计决策

### 1. 浏览器自动化与 AI 评分彻底解耦（§7/§21）

- `grading/ scoring/ arbiter/ vision/ ocr/` 不 import 任何 playwright 模块（有测试强制保证）。
- 评分引擎输入只有 `essay + question + rubric` 文本，输出结构化 `GradeResult`。
- 换平台 = 只重写 `PlatformAdapter`（`automation/platform_adapter.ts` 接口），评分系统零改动。

### 2. 数据契约单一来源（src/types/contracts.ts）

模块间只通过契约类型交换数据：`PageAnalysis`（§4 字段名与规格一致）、`EssayRecognition`（§6）、`GradeResult`（§7）、`ScoreValidation`（§8）、`EssayRecord`（§15）、`AgentStatus`（面板）。

### 3. 安全闸门默认全关（§8/§10/§18/§22）

所有「真实操作」能力**已实现但默认锁死**，按阶段开闸：

| 能力 | 闸门 |
|---|---|
| 点击分数按钮 | `dryRun=false` 且 `phase>=2` |
| 点击确认 ✓ | 同上 |
| 点击提交 | `phase>=3` 且 `allowSubmit=true` 且自动提交状态可确认且判定 `auto` |
| 完全无人值守 | `allowAutoSubmit=true`（开发阶段禁止） |

平台「自动提交」开关只检测（`auto_submit_state`），**绝不修改**（§10）。

### 4. 定位策略（§3/§19）

优先级：**DOM selector → role/accessibility name → 精确文本 → aria-label → 结构启发式**。
坐标只出现在「证据/调试」里；Canvas 纯图平台的视觉坐标兜底预留 `visual` 方法位，后续阶段实现。每次定位都记录 `method + selector` 证据，测试断言真实方法而非固定坐标。

### 5. 置信度合并（保守策略）

- 识别置信度：Vision 自评 + OCR 交叉校验（词级 Jaccard 重合度，分歧大则压到 50%）。
- 评分置信度：模型自评（要求模型考虑转录不确定性）。
- **综合置信度 = min(识别, 评分)** → 决定 auto/teacher_confirm/manual 三档裁决。

### 6. 状态机（§12/§14）

```
IDLE → CHECK_PAGE → CAPTURE_ESSAY → OCR → GRADE → VALIDATE_SCORE
     → INPUT_SCORE → VERIFY_SCORE → SUBMIT → VERIFY_SUBMISSION
     → NEXT_ESSAY → CHECK_PAGE → …
任何一步抛错 → PAUSE（记录原因）→ CONTINUE 重试该步；
PAUSE 支持 manual_grade/reidentify/regrade/skip/stop。
```

- 命令在步骤之间处理；NEXT_ESSAY 的等待循环通过 `interruptCheck` 支持等待期间暂停/停止。
- 每个状态步进后 `tick(0)` 让出事件循环（防空转占满 CPU，也保证命令及时处理）。

### 7. 页面变化检测（§11）

`waitForPageChange` 轮询快照对比（学生标识 / 题号 / 分数复位），**禁止固定 sleep 后盲点**。基准快照跨 PAUSE→CONTINUE 重试保持，教师切换后能立即检测。

### 8. 面板双通道（§16）

- 注入式：`page.evaluate` + `context.addInitScript`，shadow DOM 隔离样式，默认左上角可拖动。
- 兜底：`/panel` 独立页（平台 CSP 阻止注入连接时使用）。
- 通信：WS 推送 + 轮询降级；命令 POST `/api/command`。

## 运行形态

- **attach（推荐）**：教师自行用 `--remote-debugging-port` 启动 Chrome 并登录，Agent `connectOverCDP` 接管；绝不接触凭证（§2）。
- **managed**：`launchPersistentContext`（独立 user-data-dir，channel=chrome），教师在该窗口手动登录。
- 干预检测：页面出现 验证码/登录过期/二次认证 文案 → `intervention_needed` → PAUSE 提示人工处理。
