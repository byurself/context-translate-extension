# Context Translate Extension

[English](./README.md)

Context Translate 是一个适用于 Chrome/Edge 的 Manifest V3 浏览器翻译扩展，支持划词翻译和整页翻译。默认使用免费的微软翻译服务，无需 API Key；也可以切换到你自己的 OpenAI 兼容接口，实现结合上下文的 AI 精翻。

## 功能特性

- 划词后在页面浮窗中显示译文，并结合附近段落和标题作为上下文。
- 通过扩展弹窗或页面右键菜单翻译当前页面的可读文本。
- 支持双语对照显示，也支持直接替换原文。
- 可一键恢复整页翻译前的原文。
- 默认使用免费微软翻译，也可配置 OpenAI 兼容的 Chat Completions 服务商。
- 可配置目标语言、AI 翻译模式、术语表、页面上下文采样长度、译文样式和缓存有效期。
- 使用 IndexedDB 缓存译文，减少重复请求。
- 使用 `chrome.storage.local` 在本地保存扩展设置。

## 技术栈

- [WXT](https://wxt.dev/)：浏览器扩展开发框架
- React 19：弹窗和设置页 UI
- TypeScript
- Chrome/Edge Manifest V3
- `chrome.storage.local`：本地设置存储
- IndexedDB：译文缓存

## 环境要求

- 推荐 Node.js 20 或更新版本。
- pnpm 9 或更新版本。
- Chrome 或 Edge，并开启扩展开发者模式。

## 快速开始

安装依赖：

```bash
pnpm install
```

启动开发构建：

```bash
pnpm dev
```

然后打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，选择：

```text
.output/chrome-mv3
```

开发时 WXT 会监听源码变化并重新构建。如果浏览器没有自动应用更新，可以在扩展管理页手动重新加载扩展。

## 使用方式

1. 打开扩展弹窗。
2. 选择目标语言。
3. 可以继续使用默认的免费微软翻译；如果需要 AI 精翻，先在设置页配置 OpenAI 兼容服务商，再切换到“自定义 AI”。
4. 在网页中选中文本，即可看到翻译浮窗。
5. 在弹窗中点击“翻译当前页面”，或通过页面右键菜单翻译当前页面。
6. 在弹窗中切换“双语”或“替换原文”的页面显示方式。
7. 点击“恢复原文”可以移除插入的译文，或恢复被替换的原文。

## 服务商配置

默认服务商是 `microsoft-free`，不需要 API Key。若要使用 AI 翻译，请打开扩展设置页，将服务商切换为 `openai-compatible`，然后配置：

- API Base URL，例如 `https://api.openai.com/v1`
- API Key
- 模型名称，例如 `gpt-4o-mini`
- 目标语言
- 翻译模式：快速、均衡或精准
- 页面上下文样本长度
- 术语表，格式为 `原文 => 译文`
- 缓存偏好和译文显示样式

OpenAI 兼容服务商会请求：

```text
POST {API Base URL}/chat/completions
```

并使用你配置的 API Key 作为 bearer token。

## 常用命令

```bash
pnpm dev            # 启动 Chrome/Edge 开发构建
pnpm dev:firefox    # 启动 Firefox 开发构建
pnpm compile        # TypeScript 类型检查
pnpm lint           # TypeScript 类型检查别名
pnpm build          # 构建 Chrome/Edge 扩展
pnpm build:firefox  # 构建 Firefox 扩展
pnpm zip            # 打包 Chrome/Edge 扩展 zip
pnpm zip:firefox    # 打包 Firefox 扩展 zip
```

## 项目结构

```text
entrypoints/
  background.ts           后台 service worker 与翻译服务调度
  content.ts              页面文本提取、划词浮窗、整页译文注入
  popup/                  扩展弹窗 UI
  options/                设置页 UI
lib/
  cache.ts                IndexedDB 译文缓存
  defaults.ts             默认设置和支持语言
  openaiClient.ts         微软翻译和 OpenAI 兼容服务客户端
  storage.ts              本地设置读写
  types.ts                共享 TypeScript 类型
public/icon/              扩展图标
wxt.config.ts             WXT 和 manifest 配置
```

## 构建

先进行类型检查：

```bash
pnpm compile
```

构建生产版本：

```bash
pnpm build
```

Chrome/Edge 的构建产物位于：

```text
.output/chrome-mv3
```

打包扩展：

```bash
pnpm zip
```

## 隐私说明

- 扩展设置，包括可选的 API Key，保存在本地 `chrome.storage.local`。
- 译文缓存保存在本地 IndexedDB。
- API Key 只会被后台 service worker 用于请求服务商，不会写入网页 DOM。
- 使用 `openai-compatible` 时，选中文本、页面文本块、页面元信息、附近上下文和术语提示可能会发送给你配置的服务商。
- 使用 `microsoft-free` 时，待翻译文本会发送到 Microsoft/Bing Translator 相关接口。

## 权限说明

扩展会请求以下权限：

- `storage`：保存本地设置。
- `contextMenus`：提供划词翻译和页面翻译右键菜单。
- `activeTab` 和 `scripting`：与当前页面交互。
- `<all_urls>`：让 content script 能在支持的网页上运行并翻译页面文本。

## 注意事项与限制

- 整页翻译会提取段落、列表项、标题、引用和图片说明等可读文本块。
- 为避免破坏页面交互，代码块、表单、导航区域、表格和常见代码仓库 UI 区域会被跳过。
- 整页翻译会处理所有已提取的可读文本块；异常过长的单个文本块仍会被跳过，以保证翻译服务请求稳定。
- 浏览器级快捷键暂未接入；当前可通过弹窗、划词浮窗和右键菜单使用翻译功能。
