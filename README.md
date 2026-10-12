# 📝 essay-agent — 高中英语作文 AI 自动阅卷浏览器 Agent

## ⬇️ 我要下载安装包（其他老师看这里）

**Windows 10/11（免安装 Node，解压双击即用）**

👉 **https://github.com/Poliax/AI-Mark/releases/latest/download/essay-agent-windows.zip**

**macOS（Intel / Apple 芯片通用）**

👉 **https://github.com/Poliax/AI-Mark/releases/latest/download/essay-agent-mac.zip**

安装三步：

1. 下载上面的 zip → 解压（Windows 解压后双击 `install.bat`；Mac 右键打开 `install.command`）；
2. 等 1-2 分钟，桌面出现「**启动阅卷助手**」图标（Windows 为快捷方式、Mac 为 .app，**都不会弹黑窗口**）；
3. 双击它 → 浏览器登录好分数 → 首次会**自动打开设置页**，粘贴**自己的**智谱 API Key（免费注册 https://open.bigmodel.cn ）→ 保存 → 开始批改（默认 DRY RUN：只高亮建议分数，不点击）。

> 找不到下载位置？GitHub 页面**右侧栏的「Releases」**就是下载区，或直接点上面的链接。

---

教师登录第三方阅卷平台后，由本工具**接管已打开的浏览器页面**：自动识别阅卷页面 → 截取作文区域 → Vision LLM + OCR 识别手写作文 → 按教师提供的评分标准评分 → 输出分数与置信度 → 定位分数按钮 →（DRY RUN 验收后）自动填分/确认/提交 → 自动切换下一份。

> ⚠️ **安全第一（本系统最高优先级）**
> - **绝不接触账号密码**：程序不登录任何平台，只接管教师已打开并登录的页面（attach）或自开 Chrome 窗口由教师手动登录（managed）。遇到验证码/短信验证/二次认证/登录过期 → **自动暂停，提示人工处理**，绝不绕过。
> - **DRY RUN 默认开启**：只识别、评分、高亮建议按钮，**绝不真实点击**。
> - **无人值守提交默认禁止**：`allowAutoSubmit=false`，提交默认策略为「评分→确认→**等待教师确认→提交**」（§10）。
> - **低置信度不自动提交**：置信度 ≥0.90 可自动、0.75-0.90 教师确认、<0.75 强制人工；多模型分差 ≥3 强制人工复核（阈值全部可配置）。
> - **防误打分 7 项保护**：题号/学生/作文区域/评分面板/当前分数状态/提交状态/页面变化检测，任一无法确认即 STOP。

## 快速开始

```bash
cd essay-agent
npm install
npm run demo        # ① 本地模拟阅卷平台演示（DRY RUN，无需 API Key，零真实点击）
```

### 真实平台使用（DRY RUN）

```bash
# 1. 配置大模型（OpenAI 兼容接口，默认通义千问）
cp .env.example .env && vim .env        # 填 DASHSCOPE_API_KEY

# 2. 以调试端口启动 Chrome（建议使用独立配置目录，保护日常浏览数据）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/essay-agent-chrome"

# 3. 在该 Chrome 中手动登录阅卷平台，进入英语作文阅卷页面

# 4. 启动 Agent（attach 模式，默认 DRY RUN）
npm run start

# 5. 浏览器打开控制面板（或使用阅卷页面内注入的悬浮面板）
open http://127.0.0.1:8766/panel
#    在面板中：填写本次评分标准 → 点击「开始」
```

也可用 managed 模式（程序自开 Chrome，教师在其中登录）：`npm run start -- --mode managed`

常用命令：

```bash
npm run init          # 生成 config.local.json 示例配置
npm run check         # 环境自检（Chrome/API Key/安全状态）
npm run analyze       # 一次性分析当前页面（第一阶段验收用）
npm test              # 全部单元 + 集成验收测试
```

## 使用流程

