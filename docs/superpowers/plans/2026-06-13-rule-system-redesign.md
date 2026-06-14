# GEO 规则系统重新设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重建规则系统，使阶段 7 生成的优化规则能反馈到阶段 2-6，实现 GEO 全流程闭环。

**Architecture:** 扩展 `evolution_rules` 表（新增 scope + target_stages 字段），新建 `ruleService.cjs`（按阶段查询规则）和 `globalRuleService.cjs`（增量提取全局规则），新增 2 个 skill 文件，修复阶段 2 状态 BUG，同步阶段 3 skill 文件，阶段 4 注入规则。

**Tech Stack:** Node.js (CommonJS), SQLite (better-sqlite3), React 19, Tailwind v4

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/services/databaseService.cjs` | 修改 | 添加 scope + target_stages 字段 + global_rule_state 表 |
| `src/main/services/ruleService.cjs` | 新增 | 规则查询服务 |
| `src/main/services/globalRuleService.cjs` | 新增 | 全局规则提取服务 |
| `skills/geo-rule-extraction.md` | 新增 | 企业规则提取 skill |
| `skills/geo-global-rule-extraction.md` | 新增 | 全局规则模式提取 skill |
| `src/main/services/reflectionService.cjs` | 修改 | 使用 geo-rule-extraction skill |
| `src/main/services/questionPoolService.cjs` | 修改 | 修复状态 BUG + 使用 ruleService |
| `skills/geo-source-discovery.md` | 修改 | 以服务内联 prompt 为准同步 |
| `skills/geo-support-content.md` | 修改 | 添加规则输入说明 |
| `src/main/services/articleDraftService.cjs` | 修改 | 注入规则到 prompt |
| `src/main/services/autoLearningScheduler.cjs` | 修改 | 集成全局规则提取 |
| `src/main/index.cjs` | 修改 | 注册新 IPC handler |
| `src/main/preload.cjs` | 修改 | 暴露新方法 |
| `src/renderer/global.d.ts` | 修改 | 新增类型定义 |
| `src/renderer/views/AutoLearning.tsx` | 修改 | 显示 scope + target_stages |

---

### Task 1: 数据库迁移 — 扩展 evolution_rules 表 + 新建 global_rule_state 表

**Files:**
- Modify: `src/main/services/databaseService.cjs`

- [ ] **Step 1: 在 migrateSchema 函数末尾添加字段迁移和新表**

在 `migrateSchema` 函数末尾（`scheduler_state` 表创建之后）添加：

```javascript
  // 规则系统扩展：evolution_rules 新增 scope 和 target_stages 字段
  const erColumns = database.prepare('PRAGMA table_info(evolution_rules)').all();
  const erExisting = new Set(erColumns.map((c) => c.name));
  if (!erExisting.has('scope')) {
    database.exec("ALTER TABLE evolution_rules ADD COLUMN scope TEXT NOT NULL DEFAULT 'enterprise'");
  }
  if (!erExisting.has('target_stages')) {
    database.exec("ALTER TABLE evolution_rules ADD COLUMN target_stages TEXT NOT NULL DEFAULT '[]'");
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_evolution_rules_scope_stages
      ON evolution_rules(scope, status, target_stages);
  `);

  // 全局规则处理状态表
  database.exec(`
    CREATE TABLE IF NOT EXISTS global_rule_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/databaseService.cjs
git commit -m "feat: add scope + target_stages to evolution_rules, add global_rule_state table"
```

---

### Task 2: 规则查询服务 ruleService.cjs

**Files:**
- Create: `src/main/services/ruleService.cjs`

- [ ] **Step 1: 创建规则查询服务**

```javascript
'use strict';

const { getDb } = require('./databaseService.cjs');

/**
 * 获取指定阶段适用的规则（全局 + 企业，企业优先）
 */
function getRulesForStage(projectId, stage, platform) {
  const db = getDb();

  // 查询全局规则
  const globalRules = db.prepare(`
    SELECT * FROM evolution_rules
    WHERE scope = 'global' AND status = 'confirmed'
    AND target_stages LIKE ?
    AND (platform = ? OR platform IS NULL)
  `).all(`%${stage}%`, platform);

  // 查询企业规则
  const enterpriseRules = db.prepare(`
    SELECT * FROM evolution_rules
    WHERE project_id = ? AND scope = 'enterprise' AND status = 'confirmed'
    AND target_stages LIKE ?
    AND (platform = ? OR platform IS NULL)
  `).all(projectId, `%${stage}%`, platform);

  // 合并：企业规则优先（同 rule_type 覆盖全局规则）
  const merged = new Map();
  for (const rule of globalRules) {
    merged.set(rule.rule_type, rule);
  }
  for (const rule of enterpriseRules) {
    merged.set(rule.rule_type, rule); // 企业规则覆盖全局
  }

  return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
}

/**
 * 获取指定阶段的规则文本（注入 prompt 用）
 */
function getRulesTextForStage(projectId, stage, platform) {
  const rules = getRulesForStage(projectId, stage, platform);
  if (rules.length === 0) return '';

  const typeLabels = {
    evidence: '证据强化',
    keyword: '关键词策略',
    source: '信源优化',
    avoid: '避坑策略',
    content_gap: '内容缺口',
    content: '内容优化',
    title: '标题优化（全局规则）',
    structure: '结构调整（全局规则）',
  };

  const lines = ['## 已确认的优化规则'];
  for (const rule of rules) {
    const label = typeLabels[rule.rule_type] || rule.rule_type;
    const scope = rule.scope === 'global' ? ' [全局]' : '';
    lines.push(`### ${label}${scope}`);
    lines.push(`- ${rule.content}（置信度 ${Math.round(rule.confidence * 100)}%）`);
  }
  return lines.join('\n');
}

/**
 * 获取全局规则列表
 */
function getGlobalRules(platform) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM evolution_rules
    WHERE scope = 'global' AND status = 'confirmed'
    AND (platform = ? OR platform IS NULL)
    ORDER BY confidence DESC
  `).all(platform);
}

/**
 * 获取企业规则列表
 */
function getEnterpriseRules(projectId, platform, filters = {}) {
  const db = getDb();
  let sql = `SELECT * FROM evolution_rules WHERE project_id = ? AND scope = 'enterprise'`;
  const params = [projectId];

  if (filters.status) {
    sql += ` AND status = ?`;
    params.push(filters.status);
  }
  if (platform) {
    sql += ` AND (platform = ? OR platform IS NULL)`;
    params.push(platform);
  }
  sql += ` ORDER BY created_at DESC`;

  return db.prepare(sql).all(...params);
}

module.exports = {
  getRulesForStage,
  getRulesTextForStage,
  getGlobalRules,
  getEnterpriseRules,
};
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/ruleService.cjs
git commit -m "feat: add ruleService for stage-based rule querying"
```

---

### Task 3: 企业规则提取 Skill

**Files:**
- Create: `skills/geo-rule-extraction.md`

- [ ] **Step 1: 创建 skill 文件**

将设计文档中第 5 节的完整 skill 内容写入文件。内容包括：
- YAML frontmatter（name: geo-rule-extraction, visibility: internal, task_type: reflection）
- 6 种规则类型的详解和示例输出
- 提取原则

完整内容见设计文档 `docs/superpowers/specs/2026-06-13-rule-system-redesign.md` 第 5 节。

- [ ] **Step 2: 提交**

```bash
git add skills/geo-rule-extraction.md
git commit -m "feat: add geo-rule-extraction skill for enterprise rule generation"
```

---

### Task 4: 全局规则模式提取 Skill

**Files:**
- Create: `skills/geo-global-rule-extraction.md`

- [ ] **Step 1: 创建 skill 文件**

将设计文档中第 6 节的完整 skill 内容写入文件。内容包括：
- YAML frontmatter（name: geo-global-rule-extraction, visibility: internal, task_type: global_rule_extraction）
- 标题模式识别指南（数字型、痛点型、方案型、对比型）
- 结构模式识别指南（问题-方案、数据驱动、案例叙事）
- 提取原则

完整内容见设计文档 `docs/superpowers/specs/2026-06-13-rule-system-redesign.md` 第 6 节。

- [ ] **Step 2: 提交**

```bash
git add skills/geo-global-rule-extraction.md
git commit -m "feat: add geo-global-rule-extraction skill for global rule pattern extraction"
```

---

### Task 5: 全局规则提取服务 globalRuleService.cjs

**Files:**
- Create: `src/main/services/globalRuleService.cjs`

- [ ] **Step 1: 创建全局规则提取服务**

```javascript
'use strict';

const { getDb } = require('./databaseService.cjs');

const BATCH_SIZE = 20;
const DECAY_CYCLES = 3;

function getState(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM global_rule_state WHERE key = ?').get(key);
  return row?.value || null;
}

function setState(key, value) {
  const db = getDb();
  db.prepare(`
    INSERT INTO global_rule_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value));
}

