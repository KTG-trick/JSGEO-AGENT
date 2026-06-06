# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 产品定位、GEO 七阶段流程、模型与联网边界、协作心智模型见 [CODEX.md](./CODEX.md)，本文件不重复其内容，只补充工程化操作所需信息。

## 开发命令

```bash
npm run dev         # 启动 Vite (3000 端口) 并拉起 Electron；启动前自动检测端口占用
npm run typecheck   # tsc --noEmit；等同于 npm run lint
npm test            # node --test tests/*.test.cjs（Node 内置 test runner）
npm run build       # 仅构建渲染端到 dist/
npm run dist        # build + electron-builder 打包桌面应用
npm run clean       # 清理 dist/
```

- 跑单个测试文件：`node --test tests/sourceDiscoveryService.test.cjs`
- 端口冲突由 [scripts/check-dev-port.cjs](scripts/check-dev-port.cjs) 检测，默认 3000，可用 `GEO_AGENT_DEV_PORT` 覆盖
- 主进程改动**不能依赖 Vite HMR**，需要重启 `npm run dev`
- 文档改动通常无需跑构建；改主进程/IPC/类型至少跑 `typecheck`；改服务逻辑跑 `npm test`

## 架构骨架

Electron 桌面应用，主进程 + 渲染进程，模块系统严格分裂：

| 目录 | 模块系统 | 扩展名 | 说明 |
|---|---|---|---|
| `src/main/` | CommonJS | `.cjs` 仅 | Node 运行时，无打包器，relative require 不使用 alias |
| `src/renderer/` | ESM | `.ts`/`.tsx` | Vite + React 19 + Tailwind v4，路径 alias `@/` → `src/renderer/` |
| `src/shared/` | 双用 | `.ts` + `.cjs` | 类型在 `.ts`，主进程能用的 schema 写成 `.cjs`（见 `profileSchema.cjs`） |

入口：
- 主进程 [src/main/index.cjs](src/main/index.cjs) — 启动窗口、注册全部 `ipcMain.handle`、加载 `.env`
- Preload [src/main/preload.cjs](src/main/preload.cjs) — 通过 `contextBridge.exposeInMainWorld('geoAgent', …)` 把能力暴露给渲染端
- 渲染入口 [src/renderer/main.tsx](src/renderer/main.tsx) → [src/renderer/App.tsx](src/renderer/App.tsx) — 顶层视图由 `currentView` 切换，包在 `EnterpriseProvider` 内

### IPC 调用约定

渲染端调用一律走 `window.geoAgent.<method>`，类型定义在 [src/renderer/global.d.ts](src/renderer/global.d.ts) 的 `Window.geoAgent` 接口里。

**非流式**：`ipcRenderer.invoke('geo-agent:<action>', payload)` ↔ `ipcMain.handle('geo-agent:<action>', handler)`，channel 命名一律 `geo-agent:` 前缀。

**流式**：每次调用生成 `requestId`，事件 channel 为 `geo-agent:<action>-stream:${requestId}`。preload 中的 `invokeStream()` 包装好了 Promise，在收到 `type: 'done'` 时 resolve、`type: 'error'` 时 reject。事件 type 常用：`meta` | `status` | `delta` | `reasoning_delta` | `result` | `done` | `error`。

新增流式 IPC 时需要同步四处：① 主进程 `index.cjs` 注册 handler；② `preload.cjs` 增加方法（复用 `invokeStream`）；③ `global.d.ts` 加类型；④ 调用方（视图或服务）使用。

### 主进程服务分层

业务能力按服务拆分在 [src/main/services/](src/main/services/)（全部 `.cjs`）。Index.cjs 只编排 IPC，业务逻辑都在服务里：

