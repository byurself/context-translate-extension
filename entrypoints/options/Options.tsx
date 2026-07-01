import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  Info,
  Keyboard,
  Languages,
  Palette,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  TestTube2,
} from 'lucide-react';
import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES } from '@/lib/defaults';
import type {
  BackgroundMessage,
  ExtensionSettings,
  TranslationStyle,
  TranslationProvider,
} from '@/lib/types';

type SectionId =
  | 'general'
  | 'provider'
  | 'shortcuts'
  | 'appearance'
  | 'advanced'
  | 'about';

const navigation = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'provider', label: '服务商', icon: Cloud },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'advanced', label: '高级', icon: SlidersHorizontal },
  { id: 'about', label: '关于', icon: Info },
] satisfies Array<{ id: SectionId; label: string; icon: typeof Settings2 }>;

const sectionCopy: Record<SectionId, { title: string; description: string }> = {
  general: {
    title: '通用设置',
    description: '设置默认目标语言、页面显示方式和术语表行为。',
  },
  provider: {
    title: '翻译服务商',
    description: '默认使用免费微软翻译，也可以切换到自己的 AI API。',
  },
  shortcuts: {
    title: '快捷键',
    description: '查看扩展可用的快捷操作。浏览器级快捷键稍后接入。',
  },
  appearance: {
    title: '外观',
    description: '调整译文在网页中的显示方式。',
  },
  advanced: {
    title: '高级设置',
    description: '控制缓存有效期和重复请求行为。',
  },
  about: {
    title: '关于 Context Translate',
    description: '一个使用自带 API Key 的上下文感知翻译插件。',
  },
};

const cacheTtlOptions = [
  { label: '1 小时', value: 60 * 60 * 1000 },
  { label: '6 小时', value: 6 * 60 * 60 * 1000 },
  { label: '24 小时', value: 24 * 60 * 60 * 1000 },
  { label: '7 天', value: 7 * 24 * 60 * 60 * 1000 },
];

const providerLabels: Record<TranslationProvider, string> = {
  'microsoft-free': '微软翻译（免费）',
  'openai-compatible': '自定义 AI（OpenAI 兼容）',
};

const translationStyleOptions = [
  { value: 'none', label: '无', description: '保持页面原有字体和颜色。' },
  { value: 'dashed-underline', label: '虚线下划线', description: '轻量标记译文，不打断阅读。' },
  { value: 'solid-underline', label: '直线下划线', description: '比虚线更明确的译文提示。' },
  { value: 'quote', label: '引用样式', description: '适合长段译文，左侧增加强调线。' },
  { value: 'muted', label: '弱化', description: '降低译文存在感，适合辅助阅读。' },
  { value: 'background', label: '背景色', description: '用浅色背景突出译文。' },
  { value: 'paper', label: '白纸阴影', description: '译文以独立纸片形式显示。' },
] satisfies Array<{
  value: TranslationStyle;
  label: string;
  description: string;
}>;

const previewOriginal =
  'Language is not a wall, but a bridge between minds.';
const previewTranslation =
  '语言不是墙，而是心灵之间的桥梁。';

