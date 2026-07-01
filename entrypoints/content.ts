import type {
  BackgroundMessage,
  ContentMessage,
  PageModeApplyResponse,
  PageMeta,
  PageRenderMode,
  PageRestoreResponse,
  PageTranslationProgress,
  PageTranslationResponse,
  TextBlock,
  TranslationStyle,
  TranslationResult,
} from '@/lib/types';

const UI_ROOT_ID = 'context-translate-root';
const STYLE_ID = 'context-translate-styles';
const TRANSLATION_ATTR = 'data-context-translate';
const ORIGINAL_ATTR = 'data-context-translate-original';
const PROGRESS_ROOT_ID = 'context-translate-progress';
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption';
const MAX_PAGE_BLOCK_TEXT_LENGTH = 4000;
const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'input',
  'select',
  'option',
  'button',
  'summary',
  'code',
  'pre',
  'kbd',
  'samp',
  'table',
  'nav',
  'aside',
  'header',
  'footer',
  'menu',
  '[role="grid"]',
  '[role="tree"]',
  '[role="menu"]',
  '[role="navigation"]',
  '[contenteditable="true"]',
  `[${TRANSLATION_ATTR}]`,
].join(',');

const blockElements = new Map<string, HTMLElement>();
let tooltip: HTMLElement | undefined;
let progressPanel: HTMLElement | undefined;
let pinned = false;
let translationInFlight = false;
let pageTranslationInFlight = false;
let currentTranslationStyle: TranslationStyle = 'none';
const translatedItems = new Map<string, TranslationResult>();

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    injectStyles();

    document.addEventListener('mouseup', (event) => {
      if (isInsideExtensionUi(event.target as Node)) {
        return;
      }

      window.setTimeout(() => {
        void translateCurrentSelection();
      }, 30);
    });

    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!pinned && tooltip && !isInsideExtensionUi(event.target as Node)) {
          hideTooltip();
        }
      },
      true,
    );

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !pinned) {
        hideTooltip();
      }
    });

    browser.runtime.onMessage.addListener(
      async (message: ContentMessage): Promise<unknown> => {
        switch (message.type) {
          case 'TRANSLATE_PAGE':
            return translateCurrentPage();

          case 'RESTORE_PAGE':
            return restorePage();

          case 'APPLY_PAGE_MODE':
            return applyStoredPageMode(message.payload.pageMode);

          case 'SHOW_SELECTION_TRANSLATION':
            return translateCurrentSelection(message.payload.text);

          case 'PAGE_TRANSLATION_PROGRESS':
            showPageProgress(message.payload);
            return undefined;

          case 'PAGE_TRANSLATION_BATCH':
            applyPageTranslations({
              pageMode: message.payload.pageMode,
              translationStyle: message.payload.translationStyle,
              pageContext: {
                summary: '',
                glossary: {},
                style: '',
                sourceLanguage: '',
              },
              items: message.payload.items,
            });
            return undefined;

          default:
            return undefined;
        }
      },
    );
  },
});

async function translateCurrentSelection(forcedText?: string) {
  if (translationInFlight) {
    return;
  }

  const selection = window.getSelection();
  const selectedText = (forcedText || selection?.toString() || '').trim();

  if (selectedText.length < 2 || selectedText.length > 4000) {
    return;
  }

  const settings = (await browser.runtime.sendMessage({
    type: 'GET_SETTINGS',
  } satisfies BackgroundMessage)) as { selectionTranslationEnabled?: boolean };
  if (!settings.selectionTranslationEnabled) {
    return;
  }

  if (!forcedText && selection && isInsideExtensionUi(selection.anchorNode)) {
    return;
  }

  const range =
    !forcedText && selection && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : undefined;
  const rect = range?.getBoundingClientRect();
  const context = buildSelectionContext(range);
  const pageMeta = getPageMeta(context.nearestHeading);

  translationInFlight = true;
  showTooltip({
    rect,
    originalText: selectedText,
    translatedText: '',
    status: '正在结合上下文翻译',
    loading: true,
  });

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'TRANSLATE_SELECTION',
      payload: {
        mode: 'selection',
        text: selectedText,
        targetLanguage: '',
        context: {
          beforeText: context.beforeText,
          afterText: context.afterText,
          currentParagraph: context.currentParagraph,
        },
        pageMeta,
      },
    } satisfies BackgroundMessage)) as TranslationResult;

    showTooltip({
      rect,
      originalText: selectedText,
      translatedText: response.translatedText,
      status: '翻译完成',
      loading: false,
    });
  } catch (error) {
    showTooltip({
      rect,
      originalText: selectedText,
      translatedText: getErrorMessage(error),
      status: '翻译失败',
      loading: false,
      error: true,
    });
  } finally {
    translationInFlight = false;
  }
}

