# 自动学习调度器设计

> 日期：2026-06-13
> 状态：待实现

## 背景

当前自动学习功能（Phase 6 可见性检测 + Phase 7 反思优化）的定时器运行在渲染端（`AutoLearning.tsx` 的 `setInterval`），只在用户打开该页面时生效，离开即停止。需要一个主进程级别的持久调度器，实现 12 小时自动同步 + 学习。

## 目标

1. 应用启动后自动开始调度，不依赖特定页面
2. 每 12 小时对所有有已发布文章的项目执行：可见性检测 → 被收录则触发学习
3. 启动时补偿执行：如果距上次执行超过 12 小时，立即执行一次
4. 应用关闭期间错过的执行在重启后补偿

## 非目标

- 不改变 Phase 6/7 的核心检测和学习逻辑
- 不实现跨进程持久化（应用完全关闭后定时器停止，重启时补偿）
- 不自动确认进化规则（规则仍需用户手动确认）

## 架构设计

### 核心组件

```
┌─────────────────────────────────────────────┐
│              Main Process                    │
│                                              │
│  ┌──────────────────────────────────┐       │
│  │    autoLearningScheduler.cjs      │       │
│  │                                    │       │
│  │  - lastRunAt (SQLite 持久化)      │       │
│  │  - start(): 应用启动时调用         │       │
│  │    ├─ 检查 lastRunAt              │       │
│  │    ├─ 超过 12h → 立即执行          │       │
│  │    └─ 启动 setInterval(12h)       │       │
│  │  - runCycle(): 单次完整周期        │       │
│  │    ├─ 查询所有有已发布文章的项目    │       │
│  │    ├─ 逐项目执行 Phase 6          │       │
│  │    ├─ 被收录 → 执行 Phase 7       │       │
│  │    └─ 更新 lastRunAt              │       │
│  │  - getStatus(): 返回调度状态       │       │
│  │  - stop(): 停止定时器              │       │
│  └──────────────────────────────────┘       │
│         │                                    │
│         ▼                                    │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ visibility    │  │ reflection   │        │
│  │ CheckService  │→ │ Service      │        │
│  │ (Phase 6)     │  │ (Phase 7)    │        │
│  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────┘
```

### 数据流

```
应用启动
  │
  ▼
autoLearningScheduler.start()
  │
  ├─ 读取 lastRunAt
  ├─ now - lastRunAt > 12h? ──YES──→ runCycle()
  │                                    │
  ├─ 启动 setInterval(12h)            │
  │                                    ▼
  │                           ┌─ 遍历所有项目 ─┐
  │                           │                │
  │                           ▼                ▼
  │                    Phase 6 检测     Phase 6 检测
  │                           │                │
  │                           ▼                ▼
  │                    被收录? ──YES──→ Phase 7 学习
  │                           │                │
  │                           └───────┬────────┘
  │                                   ▼
  │                           更新 lastRunAt
  │
  ▼
用户打开 AutoLearning 页面
  │
  ▼
显示最新检测结果 + 待确认规则
```

## 实现细节

### 1. 数据库迁移

在 `databaseService.cjs` 的 `migrateSchema()` 中添加：