function getNewArticles(lastProcessedAt) {
  const db = getDb();
  if (!lastProcessedAt) {
    return db.prepare(`
      SELECT ad.*, ap.name as project_name
      FROM geo_article_drafts ad
      INNER JOIN geo_projects ap ON ap.id = ad.project_id
      WHERE ad.publication_evidence IS NOT NULL
      AND json_extract(ad.publication_evidence, '$.status') = 'published'
      AND json_extract(ad.publication_evidence, '$.published_url') IS NOT NULL
    `).all();
  }
  return db.prepare(`
    SELECT ad.*, ap.name as project_name
    FROM geo_article_drafts ad
    INNER JOIN geo_projects ap ON ap.id = ad.project_id
    WHERE ad.publication_evidence IS NOT NULL
    AND json_extract(ad.publication_evidence, '$.status') = 'published'
    AND json_extract(ad.publication_evidence, '$.published_url') IS NOT NULL
    AND ad.created_at > ?
  `).all(lastProcessedAt);
}

function getExistingGlobalRules() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM evolution_rules
    WHERE scope = 'global' AND status = 'confirmed'
    AND rule_type IN ('title', 'structure')
  `).all();
}

function createGlobalRule(pattern) {
  const db = getDb();
  const id = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO evolution_rules (id, project_id, scope, platform, rule_type, content, evidence_count, confidence, status, target_stages, created_at, updated_at)
    VALUES (?, NULL, 'global', ?, ?, ?, 1, ?, 'confirmed', '[4]', datetime('now'), datetime('now'))
  `).run(id, pattern.platform || null, pattern.rule_type, pattern.content, pattern.confidence || 0.7);
}

