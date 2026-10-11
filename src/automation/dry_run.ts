import type { Locator, Page } from 'playwright-core';

/**
 * DRY RUN（§18）—— 高亮目标按钮，绝不真正点击。
 * 高亮采用注入覆盖层 + data 标记（供测试断言与人工核验），不依赖固定坐标。
 */

const HIGHLIGHT_ID = '__essay_agent_highlight__';
const OUTLINE_ID = '__essay_agent_highlight_outline__';
export const TARGET_ATTR = 'data-essay-agent-target';

export async function highlightLocator(
  page: Page,
  locator: Locator,
  opts: { label: string; score: number },
): Promise<void> {
  await removeHighlight(page);
  await locator.evaluate(
    (el, { lbl, outlineId, labelId, targetAttr }) => {
      const rect = el.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.id = labelId;
      overlay.textContent = lbl;
      overlay.style.cssText = [
        'position:fixed',
        `left:${Math.max(0, rect.left - 4)}px`,
        `top:${Math.max(0, rect.top - 28)}px`,
        'z-index:2147483647',
        'background:#ff9800',
        'color:#fff',
        'padding:2px 10px',
        'border-radius:4px',
        'font:bold 13px system-ui,sans-serif',
        'pointer-events:none',
        'box-shadow:0 2px 8px rgba(0,0,0,.35)',
      ].join(';');
      const outline = document.createElement('div');
      outline.id = outlineId;
      outline.style.cssText = [
        'position:fixed',
        `left:${rect.left - 4}px`,
        `top:${rect.top - 4}px`,
        `width:${rect.width + 8}px`,
        `height:${rect.height + 8}px`,
        'z-index:2147483646',
        'pointer-events:none',
        'border:3px dashed #ff9800',
        'border-radius:6px',
        'box-shadow:0 0 0 4px rgba(255,152,0,.25), inset 0 0 0 2px rgba(255,152,0,.25)',
      ].join(';');
      document.body.appendChild(outline);
      document.body.appendChild(overlay);
      el.setAttribute(targetAttr, String(lbl));
    },
    { lbl: opts.label, outlineId: OUTLINE_ID, labelId: HIGHLIGHT_ID, targetAttr: TARGET_ATTR },
  );
}

export async function removeHighlight(page: Page): Promise<void> {
  await page
    .evaluate(({ labelId, outlineId, targetAttr }) => {
      document.getElementById(labelId)?.remove();
      document.getElementById(outlineId)?.remove();
      document.querySelectorAll(`[${targetAttr}]`).forEach((el) => el.removeAttribute(targetAttr));
    }, { labelId: HIGHLIGHT_ID, outlineId: OUTLINE_ID, targetAttr: TARGET_ATTR })
    .catch(() => {});
}
