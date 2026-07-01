import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Context Translate',
    description:
      'Translate selected text or entire pages with your own context-aware AI provider.',
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Context Translate',
    },
  },
});