```
教师登录阅卷平台 → 进入作文阅卷页 → 启动 Agent
→ 面板填写/选择评分标准 → [开始自动阅卷]
→ AI: 读页面 → 截作文 → OCR+Vision 识别 → 评分 → 校验置信度
→ DRY RUN: 高亮建议按钮「建议点击：13」
→ （阶段2+）点击分数 → ✓ 确认 → （阶段3+）提交/等待教师提交
→ 检测页面变化（学生切换）→ 下一份 → 重复
教师只处理：低置信度作文、AI 评分异常、页面异常
```

## 目录结构（§21 模块化）

```
essay-agent/
├── src/
│   ├── config/          配置系统（zod schema、Qwen/GLM/OpenAI/Ollama 预设、.env 覆盖）
│   ├── types/           共享数据契约（页面分析/识别/评分/日志/状态）
│   ├── logging/         阅卷日志（§15 全字段，JSON 落盘）
│   ├── browser/         Playwright 连接管理（attach CDP / managed 持久化 Chrome）
│   ├── page_analyzer/   页面识别（selector→文本→role/aria→启发式，无固定坐标）
│   ├── essay_capture/   作文区域定位 + 截图 + sharp 图像预处理
│   ├── ocr/             传统 OCR 通道（tesseract.js，可选，交叉校验）
│   ├── vision/          Vision LLM 通道（OpenAI 兼容）+ 识别合并管线
│   ├── grading/         评分引擎（纯文本输入，与浏览器完全解耦）
│   ├── scoring/         评分校验（置信度阈值/分差仲裁/越界钳制）
│   ├── arbiter/         多模型仲裁（阶段5；接口与中位数逻辑已就绪）
│   ├── automation/      PlatformAdapter 接口 + 通用适配器 + DRY RUN 高亮 + 安全闸门
│   ├── state_machine/   状态机（IDLE→CHECK_PAGE→…→NEXT_ESSAY；失败→PAUSE→CONTINUE）
│   ├── agent/           各状态的实际执行编排
│   ├── server/          本地控制服务（HTTP+WS，127.0.0.1）
│   ├── ui/              悬浮控制面板（shadow DOM 注入，左上角不遮挡评分区）
│   └── cli/             命令行入口
├── tests/
│   ├── fixtures/grading-page.html   模拟阅卷平台（左侧作文图 + 右侧 0-15 按钮 + ✓ + 提交/自动提交）
│   ├── unit/            单元测试（34 个）
│   └── integration/     第一阶段验收集成测试（真实 Chrome，8 个）
├── scripts/demo-fixture.ts         本地演示
└── docs/                架构/阶段/安全/平台适配文档
```

## 开发阶段（§17）与当前状态

| 阶段 | 能力 | 状态 |
|---|---|---|
| 1 | 读取页面 + 截图作文 + AI 识别 + AI 评分（禁止点击） | ✅ 已完成并通过验收测试 |
| 2 | + 自动点击分数（禁止自动提交） | 已实现，`phase>=2` + `dryRun=false` 开闸 |
| 3 | + 确认、教师确认后提交 | 已实现，`phase>=3` + `allowSubmit=true` 开闸 |
| 4 | + 批量自动阅卷 | 已实现（NEXT_ESSAY 循环），批量开关同上 |
| 5 | + 多模型仲裁 | 仲裁器已就绪，配置多模型即用 |

**所有真实操作能力均已实现但默认锁死**，按阶段逐级开闸（config.local.json → safety）：

```jsonc
{
  "safety": {
    "dryRun": true,                  // DRY RUN（默认开）
    "phase": 1,                      // 开发阶段 1-5
    "minConfidenceAuto": 0.9,        // ≥0.90 可自动提交
    "minConfidenceTeacherConfirm": 0.75,
    "maxModelDisagreement": 3,       // 分差 ≥3 强制人工
    "allowSubmit": false,            // 允许程序点「提交」（阶段3+）
    "allowAutoSubmit": false,        // 完全无人值守（开发阶段禁止）
    "checkAutoSubmitFirst": true,    // 先检测平台自动提交状态，绝不修改用户设置
    "expectedQuestionNumber": null   // 可配置硬校验题号（如 66）
  }
}
```

## 平台适配（§21）

