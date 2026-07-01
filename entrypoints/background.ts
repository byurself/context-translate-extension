import { createCacheKey, getCachedTranslation, setCachedTranslation } from '@/lib/cache';
import { getSettings, saveSettings } from '@/lib/storage';
import {
  buildPageContext,
  testTranslationProvider,
  translateText,
} from '@/lib/openaiClient';
import type {
  BackgroundMessage,
  ContentMessage,
  ExtensionSettings,
  PageContext,
  PageTranslationResponse,
  PageTranslationProgress,
  TextBlock,
  TranslationRequest,
  TranslationResult,
} from '@/lib/types';

const SELECTION_CONTEXT_MENU_ID = 'context-translate-selection';
const PAGE_CONTEXT_MENU_ID = 'context-translate-page';
const DEFAULT_PAGE_CONTEXT: PageContext = {
  summary: 'Cached translation.',
  glossary: {},
  style: 'Natural and clear.',
  sourceLanguage: 'auto',
};

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    await createPageContextMenu();
    const settings = await getSettings();
    await syncSelectionContextMenu(settings.selectionTranslationEnabled);
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) {
      return;
    }

    if (info.menuItemId === PAGE_CONTEXT_MENU_ID) {
      await browser.tabs.sendMessage<ContentMessage>(tab.id, {
        type: 'TRANSLATE_PAGE',
      });
      return;
    }

    if (info.menuItemId === SELECTION_CONTEXT_MENU_ID && info.selectionText) {
      const settings = await getSettings();
      if (!settings.selectionTranslationEnabled) {
        return;
      }

      await browser.tabs.sendMessage<ContentMessage>(tab.id, {
        type: 'SHOW_SELECTION_TRANSLATION',
        payload: { text: info.selectionText },
      });
    }
  });

  browser.runtime.onMessage.addListener(
    async (message: BackgroundMessage, sender): Promise<unknown> => {
      switch (message.type) {
        case 'GET_SETTINGS':
          return getSettings();

        case 'SAVE_SETTINGS': {
          const next = await saveSettings(message.payload);
          if (message.payload.selectionTranslationEnabled !== undefined) {
            await syncSelectionContextMenu(next.selectionTranslationEnabled);
          }
          return next;
        }

        case 'TRANSLATE_SELECTION':
          return translateSelection(message.payload);

        case 'TRANSLATE_PAGE':
          return translatePage(
            message.payload.blocks,
            message.payload.pageMeta,
            sender.tab?.id,
          );

        case 'TEST_PROVIDER': {
          const settings = await mergeSettings(message.payload);
          const reply = await testTranslationProvider(settings);
          return { ok: true, reply };
        }

        case 'RUN_ACTIVE_TAB_TRANSLATION':
          return sendToActiveTab({ type: 'TRANSLATE_PAGE' });

        case 'RUN_ACTIVE_TAB_RESTORE':
          return sendToActiveTab({ type: 'RESTORE_PAGE' });

        case 'RUN_ACTIVE_TAB_PAGE_MODE':
          return sendToActiveTab({
            type: 'APPLY_PAGE_MODE',
            payload: message.payload,
          });

        default:
          return undefined;
      }
    },
  );
});

async function syncSelectionContextMenu(enabled: boolean) {
  await browser.contextMenus
    .remove(SELECTION_CONTEXT_MENU_ID)
    .catch(() => undefined);

  if (!enabled) {
    return;
  }

  await browser.contextMenus.create({
    id: SELECTION_CONTEXT_MENU_ID,
    title: '翻译选中文本',
    contexts: ['selection'],
  });
}

async function createPageContextMenu() {
  await browser.contextMenus
    .remove(PAGE_CONTEXT_MENU_ID)
    .catch(() => undefined);

  await browser.contextMenus.create({
    id: PAGE_CONTEXT_MENU_ID,
    title: '翻译当前页面',
    contexts: ['page'],
  });
}

async function mergeSettings(
  patch: Partial<ExtensionSettings> = {},
): Promise<ExtensionSettings> {
  const settings = await getSettings();
  return {
    ...settings,
    ...patch,
    providerConfig: {
      ...settings.providerConfig,
      ...patch.providerConfig,
    },
    glossary: patch.glossary ?? settings.glossary,
  };
}

