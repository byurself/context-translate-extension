import type {
  ExtensionSettings,
  PageContext,
  PageMeta,
  ProviderConfig,
  TextBlock,
  TranslationRequest,
} from './types';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface MicrosoftSession {
  origin: string;
  ig: string;
  key: string;
  token: string;
  expiresAt: number;
}

let microsoftSession: MicrosoftSession | undefined;

export async function testProvider(config: ProviderConfig): Promise<string> {
  return chatComplete(
    config,
    [
      {
        role: 'system',
        content: 'Reply with exactly: OK',
      },
      {
        role: 'user',
        content: 'Connectivity test.',
      },
    ],
    0,
  );
}

export async function testTranslationProvider(
  settings: ExtensionSettings,
  config: ProviderConfig = settings.providerConfig,
): Promise<string> {
  if (settings.provider === 'microsoft-free') {
    return microsoftTranslate('Hello', settings.targetLanguage);
  }

  return testProvider(config);
}

export async function buildPageContext(
  settings: ExtensionSettings,
  blocks: TextBlock[],
  pageMeta: PageMeta,
): Promise<PageContext> {
  if (settings.provider === 'microsoft-free') {
    return {
      summary: 'Microsoft Translator does not build AI page context.',
      glossary: {},
      style: 'Natural and clear.',
      sourceLanguage: 'auto',
    };
  }

  const sampledText = blocks
    .slice(0, 30)
    .map((block) => `${block.kind}: ${block.text}`)
    .join('\n\n')
    .slice(0, settings.contextWindow);

  const glossaryHint = settings.glossaryEnabled
    ? settings.glossary
        .filter((term) => term.source.trim() && term.target.trim())
        .map((term) => `${term.source} => ${term.target}`)
        .join('\n')
    : '';

  const content = await chatComplete(settings.providerConfig, [
    {
      role: 'system',
      content:
        'You analyze web pages for translation. Return compact valid JSON only.',
    },
    {
      role: 'user',
      content: `Analyze this page before translation.
Target language: ${settings.targetLanguage}
Title: ${pageMeta.title}
URL: ${pageMeta.url}
User glossary:
${glossaryHint || '(none)'}

Return JSON with keys summary, glossary, style, sourceLanguage.
Glossary must be an object mapping source terms to target terms.

Page text:
${sampledText}`,
    },
  ]);

  return parsePageContext(content);
}

export async function translateText(
  settings: ExtensionSettings,
  request: TranslationRequest,
): Promise<string> {
  if (settings.provider === 'microsoft-free') {
    return microsoftTranslate(request.text, request.targetLanguage);
  }

  const modeInstruction = {
    fast: 'Prefer concise, direct translation.',
    balanced: 'Balance natural wording with accuracy.',
    accurate: 'Prioritize precision, terminology, and source nuance.',
  }[settings.translationMode];

  const glossary = request.context.glossary
    ? Object.entries(request.context.glossary)
        .map(([source, target]) => `${source} => ${target}`)
        .join('\n')
    : '';

  const content = await chatComplete(settings.providerConfig, [
    {
      role: 'system',
      content: `You are a professional context-aware translation engine.
Only output the translated text. Do not explain. Preserve meaning, numbers, links, and product names.
${modeInstruction}`,
    },
    {
      role: 'user',
      content: `Target language: ${request.targetLanguage}
Page title: ${request.pageMeta.title}
Nearest heading: ${request.pageMeta.nearestHeading || '(none)'}
Page summary: ${request.context.pageSummary || '(none)'}
Glossary:
${glossary || '(none)'}

Before:
${request.context.beforeText || '(none)'}

Text to translate:
${request.text}

After:
${request.context.afterText || '(none)'}

Translate only "Text to translate".`,
    },
  ]);

  return cleanTranslation(content);
}

interface MicrosoftTranslateResponse {
  translations?: Array<{
    text?: string;
    to?: string;
  }>;
  error?: {
    message?: string;
  };
}

