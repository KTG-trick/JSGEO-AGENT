# 自动学习调度器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现主进程级别的自动学习调度器，每 12 小时自动对所有有已发布文章的项目执行可见性检测，被收录则触发学习。

**Architecture:** 新增 `autoLearningScheduler.cjs` 服务，使用 SQLite 持久化调度状态（`scheduler_state` 表），通过 `setInterval` 实现定时执行，启动时检查并补偿错过的周期。渲染端 UI 新增调度状态卡片，移除客户端定时器。

**Tech Stack:** Node.js (CommonJS), SQLite (better-sqlite3), React 19, Tailwind v4, Lucide icons

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/services/autoLearningScheduler.cjs` | 新增 | 调度器核心服务 |
| `src/main/services/databaseService.cjs` | 修改 | 添加 `scheduler_state` 表迁移 |
| `src/main/index.cjs` | 修改 | 注册 IPC handler + 生命周期集成 |
| `src/main/preload.cjs` | 修改 | 新增 3 个方法 |
| `src/renderer/global.d.ts` | 修改 | 新增类型定义 |
| `src/renderer/views/AutoLearning.tsx` | 修改 | 新增调度状态卡片 + 移除渲染端定时器 |

---

### Task 1: 数据库迁移 — 添加 scheduler_state 表

**Files:**
- Modify: `src/main/services/databaseService.cjs:440-520`

- [ ] **Step 1: 在 migrateSchema 函数末尾添加 scheduler_state 表创建**

在 `migrateSchema` 函数的末尾（在 `return` 语句之前）添加：

```javascript
  // 自动学习调度器状态表
  database.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/databaseService.cjs
git commit -m "feat: add scheduler_state table migration for auto-learning scheduler"
```

---

### Task 2: 调度器核心服务

**Files:**
- Create: `src/main/services/autoLearningScheduler.cjs`

- [ ] **Step 1: 创建调度器服务文件骨架**

```javascript
'use strict';

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 小时
const STATE_KEY_LAST_RUN = 'last_run_at';
const STATE_KEY_INTERVAL = 'interval_ms';

let timerId = null;
let isRunning = false;
let databaseRef = null;

/**
 * 初始化调度器，传入数据库实例
 * @param {import('better-sqlite3').Database} database
 */
function init(database) {
  databaseRef = database;
}

/**
 * 获取调度状态
 */
function getStatus() {
  if (!databaseRef) return null;
  const row = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?').get(STATE_KEY_LAST_RUN);
  const intervalRow = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?').get(STATE_KEY_INTERVAL);
  const lastRunAt = row?.value || null;
  const intervalMs = intervalRow ? Number(intervalRow.value) : DEFAULT_INTERVAL_MS;
  const nextRunAt = lastRunAt
    ? new Date(new Date(lastRunAt).getTime() + intervalMs).toISOString()
    : new Date().toISOString();
  return {
    isRunning,
    lastRunAt,
    nextRunAt,
    intervalMs,
  };
}

/**
 * 更新调度状态
 */