async function translateSelection(request: TranslationRequest) {
  const settings = await getSettings();
  if (!settings.selectionTranslationEnabled) {
    throw new Error('划词翻译已关闭');
  }

  const targetLanguage = request.targetLanguage || settings.targetLanguage;

  const cacheKey = createSelectionCacheKey(settings, {
    ...request,
    targetLanguage,
  });
  if (settings.cacheEnabled) {
    const cached = await getCachedTranslation(cacheKey, settings.cacheTtlMs);
    if (cached) {
      return {
        originalText: cached.originalText,
        translatedText: cached.translatedText,
      } satisfies TranslationResult;
    }
  }

  const translatedText = await translateText(settings, {
    ...request,
    targetLanguage,
  });

  const result = {
    originalText: request.text,
    translatedText,
  } satisfies TranslationResult;

  if (settings.cacheEnabled) {
    await setCachedTranslation({
      key: cacheKey,
      createdAt: Date.now(),
      ...result,
    });
  }

  return result;
}

async function translatePage(
  blocks: TextBlock[],
  pageMeta: TranslationRequest['pageMeta'],
  tabId?: number,
): Promise<PageTranslationResponse> {
  const settings = await getSettings();
  await sendPageProgress(tabId, {
    stage: 'analyzing',
    translated: 0,
    total: blocks.length,
    message: '正在检查缓存...',
  });

  const blockCacheKeys = new Map(
    blocks.map((block) => [block.id, createPageBlockCacheKey(settings, block, pageMeta)]),
  );
  const cachedBlocks = new Map<string, TranslationResult>();
  if (settings.cacheEnabled) {
    for (const block of blocks) {
      const cacheKey = blockCacheKeys.get(block.id);
      if (!cacheKey) {
        continue;
      }

      const cached = await getCachedTranslation(cacheKey, settings.cacheTtlMs);
      if (cached) {
        cachedBlocks.set(block.id, {
          id: block.id,
          originalText: cached.originalText,
          translatedText: cached.translatedText,
        });
      }
    }
  }

  if (cachedBlocks.size > 0) {
    await sendPageProgress(tabId, {
      stage: 'analyzing',
      translated: cachedBlocks.size,
      total: blocks.length,
      message: `缓存命中 ${cachedBlocks.size}/${blocks.length} 个文本块`,
    });
  }

  const allBlocksCached = cachedBlocks.size === blocks.length;
  const pageContext = allBlocksCached
    ? (await getCachedPageContext(settings, blocks, pageMeta)) ||
      DEFAULT_PAGE_CONTEXT
    : await getOrBuildPageContext(settings, blocks, pageMeta);
  const items: TranslationResult[] = [];

  for (const [index, block] of blocks.entries()) {
    const cached = cachedBlocks.get(block.id);
    if (cached) {
      items.push(cached);
      await sendPageBatch(
        tabId,
        settings.pageMode,
        settings.translationStyle,
        [cached],
      );
      await sendPageProgress(tabId, {
        stage: 'translating',
        translated: index + 1,
        total: blocks.length,
        message: `已使用缓存 ${index + 1}/${blocks.length}`,
      });
      continue;
    }

    const translatedText = await translateText(settings, {
      mode: 'page-block',
      text: block.text,
      targetLanguage: settings.targetLanguage,
      pageMeta,
      context: {
        beforeText: block.before,
        afterText: block.after,
        pageSummary: pageContext.summary,
        glossary: pageContext.glossary,
      },
    });

    const result = {
      id: block.id,
      originalText: block.text,
      translatedText,
    };
    items.push(result);
    await sendPageBatch(
      tabId,
      settings.pageMode,
      settings.translationStyle,
      [result],
    );
    await sendPageProgress(tabId, {
      stage: 'translating',
      translated: index + 1,
      total: blocks.length,
      message: `正在翻译 ${index + 1}/${blocks.length}`,
    });

    if (settings.cacheEnabled) {
      const cacheKey = blockCacheKeys.get(block.id);
      if (!cacheKey) {
        continue;
      }

      await setCachedTranslation({
        key: cacheKey,
        createdAt: Date.now(),
        ...result,
      });
    }
  }

  await sendPageProgress(tabId, {
    stage: 'complete',
    translated: items.length,
    total: blocks.length,
    message:
      cachedBlocks.size === items.length
        ? `已从缓存恢复 ${items.length} 个文本块`
        : `已翻译 ${items.length} 个文本块，其中缓存命中 ${cachedBlocks.size} 个`,
  });

  return {
    pageContext,
    pageMode: settings.pageMode,
    translationStyle: settings.translationStyle,
    items,
  };
}