换平台只改 `config.local.json` 的 `platform` 部分（或实现新的 `PlatformAdapter`，见 `docs/platform-adapter.md`）：

```jsonc
{
  "platform": {
    "adapter": "generic",
    "urlPatterns": ["marking.*/grade"],
    "scoreRange": { "min": 0, "max": 15 },
    "selectors": {
      "essayImage": [".essay-img img"],       // 作文区域（留空走启发式：左半屏最大图）
      "scorePanel": [".score-panel"],
      "scoreButtonContainer": [".score-grid"],
      "confirmButton": [".confirm"],
      "submitButton": [".submit"],
      "autoSubmitToggle": [".auto-submit input"],
      "questionNumber": [".question-no"],
      "studentIdentity": [".student-name"],
      "currentScore": [".current-score"]
    },
    "confirmTexts": ["✓", "确认"],
    "submitTexts": ["提交"],
    "autoSubmitTexts": ["自动提交"],
    "totalStudents": 100,
    "nextEssayTimeoutMs": 120000
  }
}
```

定位优先级（§3/§19）：**DOM selector → role/accessibility → 文本精确匹配 → aria-label → 启发式结构**；Canvas 纯图平台才允许视觉坐标兜底（后续阶段实现）。全程无固定坐标。

## 控制面板（§16）

- **注入式悬浮面板**：启动时自动注入阅卷页面（shadow DOM，默认左上角，可拖动，不遮挡右侧评分区）。
- **独立面板页**：`http://127.0.0.1:8766/panel`（平台 CSP 阻止注入连接时的兜底，附带记录列表与作文截图预览）。
- 按钮：`[开始] [暂停] [继续] [人工评分] [重新识别] [重新评分] [跳过] [停止]` + 评分标准编辑器。
- **大模型设置（面板内修改）**：面板「大模型设置」可切换服务商预设（智谱/通义/OpenAI/Ollama）、修改接口地址、模型名与 API Key；保存后**下一次识别/评分立即生效**，并持久化到 `config.local.json`（重启不丢，优先级高于 `.env`）。Key 只显示脱敏形式，留空即不修改。
- 「人工评分」：AI 停止操作当前学生 → 教师平台内手动评分 → 点「继续」，Agent 读取教师分数（`final_teacher_score`）并进入下一份。

## 阅卷日志（§15）

每份作文在 `logs/<session>/essay-XXXX.json` 记录：`student_index / question_number / essay_image / ocr_text / vision_text / final_text / ai_score / confidence / rubric_version / model_version / action_log / final_teacher_score / submission_status / timestamp`（另有识别置信度、三维分析、语法错误、评语、仲裁结论等）。作文原图与预处理图同步存档。

## 测试与第一阶段验收（§22）

`npm test` = 42 个测试全绿：

1. ✅ 自动识别阅卷页面（`is_grading_page`、题号 66、学生、评分面板、提交按钮、自动提交状态）
2. ✅ 自动定位作文区域（selector / 左半屏启发式）
3. ✅ 截取作文（区域截图 + 预处理，拒绝整页截图）
4. ✅ 识别英文手写作文（Vision 主通道 + OCR 交叉校验 + 置信度合并）
5. ✅ 按评分标准评分（rubric 由教师提供，评分引擎纯文本解耦）
6. ✅ 输出分数（13/15）
7. ✅ 输出置信度（评分 + 识别 + 综合）
8. ✅ 正确定位对应分数按钮（role/text/aria，返回定位方法证据）
9. ✅ DRY RUN 准确指出应点击按钮（橙色高亮「建议点击：13」，断言全程零点击）

> 注：集成测试用 mock 模型跑通全链路；**真实手写识别质量**需在真实平台用真 API（qwen-vl-max）验证，这是你启动真实阅卷后的第一件事。在此确认无误前，请保持 DRY RUN 与 phase=1。

## Windows 笔记本使用（不支持火狐）

> ⚠️ **火狐浏览器不支持**：工具通过 Chrome/Edge 的调试端口（CDP）接管「教师已登录的页面」，火狐协议不同且不允许安全接管已登录会话。Windows 上请使用 **Edge**（系统自带）或安装 Chrome。