async function translateCurrentPage() {
  if (pageTranslationInFlight) {
    showToast('Page translation is already running.');
    return { translated: 0 };
  }

  pageTranslationInFlight = true;
  const blocks = extractTextBlocks();
  if (!blocks.length) {
    pageTranslationInFlight = false;
    showToast('No readable text found on this page.');
    return { translated: 0 };
  }

  showPageProgress({
    stage: 'extracting',
    translated: 0,
    total: blocks.length,
    message: `Found ${blocks.length} readable text blocks`,
  });

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'TRANSLATE_PAGE',
      payload: {
        blocks,
        pageMeta: getPageMeta(),
      },
    } satisfies BackgroundMessage)) as PageTranslationResponse;

    applyPageTranslations(response);
    showPageProgress({
      stage: 'complete',
      translated: response.items.length,
      total: blocks.length,
      message: `Translated ${response.items.length} text blocks`,
    });
    return { translated: response.items.length, pageContext: response.pageContext };
  } catch (error) {
    showPageProgress({
      stage: 'error',
      translated: 0,
      total: blocks.length,
      message: getErrorMessage(error),
    });
    showToast(getErrorMessage(error), true);
    throw error;
  } finally {
    pageTranslationInFlight = false;
  }
}

function restorePage(): PageRestoreResponse {
  let restoredCount = 0;

  document
    .querySelectorAll(`[${TRANSLATION_ATTR}="injected"]`)
    .forEach((node) => {
      node.remove();
      restoredCount += 1;
    });

  document.querySelectorAll<HTMLElement>(`[${ORIGINAL_ATTR}]`).forEach((node) => {
    const original = node.getAttribute(ORIGINAL_ATTR);
    if (original !== null) {
      node.textContent = original;
      node.removeAttribute(ORIGINAL_ATTR);
      node.removeAttribute(TRANSLATION_ATTR);
      restoredCount += 1;
    }
  });

  translatedItems.clear();

  const message =
    restoredCount > 0
      ? `已恢复原文，共处理 ${restoredCount} 处译文。`
      : '当前页面没有可恢复的译文。';
  showToast(message);
  hidePageProgress();
  return { restored: restoredCount > 0, restoredCount, message };
}

function extractTextBlocks(): TextBlock[] {
  blockElements.clear();

  const body = document.body;
  if (!body) {
    return [];
  }
  const root = getTranslationRoot(body);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
      const parent = node.parentElement;

      if (
        !parent ||
        text.length < 2 ||
        parent.closest(SKIP_SELECTOR) ||
        isLikelyChromeOrRepositoryUi(parent)
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      const block = getBlockElement(parent);
      if (!block || !isVisible(block) || shouldSkipBlock(block)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const grouped = new Map<HTMLElement, string[]>();
  let node = walker.nextNode();

  while (node) {
    const parent = node.parentElement;
    const block = parent ? getBlockElement(parent) : undefined;
    if (block) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim();
      if (text) {
        grouped.set(block, [...(grouped.get(block) || []), text]);
      }
    }
    node = walker.nextNode();
  }

  const createdAt = Date.now();
  const blocks = Array.from(grouped.entries())
    .flatMap(([element, parts], index) => {
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (text.length < 8 || text.length > MAX_PAGE_BLOCK_TEXT_LENGTH) {
        return [];
      }

      const id = `ct-block-${createdAt}-${index}`;
      blockElements.set(id, element);

      return [{
        id,
        text,
        kind: element.tagName.toLowerCase(),
      }];
    });

  return blocks.map((block, index) => ({
    ...block,
    before: blocks[index - 1]?.text,
    after: blocks[index + 1]?.text,
  }));
}

function getTranslationRoot(body: HTMLElement) {
  const selectors = [
    '.markdown-body',
    '[data-testid="readme"]',
    '#readme',
    '.readme',
    '[itemprop="text"]',
    'main article',
    'article',
  ];

  for (const selector of selectors) {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).filter((element) => isVisible(element) && element.innerText.trim().length > 80);

    if (candidates.length) {
      return candidates.sort(
        (left, right) => right.innerText.length - left.innerText.length,
      )[0];
    }
  }

  return body;
}