async function getOrBuildPageContext(
  settings: ExtensionSettings,
  blocks: TextBlock[],
  pageMeta: TranslationRequest['pageMeta'],
) {
  const cachedContext = await getCachedPageContext(settings, blocks, pageMeta);
  if (cachedContext) {
    return cachedContext;
  }

  const pageContext = await buildPageContext(settings, blocks, pageMeta);
  if (settings.cacheEnabled) {
    await setCachedTranslation({
      key: createPageContextCacheKey(settings, blocks, pageMeta),
      createdAt: Date.now(),
      originalText: blocks
        .slice(0, 30)
        .map((block) => block.text)
        .join('\n\n')
        .slice(0, settings.contextWindow),
      translatedText: JSON.stringify(pageContext),
    });
  }

  return pageContext;
}

async function getCachedPageContext(
  settings: ExtensionSettings,
  blocks: TextBlock[],
  pageMeta: TranslationRequest['pageMeta'],
): Promise<PageContext | undefined> {
  if (!settings.cacheEnabled) {
    return undefined;
  }

  const cached = await getCachedTranslation(
    createPageContextCacheKey(settings, blocks, pageMeta),
    settings.cacheTtlMs,
  );
  if (!cached) {
    return undefined;
  }

  try {
    return {
      ...DEFAULT_PAGE_CONTEXT,
      ...(JSON.parse(cached.translatedText) as Partial<PageContext>),
    };
  } catch {
    return undefined;
  }
}

function createSelectionCacheKey(
  settings: ExtensionSettings,
  request: TranslationRequest,
) {
  return createCacheKey([
    'selection',
    createSettingsSignature(settings),
    normalizePageUrl(request.pageMeta.url),
    request.pageMeta.title,
    request.pageMeta.nearestHeading || '',
    request.text,
    request.context.currentParagraph || '',
    request.context.beforeText || '',
    request.context.afterText || '',
  ]);
}

function createPageBlockCacheKey(
  settings: ExtensionSettings,
  block: TextBlock,
  pageMeta: TranslationRequest['pageMeta'],
) {
  return createCacheKey([
    'page-block',
    createSettingsSignature(settings),
    normalizePageUrl(pageMeta.url),
    pageMeta.title,
    block.kind,
    block.text,
    block.before || '',
    block.after || '',
  ]);
}

function createPageContextCacheKey(
  settings: ExtensionSettings,
  blocks: TextBlock[],
  pageMeta: TranslationRequest['pageMeta'],
) {
  return createCacheKey([
    'page-context',
    createSettingsSignature(settings),
    normalizePageUrl(pageMeta.url),
    pageMeta.title,
    blocks
      .slice(0, 30)
      .map((block) => `${block.kind}:${block.text}`)
      .join('\n\n')
      .slice(0, settings.contextWindow),
  ]);
}

function createSettingsSignature(settings: ExtensionSettings) {
  if (settings.provider === 'microsoft-free') {
    return createCacheKey([
      settings.provider,
      settings.targetLanguage,
      'microsoft-translator',
    ]);
  }

  return createCacheKey([
    settings.provider,
    normalizeBaseUrl(settings.providerConfig.baseURL),
    settings.providerConfig.model.trim(),
    settings.targetLanguage,
    settings.translationMode,
    settings.glossaryEnabled ? serializeGlossary(settings) : '',
  ]);
}

function serializeGlossary(settings: ExtensionSettings) {
  return settings.glossary
    .filter((term) => term.source.trim() && term.target.trim())
    .map((term) => `${term.source.trim()}=>${term.target.trim()}`)
    .sort()
    .join('\n');
}

function normalizeBaseUrl(baseURL: string) {
  return baseURL.trim().replace(/\/+$/, '');
}

function normalizePageUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function sendPageProgress(
  tabId: number | undefined,
  progress: PageTranslationProgress,
) {
  if (!tabId) {
    return;
  }

  await browser.tabs
    .sendMessage<ContentMessage>(tabId, {
      type: 'PAGE_TRANSLATION_PROGRESS',
      payload: progress,
    })
    .catch(() => undefined);
}

async function sendPageBatch(
  tabId: number | undefined,
  pageMode: PageTranslationResponse['pageMode'],
  translationStyle: PageTranslationResponse['translationStyle'],
  items: TranslationResult[],
) {
  if (!tabId) {
    return;
  }

  await browser.tabs
    .sendMessage<ContentMessage>(tabId, {
      type: 'PAGE_TRANSLATION_BATCH',
      payload: { pageMode, translationStyle, items },
    })
    .catch(() => undefined);
}

async function sendToActiveTab(message: ContentMessage) {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  return browser.tabs.sendMessage(tab.id, message);
}