function setState(key, value) {
  if (!databaseRef) return;
  databaseRef.prepare(`
    INSERT INTO scheduler_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value));
}

/**
 * 执行一次完整的自动学习周期
 */
async function runCycle() {
  if (isRunning || !databaseRef) return null;
  isRunning = true;
  try {
    // 查询所有有已发布文章的项目
    const projects = databaseRef.prepare(`
      SELECT DISTINCT p.id, p.name
      FROM projects p
      INNER JOIN article_drafts ad ON ad.project_id = p.id
      WHERE ad.publication_evidence IS NOT NULL
        AND json_extract(ad.publication_evidence, '$.status') = 'published'
        AND json_extract(ad.publication_evidence, '$.published_url') IS NOT NULL
    `).all();

    let projectsChecked = 0;
    let visibilityDetected = 0;
    let rulesGenerated = 0;

    // 延迟加载服务（避免循环依赖）
    const visibilityCheckService = require('./visibilityCheckService');
    const reflectionService = require('./reflectionService');

    for (const project of projects) {
      try {
        projectsChecked++;
        const projectId = project.id;

        // 获取企业档案
        const enterprise = databaseRef.prepare('SELECT * FROM enterprises WHERE id = ?').get(projectId);
        if (!enterprise) continue;

        // 获取已确认的问题
        const questions = databaseRef.prepare(
          "SELECT * FROM question_pool WHERE project_id = ? AND status = 'confirmed'"
        ).all(projectId);
        if (questions.length === 0) continue;

        // 获取已发布的文章 URL
        const drafts = databaseRef.prepare(
          "SELECT * FROM article_drafts WHERE project_id = ? AND publication_evidence IS NOT NULL"
        ).all(projectId);
        const publishedUrls = drafts
          .map((d) => {
            try { return JSON.parse(d.publication_evidence)?.published_url; }
            catch { return null; }
          })
          .filter(Boolean);
        if (publishedUrls.length === 0) continue;

        // 执行 Phase 6 可见性检测
        const profile = typeof enterprise.profile === 'string'
          ? JSON.parse(enterprise.profile)
          : enterprise.profile;
        const checkResult = await visibilityCheckService.runVisibilityCheck({
          projectId,
          platform: 'doubao',
          profile,
          questions: questions.map((q) => ({ id: q.id, text: q.question_text })),
          publishedUrls,
        });

        if (!checkResult) continue;

        // 分析是否被收录
        const questionResults = checkResult.result?.question_results ?? [];
        const matchedUrls = questionResults.flatMap((r) => r.matched_published_urls || []);
        if (matchedUrls.length > 0) {
          visibilityDetected++;

          // 获取上一次检测结果用于对比
          const previousCheck = databaseRef.prepare(
            "SELECT * FROM ai_visibility_checks WHERE project_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1"
          ).get(projectId, checkResult.id);

          // 执行 Phase 7 反思学习
          const reflectionResult = await reflectionService.generateReflection({
            projectId,
            platform: 'doubao',
            visibilityCheckId: checkResult.id,
            profile,
            publishedArticles: drafts.map((d) => ({
              id: d.id,
              title: d.title,
              url: (() => { try { return JSON.parse(d.publication_evidence)?.published_url; } catch { return null; } })(),
            })).filter((a) => a.url),
          });

          if (reflectionResult?.rules?.length > 0) {
            rulesGenerated += reflectionResult.rules.length;
          }
        }
      } catch (projectError) {
        console.error(`[AutoLearningScheduler] 项目 ${project.id} 执行失败:`, projectError.message);
      }
    }

    // 更新最后执行时间
    setState(STATE_KEY_LAST_RUN, new Date().toISOString());

    const result = { projectsChecked, visibilityDetected, rulesGenerated };
    console.log('[AutoLearningScheduler] 周期执行完成:', result);
    return result;
  } finally {
    isRunning = false;
  }
}

/**
 * 检查是否需要立即执行并启动定时器
 */
function start() {
  if (!databaseRef) {
    console.error('[AutoLearningScheduler] 未初始化数据库，无法启动');
    return;
  }

  const lastRunAt = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?')
    .get(STATE_KEY_LAST_RUN)?.value;
  const intervalRow = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?')
    .get(STATE_KEY_INTERVAL);
  const intervalMs = intervalRow ? Number(intervalRow.value) : DEFAULT_INTERVAL_MS;

  // 启动时补偿检查
  if (!lastRunAt || Date.now() - new Date(lastRunAt).getTime() >= intervalMs) {
    console.log('[AutoLearningScheduler] 启动补偿执行');
    runCycle().catch((err) => console.error('[AutoLearningScheduler] 补偿执行失败:', err));
  }

  // 启动定时器
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    console.log('[AutoLearningScheduler] 定时执行');
    runCycle().catch((err) => console.error('[AutoLearningScheduler] 定时执行失败:', err));
  }, intervalMs);

  console.log(`[AutoLearningScheduler] 已启动，间隔 ${intervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止定时器
 */
function stop() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  console.log('[AutoLearningScheduler] 已停止');
}

/**
 * 修改执行间隔
 */
function setIntervalMs(ms) {
  if (typeof ms !== 'number' || ms < 60000) return false;
  setState(STATE_KEY_INTERVAL, String(ms));
  // 重启定时器以应用新间隔
  stop();
  start();
  return true;
}

module.exports = {
  init,
  start,
  stop,
  runCycle,
  getStatus,
  setIntervalMs,
};
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: 无新增错误（新文件使用 require，符合 CommonJS 规范）

- [ ] **Step 3: 提交**

```bash
git add src/main/services/autoLearningScheduler.cjs
git commit -m "feat: add autoLearningScheduler service with 12h interval + startup compensation"
```

---

### Task 3: 主进程集成 — 注册 IPC + 生命周期

**Files:**
- Modify: `src/main/index.cjs`

- [ ] **Step 1: 在 index.cjs 顶部引入调度器服务**

在 `require` 区域（其他服务引入附近）添加：

```javascript
const autoLearningScheduler = require('./services/autoLearningScheduler');
```

- [ ] **Step 2: 在数据库初始化后初始化调度器**

在 `databaseService.init()` 调用之后添加：

```javascript
autoLearningScheduler.init(databaseService.getDatabase());
```

- [ ] **Step 3: 在 app.whenReady 后启动调度器**

在 `app.whenReady()` 回调中，窗口创建之后添加：

```javascript
autoLearningScheduler.start();
```

- [ ] **Step 4: 在 before-quit 事件中停止调度器**

```javascript
app.on('before-quit', () => {
  autoLearningScheduler.stop();
});
```

- [ ] **Step 5: 注册 IPC handlers**

在 `ipcMain.handle` 注册区域添加：

```javascript
ipcMain.handle('geo-agent:get-auto-learning-status', async () => {
  return autoLearningScheduler.getStatus();
});

ipcMain.handle('geo-agent:trigger-auto-learning-now', async (event) => {
  const requestId = `auto-learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = `geo-agent:trigger-auto-learning-stream:${requestId}`;

  // 异步执行周期
  autoLearningScheduler.runCycle()
    .then((result) => {
      event.sender.send(channel, { type: 'result', result });
      event.sender.send(channel, { type: 'done' });
    })
    .catch((error) => {
      event.sender.send(channel, { type: 'error', message: error.message });
      event.sender.send(channel, { type: 'done' });
    });

  return { requestId, channel };
});