function Options() {
  const [settings, setSettings] = useState<ExtensionSettings>();
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState('尚未保存');
  const [testing, setTesting] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('general');
  const saveVersion = useRef(0);

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'GET_SETTINGS' } satisfies BackgroundMessage)
      .then((value) => {
        setSettings(value as ExtensionSettings);
        setStatus('已加载本地设置');
      });
  }, []);

  const glossaryText = useMemo(
    () =>
      settings?.glossary
        .map((term) => `${term.source} => ${term.target}`)
        .join('\n') || '',
    [settings?.glossary],
  );

  function patch(patchValue: Partial<ExtensionSettings>) {
    const version = saveVersion.current + 1;
    saveVersion.current = version;

    setSettings((current) =>
      current
        ? {
            ...current,
            ...patchValue,
            providerConfig: {
              ...current.providerConfig,
              ...patchValue.providerConfig,
            },
          }
        : current,
    );
    setStatus('正在自动保存...');

    void browser.runtime
      .sendMessage({
        type: 'SAVE_SETTINGS',
        payload: patchValue,
      } satisfies BackgroundMessage)
      .then((next) => {
        if (saveVersion.current !== version) {
          return;
        }

        setSettings(next as ExtensionSettings);
        setStatus('已自动保存');
      })
      .catch((error) => {
        if (saveVersion.current !== version) {
          return;
        }

        setStatus(error instanceof Error ? error.message : '自动保存失败');
      });
  }

  function updateGlossary(value: string) {
    const glossary = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [source, target] = line.split(/\s*=>\s*/);
        return {
          source: source?.trim() || '',
          target: target?.trim() || '',
        };
      })
      .filter((term) => term.source && term.target);

    patch({ glossary });
  }

  async function testConnection() {
    if (!settings) {
      return;
    }

    setTesting(true);
    setStatus('正在测试服务商...');
    try {
      await browser.runtime.sendMessage({
        type: 'TEST_PROVIDER',
        payload: settings,
      } satisfies BackgroundMessage);
      setStatus('连接成功');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '连接失败');
    } finally {
      setTesting(false);
    }
  }

  if (!settings) {
    return <main className="options-loading">正在加载设置...</main>;
  }

  return (
    <main className="options-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Languages size={24} />
          </div>
          <strong>Context Translate</strong>
        </div>
        <nav>
          {navigation.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className={activeSection === item.id ? 'active' : ''}
                key={item.label}
                onClick={() => setActiveSection(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="settings-panel">
        <header className="settings-header">
          <div>
            <h1>{sectionCopy[activeSection].title}</h1>
            <p>{sectionCopy[activeSection].description}</p>
          </div>
        </header>

        <div className="settings-grid">
          {activeSection === 'general' && (
            <>
              <label className="field">
                <span>目标语言</span>
                <select
                  value={settings.targetLanguage}
                  onChange={(event) =>
                    patch({ targetLanguage: event.target.value })
                  }
                >
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <option value={language} key={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>

              <div className="switch-row">
                <div>
                  <span>划词翻译</span>
                  <small>选中文本后自动显示翻译浮窗。</small>
                </div>
                <button
                  type="button"
                  className={
                    settings.selectionTranslationEnabled ? 'switch on' : 'switch'
                  }
                  aria-pressed={settings.selectionTranslationEnabled}
                  onClick={() =>
                    patch({
                      selectionTranslationEnabled:
                        !settings.selectionTranslationEnabled,
                    })
                  }
                >
                  <span />
                </button>
              </div>

              <div className="switch-row">
                <div>
                  <span>术语表（自定义术语）</span>
                  <small>使用术语表提升专有名词和固定表达的一致性。</small>
                </div>
                <button
                  type="button"
                  className={settings.glossaryEnabled ? 'switch on' : 'switch'}
                  aria-pressed={settings.glossaryEnabled}
                  onClick={() =>
                    patch({ glossaryEnabled: !settings.glossaryEnabled })
                  }
                >
                  <span />
                </button>
              </div>

              <label className="field">
                <span>
                  <BookOpen size={15} />
                  管理术语表
                </span>
                <textarea
                  value={glossaryText}
                  placeholder={'inference => 推理\nlatency => 延迟'}
                  onChange={(event) => updateGlossary(event.target.value)}
                />
                <small>每行一个术语，格式为：原文 =&gt; 译文。</small>
              </label>

              <div className="reset-panel">
                <div>
                  <span>重置设置</span>
                  <small>恢复默认目标语言、划词翻译、服务商、外观、高级设置和术语表。</small>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => patch(DEFAULT_SETTINGS)}
                >
                  <RotateCcw size={16} />
                  重置设置
                </button>
              </div>
            </>
          )}

          {activeSection === 'provider' && (
            <>
              <label className="field">
                <span>默认翻译服务</span>
                <select
                  value={settings.provider}
                  onChange={(event) =>
                    patch({
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
                <small>
                  微软翻译无需 API Key；自定义 AI 会使用你配置的 OpenAI 兼容接口。
                </small>
              </label>

              {settings.provider === 'microsoft-free' && (
                <div className="info-panel">
                  <Cloud size={22} />
                  <h2>当前使用微软翻译</h2>
                  <p>
                    适合快速、免费的常规翻译。需要上下文推理、术语控制和更自然表达时，可以切换到自定义 AI。
                  </p>
                </div>
              )}

              {settings.provider === 'openai-compatible' && (
                <>
                  <label className="field">
                    <span>API Base URL</span>
                    <input
                      value={settings.providerConfig.baseURL}
                      placeholder="https://api.openai.com/v1"
                      onChange={(event) =>
                        patch({
                          providerConfig: {
                            ...settings.providerConfig,
                            baseURL: event.target.value,
                          },
                        })
                      }
                    />
                    <small>OpenAI 兼容 Chat Completions API 的基础地址。</small>
                  </label>

                  <label className="field">
                    <span>API Key</span>
                    <div className="input-with-action">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={settings.providerConfig.apiKey}
                        onChange={(event) =>
                          patch({
                            providerConfig: {
                              ...settings.providerConfig,
                              apiKey: event.target.value,
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                        title={showKey ? '隐藏 API Key' : '显示 API Key'}
                        onClick={() => setShowKey((value) => !value)}
                      >
                        {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                    <small>API Key 仅保存在本地，不会发送到本项目服务器。</small>
                  </label>

                  <label className="field">
                    <span>模型名称</span>
                    <input
                      value={settings.providerConfig.model}
                      placeholder="gpt-4o-mini"
                      onChange={(event) =>
                        patch({
                          providerConfig: {
                            ...settings.providerConfig,
                            model: event.target.value,
                          },
                        })
                      }
                    />
                    <small>用于 Chat Completions 的模型名称。</small>
                  </label>

                  <label className="field">
                    <span>页面上下文样本长度</span>
                    <div className="slider-row">
                      <input
                        type="range"
                        min={500}
                        max={8000}
                        step={500}
                        value={settings.contextWindow}
                        onChange={(event) =>
                          patch({ contextWindow: Number(event.target.value) })
                        }
                      />
                      <strong>{settings.contextWindow}</strong>
                      <span>字符</span>
                    </div>
                    <small>
                      全文翻译前用于生成页面摘要和术语表的样本文本长度，不是精确 token 数。
                    </small>
                  </label>
                </>
              )}
            </>
          )}

          {activeSection === 'advanced' && (
            <>
              <div className="switch-row">
                <div>
                  <span>启用缓存</span>
                  <small>
                    缓存翻译结果，默认 1 小时后自动失效并重新翻译。
                  </small>
                </div>
                <button
                  type="button"
                  className={settings.cacheEnabled ? 'switch on' : 'switch'}
                  aria-pressed={settings.cacheEnabled}
                  onClick={() => patch({ cacheEnabled: !settings.cacheEnabled })}
                >
                  <span />
                </button>
              </div>

              <label className="field">
                <span>缓存有效期</span>
                <select
                  value={settings.cacheTtlMs}
                  disabled={!settings.cacheEnabled}
                  onChange={(event) =>
                    patch({ cacheTtlMs: Number(event.target.value) })
                  }
                >
                  {cacheTtlOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>
                  超过有效期后会忽略旧缓存，请求 AI 生成最新译文。
                </small>
              </label>
            </>
          )}

          {activeSection === 'shortcuts' && (
            <div className="info-panel">
              <Keyboard size={22} />
              <h2>快捷键即将支持</h2>
              <p>
                目前可以通过插件弹窗按钮和右键菜单使用翻译。下一步会接入浏览器快捷键配置。
              </p>
            </div>
          )}

          {activeSection === 'appearance' && (
            <section className="appearance-panel" aria-label="译文显示样式">
              <div className="appearance-preview">
                <div>
                  <span>预览</span>
                  <strong>{previewOriginal}</strong>
                  <p className={`translation-preview preview-${settings.translationStyle}`}>
                    {previewTranslation}
                  </p>
                </div>
              </div>

              <div className="style-options">
                {translationStyleOptions.map((option) => (
                  <label
                    className={
                      settings.translationStyle === option.value
                        ? 'style-option active'
                        : 'style-option'
                    }
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name="translationStyle"
                      checked={settings.translationStyle === option.value}
                      onChange={() => patch({ translationStyle: option.value })}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <em className={`style-swatch preview-${option.value}`}>
                      {previewTranslation}
                    </em>
                  </label>
                ))}
              </div>
            </section>
          )}

          {activeSection === 'about' && (
            <div className="info-panel">
              <Info size={22} />
              <h2>Context Translate</h2>
              <p>
                本插件支持划词翻译和全文上下文翻译。你的 API Key 只保存在本地浏览器存储中。
              </p>
            </div>
          )}
        </div>

        <footer className="options-footer">
          <div className="connection-status">
            <CheckCircle2 size={16} />
            {status}
          </div>
          {activeSection === 'provider' &&
            settings.provider === 'openai-compatible' && (
            <button
              type="button"
              className="test"
              disabled={testing}
              onClick={testConnection}
            >
              <TestTube2 size={16} />
              {testing ? '正在测试...' : '测试连接'}
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}

export default Options;
