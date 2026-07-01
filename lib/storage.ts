import { DEFAULT_SETTINGS } from './defaults';
import type { ExtensionSettings } from './types';

const SETTINGS_KEY = 'contextTranslate.settings';

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  const provider =
    value?.provider === 'openai-compatible' && value.providerConfig?.apiKey
      ? value.provider
      : value?.provider === 'microsoft-free'
        ? value.provider
        : DEFAULT_SETTINGS.provider;

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    provider,
    providerConfig: {
      ...DEFAULT_SETTINGS.providerConfig,
      ...value?.providerConfig,
    },
    glossary: value?.glossary ?? DEFAULT_SETTINGS.glossary,
  };
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    ...patch,
    providerConfig: {
      ...current.providerConfig,
      ...patch.providerConfig,
    },
  };

  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