ipcMain.handle('geo-agent:set-auto-learning-interval', async (_event, payload) => {
  const { intervalMs } = payload || {};
  return autoLearningScheduler.setIntervalMs(intervalMs);
});
```

- [ ] **Step 6: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 7: 提交**

```bash
git add src/main/index.cjs
git commit -m "feat: integrate autoLearningScheduler into main process IPC and lifecycle"
```

---

### Task 4: Preload 桥接 — 暴露新方法给渲染端

**Files:**
- Modify: `src/main/preload.cjs`

- [ ] **Step 1: 在 contextBridge.exposeInMainWorld 中添加新方法**

在 `geoAgent` 对象中添加：

```javascript
getAutoLearningStatus: () => ipcRenderer.invoke('geo-agent:get-auto-learning-status'),

triggerAutoLearningNow: () => {
  return invokeStream('geo-agent:trigger-auto-learning-now', {});
},

setAutoLearningInterval: (intervalMs) => ipcRenderer.invoke('geo-agent:set-auto-learning-interval', { intervalMs }),
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/preload.cjs
git commit -m "feat: expose auto-learning scheduler methods via preload bridge"
```

---

### Task 5: 类型定义 — 扩展 global.d.ts

**Files:**
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: 添加调度状态类型**

在类型定义区域添加：

```typescript
interface GeoAgentAutoLearningStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  intervalMs: number;
}

interface GeoAgentAutoLearningCycleResult {
  projectsChecked: number;
  visibilityDetected: number;
  rulesGenerated: number;
}
```

- [ ] **Step 2: 在 Window.geoAgent 接口中添加新方法**

```typescript
getAutoLearningStatus: () => Promise<GeoAgentAutoLearningStatus>;
triggerAutoLearningNow: () => Promise<{
  requestId: string;
  channel: string;
} & ((event: { type: string; result?: GeoAgentAutoLearningCycleResult; message?: string }) => void)>;
setAutoLearningInterval: (intervalMs: number) => Promise<boolean>;
```

- [ ] **Step 3: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/global.d.ts
git commit -m "feat: add TypeScript types for auto-learning scheduler IPC"
```

---

### Task 6: 渲染端 UI — 调度状态卡片 + 移除客户端定时器

**Files:**
- Modify: `src/renderer/views/AutoLearning.tsx`

- [ ] **Step 1: 移除客户端定时器常量和逻辑**

删除第 8 行的常量：

```typescript
// 删除这行
const VISIBILITY_CHECK_INTERVAL_MS = 10 * 60 * 1000;
```

删除第 208-224 行的 `useEffect`（客户端定时器逻辑）。

- [ ] **Step 2: 添加调度状态相关 state**

在组件 state 声明区域添加：

```typescript
const [schedulerStatus, setSchedulerStatus] = useState<GeoAgentAutoLearningStatus | null>(null);
const [isTriggeringManual, setIsTriggeringManual] = useState(false);
const [manualProgress, setManualProgress] = useState<string | null>(null);
```

- [ ] **Step 3: 添加加载调度状态的逻辑**

在 `loadRules` 函数中添加调度状态加载：

```typescript
if (window.geoAgent?.getAutoLearningStatus) {
  try {
    const status = await window.geoAgent.getAutoLearningStatus();
    setSchedulerStatus(status);
  } catch {
    // 静默失败，不影响主流程
  }
}
```

