import type { Page } from 'playwright-core';
import type { PageAnalysis } from '../types/contracts.js';
import type { PlatformConfig } from '../config/schema.js';

/**
 * PageAnalyzer（§4）—— 判断当前是否处于正确的阅卷页面。
 * 输出 PageAnalysis；is_grading_page 为 false 时上层禁止自动评分。
 *
 * 定位策略优先级（§3）：DOM selector → 文本 → role/aria → 启发式（视觉兜底留给后续阶段）。
 * 不使用固定坐标。
 */

interface SelectorSet {
  essayImage: string[];
  scorePanel: string[];
  scoreButtonContainer: string[];
  confirmButton: string[];
  submitButton: string[];
  autoSubmitToggle: string[];
  questionNumber: string[];
  studentIdentity: string[];
  currentScore: string[];
}

interface AnalyzeArgs {
  selectors: SelectorSet;
  scoreRange: { min: number; max: number };
  confirmTexts: string[];
  submitTexts: string[];
  autoSubmitTexts: string[];
  urlPatterns: string[];
  url: string;
}

export async function analyzePage(page: Page, platform: PlatformConfig): Promise<PageAnalysis> {
  const args: AnalyzeArgs = {
    selectors: platform.selectors,
    scoreRange: platform.scoreRange,
    confirmTexts: platform.confirmTexts,
    submitTexts: platform.submitTexts,
    autoSubmitTexts: platform.autoSubmitTexts,
    urlPatterns: platform.urlPatterns,
    url: page.url(),
  };
  return page.evaluate((a: AnalyzeArgs) => {
    const evidence: Record<string, string> = {};
    const doc = document;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;

    const visible = (el: Element | null): el is Element => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.bottom > 0 && rect.right > 0;
    };

    /** 按候选 selector 找第一个可见元素 */
    const q = (sels: string[]): Element | null => {
      for (const sel of sels) {
        try {
          const el = doc.querySelector(sel);
          if (visible(el)) {
            evidence[sel] = `selector:${sel}`;
            return el;
          }
        } catch {
          /* 非法 selector 跳过 */
        }
      }
      return null;
    };

    const text = (el: Element | null) => (el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '');

    // ---- 1. 作文图像区域（selector → 启发式：左半屏最大 img/canvas）----
    let essayEl: Element | null = q(a.selectors.essayImage);
    let essayMethod = 'selector';
    if (!essayEl) {
      let best: Element | null = null;
      let bestArea = 0;
      for (const el of Array.from(doc.querySelectorAll('img, canvas, svg, iframe'))) {
        if (!visible(el)) continue;
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        // 只考虑左半屏、面积足够大的区域（排除图标/头像等）
        if (rect.left < vw * 0.6 && area > vw * vh * 0.04 && area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      essayEl = best;
      essayMethod = 'heuristic';
      if (best) evidence.essayImage = 'heuristic:left-half-largest-img-canvas';
    }

    // ---- 2. 分数按钮区 ----
    const range = a.scoreRange;
    const panelRoot = q(a.selectors.scorePanel) ?? q(a.selectors.scoreButtonContainer) ?? null;
    const candidates = panelRoot
      ? Array.from(panelRoot.querySelectorAll('button, [role="button"], a'))
      : Array.from(doc.querySelectorAll('button, [role="button"], a'));
    const scores: number[] = [];
    const scoreButtons: Element[] = [];
    for (const b of candidates) {
      if (!visible(b)) continue;
      const t = text(b);
      if (/^\d{1,2}$/.test(t)) {
        const n = parseInt(t, 10);
        if (n >= range.min && n <= range.max && !scores.includes(n)) {
          scores.push(n);
          scoreButtons.push(b);
        }
      }
    }
    scores.sort((x, y) => x - y);
    const hasScorePanel = scores.length >= Math.max(3, Math.ceil((range.max - range.min + 1) / 2));
    if (hasScorePanel) evidence.scorePanel = panelRoot ? 'selector' : 'heuristic:numeric-buttons';

    // ---- 3. 确认按钮（✓ / 确认）----
    const confirmEl =
      q(a.selectors.confirmButton) ??
      candidates.find((b) => a.confirmTexts.some((t) => text(b) === t || text(b) === t.replace(/\s/g, ''))) ??
      null;
    const hasConfirm = !!confirmEl;
    if (confirmEl) evidence.confirmButton = confirmEl === q(a.selectors.confirmButton) ? 'selector' : 'text';

    // ---- 4. 提交按钮 ----
    const submitEl =
      q(a.selectors.submitButton) ??
      candidates.find((b) => a.submitTexts.some((t) => text(b).includes(t) && !a.autoSubmitTexts.some((x) => text(b).includes(x)))) ??
      null;
    const hasSubmit = !!submitEl;
    if (submitEl) evidence.submitButton = 'text';

    // ---- 5. 平台「自动提交」开关状态（只检测，绝不修改）----
    let toggleEl: Element | null = q(a.selectors.autoSubmitToggle);
    if (!toggleEl) {
      // 找文本包含「自动提交」的 label/switch/checkbox
      toggleEl =
        Array.from(doc.querySelectorAll('label, [role="switch"], [role="checkbox"]')).find(
          (el) => visible(el) && a.autoSubmitTexts.some((t) => text(el).includes(t)),
        ) ?? null;
    }
    let autoSubmitState: 'on' | 'off' | 'unknown' = 'unknown';
    if (toggleEl) {
      const checkEl =
        toggleEl.matches('input[type="checkbox"], [role="switch"], [role="checkbox"]')
          ? toggleEl
          : toggleEl.querySelector('input[type="checkbox"], [role="switch"], [role="checkbox"]');
      if (checkEl) {
        const asInput = checkEl as HTMLInputElement;
        const checked =
          asInput.checked !== undefined
            ? asInput.checked
            : checkEl.getAttribute('aria-checked') === 'true' ||
              /(checked|active|on)/i.test(String(checkEl.className ?? ''));
        autoSubmitState = checked ? 'on' : 'off';
        evidence.autoSubmitToggle = 'dom-state';
      } else {
        // 只找到文本标签没有开关控件：保守视为 off
        autoSubmitState = 'off';
        evidence.autoSubmitToggle = 'label-only-assume-off';
      }
    }

    // ---- 6. 页面左上角考试信息（如「高三英语 题块2 五.66 进度：301/302」）----
    let examInfo: PageAnalysis['exam_info'] = null;
    {
      // 找含「题块」的最小容器（优先带科目前缀的），找不到再退化拼装独立叶子文本
      const cands: Array<{ t: string; len: number; hasSubject: boolean }> = [];
      for (const el of Array.from(doc.querySelectorAll('div,span,p,li,h1,h2,h3,h4'))) {
        const t = text(el);
        if (t.includes('题块') && t.length <= 80) {
          cands.push({ t, len: t.length, hasSubject: /^[\u4e00-\u9fa5A-Za-z0-9]+\s*(?=题块)/.test(t) });
        }
      }
      cands.sort((a, b) => (b.hasSubject ? 1 : 0) - (a.hasSubject ? 1 : 0) || a.len - b.len);
      let blockNum: number | null = null;
      let qnNum: number | null = null;
      let partNum: number | null = null;
      let subject = '';
      // 中文数字 → 阿拉伯数字（只处理单个汉字，如「五」→5）
      const zhDigit: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      // 「五.66」→ 大题 5、题号 66；叶子文本兜底时只接受「带中文大题前缀」或「>20 的整数」（排除 0-15 分数按钮）
      const parseQn = (t: string): { part: number | null; qn: number | null } => {
        const m = t.match(/([一二三四五六七八九十]+)[.、．]\s*(\d{1,3})/) ?? t.match(/(?:^|\s)([一二三四五六七八九十]+)\s*[.、．]\s*(\d{1,3})(?=\s|$)/);
        if (m) return { part: zhDigit[m[1]!] ?? null, qn: parseInt(m[2]!, 10) };
        const plain = t.match(/^\s*(\d{1,3})\s*$/);
        if (plain && !t.includes('/')) {
          const n = parseInt(plain[1]!, 10);
          return n > 20 ? { part: null, qn: n } : { part: null, qn: null };
        }
        return { part: null, qn: null };
      };
      if (cands.length) {
        // 单个容器包含头部信息：直接解析
        const t = cands[0]!.t;
        const bm = t.match(/题块\s*(\d+)/);
        if (bm) blockNum = parseInt(bm[1]!, 10);
        const pq = parseQn(t);
        if (pq.qn !== null) {
          qnNum = pq.qn;
          partNum = pq.part;
        }
        let sm = t.match(/^([\u4e00-\u9fa5A-Za-z0-9]+?)\s*(?=题块)/);
        if (!sm) sm = t.match(/^([\u4e00-\u9fa5A-Za-z0-9]+?)\s*(?=$)/);
        if (sm) subject = sm[1]!.trim();
      }
      // 缺失的字段从独立叶子文本补齐（好分数常把「五.66」「题块2」拆成多处）
      if (blockNum === null || qnNum === null) {
        for (const el of Array.from(doc.querySelectorAll('span,div,b,i,p'))) {
          if (el.children.length > 0) continue;
          const t = text(el);
          if (blockNum === null && /^题块\s*(\d+)$/.test(t)) blockNum = parseInt(t.match(/^题块\s*(\d+)$/)![1]!, 10);
          if (qnNum === null) {
            const pq = parseQn(t);
            if (pq.qn !== null) {
              qnNum = pq.qn;
              partNum = partNum ?? pq.part;
            }
          }
          if (blockNum !== null && qnNum !== null) break;
        }
      }
      // 去掉评阅模式标签（单评/双评/三评/仲裁/复评/初评），避免被误认为科目
      subject = subject
        .replace(/(单评|双评|三评|仲裁|复评|初评|评卷|评阅)/g, '')
        .trim();
      if (blockNum !== null || qnNum !== null) {
        examInfo = { subject, block: blockNum, part: partNum, question_number: qnNum };
        evidence.examInfo = cands.length ? 'header-container' : 'leaf-parts';
      }
    }

    // ---- 6.5 题号（优先级：selector → 左上角「五.66」→ 标题 → 叶子文本）----
    let questionNumber: number | null = null;
    const qnEl = q(a.selectors.questionNumber);
    const qnText = text(qnEl);
    const qnMatch = qnText.match(/(\d{1,3})\s*(?:题|\.|、|：|$)/);
    if (qnMatch) {
      questionNumber = parseInt(qnMatch[1]!, 10);
      evidence.questionNumber = qnEl ? 'selector' : 'regex';
    } else if (examInfo?.question_number !== null && examInfo?.question_number !== undefined) {
      questionNumber = examInfo.question_number;
      evidence.questionNumber = 'exam-info';
    } else {
      // 页面范围兜底：标题/粗体文本中的题号模式
      for (const el of Array.from(doc.querySelectorAll('h1,h2,h3,h4,strong,.title,.question,.question-title,.q-title'))) {
        const t = text(el);
        const m = t.match(/(\d{1,3})\s*\.\s*(书面表达|作文|写作)/);
        if (m) {
          questionNumber = parseInt(m[1]!, 10);
          evidence.questionNumber = 'heading-regex';
          break;
        }
      }
      // 好分数等平台把题号显示为「五.66」这类叶子文本（只接受带中文大题前缀或 >20 的整数，排除 0-15 分数按钮）
      if (questionNumber === null) {
        for (const el of Array.from(doc.querySelectorAll('span,div,b,i,p'))) {
          if (el.children.length > 0) continue;
          const t = text(el);
          const m = t.match(/^([一二三四五六七八九十]+)[.、．]\s*(\d{1,3})\s*$/);
          if (m) {
            questionNumber = parseInt(m[2]!, 10);
            evidence.questionNumber = 'leaf-text';
            break;
          }
          const plain = t.match(/^\s*(\d{1,3})\s*$/);
          if (plain && !t.includes('/') && parseInt(plain[1]!, 10) > 20) {
            questionNumber = parseInt(plain[1]!, 10);
            evidence.questionNumber = 'leaf-text';
            break;
          }
        }
      }
    }

    // ---- 6.6 平台阅卷进度（如「进度：302/302/--」）----
    let progress: PageAnalysis['progress'] = null;
    for (const el of Array.from(doc.querySelectorAll('span,div,b,p'))) {
      if (el.children.length > 0) continue;
      const t = text(el);
      const m = t.match(/(?:进度|已评)[^0-9]{0,8}(\d{1,6})\s*\/\s*(\d{1,6})/);
      if (m) {
        progress = { done: parseInt(m[1]!, 10), total: parseInt(m[2]!, 10) };
        evidence.progress = 'leaf-text';
        break;
      }
    }

    // ---- 7. 学生标识（仅记录/防错，不做任何登录用途）----
    let idEl = q(a.selectors.studentIdentity);
    if (!idEl) {
      // 兜底：文本含 考生/考号/姓名/学号 的可见元素（首个）
      for (const el of Array.from(doc.querySelectorAll('div, span, td, li, p, b'))) {
        if (!visible(el)) continue;
        const t = text(el);
        if (t.length <= 64 && /(考生|考号|姓名|学号)/.test(t)) {
          idEl = el;
          evidence.studentIdentity = 'heuristic:text';
          break;
        }
      }
    } else {
      evidence.studentIdentity = 'selector';
    }
    const studentIdentity = idEl ? (text(idEl).slice(0, 64) || null) : null;

    // ---- 8. 当前分数状态 ----
    let currentScore: number | null = null;
    const csEl = q(a.selectors.currentScore);
    const csText = text(csEl);
    const csMatch = csText.match(/(\d{1,2})/);
    if (csMatch && csEl) {
      const n = parseInt(csMatch[1]!, 10);
      if (n >= range.min && n <= range.max) currentScore = n;
      evidence.currentScore = 'selector';
    }
    if (currentScore === null) {
      // 分数按钮的选中态（class/aria）
      for (const b of scoreButtons) {
        const cls = b.className || '';
        const pressed = b.getAttribute('aria-pressed');
        if (pressed === 'true' || /(active|selected|checked|current|on)/i.test(cls)) {
          const n = parseInt(text(b), 10);
          if (!Number.isNaN(n)) {
            currentScore = n;
            evidence.currentScore = 'selected-state';
            break;
          }
        }
      }
    }

    // ---- 9. 人工介入检测（登录过期/验证码/二次认证等，§2）----
    // 仅当匹配文本位于「可见弹窗/遮罩」内，或页面缺少阅卷要素（作文图+评分面板）时判定为干预，
    // 避免页面上「验证码」只是帮助链接/设置文字时误暂停。
    let intervention: PageAnalysis['intervention_needed'] = null;
    type InterventionType = NonNullable<PageAnalysis['intervention_needed']>['type'];
    const markers: Array<[InterventionType, RegExp]> = [
      ['captcha', /验证码|图形验证|滑动验证|安全验证/],
      ['auth_expired', /登录已过期|登录过期|会话过期|请重新登录|重新登录/],
      ['login', /账号登录|密码登录|手机号登录|扫码登录/],
      ['security', /短信验证|二次认证|身份验证/],
    ];
    for (const [type, re] of markers) {
      if (!re.test(text(doc.body))) continue;
      // 找实际匹配的可见元素
      let matched: Element | null = null;
      for (const el of Array.from(doc.querySelectorAll('div,span,p,label,b,strong'))) {
        if (!visible(el)) continue;
        const t = text(el);
        if (re.test(t) && t.length <= 60) {
          matched = el;
          break;
        }
      }
      if (!matched) continue;
      const inDialog = !!matched.closest(
        'dialog, [role="dialog"], .el-dialog, .el-message-box, .modal, [class*="dialog"], [class*="modal"], [class*="popup"], [class*="mask"]',
      );
      const gradingMissing = !essayEl || !hasScorePanel;
      if (inDialog || gradingMissing) {
        intervention = { type, detail: `页面出现「${text(matched).match(re)?.[0] ?? type}」相关提示，请人工处理` };
        break;
      }
    }

    // ---- 10. URL 模式佐证 ----
    let urlMatched = false;
    for (const pat of a.urlPatterns) {
      try {
        if (new RegExp(pat).test(a.url)) {
          urlMatched = true;
          evidence.url = `pattern:${pat}`;
          break;
        }
      } catch {
        /* 非法正则跳过 */
      }
    }

    const hasEssayImage = !!essayEl;
    const isGradingPage =
      hasEssayImage && hasScorePanel && (hasConfirm || hasSubmit) && !intervention;
    if (essayMethod === 'heuristic' && essayEl) {
      evidence.essayImage = 'heuristic';
    }

    return {
      is_grading_page: isGradingPage,
      question_number: questionNumber,
      current_score: currentScore,
      has_submission_button: hasSubmit,
      has_score_panel: hasScorePanel,
      has_essay_image: hasEssayImage,
      student_identity: studentIdentity,
      auto_submit_state: autoSubmitState,
      intervention_needed: intervention,
      score_panel_scores: scores,
      progress,
      exam_info: examInfo,
      evidence: { ...evidence, urlMatched: String(urlMatched) },
    };
  }, args);
}