async function microsoftTranslate(
  text: string,
  targetLanguage: string,
): Promise<string> {
  try {
    return await bingTranslate(text, targetLanguage);
  } catch (error) {
    microsoftSession = undefined;
    return bingTranslate(text, targetLanguage, error);
  }
}

async function bingTranslate(
  text: string,
  targetLanguage: string,
  previousError?: unknown,
): Promise<string> {
  const session = await getMicrosoftSession();
  const url = new URL('/ttranslatev3', session.origin);
  url.searchParams.set('isVertical', '1');
  url.searchParams.set('IG', session.ig);
  url.searchParams.set('IID', 'translator.5023.1');

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      fromLang: 'auto-detect',
      text,
      to: getMicrosoftLanguageCode(targetLanguage),
      token: session.token,
      key: session.key,
    }),
  });

  const data = (await response
    .json()
    .catch(() => [])) as MicrosoftTranslateResponse[];

  if (!response.ok) {
    const previous = previousError instanceof Error ? ` ${previousError.message}` : '';
    throw new Error(
      data[0]?.error?.message ||
        `Microsoft Translator request failed (${response.status}).${previous}`,
    );
  }

  const translatedText = data[0]?.translations?.[0]?.text;
  if (!translatedText) {
    throw new Error('Microsoft Translator returned an empty translation.');
  }

  return translatedText;
}

async function getMicrosoftSession(): Promise<MicrosoftSession> {
  if (microsoftSession && microsoftSession.expiresAt > Date.now() + 60_000) {
    return microsoftSession;
  }

  const response = await fetch('https://www.bing.com/translator', {
    credentials: 'include',
    headers: {
      Accept: 'text/html',
    },
  });
  const html = await response.text();
  const origin = new URL(response.url).origin;
  const ig = html.match(/IG:"([^"]+)"/)?.[1];
  const params = html.match(
    /params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/,
  )?.[1];
  const [key, token, ttl] =
    params?.split(',').map((value) => value.trim().replace(/^"|"$/g, '')) || [];

  if (!response.ok || !ig || !key || !token) {
    throw new Error('Unable to initialize Microsoft Translator session.');
  }

  microsoftSession = {
    origin,
    ig,
    key,
    token,
    expiresAt: Date.now() + Number(ttl || 3_600_000),
  };

  return microsoftSession;
}

function getMicrosoftLanguageCode(language: string) {
  const languageMap: Record<string, string> = {
    简体中文: 'zh-Hans',
    繁體中文: 'zh-Hant',
    English: 'en',
    日本語: 'ja',
    한국어: 'ko',
    Français: 'fr',
    Deutsch: 'de',
    Español: 'es',
  };

  return languageMap[language] || 'zh-Hans';
}

async function chatComplete(
  config: ProviderConfig,
  messages: ChatMessage[],
  temperature = config.temperature,
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error('Please add your API key in Context Translate options.');
  }

  const baseURL = config.baseURL.trim().replace(/\/$/, '');
  if (!baseURL) {
    throw new Error('Please add an OpenAI-compatible API base URL.');
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Provider request failed (${response.status})`,
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Provider returned an empty translation.');
  }

  return content;
}

function parsePageContext(content: string): PageContext {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] || content) as Partial<PageContext>;

    return {
      summary: parsed.summary || 'General web page.',
      glossary: parsed.glossary || {},
      style: parsed.style || 'Natural and clear.',
      sourceLanguage: parsed.sourceLanguage || 'auto',
    };
  } catch {
    return {
      summary: content.slice(0, 240) || 'General web page.',
      glossary: {},
      style: 'Natural and clear.',
      sourceLanguage: 'auto',
    };
  }
}

function cleanTranslation(text: string): string {
  return text
    .trim()
    .replace(/^["'“”]+/, '')
    .replace(/["'“”]+$/, '')
    .trim();
}