function updateRuleConfidence(ruleId, evidenceCount, confidence) {
  const db = getDb();
  db.prepare(`
    UPDATE evolution_rules SET evidence_count = ?, confidence = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(evidenceCount, confidence, ruleId);
}

function calculateConfidence(evidenceCount) {
  // 置信度随证据数递增，上限 0.95
  return Math.min(0.95, 0.5 + evidenceCount * 0.05);
}

/**
 * 增量处理新文章，提取全局规则
 */
async function processNewArticles(extractPatternsFn, mergePatternsFn) {
  const lastProcessed = getState('last_processed_at');
  const articles = getNewArticles(lastProcessed);

  if (articles.length === 0) return { processed: 0, rulesCreated: 0 };

  let rulesCreated = 0;
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const allPatterns = [];

    for (const article of batch) {
      try {
        const patterns = await extractPatternsFn(article);
        allPatterns.push(...patterns);
      } catch (err) {
        console.error(`[GlobalRuleService] 文章 ${article.id} 提取失败:`, err.message);
      }
    }

    if (allPatterns.length > 0) {
      const result = await mergePatternsFn(allPatterns, getExistingGlobalRules());
      rulesCreated += result.created || 0;
    }
  }

  setState('last_processed_at', new Date().toISOString());
  console.log(`[GlobalRuleService] 处理完成: ${articles.length} 篇文章, ${rulesCreated} 条新规则`);
  return { processed: articles.length, rulesCreated };
}

/**
 * 衰减长期未出现的规则置信度
 */
function decayStaleRules() {
  const db = getDb();
  const staleRules = db.prepare(`
    SELECT * FROM evolution_rules
    WHERE scope = 'global' AND status = 'confirmed'
    AND rule_type IN ('title', 'structure')
    AND updated_at < datetime('now', '-3 days')
  `).all();

  for (const rule of staleRules) {
    const newConfidence = Math.max(0.1, rule.confidence - 0.1);
    if (newConfidence <= 0.1) {
      db.prepare("UPDATE evolution_rules SET status = 'archived' WHERE id = ?").run(rule.id);
    } else {
      updateRuleConfidence(rule.id, rule.evidence_count, newConfidence);
    }
  }
}

module.exports = {
  processNewArticles,
  getExistingGlobalRules,
  decayStaleRules,
  getState,
  setState,
};
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/globalRuleService.cjs
git commit -m "feat: add globalRuleService for incremental global rule extraction"
```

---

### Task 6: 更新 reflectionService 使用 skill

**Files:**
- Modify: `src/main/services/reflectionService.cjs`

- [ ] **Step 1: 在 reflectionService 中加载 skill 并替换内联 prompt**

找到 `buildMessages` 函数（约 line 53），将内联 system prompt 替换为从 skill 加载：

```javascript
// 在文件顶部添加
const { getSkill } = require('./skillService.cjs');

// 在 buildMessages 函数中替换 system content
function buildMessages({ profile, visibilityResult, publishedArticles }) {
  const skill = getSkill('geo-rule-extraction');
  const systemContent = skill?.content || '你是 GEO 优化规则提取专家。';

  // ... 其余逻辑不变
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/reflectionService.cjs
git commit -m "feat: reflectionService now uses geo-rule-extraction skill"
```

---

### Task 7: 修复 questionPoolService 状态 BUG

**Files:**
- Modify: `src/main/services/questionPoolService.cjs`

- [ ] **Step 1: 修复状态查询 + 使用 ruleService**

```javascript
// 在文件顶部添加
const ruleService = require('./ruleService.cjs');

// 替换 getEvolutionRules 函数（约 line 40-54）
function getEvolutionRules(projectId, platform, stage = 2) {
  return ruleService.getRulesForStage(projectId, stage, platform);
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/questionPoolService.cjs
git commit -m "fix: questionPoolService now uses ruleService for stage-based rule queries"
```

---

### Task 8: 同步阶段 3 skill 文件

**Files:**
- Modify: `skills/geo-source-discovery.md`

- [ ] **Step 1: 以服务内联 prompt 为准更新 skill 文件**

读取 `src/main/services/sourceDiscoveryService.cjs` 中的内联 prompt（lines 229-281），将其内容同步到 `skills/geo-source-discovery.md` 的 body 部分。保留 YAML frontmatter 不变。

内联 prompt 包含两个核心函数：
- `buildPreferenceMessages` — 偏好搜索 prompt
- `buildQuestionMessages` — 逐问题搜索 prompt

将这两个 prompt 的内容写入 skill 文件的 markdown body 中。

- [ ] **Step 2: 提交**

```bash
git add skills/geo-source-discovery.md
git commit -m "feat: sync geo-source-discovery skill with service inline prompts"
```

---

### Task 9: 更新阶段 4 skill 支持规则输入

**Files:**
- Modify: `skills/geo-support-content.md`

- [ ] **Step 1: 在 skill 文件的输入表格中更新规则说明**

找到输入表格中的"历史规则"行，替换为：

```markdown
| 已确认的优化规则 | evidence/keyword/content_gap/content/title/structure 规则，指导内容生成 |
```

在"写作规则"部分添加：

```markdown
- 必须参考已确认的优化规则：
  - evidence 规则：补充对应的企业事实和案例
  - keyword 规则：在标题和正文中嵌入目标关键词
  - content_gap 规则：覆盖缺失的内容主题
  - content 规则：按优化建议调整内容结构
  - title 规则（全局）：使用高效的标题模式
  - structure 规则（全局）：使用便于 AI 摘取的结构
```

- [ ] **Step 2: 提交**

```bash
git add skills/geo-support-content.md
git commit -m "feat: update geo-support-content skill with rule input guidelines"
```

---

### Task 10: 阶段 4 服务注入规则

**Files:**
- Modify: `src/main/services/articleDraftService.cjs`

- [ ] **Step 1: 在构建 LLM messages 时查询并注入规则**

在 `articleDraftService.cjs` 中找到构建 user prompt 的位置，在 prompt 中注入规则文本：

```javascript
// 在文件顶部添加
const ruleService = require('./ruleService.cjs');

// 在构建 user prompt 时（geoProjectId 和 platform 可用的位置）
const rulesText = ruleService.getRulesTextForStage(projectId, 4, platform);
// 将 rulesText 追加到 user prompt 中
```

具体插入位置需要读取文件确认 prompt 构建点。

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/articleDraftService.cjs
git commit -m "feat: articleDraftService injects rules into content generation prompt"
```

---

### Task 11: 自动学习调度器集成全局规则提取

**Files:**
- Modify: `src/main/services/autoLearningScheduler.cjs`

- [ ] **Step 1: 在 runCycle 中调用全局规则提取**

```javascript
// 在文件顶部添加
const globalRuleService = require('./globalRuleService.cjs');

// 在 runCycle 函数中，更新 last_run_at 之前添加
await globalRuleService.processNewArticles(
  async (article) => {
    // 使用 geo-global-rule-extraction skill 提取模式
    const { getSkill } = require('./skillService.cjs');
    const skill = getSkill('geo-global-rule-extraction');
    // 调用 LLM 提取模式（需要实现具体调用逻辑）
    return [];
  },
  async (patterns, existingRules) => {
    // 使用 LLM 合并模式（需要实现具体合并逻辑）
    return { created: 0 };
  }
);
```

注意：具体的 LLM 调用逻辑需要根据 `llmGateway.cjs` 的接口实现。

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/main/services/autoLearningScheduler.cjs
git commit -m "feat: autoLearningScheduler integrates global rule extraction"
```

---

### Task 12: IPC + Preload + 类型定义

**Files:**
- Modify: `src/main/index.cjs`
- Modify: `src/main/preload.cjs`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: 在 index.cjs 注册新 IPC handler**

```javascript
ipcMain.handle('geo-agent:get-rules-for-stage', async (_event, projectId, stage, platform) => {
  return ruleService.getRulesForStage(projectId, stage, platform);
});

ipcMain.handle('geo-agent:get-global-rules', async (_event, platform) => {
  return ruleService.getGlobalRules(platform);
});
```

在文件顶部添加：`const ruleService = require('./services/ruleService.cjs');`

- [ ] **Step 2: 在 preload.cjs 暴露新方法**

```javascript
getRulesForStage: (projectId, stage, platform) => ipcRenderer.invoke('geo-agent:get-rules-for-stage', projectId, stage, platform),
getGlobalRules: (platform) => ipcRenderer.invoke('geo-agent:get-global-rules', platform),
```

- [ ] **Step 3: 在 global.d.ts 添加类型**

```typescript
interface GeoAgentRule {
  id: string;
  project_id: string | null;
  scope: 'global' | 'enterprise';
  platform: string | null;
  rule_type: string;
  content: string;
  evidence_count: number;
  confidence: number;
  status: string;
  target_stages: string;
  created_at: string;
  updated_at: string;
}
```

在 `Window.geoAgent` 接口中添加：

```typescript
getRulesForStage: (projectId: string, stage: number, platform: string) => Promise<GeoAgentRule[]>;
getGlobalRules: (platform: string) => Promise<GeoAgentRule[]>;
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 5: 提交**

```bash
git add src/main/index.cjs src/main/preload.cjs src/renderer/global.d.ts
git commit -m "feat: add IPC handlers and types for rule querying"
```

---

### Task 13: 渲染端 UI 更新

**Files:**
- Modify: `src/renderer/views/AutoLearning.tsx`

- [ ] **Step 1: 规则卡片增加 scope 和 target_stages 显示**

在规则卡片的 badge 区域，增加 scope 标签：

```tsx
{rule.scope === 'global' && (
  <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
    全局
  </span>
)}
```

在规则内容下方增加 target_stages 显示：

```tsx
{rule.target_stages && (
  <div className="mt-1 text-[10px] text-on-surface-variant">
    作用阶段：{JSON.parse(rule.target_stages).map(s => `阶段${s}`).join('、')}
  </div>
)}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 3: 运行测试**

Run: `npm test`
Expected: 现有测试通过

- [ ] **Step 4: 提交**

```bash
git add src/renderer/views/AutoLearning.tsx
git commit -m "feat: AutoLearning UI shows rule scope and target_stages"
```

---

### Task 14: 端到端验证

- [ ] **Step 1: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 2: 运行测试**

Run: `npm test`
Expected: 全部测试通过

- [ ] **Step 3: 启动开发服务器验证**

Run: `npm run dev`
验证：
1. 阶段 7 反思生成规则（使用 skill）
2. 用户确认规则
3. 阶段 2 问题池生成引用规则
4. AutoLearning 页面显示 scope 和 target_stages
