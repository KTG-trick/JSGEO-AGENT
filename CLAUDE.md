# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GEO-Agent Studio — an Electron desktop application for Generative Engine Optimization (GEO) workflows. It helps enterprises build knowledge bases, discover AI-relevant sources, and generate content optimized for AI platforms (Doubao, DeepSeek).

The UI is in Chinese (zh-CN). All user-facing strings and comments in business logic should remain in Chinese.

## Architecture

### Electron Process Split

- **`src/renderer/`** — React 19 + TypeScript frontend. Vite build target. Uses TailwindCSS v4, shadcn/ui, Radix UI primitives, motion/react for animations.
- **`src/main/`** — Electron main process. **CommonJS (`.cjs`) only.** Node.js runtime. No bundler.
- **`src/shared/`** — TypeScript types shared between both processes (imported by renderer, manually synced in main).

### IPC Bridge

All main/renderer communication goes through `window.geoAgent` (exposed in `preload.cjs`).

- Non-streaming: `ipcRenderer.invoke(channel, ...args)` → `ipcMain.handle(channel, handler)`
- **Streaming**: Each call gets a `requestId`. The main process sends events to a per-request channel (e.g. `geo-agent:chat-stream:${requestId}`). Preload's `invokeStream()` wraps this into a Promise that resolves on `type: 'done'` and rejects on `type: 'error'`.

### Services (Main Process)

All service modules are in `src/main/services/` and use `.cjs` extension:

| Service | Responsibility |
|---------|---------------|
| `databaseService.cjs` | SQLite (`better-sqlite3`) init, schema, migrations. DB lives at `<userData>/geo-agent-studio.sqlite3`. Uses WAL mode, FTS5 for full-text search on `knowledge_chunks_fts`. |
| `projectService.cjs` | CRUD for projects and knowledge profiles. |
| `knowledgeService.cjs` | Knowledge entries, chunks, indexing (FTS), drafts, enterprise profiles. |
| `conversationService.cjs` | Chat conversations and messages persistence. |
| `sourceDiscoveryService.cjs` | GEO Phase 3 — source discovery reports. |
| `modelPolicyService.cjs` | Task-based model routing (extraction, generation, reflection). |
| `llmGateway.cjs` | LLM provider abstraction (OpenAI, DeepSeek, Doubao/Ark). |
| `knowledgeExtractionService.cjs` | Document parsing + LLM-based fact extraction for knowledge drafts. |

### Document Parser

`src/main/parsers/documentParser.cjs` — parses uploaded documents (currently mammoth for `.docx`) into text chunks for knowledge extraction.

### LLM Providers (via env)

Configured in `.env` (copied from `.env.example`):

- **OpenAI** — primary for knowledge extraction (`GEO_EXTRACTION_PROVIDER=openai`). Supports both chat completions and Responses API (`GEO_EXTRACTION_API_FAMILY`).
- **DeepSeek** — reasoning tasks (`DEEPSEEK_DEEP_THINKING=true`).
- **Doubao / Volcengine Ark** — generation + embedding (`ARK_EMBEDDING_MODEL` for sqlite-vec vector retrieval).

Model selection is task-driven: extraction always uses OpenAI; generation/reflection use configured task models.

### Database Schema (SQLite)

Key tables: `projects`, `enterprise_profiles`, `knowledge_drafts`, `knowledge_entries`, `knowledge_chunks`, `knowledge_chunks_fts` (FTS5 virtual table), `conversations`, `messages`, `workflow_events`, `geo_question_sets`, `geo_source_discoveries`, `geo_article_drafts`, `ai_visibility_checks`, `evolution_rules`.

Foreign keys cascade on delete. Schema is created in `databaseService.cjs`; migrations are done via `ALTER TABLE` in `migrateSchema()`.

### GEO Workflow Phases

1. **Knowledge Base** — upload/paste enterprise materials → LLM extracts structured profile → confirmed → indexed (FTS + optional embedding)
2. **AI Question Pool** — per-platform (Doubao/DeepSeek) question generation
3. **Source Discovery** — find high-weight sources cited by AI platforms
4. **Support Content** — generate consulting, review, and ranking article drafts

Many Phase 2–4 handlers are currently stubbed (`notImplemented`) and return placeholder responses.

## Development Commands

```bash
# Install dependencies
npm install

# Start development (Vite dev server + Electron)
npm run dev

# Build renderer for production
npm run build

# Type check (no test runner configured)
npm run typecheck       # alias: npm run lint

# Clean build artifacts
npm run clean

# Build + package with electron-builder
npm run dist
```

## Important Conventions

### Dual Module Systems

- **Renderer**: ESM (`import`/`export`), `.ts`/`.tsx`. Path alias `@/` → `src/renderer/`.
- **Main**: CommonJS (`require`/`module.exports`), `.cjs` **only**. No path aliases. Use relative paths.
- When adding a type in `src/shared/`, manually update the corresponding CJS code in main — there is no shared import between processes.

### Env File

The main process loads `.env` from the project root at startup (`loadEnvFile()` in `index.cjs`). Copy `.env.example` to `.env` and fill in API keys before running. `.env` is **not** shipped in the build.

### HMR Behavior

Vite HMR is controlled by `DISABLE_HMR` env var. When set (e.g. in AI Studio), file watching is disabled to prevent flicker during agent edits. Do not modify this behavior in `vite.config.ts`.

### UI Components

`src/renderer/components/ui/` contains shadcn/ui components (built on Radix UI). New UI primitives go here. `src/renderer/components/ai-elements/` contains custom AI chat UI components (message bubbles, reasoning chains, source citations, etc.).

### State & Context

`src/renderer/context/EnterpriseContext.tsx` provides the global enterprise/project context. Views switch via `currentView` state in `App.tsx` with animated transitions (`motion/react`).

### Streaming API Pattern

When adding a new streaming IPC handler in main:

1. Register handler in `index.cjs` as `geo-agent:<action>-stream`
2. Accept `{ requestId, payload }` as arguments
3. Use channel name: `geo-agent:<action>-stream:${requestId}`
4. Send events with `{ type: 'meta' | 'status' | 'delta' | 'done' | 'error', ... }`
5. Add corresponding method in `preload.cjs` using `invokeStream()`
6. Add type in `global.d.ts` under `Window.geoAgent`

## File Extensions to Respect

| Location | Extension |
|----------|-----------|
| `src/main/` | `.cjs` only |
| `src/renderer/` | `.ts`, `.tsx` |
| `src/shared/` | `.ts` |