```sql
-- 调度器状态表
CREATE TABLE IF NOT EXISTS scheduler_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

初始键值对：`last_run_at = NULL`（首次启动时立即执行）。

### 2. 调度器服务

**文件：** `src/main/services/autoLearningScheduler.cjs`

```javascript
// 核心接口
module.exports = {
  start(),           // 应用启动时调用
  stop(),            // 应用关闭时调用
  runCycle(),        // 手动触发一次完整周期
  getStatus(),       // 返回调度状态
  setInterval(ms),   // 修改间隔（可选）
};
```

**关键逻辑：**

- `start()`:
  1. 从 `scheduler_state` 表读取 `last_run_at`
  2. 如果 `now - lastRunAt > INTERVAL_MS`，立即调用 `runCycle()`
  3. 启动 `setInterval(runCycle, INTERVAL_MS)`

- `runCycle()`:
  1. 查询所有有已发布文章的项目（`article_drafts` 表中 `publication_evidence` 非空）
  2. 逐项目执行：
     a. 调用 `visibilityCheckService.runVisibilityCheck()` 获取最新检测结果
     b. 分析结果：是否有已发布 URL 被 AI 引用
     c. 如果被收录：调用 `reflectionService.generateReflection()` 生成优化规则
  3. 更新 `scheduler_state` 中的 `last_run_at`

- `getStatus()`:
  ```javascript
  {
    isRunning: boolean,        // 是否正在执行周期
    lastRunAt: string|null,    // 上次执行时间 ISO
    nextRunAt: string,         // 下次执行时间 ISO
    intervalMs: number,        // 当前间隔
    projectCount: number,      // 涉及项目数
    lastCycleResult: {         // 上次周期结果
      projectsChecked: number,
      visibilityDetected: number,
      rulesGenerated: number,
    }
  }
  ```

### 3. IPC 接口扩展

在 `index.cjs` 中新增：

| Channel | 类型 | 说明 |
|---------|------|------|
| `geo-agent:get-auto-learning-status` | 非流式 | 返回调度状态 |
| `geo-agent:trigger-auto-learning-now` | 流式 | 手动触发一次完整周期，流式返回进度 |
| `geo-agent:set-auto-learning-interval` | 非流式 | 修改间隔（参数：`{ intervalMs: number }`） |

在 `preload.cjs` 中新增对应方法。

在 `global.d.ts` 中新增类型定义。

### 4. 渲染端 UI 变更

**文件：** `src/renderer/views/AutoLearning.tsx`

变更点：

1. **新增调度状态卡片**（右侧面板顶部）：
   - 显示「自动学习：运行中 / 已暂停」状态
   - 显示上次执行时间
   - 显示下次执行时间
   - 显示涉及项目数
   - 「立即执行」按钮（复用现有按钮，对接新 IPC）
   - 「暂停 / 恢复」开关

2. **移除渲染端定时器**：
   - 删除 `VISIBILITY_CHECK_INTERVAL_MS` 常量
   - 删除 `useEffect` 中的 `setInterval` 逻辑
   - 改为从主进程获取状态并展示

3. **流式进度展示**：
   - 手动触发时，通过流式 IPC 实时显示执行进度
   - 显示当前正在检测的项目名称
   - 显示检测结果摘要

### 5. 应用生命周期集成

**文件：** `src/main/index.cjs`

在应用启动时（`app.whenReady()` 后）调用 `autoLearningScheduler.start()`。

在应用关闭前（`before-quit` 事件）调用 `autoLearningScheduler.stop()` 清理定时器。

### 6. 错误处理策略

- **项目隔离**：单个项目检测失败不影响其他项目执行
- **重试机制**：失败项目记录错误，下次周期自动重试
- **连续失败暂停**：连续 3 次失败的项目暂停自动检测，等待用户手动触发
- **日志记录**：所有执行结果和错误写入 SQLite，便于排查

### 7. 间隔配置

默认间隔：12 小时（`12 * 60 * 60 * 1000 = 43200000ms`）。

可通过以下方式修改：
- IPC 调用 `set-auto-learning-interval`
- 环境变量 `GEO_AUTO_LEARNING_INTERVAL_MS`（启动时读取）

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/main/services/autoLearningScheduler.cjs` | 新增 | 调度器核心服务 |
| `src/main/services/databaseService.cjs` | 修改 | 添加 `scheduler_state` 表迁移 |
| `src/main/index.cjs` | 修改 | 注册 IPC handler + 生命周期集成 |
| `src/main/preload.cjs` | 修改 | 新增 3 个方法 |
| `src/renderer/global.d.ts` | 修改 | 新增类型定义 |
| `src/renderer/views/AutoLearning.tsx` | 修改 | 新增调度状态卡片 + 移除渲染端定时器 |

## 测试策略

1. **单元测试**：调度器核心逻辑（时间计算、状态管理）
2. **集成测试**：IPC 调用链路（preload → main → service）
3. **手动测试**：
   - 启动应用，验证首次立即执行
   - 等待 12 小时（或修改间隔为短时间），验证定时执行
   - 关闭应用，等待一段时间后重启，验证补偿执行
   - 打开 AutoLearning 页面，验证状态显示正确

## 验收标准

- [ ] 应用启动后，如果距上次执行超过 12 小时，立即执行一次自动学习周期
- [ ] 运行时每 12 小时自动执行一次
- [ ] 执行不依赖特定页面，在任何页面都能运行
- [ ] 所有有已发布文章的项目都被检测
- [ ] 被收录的文章触发 Phase 7 学习，生成待确认规则
- [ ] AutoLearning 页面显示调度状态（上次/下次执行时间、项目数）
- [ ] 手动触发按钮正常工作
- [ ] 单个项目失败不影响其他项目
