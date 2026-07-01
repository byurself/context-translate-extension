# Context Translate Extension

[简体中文](./README.zh-CN.md)

Context Translate is a Chrome/Edge MV3 browser extension for selected-text and
full-page translation. It works out of the box with a free Microsoft Translator
provider, and can be switched to your own OpenAI-compatible API for
context-aware AI translation.

## Features

- Translate selected text in a floating tooltip, with nearby paragraph and
  heading context.
- Translate readable page content from the popup or page context menu.
- Choose bilingual rendering or replace the original page text.
- Restore the original page after full-page translation.
- Use the built-in free Microsoft Translator provider, or configure an
  OpenAI-compatible Chat Completions provider.
- Configure target language, AI translation mode, glossary, page context sample
  length, translation style, and cache TTL.
- Cache translation results in IndexedDB to reduce repeat requests.
- Store extension settings locally in `chrome.storage.local`.

## Tech Stack

- [WXT](https://wxt.dev/) for browser extension development
- React 19 for the popup and options UI
- TypeScript
- Chrome/Edge Manifest V3
- `chrome.storage.local` for settings
- IndexedDB for translation cache

## Requirements

- Node.js 20 or newer is recommended.
- pnpm 9 or newer.
- Chrome or Edge with extension Developer Mode enabled.

## Getting Started

Install dependencies:

```bash
pnpm install
```

Start the development build:

```bash
pnpm dev
```

Then open `chrome://extensions` or `edge://extensions`, enable Developer Mode,
choose "Load unpacked", and select:

```text
.output/chrome-mv3
```

WXT watches source files during development. After a rebuild, reload the
extension from the browser extensions page if the browser does not pick up the
change automatically.

## Usage

1. Open the extension popup.
2. Choose the target language.
3. Keep the default free Microsoft Translator provider, or switch to "Custom AI"
   after configuring an OpenAI-compatible provider in the options page.
4. Select text on a web page to see the translation tooltip.
5. Click "Translate current page" in the popup, or use the page context menu to
   translate readable page blocks.
6. Switch between bilingual and replacement display modes from the popup.
7. Click "Restore original" to remove injected translations or restore replaced
   text.

## Provider Setup

The default provider is `microsoft-free`, which does not require an API key.
For AI translation, open the extension options page and switch the provider to
`openai-compatible`, then configure:

- API Base URL, for example `https://api.openai.com/v1`
- API Key
- Model name, for example `gpt-4o-mini`
- Target language
- Translation mode: fast, balanced, or accurate
- Page context sample length
- Glossary entries in `source => target` format
- Cache preferences and translation style

The OpenAI-compatible provider calls:

```text
POST {API Base URL}/chat/completions
```

with a bearer token from the configured API key.

## Scripts

```bash
pnpm dev            # Start Chrome/Edge development build
pnpm dev:firefox    # Start Firefox development build
pnpm compile        # Type-check with TypeScript
pnpm lint           # Alias for TypeScript type-checking
pnpm build          # Build Chrome/Edge extension
pnpm build:firefox  # Build Firefox extension
pnpm zip            # Create Chrome/Edge extension zip
pnpm zip:firefox    # Create Firefox extension zip
```

## Project Structure

```text
entrypoints/
  background.ts           Background service worker and provider orchestration
  content.ts              Page text extraction, tooltip, page injection
  popup/                  Extension popup UI
  options/                Options page UI
lib/
  cache.ts                IndexedDB translation cache
  defaults.ts             Default settings and supported languages
  openaiClient.ts         Microsoft and OpenAI-compatible provider clients
  storage.ts              Local settings persistence
  types.ts                Shared TypeScript types
public/icon/              Extension icons
wxt.config.ts             WXT and manifest configuration
```

## Build

Run type-checking first:

```bash
pnpm compile
```

Build the production extension:

```bash
pnpm build
```

The Chrome/Edge output is generated under:

```text
.output/chrome-mv3
```

To package the extension:

```bash
pnpm zip
```

## Privacy Notes

- Settings, including the optional API key, are stored locally in
  `chrome.storage.local`.
- Translation cache entries are stored locally in IndexedDB.
- The API key is read by the background service worker for provider requests and
  is not written into the page DOM.
- When using `openai-compatible`, selected text, page blocks, page metadata,
  nearby context, and glossary hints may be sent to the configured provider.
- When using `microsoft-free`, text is sent to Microsoft/Bing Translator
  endpoints.

## Permissions

The extension requests:

- `storage` for local settings.
- `contextMenus` for selection and page translation menu items.
- `activeTab` and `scripting` for interacting with the current page.
- `<all_urls>` host permissions so the content script can run on supported web
  pages and translate page text.

## Notes and Limitations

- Full-page translation extracts readable text blocks such as paragraphs, list
  items, headings, block quotes, and figcaptions.
- Code blocks, forms, navigation areas, tables, and common repository UI regions
  are skipped to avoid breaking page interactions.
- Full-page translation processes all extracted readable blocks. Exceptionally
  long individual blocks are skipped to keep provider requests reliable.
- Browser-level keyboard shortcuts are not wired yet; the current controls are
  the popup, selected-text tooltip, and context menus.
