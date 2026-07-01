import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  FileText,
  Languages,
  RotateCcw,
  Settings,
  Sparkles,
} from 'lucide-react';
import './App.css';
import { SUPPORTED_LANGUAGES } from '@/lib/defaults';
import type {
  BackgroundMessage,
  ExtensionSettings,
  PageModeApplyResponse,
  PageRenderMode,
  PageRestoreResponse,
  TranslationProvider,
  TranslationMode,
} from '@/lib/types';

const modeLabels: Record<TranslationMode, string> = {
  balanced: '均衡',
  fast: '快速',
  accurate: '精准',
};

const providerLabels: Record<TranslationProvider, string> = {
  'microsoft-free': '微软翻译（免费）',
  'openai-compatible': '自定义 AI',
};

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>();
  const [busy, setBusy] = useState<
    'translate' | 'restore' | 'page-mode' | undefined
  >();
  const [status, setStatus] = useState('');
  const statusTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'GET_SETTINGS' } satisfies BackgroundMessage)
      .then((value) => setSettings(value as ExtensionSettings));

    return () => {
      if (statusTimer.current) {
        window.clearTimeout(statusTimer.current);
      }
    };
  }, []);

  function showStatus(message: string, clearAfterMs?: number) {
    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current);
      statusTimer.current = undefined;
    }

    setStatus(message);

    if (clearAfterMs) {
      statusTimer.current = window.setTimeout(() => {
        setStatus('');
        statusTimer.current = undefined;
      }, clearAfterMs);
    }
  }

  async function patchSettings(patch: Partial<ExtensionSettings>) {
    const next = (await browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: patch,
    } satisfies BackgroundMessage)) as ExtensionSettings;
    setSettings(next);
  }

  async function applyPageMode(pageMode: PageRenderMode) {
    setBusy('page-mode');
    showStatus(`正在切换为${getPageModeLabel(pageMode)}...`);

    try {
      const next = (await browser.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: { pageMode },
      } satisfies BackgroundMessage)) as ExtensionSettings;
      setSettings(next);

      const result = (await browser.runtime.sendMessage({
        type: 'RUN_ACTIVE_TAB_PAGE_MODE',
        payload: { pageMode },
      } satisfies BackgroundMessage)) as PageModeApplyResponse;

      showStatus(result.message, 2400);
    } catch (error) {
      showStatus(
        `已保存${getPageModeLabel(pageMode)}；当前页面暂时无法即时切换。`,
        2400,
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function runPageTranslation() {
    setBusy('translate');
    showStatus('正在翻译当前页面...');
    try {
      await browser.runtime.sendMessage({
        type: 'RUN_ACTIVE_TAB_TRANSLATION',
      } satisfies BackgroundMessage);
      showStatus('页面翻译已开始', 2400);
      window.close();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : '无法翻译');
    } finally {
      setBusy(undefined);
    }
  }

  async function restorePage() {
    setBusy('restore');
    showStatus('正在恢复原文...');
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'RUN_ACTIVE_TAB_RESTORE',
      } satisfies BackgroundMessage)) as PageRestoreResponse;
      showStatus(result.message, 2400);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : '无法恢复');
    } finally {
      setBusy(undefined);
    }
  }

  if (!settings) {
    return (
      <main className="popup-shell">
        <div className="loading-state">正在加载设置...</div>
      </main>
    );
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="profile-chip">
          <div className="brand-mark">
            <Languages size={20} strokeWidth={2.2} />
          </div>
          <div>
            <h1>Context Translate</h1>
            <p>网页翻译助手</p>
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="打开设置"
          title="打开设置"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          <Settings size={18} />
        </button>
      </header>

      <section className="form-stack" aria-label="翻译控制">
        <div className="language-strip" aria-label="语言设置">
          <div className="language-side">
            <strong className="language-value">自动检测</strong>
            <span className="language-label">原文语言</span>
          </div>
          <span className="language-arrow" aria-hidden="true" />
          <label className="language-side language-target">
            <strong className="language-value language-select-value">
              {settings.targetLanguage}
            </strong>
            <span className="language-label">目标语言</span>
            <select
              className="language-native-select"
              aria-label="目标语言"
              value={settings.targetLanguage}
              onChange={(event) =>
                patchSettings({ targetLanguage: event.target.value })
              }
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <option value={language} key={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="provider-card" aria-label="服务配置">
          <label className="provider-line">
            <span>
              <Sparkles size={15} />
              翻译服务
            </span>
            <select
              value={settings.provider}
              onChange={(event) =>
                patchSettings({
                  provider: event.target.value as TranslationProvider,
                })
              }
            >
              {Object.entries(providerLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="ai-refine-row">
            <div>
              <strong>启用 AI 精翻</strong>
              <span>使用你配置的自定义 AI</span>
            </div>
            <button
              type="button"
              className={
                settings.provider === 'openai-compatible'
                  ? 'mini-switch on'
                  : 'mini-switch'
              }
              aria-pressed={settings.provider === 'openai-compatible'}
              onClick={() =>
                patchSettings({
                  provider:
                    settings.provider === 'openai-compatible'
                      ? 'microsoft-free'
                      : 'openai-compatible',
                })
              }
            >
              <span />
            </button>
          </div>
        </section>

        {settings.provider === 'openai-compatible' && (
          <label className="field">
            <span>
              <BookOpen size={14} />
              模型
            </span>
            <input
              value={settings.providerConfig.model}
              onChange={(event) =>
                patchSettings({
                  providerConfig: {
                    ...settings.providerConfig,
                    model: event.target.value,
                  },
                })
              }
            />
          </label>
        )}

        <div className="behavior-list">
          <div className="behavior-row">
            <span>页面显示</span>
            <div className="segmented page-mode" role="group" aria-label="页面显示模式">
              <button
                type="button"
                className={settings.pageMode === 'bilingual' ? 'active' : ''}
                disabled={busy !== undefined}
                onClick={() => applyPageMode('bilingual')}
              >
                双语
              </button>
              <button
                type="button"
                className={settings.pageMode === 'replace' ? 'active' : ''}
                disabled={busy !== undefined}
                onClick={() => applyPageMode('replace')}
              >
                替换原文
              </button>
            </div>
          </div>

          <div className="behavior-row">
            <span>划词翻译</span>
            <button
              type="button"
              className={
                settings.selectionTranslationEnabled
                  ? 'mini-switch on'
                  : 'mini-switch'
              }
              aria-label={
                settings.selectionTranslationEnabled ? '关闭划词翻译' : '开启划词翻译'
              }
              aria-pressed={settings.selectionTranslationEnabled}
              onClick={() =>
                patchSettings({
                  selectionTranslationEnabled:
                    !settings.selectionTranslationEnabled,
                })
              }
            >
              <span />
            </button>
          </div>

          {settings.provider === 'openai-compatible' && (
            <div className="behavior-row">
              <span>翻译模式</span>
              <div className="segmented" role="group" aria-label="翻译模式">
                {(['balanced', 'fast', 'accurate'] as TranslationMode[]).map(
                  (mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={settings.translationMode === mode ? 'active' : ''}
                      onClick={() => patchSettings({ translationMode: mode })}
                    >
                      {modeLabels[mode]}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="action-dock" aria-label="页面操作">
        <button
          className="primary-action"
          type="button"
          disabled={busy !== undefined}
          onClick={runPageTranslation}
        >
          <FileText size={17} />
          {busy === 'translate' ? '正在翻译...' : '翻译当前页面'}
        </button>
        <button
          className="quick-action"
          type="button"
          disabled={busy !== undefined}
          onClick={restorePage}
        >
          <RotateCcw size={17} />
          {busy === 'restore' ? '正在恢复...' : '恢复原文'}
        </button>
      </section>

      {status && (
        <div className="popup-status" aria-live="polite">
          {status}
        </div>
      )}
    </main>
  );
}

function getPageModeLabel(pageMode: PageRenderMode) {
  return pageMode === 'replace' ? '替换原文' : '双语';
}

export default App;