- [ ] **Step 4: 添加手动触发函数**

```typescript
const triggerManualCycle = async () => {
  if (!window.geoAgent?.triggerAutoLearningNow || isTriggeringManual) return;
  setIsTriggeringManual(true);
  setManualProgress('正在执行自动学习周期...');
  setError(null);
  try {
    const response = await window.geoAgent.triggerAutoLearningNow();
    // 流式监听进度
    if (typeof response === 'function') {
      response((event) => {
        if (event.type === 'status' && event.message) setManualProgress(event.message);
        if (event.type === 'result' && event.result) {
          const r = event.result;
          setManualProgress(`完成：检测 ${r.projectsChecked} 个项目，${r.visibilityDetected} 个被收录，生成 ${r.rulesGenerated} 条规则`);
        }
      });
    }
    // 刷新数据
    await loadRules();
    setManualProgress('自动学习周期已完成');
  } catch (err) {
    setManualProgress('执行失败');
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setIsTriggeringManual(false);
  }
};
```

- [ ] **Step 5: 在右侧面板顶部添加调度状态卡片**

在右侧面板（`xl:col-span-5`）的开头添加：

```tsx
{/* 调度状态卡片 */}
<div className="rounded-xl border border-border bg-surface p-5">
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-semibold text-on-surface">自动学习调度</h3>
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
      schedulerStatus?.isRunning
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
        : "bg-surface-container text-on-surface-variant"
    )}>
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        schedulerStatus?.isRunning ? "bg-emerald-500 animate-pulse" : "bg-on-surface-variant/40"
      )} />
      {schedulerStatus?.isRunning ? '执行中' : '等待中'}
    </span>
  </div>

  <div className="grid grid-cols-2 gap-3 text-xs text-on-surface-variant">
    <div>
      <span className="block text-on-surface-variant/60 mb-0.5">上次执行</span>
      <span className="text-on-surface font-medium">
        {schedulerStatus?.lastRunAt
          ? new Date(schedulerStatus.lastRunAt).toLocaleString('zh-CN')
          : '尚未执行'}
      </span>
    </div>
    <div>
      <span className="block text-on-surface-variant/60 mb-0.5">下次执行</span>
      <span className="text-on-surface font-medium">
        {schedulerStatus?.nextRunAt
          ? new Date(schedulerStatus.nextRunAt).toLocaleString('zh-CN')
          : '--'}
      </span>
    </div>
    <div>
      <span className="block text-on-surface-variant/60 mb-0.5">执行间隔</span>
      <span className="text-on-surface font-medium">
        {schedulerStatus?.intervalMs
          ? `${Math.round(schedulerStatus.intervalMs / 1000 / 60)} 分钟`
          : '12 小时'}
      </span>
    </div>
    <div className="flex items-end">
      <button
        onClick={triggerManualCycle}
        disabled={isTriggeringManual}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          "bg-primary text-on-primary hover:bg-primary/90",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {isTriggeringManual ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <RefreshCw className="w-3 h-3" />
        )}
        {isTriggeringManual ? '执行中...' : '立即执行'}
      </button>
    </div>
  </div>

  {manualProgress && (
    <p className="mt-3 text-xs text-on-surface-variant bg-surface-container rounded-lg p-2">
      {manualProgress}
    </p>
  )}
</div>
```

- [ ] **Step 6: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 7: 运行测试验证**

Run: `npm test`
Expected: 现有测试通过

- [ ] **Step 8: 提交**

```bash
git add src/renderer/views/AutoLearning.tsx
git commit -m "feat: add scheduler status card to AutoLearning view, remove client-side timer"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run: `npm run dev`
Expected: 应用正常启动

- [ ] **Step 2: 验证首次启动补偿执行**

1. 打开开发者工具，查看控制台日志
2. 确认看到 `[AutoLearningScheduler] 启动补偿执行` 日志
3. 确认 `scheduler_state` 表中 `last_run_at` 已更新

- [ ] **Step 3: 验证调度状态显示**

1. 打开自动学习页面
2. 确认右侧面板顶部显示「自动学习调度」卡片
3. 确认显示「上次执行」「下次执行」「执行间隔」
4. 确认状态指示器显示「等待中」

- [ ] **Step 4: 验证手动触发**

1. 点击「立即执行」按钮
2. 确认按钮变为 loading 状态
3. 确认进度信息实时更新
4. 确认完成后显示结果摘要

- [ ] **Step 5: 提交最终版本**

```bash
git add -A
git commit -m "feat: complete auto-learning scheduler implementation"
```