async function applyStoredPageMode(
  pageMode: PageRenderMode,
): Promise<PageModeApplyResponse> {
  if (!translatedItems.size) {
    const message = '还没有可切换的译文，请先翻译当前页面。';
    showToast(message);
    return {
      applied: false,
      pageMode,
      translatedCount: 0,
      message,
    };
  }

  const settings = (await browser.runtime.sendMessage({
    type: 'GET_SETTINGS',
  } satisfies BackgroundMessage)) as { translationStyle?: TranslationStyle };

  applyPageTranslations(
    {
      pageMode,
      translationStyle: settings.translationStyle || currentTranslationStyle,
      pageContext: {
        summary: '',
        glossary: {},
        style: '',
        sourceLanguage: '',
      },
      items: Array.from(translatedItems.values()),
    },
    { remember: false },
  );

  const message = `已切换为${getPageModeLabel(pageMode)}显示。`;
  showToast(message);
  return {
    applied: true,
    pageMode,
    translatedCount: translatedItems.size,
    message,
  };
}

function applyPageTranslations(
  response: PageTranslationResponse,
  options: { remember?: boolean } = {},
) {
  const remember = options.remember ?? true;
  currentTranslationStyle = response.translationStyle || 'none';

  for (const item of response.items) {
    if (!item.id) {
      continue;
    }

    if (remember) {
      translatedItems.set(item.id, item);
    }

    const element = blockElements.get(item.id);
    if (!element || !item.translatedText.trim()) {
      continue;
    }

    if (response.pageMode === 'replace') {
      removeInjectedTranslation(element);
      if (!element.hasAttribute(ORIGINAL_ATTR)) {
        element.setAttribute(ORIGINAL_ATTR, element.textContent || '');
      }
      element.setAttribute(TRANSLATION_ATTR, 'replaced');
      element.textContent = item.translatedText;
      continue;
    }

    restoreElementOriginal(element);

    if (isHeadingElement(element)) {
      const existingInline = element.querySelector<HTMLElement>(
        `:scope > [${TRANSLATION_ATTR}="injected"]`,
      );
      if (existingInline) {
        existingInline.className = createTranslationClassName(
          currentTranslationStyle,
          true,
        );
        existingInline.textContent = ` ${item.translatedText}`;
        continue;
      }

      const inlineTranslation = document.createElement('span');
      inlineTranslation.setAttribute(TRANSLATION_ATTR, 'injected');
      inlineTranslation.className = createTranslationClassName(
        currentTranslationStyle,
        true,
      );
      inlineTranslation.textContent = ` ${item.translatedText}`;
      element.append(inlineTranslation);
      continue;
    }

    const existingBlock = element.nextElementSibling;
    if (existingBlock?.getAttribute(TRANSLATION_ATTR) === 'injected') {
      existingBlock.className = createTranslationClassName(
        currentTranslationStyle,
        false,
      );
      existingBlock.textContent = item.translatedText;
      continue;
    }

    const translation = document.createElement('div');
    translation.setAttribute(TRANSLATION_ATTR, 'injected');
    translation.className = createTranslationClassName(
      currentTranslationStyle,
      false,
    );
    translation.textContent = item.translatedText;
    element.insertAdjacentElement('afterend', translation);
  }
}

function createTranslationClassName(
  style: TranslationStyle,
  inline: boolean,
) {
  return [
    'ct-page-translation',
    inline ? 'ct-page-translation-inline' : 'ct-page-translation-block',
    `ct-style-${style}`,
  ].join(' ');
}

function restoreElementOriginal(element: HTMLElement) {
  const original = element.getAttribute(ORIGINAL_ATTR);
  if (original === null) {
    return;
  }

  element.textContent = original;
  element.removeAttribute(ORIGINAL_ATTR);
  element.removeAttribute(TRANSLATION_ATTR);
}

function removeInjectedTranslation(element: HTMLElement) {
  if (isHeadingElement(element)) {
    element
      .querySelectorAll<HTMLElement>(`:scope > [${TRANSLATION_ATTR}="injected"]`)
      .forEach((node) => node.remove());
    return;
  }

  const next = element.nextElementSibling;
  if (next?.getAttribute(TRANSLATION_ATTR) === 'injected') {
    next.remove();
  }
}