1. 装 Node.js（https://nodejs.org LTS 版）；
2. 把「essay-agent-迁移包.zip」拷到 Windows 笔记本并解压；
3. 双击解压出来的 `install-on-windows.bat`（自动装依赖 + 创建桌面快捷方式）；
4. 双击桌面「启动阅卷助手.bat」→ 自动启动专用 Edge 并打开好分数 → 你登录后进入阅卷页 → Agent 自动启动（DRY RUN）。

## 学习教师打分尺度（校准）

工具会**持续学习教师实际打的分**，让 AI 评分尺度逐渐向老师收敛：

- **样本收集**：每份「AI 原始分 + 教师实际分」自动记入 `data/calibration.jsonl`（按评分标准隔离，换考试自动换数据集）；
- **示例注入**：评分时把最近教师评分示例（few-shot）写进提示词，让模型体会老师的给分尺度；
- **偏差修正**：统计「老师分 − AI 分」的系统性偏差，自动修正 AI 建议分（面板「校准」行显示样本数与偏差）；
- **安全护栏**：修正封顶 ±3 分、样本不足 10 份不修正、偏差 <0.5 不修正；只调建议分，不改变置信度裁决与提交闸门；面板大模型设置里可一键重置重新学习。

> 注：校准让 AI 的**平均偏差**趋近 0，但不能保证每一份与老师完全一致（老师自身打分也有波动）。

## 其他老师怎么安装（Git 下载版）

**不需要手动安装 Node.js**——安装脚本会自动下载内置运行时（约 40MB，仅首次）。只需电脑装有 **Chrome / Edge**（火狐不支持）。

```bash
# 方式一：git 克隆（推荐，以后更新只需 git pull）
git clone <仓库地址>
cd essay-agent

# 方式二：在仓库页面点「Code → Download ZIP」下载并解压
```

然后在克隆/解压出来的目录里运行安装脚本（自动下载 Node 运行时 + 安装依赖 + 创建桌面快捷方式）：

- **macOS**：双击 `scripts/install-on-new-mac.command`（首次需右键 → 打开）
- **Windows**：双击 `scripts/install-on-windows.bat`（若被拦截：右键 → 属性 → 勾「解除锁定」→ 确定）
- **Linux**：`bash scripts/install-on-linux.sh`

装完桌面出现「启动阅卷助手」，以后双击即可。也可以直接 `npm run start`（需先按上文说明用调试端口启动 Chrome/Edge，或加 `--mode managed`）。

首次使用：在悬浮面板「**大模型设置**」里粘贴**自己的智谱 API Key**（免费注册 https://open.bigmodel.cn/usercenter/apikeys），或复制 `.env.example` 为 `.env` 填写。默认已内置好分数阅卷页规则，其他平台改 `config.local.json`（见 `config.example.json`）。

> 安全：仓库不含任何账号/Key/学生数据（`.env`、`config.local.json`、`logs/`、`data/`、`runtime/` 均被 git 忽略）。每人用自己的 Key、独立学习自己的评分尺度。

## 常见问题

| 问题 | 解决 |
|---|---|
| attach 失败 | 先按上面命令用 `--remote-debugging-port=9222` 启动 Chrome 再运行；确认端口一致 |
| 面板按钮无反应 | 平台 CSP 可能阻止页面连接本机服务 → 使用独立面板页 `/panel` |
| 未配置 API Key | 填 `.env` 的 `DASHSCOPE_API_KEY`；或 `npm run start -- --mock` 演示 |
| 识别不准 | 换 `AI_VISION_MODEL=qwen-vl-max`（默认），保证截图清晰；OCR 通道可选开启 |
| 页面变化检测不工作 | 配置 `platform.selectors.studentIdentity`（或确认启发式命中）；检查 `nextEssayTimeoutMs` |
| 想换 GLM/OpenAI/Ollama | 改 `.env` 的 `AI_VISION_BASE_URL` / `AI_GRADING_BASE_URL` 等（见 .env.example） |