- 数据层：`databaseService.cjs`（better-sqlite3，WAL + FK，FTS5 表 `knowledge_chunks_fts`，DB 文件 `<userData>/geo-agent-studio.sqlite3`）
- 知识库：`knowledgeService` / `knowledgeExtractionService` / `embeddingService`（sqlite-vec 向量）/ `profileFieldService`
- 对话/项目：`conversationService` / `projectService` / `skillService`
- GEO 阶段：`questionPoolService`（阶段二）/ `sourceDiscoveryService`（阶段三）/ `articleDraftService`（阶段四）/ `articlePublishService` + `ossPreviewService` + `chaojimeijieService` + `publishRecommendationService`（阶段五）/ `visibilityCheckService`（阶段六）/ `reflectionService`（阶段七）
- 模型与网关：`modelPolicyService.cjs`（任务驱动的 provider / model / network_mode 选择）+ `llmGateway.cjs`（OpenAI / DeepSeek / Doubao Ark 抽象）

**模型路由的关键不变量**：所有联网决策都集中在 `modelPolicyService.getTaskPolicy(taskType, ctx)` 里，业务服务不要硬编码联网模式。只有 `task_type === 'source_discovery'` 才使用 `DOUBAO_ASSISTANT_SEARCH`；其他任务联网走 `WEB_SEARCH_PLUGIN`。详见 [CODEX.md 的"模型与联网边界"](./CODEX.md)。

### 渲染端视图

[src/renderer/views/](src/renderer/views/)：`Dashboard` / `AgentStudio`（智能助手）/ `KnowledgeBase` / `Drafts`（稿件管理）/ `Projects` / `AutoLearning` / `WebBuilder`。视图通过 `App.tsx` 的 `currentView` 切换，并监听自定义事件 `geo-agent-open-view` 跨视图跳转。

UI 基础组件分两层：
- [src/renderer/components/ui/](src/renderer/components/ui/) — shadcn / Radix 原语
- [src/renderer/components/ai-elements/](src/renderer/components/ai-elements/) — 自定义 AI 对话组件（message / reasoning / sources / chain-of-thought 等）

全局企业上下文在 [src/renderer/context/EnterpriseContext.tsx](src/renderer/context/EnterpriseContext.tsx)。

## 环境与配置

- `.env` 由主进程启动时通过 `loadEnvFile()` 读取（[src/main/index.cjs](src/main/index.cjs)），仅读取根目录，**不会**被打进发布包
- 新建环境时把 [.env.example](.env.example) 复制为 `.env` 并填入 OpenAI / DeepSeek / Ark / 阿里云 OSS / 超级媒介 的密钥
- 知识抽取 (`GEO_EXTRACTION_*`) 当前固定走 OpenAI Responses API，确认 `GEO_EXTRACTION_API_FAMILY=responses`
- 嵌入向量 (`ARK_EMBEDDING_*`) 用于 sqlite-vec 本地检索，无 API key 时退化为仅 FTS

## 工程约束（高优先级）

1. **主进程禁止 ESM / `.ts`**：一旦看到 `import …` 出现在 `src/main/` 立刻改成 `require`。新增共享类型时，TS 类型放 `src/shared/*.ts`，主进程要用的实际值/schema 用 `.cjs` 重新写一份（参考 `profileSchema.cjs`）。
2. **不要回退用户改动**：工作树可能不干净；改动前先 `git status`，遇到非自己引入的修改先问清楚。CODEX.md 也强调这一点。
3. **联网策略修改必须验证**：改 `modelPolicyService` 或 `llmGateway` 后，确认非信源发现任务没被切到豆包助手联网（高成本）。
4. **数据库 schema 迁移**：在 `databaseService.cjs` 的 `createSchema()`（建表）和 `migrateSchema()`（用 `ALTER TABLE`）双写；不要直接改建表语句而忘了迁移。
5. **UI 文案保持中文**：用户可见字符串使用中文，不要因为代码风格切回英文。

## 协作语言

按用户的全局规范，**默认使用中文与用户交流**；代码注释和 commit message 也以中文为主，路径/标识符保留英文。

## 既有文档

- [CODEX.md](./CODEX.md) — 产品定位、七阶段流程、模型边界、协作心智模型（最权威）
- [doc/GEO-Agent-Studio-从零开发文档.md](doc/) — 历史开发文档
- [skills/](skills/) — Claude Code 技能脚本（`knowledge-base-ingest.md` / `geo-question-set.md` / `geo-source-discovery.md` / `geo-support-content.md`）