function isHeadingElement(element: HTMLElement) {
  return /^H[1-6]$/.test(element.tagName);
}

function getPageModeLabel(pageMode: PageRenderMode) {
  return pageMode === 'replace' ? '替换原文' : '双语';
}

function buildSelectionContext(range?: Range) {
  const block = range
    ? getBlockElement(
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement,
      )
    : undefined;

  const currentParagraph = block?.innerText?.replace(/\s+/g, ' ').trim() || '';
  const previous = findNearbyText(block, 'previousElementSibling');
  const next = findNearbyText(block, 'nextElementSibling');
  const nearestHeading = findNearestHeading(block);

  return {
    beforeText: previous,
    afterText: next,
    currentParagraph,
    nearestHeading,
  };
}

function getPageMeta(nearestHeading?: string): PageMeta {
  return {
    title: document.title || '',
    url: location.href,
    hostname: location.hostname,
    nearestHeading,
  };
}

function getBlockElement(node: Element | null): HTMLElement | undefined {
  if (!node) {
    return undefined;
  }

  const block = node.closest(BLOCK_SELECTOR);
  if (block instanceof HTMLElement) {
    return block;
  }

  return undefined;
}

function shouldSkipBlock(element: HTMLElement) {
  const text = element.innerText?.replace(/\s+/g, ' ').trim() || '';
  const tag = element.tagName.toLowerCase();

  if (!text || text.length < 8) {
    return true;
  }

  if (element.closest(SKIP_SELECTOR) || isLikelyChromeOrRepositoryUi(element)) {
    return true;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 12) {
    return true;
  }

  if (tag === 'li' && text.length < 18 && element.closest('nav, menu')) {
    return true;
  }

  const linkText = Array.from(element.querySelectorAll('a'))
    .map((link) => link.textContent?.trim() || '')
    .join(' ');
  if (linkText && linkText.length / text.length > 0.85 && text.length < 80) {
    return true;
  }

  return false;
}

function isLikelyChromeOrRepositoryUi(element: Element) {
  return Boolean(
    element.closest(
      [
        '[data-testid="tree-browser"]',
        '[data-testid="repos-file-tree"]',
        '[data-view-component="true"][role="row"]',
        '.react-directory-filename-column',
        '.file-navigation',
        '.js-navigation-container',
        '.Box-row',
        '.Layout-sidebar',
        '.BorderGrid',
      ].join(','),
    ),
  );
}

function findNearbyText(
  block: HTMLElement | undefined,
  direction: 'previousElementSibling' | 'nextElementSibling',
) {
  let cursor = block?.[direction] as Element | null | undefined;
  let hops = 0;

  while (cursor && hops < 5) {
    if (cursor instanceof HTMLElement && isVisible(cursor)) {
      const text = cursor.innerText?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 3) {
        return text.slice(0, 900);
      }
    }

    cursor = cursor[direction] as Element | null;
    hops += 1;
  }

  return '';
}

function findNearestHeading(block?: HTMLElement) {
  if (!block) {
    return '';
  }

  const headings = Array.from(
    document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
  ).filter(isVisible);

  let nearest = '';
  for (const heading of headings) {
    if (
      heading === block ||
      heading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      nearest = heading.innerText.replace(/\s+/g, ' ').trim();
    }
  }

  return nearest;
}

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isInsideExtensionUi(node: Node | null) {
  if (!node) {
    return false;
  }
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(`#${UI_ROOT_ID}, [${TRANSLATION_ATTR}]`));
}

