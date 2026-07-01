import type { ExtensionSettings } from './types';

export const ONE_HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  targetLanguage: '简体中文',
  provider: 'microsoft-free',
  providerConfig: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.2,
  },
  translationMode: 'balanced',
  pageMode: 'bilingual',
  selectionTranslationEnabled: true,
  contextWindow: 2000,
  glossaryEnabled: true,
  cacheEnabled: true,
  cacheTtlMs: ONE_HOUR_MS,
  translationStyle: 'none',
  glossary: [],
};

export const SUPPORTED_LANGUAGES = [
  '简体中文',
  '繁體中文',
  'English',
  '日本語',
  '한국어',
  'Français',
  'Deutsch',
  'Español',
];
