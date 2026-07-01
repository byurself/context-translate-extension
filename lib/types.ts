export type TranslationMode = 'balanced' | 'fast' | 'accurate';

export type PageRenderMode = 'bilingual' | 'replace';

export type TranslationProvider = 'microsoft-free' | 'openai-compatible';

export type TranslationStyle =
  | 'none'
  | 'dashed-underline'
  | 'solid-underline'
  | 'quote'
  | 'muted'
  | 'background'
  | 'paper';

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface GlossaryTerm {
  source: string;
  target: string;
}

export interface ExtensionSettings {
  targetLanguage: string;
  provider: TranslationProvider;
  providerConfig: ProviderConfig;
  translationMode: TranslationMode;
  pageMode: PageRenderMode;
  selectionTranslationEnabled: boolean;
  contextWindow: number;
  glossaryEnabled: boolean;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  translationStyle: TranslationStyle;
  glossary: GlossaryTerm[];
}

export interface PageMeta {
  title: string;
  url: string;
  hostname: string;
  nearestHeading?: string;
}

export interface TranslationContext {
  beforeText?: string;
  afterText?: string;
  currentParagraph?: string;
  pageSummary?: string;
  glossary?: Record<string, string>;
}

export interface TranslationRequest {
  mode: 'selection' | 'page-block';
  text: string;
  targetLanguage: string;
  context: TranslationContext;
  pageMeta: PageMeta;
}

export interface PageContext {
  summary: string;
  glossary: Record<string, string>;
  style: string;
  sourceLanguage: string;
}

export interface TextBlock {
  id: string;
  text: string;
  kind: string;
  before?: string;
  after?: string;
}

export interface TranslationResult {
  id?: string;
  originalText: string;
  translatedText: string;
}

export interface PageTranslationResponse {
  pageContext: PageContext;
  pageMode: PageRenderMode;
  translationStyle: TranslationStyle;
  items: TranslationResult[];
}

export interface PageTranslationProgress {
  stage: 'extracting' | 'analyzing' | 'translating' | 'complete' | 'error';
  translated: number;
  total: number;
  message: string;
}

export interface PageModeApplyResponse {
  applied: boolean;
  pageMode: PageRenderMode;
  translatedCount: number;
  message: string;
}

export interface PageRestoreResponse {
  restored: boolean;
  restoredCount: number;
  message: string;
}

export type BackgroundMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<ExtensionSettings> }
  | { type: 'TRANSLATE_SELECTION'; payload: TranslationRequest }
  | {
      type: 'TRANSLATE_PAGE';
      payload: {
        blocks: TextBlock[];
        pageMeta: PageMeta;
        targetLanguage?: string;
      };
    }
  | { type: 'TEST_PROVIDER'; payload?: Partial<ExtensionSettings> }
  | { type: 'RUN_ACTIVE_TAB_TRANSLATION' }
  | { type: 'RUN_ACTIVE_TAB_RESTORE' }
  | { type: 'RUN_ACTIVE_TAB_PAGE_MODE'; payload: { pageMode: PageRenderMode } };

export type ContentMessage =
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'RESTORE_PAGE' }
  | { type: 'APPLY_PAGE_MODE'; payload: { pageMode: PageRenderMode } }
  | { type: 'SHOW_SELECTION_TRANSLATION'; payload: { text: string } }
  | { type: 'PAGE_TRANSLATION_PROGRESS'; payload: PageTranslationProgress }
  | {
      type: 'PAGE_TRANSLATION_BATCH';
      payload: {
        pageMode: PageRenderMode;
        translationStyle: TranslationStyle;
        items: TranslationResult[];
      };
    };