function showTooltip(options: {
  rect?: DOMRect;
  originalText: string;
  translatedText: string;
  status: string;
  loading: boolean;
  error?: boolean;
}) {
  tooltip = ensureTooltip();
  const top = Math.max(16, (options.rect?.bottom || window.innerHeight / 3) + 12);
  const left = Math.min(
    window.innerWidth - 390,
    Math.max(16, options.rect?.left || window.innerWidth / 2 - 180),
  );

  tooltip.style.top = `${top + window.scrollY}px`;
  tooltip.style.left = `${left + window.scrollX}px`;
  tooltip.innerHTML = `
    <div class="ct-tip-head">
      <span class="ct-tip-brand">Context Translate</span>
      <div class="ct-tip-actions">
        <button type="button" data-ct-action="pin" title="固定">${pinned ? '已固定' : '固定'}</button>
        <button type="button" data-ct-action="close" title="关闭">关闭</button>
      </div>
    </div>
    <div class="ct-tip-original-wrap">
      <span class="ct-tip-label">原文</span>
      <div class="ct-tip-original"></div>
    </div>
    <div class="ct-tip-status ${options.error ? 'ct-error' : ''} ${options.loading ? 'ct-tip-status-loading' : ''}">
      <span class="ct-dot ${options.loading ? 'ct-pulse' : ''}"></span>
      <span>${escapeHtml(options.status)}</span>
    </div>
    <div class="ct-tip-result ${options.error ? 'ct-error' : ''} ${options.loading ? 'ct-tip-result-loading' : ''}"></div>
    <div class="ct-tip-foot ${options.loading ? 'ct-tip-foot-hidden' : ''}">
      <button type="button" data-ct-action="copy">复制译文</button>
    </div>
  `;

  tooltip.querySelector('.ct-tip-original')!.textContent = options.originalText;
  const result = tooltip.querySelector('.ct-tip-result')!;
  if (options.loading) {
    result.innerHTML = `
      <div class="ct-loading-shell" aria-label="正在生成译文">
        <div class="ct-loading-topline">
          <span>生成译文中</span>
          <i></i>
        </div>
        <div class="ct-loading-bars">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="ct-loading-rail"><span></span></div>
      </div>
    `;
  } else {
    result.textContent = options.translatedText;
  }
}

