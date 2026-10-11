# PlatformAdapter 开发指南（§21）

换阅卷平台时，**AI 评分系统零改动**，只需处理平台层。

## 快速路径：只改配置（推荐先试）

`config.local.json` 的 `platform` 支持大部分平台差异：

```jsonc
{
  "platform": {
    "adapter": "generic",
    "urlPatterns": ["regex…"],            // 阅卷页 URL 佐证
    "scoreRange": { "min": 0, "max": 15 },
    "selectors": {
      "essayImage": [".essay img"],        // 作文图像区域（留空→左半屏最大图启发式）
      "scorePanel": [".score-panel"],      // 评分面板（留空→数字按钮启发式）
      "scoreButtonContainer": [".score-grid"],
      "confirmButton": [".confirm-btn"],
      "submitButton": [".submit-btn"],
      "autoSubmitToggle": [".auto-submit input"],
      "questionNumber": [".q-no"],
      "studentIdentity": [".stu-name"],
      "currentScore": [".cur-score"]
    },
    "confirmTexts": ["✓", "确认"],
    "submitTexts": ["提交"],
    "autoSubmitTexts": ["自动提交"],
    "totalStudents": 100,                  // 面板显示 82/100（0=未知）
    "nextEssayTimeoutMs": 120000           // 等待学生切换超时
  }
}
```

验证：`npm run analyze` 输出 `PageAnalysis`，观察 `evidence` 字段确认每个要素命中了什么方法。

## 完整路径：实现新的 PlatformAdapter

实现 `src/automation/platform_adapter.ts` 的 `PlatformAdapter` 接口：

```ts
interface PlatformAdapter {
  readonly id: string;
  analyze(page: Page): Promise<PageAnalysis>;                       // §4 页面识别
  locateScoreButton(page: Page, score: number): Promise<… | null>;  // 定位分数按钮
  locateConfirm(page: Page): Promise<Locator | null>;               // ✓ 确认
  locateSubmit(page: Page): Promise<Locator | null>;                // 提交
  getAutoSubmitState(page: Page): Promise<'on'|'off'|'unknown'>;    // 只读平台设置
  snapshot(page: Page): Promise<PageSnapshot>;                      // 学生/题号/分数快照
  waitForPageChange(page, before, timeoutMs): Promise<PageSnapshot|null>;
}
```

然后注册到 `createAdapter()`，并在 `config.local.json` 设置 `platform.adapter`。

## 硬性要求（§3/§19）

1. **定位优先**：`getByRole` → 精确文本 → `aria-label` → DOM selector；**禁止固定坐标**。
2. Canvas 纯图平台：允许视觉定位兜底（截图 + 视觉模型返回目标框 → 动态坐标），
   方法标记为 `visual`，且**必须**配 DRY RUN 高亮验收后才能用于真实点击。
3. `waitForPageChange` 必须基于快照对比轮询，**禁止固定 sleep 后盲点**。
4. `getAutoSubmitState` 只读，任何实现不得修改平台设置。
5. 定位失败返回 `null`（由上层决定 PAUSE），绝不返回「附近」的元素。
6. 所有定位记录 `method + selector` 证据，供日志审计与测试断言。

## 验收清单（换平台后）

- [ ] `npm run analyze` → `is_grading_page=true`，题号/学生/分数按钮/确认/提交全部识别
- [ ] 日志中 `score_button_method` 为 role/text/aria/selector
- [ ] DRY RUN 高亮 10+ 份作文全部落在正确按钮上
- [ ] 学生切换检测在真实「下一份」操作后立即触发
- [ ] 平台自动提交开关状态识别正确（开/关/未知）
- [ ] 验证码/登录过期页面能被识别为需要人工介入