function ensureTooltip() {
  const existing = document.getElementById(UI_ROOT_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement('div');
  root.id = UI_ROOT_ID;
  root.addEventListener('mousedown', (event) => event.stopPropagation());
  root.addEventListener('mouseup', (event) => event.stopPropagation());
  root.addEventListener('pointerup', (event) => event.stopPropagation());
  root.addEventListener('click', (event) => {
    const target = getEventElement(event.target);
    const button = target?.closest<HTMLButtonElement>('[data-ct-action]');
    const action = button?.dataset.ctAction;

    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (action === 'close') {
      pinned = false;
      hideTooltip();
      return;
    }

    if (action === 'pin') {
      pinned = !pinned;
      if (button) {
        button.textContent = pinned ? '已固定' : '固定';
      }
      return;
    }

    if (action === 'copy') {
      const text = root.querySelector('.ct-tip-result')?.textContent || '';
      void navigator.clipboard.writeText(text);
    }
  });
  document.documentElement.append(root);
  return root;
}

function getEventElement(target: EventTarget | null) {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return undefined;
}

function hideTooltip() {
  tooltip?.remove();
  tooltip = undefined;
}

function showPageProgress(progress: PageTranslationProgress) {
  progressPanel = ensureProgressPanel();
  const percent =
    progress.total > 0
      ? Math.max(4, Math.round((progress.translated / progress.total) * 100))
      : 8;
  const isDone = progress.stage === 'complete';
  const isError = progress.stage === 'error';

  progressPanel.className = `ct-progress ${isDone ? 'ct-progress-done' : ''} ${
    isError ? 'ct-progress-error' : ''
  }`;
  progressPanel.innerHTML = `
    <div class="ct-progress-row">
      <span class="ct-progress-dot ${isDone || isError ? '' : 'ct-pulse'}"></span>
      <strong>${escapeHtml(isError ? 'Translation failed' : isDone ? 'Translation complete' : 'Translating page')}</strong>
      <span class="ct-progress-count">${progress.translated}/${progress.total}</span>
    </div>
    <div class="ct-progress-message">${escapeHtml(progress.message)}</div>
    <div class="ct-progress-track">
      <span style="width: ${percent}%"></span>
    </div>
  `;

  if (isDone) {
    window.setTimeout(() => {
      if (progressPanel?.classList.contains('ct-progress-done')) {
        hidePageProgress();
      }
    }, 2400);
  }
}

function ensureProgressPanel() {
  const existing = document.getElementById(PROGRESS_ROOT_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement('div');
  root.id = PROGRESS_ROOT_ID;
  root.setAttribute(TRANSLATION_ATTR, 'progress');
  document.documentElement.append(root);
  return root;
}

function hidePageProgress() {
  progressPanel?.remove();
  progressPanel = undefined;
}

function showToast(message: string, error = false) {
  const toast = document.createElement('div');
  toast.setAttribute(TRANSLATION_ATTR, 'toast');
  toast.className = `ct-toast ${error ? 'ct-toast-error' : ''}`;
  toast.textContent = message;
  document.documentElement.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, error ? 5200 : 2600);
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${UI_ROOT_ID} {
      position: absolute;
      z-index: 2147483647;
      width: 340px;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid rgba(208, 217, 226, 0.86);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.98);
      color: #101828;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.14), 0 1px 2px rgba(15, 23, 42, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      backdrop-filter: blur(14px);
    }

    #${UI_ROOT_ID} * {
      box-sizing: border-box;
      font-family: inherit;
      letter-spacing: 0;
    }

    .ct-tip-head,
    .ct-tip-foot,
    .ct-tip-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .ct-tip-head {
      min-height: 26px;
    }

    .ct-tip-brand {
      color: #667085;
      font-size: 11px;
      font-weight: 700;
    }

    .ct-tip-label {
      color: #98a2b3;
      font-size: 10px;
      font-weight: 750;
      text-transform: uppercase;
    }

    .ct-tip-actions {
      display: flex;
      gap: 2px;
    }

    #${UI_ROOT_ID} button {
      min-height: 26px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #667085;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 7px;
    }

    #${UI_ROOT_ID} button:hover {
      background: #f4f7f9;
      color: #007a78;
    }

    .ct-tip-original-wrap {
      margin-top: 8px;
      padding: 9px 10px;
      border-radius: 8px;
      background: #f8fafc;
    }

    .ct-tip-original {
      display: -webkit-box;
      margin-top: 4px;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      color: #475467;
      font-size: 12px;
      line-height: 1.5;
    }

    .ct-tip-status {
      justify-content: flex-start;
      width: fit-content;
      max-width: 100%;
      margin-top: 10px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 999px;
      color: #667085;
      font-size: 11px;
      font-weight: 750;
    }

    .ct-tip-status-loading {
      border-color: transparent;
      background: transparent;
      color: #087571;
    }

    .ct-tip-result {
      margin-top: 8px;
      color: #111827;
      font-size: 14px;
      line-height: 1.62;
      white-space: pre-wrap;
    }

    .ct-tip-result-loading {
      margin-top: 12px;
      white-space: normal;
    }

    .ct-loading-shell {
      position: relative;
      overflow: hidden;
      padding: 10px;
      border: 1px solid #edf1f5;
      border-radius: 8px;
      background: #fbfcfd;
    }

    .ct-loading-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: #667085;
      font-size: 11px;
      font-weight: 750;
    }

    .ct-loading-topline i {
      width: 34px;
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(0, 140, 137, 0.12);
    }

    .ct-loading-topline i::after {
      content: "";
      display: block;
      width: 38%;
      height: 100%;
      border-radius: inherit;
      background: #00a39b;
      animation: ctLoadingDot 1.25s infinite ease-in-out;
    }

    .ct-loading-bars {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .ct-loading-bars span {
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: #eef3f6;
    }

    .ct-loading-bars span:nth-child(1) {
      width: 94%;
    }

    .ct-loading-bars span:nth-child(2) {
      width: 78%;
    }

    .ct-loading-bars span:nth-child(3) {
      width: 58%;
    }

    .ct-loading-bars span::after {
      content: "";
      display: block;
      width: 42%;
      height: 100%;
      transform: translateX(-120%);
      background: linear-gradient(90deg, transparent, rgba(0, 140, 137, 0.24), transparent);
      animation: ctShimmer 1.45s infinite ease-in-out;
    }

    .ct-loading-bars span:nth-child(2)::after {
      animation-delay: 140ms;
    }

    .ct-loading-bars span:nth-child(3)::after {
      animation-delay: 280ms;
    }

    .ct-loading-rail {
      height: 2px;
      margin-top: 13px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(0, 140, 137, 0.12);
    }

    .ct-loading-rail span {
      display: block;
      width: 36%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #008c89, #69d8d2);
      animation: ctRail 1.4s infinite cubic-bezier(0.65, 0, 0.35, 1);
    }

    .ct-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #00a39b;
      display: inline-flex;
    }

    .ct-pulse {
      animation: ctPulse 1s infinite ease-in-out;
    }

    .ct-error {
      color: #b42318;
    }

    .ct-tip-foot {
      justify-content: flex-end;
      margin-top: 10px;
    }

    .ct-tip-foot-hidden {
      display: none;
    }

    [${TRANSLATION_ATTR}="injected"] {
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      font-weight: inherit;
      line-height: inherit;
      opacity: 0.9;
    }

    .ct-page-translation-block {
      display: block;
      margin: 0.18em 0 0.72em;
      padding: 0;
      max-width: min(100%, 78ch);
      color: inherit;
    }

    .ct-page-translation-inline {
      display: inline;
      color: inherit;
    }

    .ct-style-dashed-underline {
      text-decoration-line: underline;
      text-decoration-style: dashed;
      text-decoration-color: rgba(0, 160, 154, 0.68);
      text-underline-offset: 0.18em;
    }

    .ct-style-solid-underline {
      text-decoration-line: underline;
      text-decoration-style: solid;
      text-decoration-color: rgba(0, 140, 137, 0.7);
      text-underline-offset: 0.18em;
    }

    .ct-style-quote.ct-page-translation-block {
      margin-top: 0.32em;
      padding-left: 0.78em;
      border-left: 3px solid #00a39b;
      color: inherit;
    }

    .ct-style-quote.ct-page-translation-inline {
      padding-left: 0.38em;
      border-left: 2px solid #00a39b;
    }

    .ct-style-muted {
      opacity: 0.62;
    }

    .ct-style-background {
      border-radius: 4px;
      background: rgba(0, 140, 137, 0.1);
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }

    .ct-style-background.ct-page-translation-block {
      padding: 0.18em 0.36em;
    }

    .ct-style-background.ct-page-translation-inline {
      padding: 0.06em 0.24em;
    }

    .ct-style-paper.ct-page-translation-block {
      width: fit-content;
      max-width: min(100%, 78ch);
      margin-top: 0.42em;
      padding: 0.62em 0.78em;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
      color: #334155;
    }

    .ct-style-paper.ct-page-translation-inline {
      padding: 0.05em 0.3em;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
    }

    .ct-toast {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 2147483647;
      max-width: 360px;
      padding: 10px 12px;
      border: 1px solid #b7e8e5;
      border-radius: 8px;
      background: #f0fbfa;
      color: #056460;
      box-shadow: 0 10px 32px rgba(16, 24, 40, 0.14);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      font-weight: 600;
    }

    .ct-toast-error {
      border-color: #fecdca;
      background: #fffbfa;
      color: #b42318;
    }

    #${PROGRESS_ROOT_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: 300px;
      max-width: calc(100vw - 36px);
      box-sizing: border-box;
      border: 1px solid rgba(0, 140, 137, 0.28);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.96);
      color: #111827;
      box-shadow: 0 16px 44px rgba(16, 24, 40, 0.18);
      padding: 12px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.35;
      backdrop-filter: blur(12px);
    }

    @media (prefers-color-scheme: dark) {
      #${PROGRESS_ROOT_ID} {
        border-color: rgba(95, 233, 225, 0.35);
        background: rgba(20, 28, 35, 0.94);
        color: #f8fafc;
        box-shadow: 0 16px 44px rgba(0, 0, 0, 0.36);
      }
    }

    .ct-progress-row {
      display: grid;
      grid-template-columns: 10px 1fr auto;
      align-items: center;
      gap: 8px;
    }

    .ct-progress-row strong {
      font-size: 13px;
      font-weight: 750;
    }

    .ct-progress-count {
      color: #667085;
      font-size: 12px;
      font-weight: 700;
    }

    .ct-progress-message {
      margin-top: 7px;
      color: #667085;
      font-size: 12px;
    }

    .ct-progress-track {
      height: 5px;
      margin-top: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(0, 140, 137, 0.14);
    }

    .ct-progress-track span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #00a39b;
      transition: width 220ms ease;
    }

    .ct-progress-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #00a39b;
    }

    .ct-progress-error .ct-progress-dot,
    .ct-progress-error .ct-progress-track span {
      background: #d92d20;
    }

    @keyframes ctPulse {
      0%, 100% { opacity: 0.35; transform: scale(0.85); }
      50% { opacity: 1; transform: scale(1); }
    }

    @keyframes ctShimmer {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(260%); }
    }

    @keyframes ctRail {
      0% { transform: translateX(-110%); }
      100% { transform: translateX(290%); }
    }

    @keyframes ctLoadingDot {
      0%, 100% { transform: translateX(0); opacity: 0.55; }
      50% { transform: translateX(165%); opacity: 1; }
    }
  `;
  document.documentElement.append(style);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown translation error.';
}
