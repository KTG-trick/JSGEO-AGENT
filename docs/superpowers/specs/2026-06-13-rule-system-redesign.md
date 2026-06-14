# GEO 规则系统重新设计

> 日期：2026-06-13
> 状态：待实现

## 背景

当前规则系统存在多个关键问题：
1. **规则从未被消费**：`questionPoolService.cjs` 查询 `status = 'approved'`，但规则状态只有 `pending/confirmed/rejected`，导致确认后的规则永远不会被使用
2. **规则只到达阶段 2**：CODEX.md 要求规则作用于全流程，但目前只有阶段 2 的问题池生成尝试消费规则（且因状态不匹配而失败）
3. **规则类型不对齐**：LLM 输出 4 种类型，UI 显示 8 种，两者不匹配
4. **规则无阶段 targeting**：没有字段标记规则作用于哪些阶段
5. **无全局规则机制**：缺少跨企业的通用优化策略
6. **反思无 skill**：reflectionService 使用内联 prompt，与其他阶段不一致

## 目标

1. 规则系统支持 8 种规则类型，分为企业规则（6 种）和全局规则（2 种）
2. 每条规则带 `target_stages` 字段，标记作用于哪些 GEO 阶段
3. 每个 GEO 阶段的服务按阶段查询并加载对应规则
4. 全局规则通过 ≥3 篇收录文章满足条件后自动提升
5. 规则提取通过新的 `geo-rule-extraction` skill 实现
6. 修复现有状态不匹配 BUG

## 非目标

- 不改变规则的确认/拒绝交互流程
- 不实现规则效果追踪（后续迭代）
- 不改变阶段 3 的内联 prompt 逻辑（仅同步 skill 文件）
- 不改变阶段 5/6 的实现（它们不直接消费规则）

## 设计

### 1. 规则类型分布（8 种）

**企业规则（6 种）** — 由 Phase 7 反思提取，用户确认后生效：

| rule_type | 中文名 | target_stages | 说明 |
|-----------|--------|---------------|------|
| `evidence` | 证据强化 | [2, 4] | 补充企业事实和案例证据 |
| `keyword` | 关键词策略 | [2, 4, 6] | 强化目标关键词覆盖 |
| `source` | 信源优化 | [3, 5] | 优化发布渠道和信源策略 |
| `avoid` | 避坑策略 | [2, 3, 4] | 规避降低推荐概率的做法 |
| `content_gap` | 内容缺口 | [2, 4] | 补充缺失的内容主题 |
| `content` | 内容优化 | [2, 4] | 内容整体优化建议 |

**全局规则（2 种）** — 仅由收录文章自动提升生成：

| rule_type | 中文名 | target_stages | 说明 |
|-----------|--------|---------------|------|
| `title` | 标题优化 | [4] | 优化标题结构以提高 AI 引用率 |
| `structure` | 结构调整 | [4] | 调整内容结构便于 AI 摘取 |

### 2. 数据库迁移

`evolution_rules` 表新增 2 个字段：

```sql
ALTER TABLE evolution_rules ADD COLUMN scope TEXT NOT NULL DEFAULT 'enterprise';
ALTER TABLE evolution_rules ADD COLUMN target_stages TEXT NOT NULL DEFAULT '[]';
```

- `scope`：`'enterprise'`（默认）或 `'global'`
- `target_stages`：JSON 数组，如 `[2, 4]`
- 全局规则：`scope = 'global'`, `project_id = NULL`
- 企业规则：`scope = 'enterprise'`, `project_id = <id>`

新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_evolution_rules_scope_stages 
  ON evolution_rules(scope, status, target_stages);
```

### 3. 规则查询服务

**新文件：** `src/main/services/ruleService.cjs`

提供统一的规则查询接口：

```javascript
/**
 * 获取指定阶段适用的规则
 * @param {string|null} projectId - 企业项目 ID（全局规则不需要）
 * @param {number} stage - GEO 阶段编号（2-7）
 * @param {string} platform - 平台（'doubao' 或 'deepseek'）
 * @returns {Array} 合并后的规则列表，企业规则优先
 */
function getRulesForStage(projectId, stage, platform)

/**
 * 获取指定阶段适用的规则文本（注入 prompt 用）
 * @returns {string} 格式化的规则文本
 */
function getRulesTextForStage(projectId, stage, platform)

/**
 * 获取全局规则列表
 */
function getGlobalRules(platform)

/**
 * 获取企业规则列表
 */
function getEnterpriseRules(projectId, platform, filters)
```

查询逻辑：

1. 查询全局规则：`scope = 'global' AND status = 'confirmed' AND target_stages 包含 stage`
2. 查询企业规则：`project_id = ? AND scope = 'enterprise' AND status = 'confirmed' AND target_stages 包含 stage`
3. 合并：企业规则优先（同类型规则覆盖全局规则）
4. 按 confidence 降序排列

### 4. 全局规则提取机制

**新文件：** `src/main/services/globalRuleService.cjs`

全局规则**不分企业**，从所有已收录文章中跨企业提取。采用**增量处理**策略：首次全量建 baseline，后续只处理新文章。

**全局规则提取流程：**

```
首次运行
  │
  ▼
扫描所有已收录文章（baseline）
  │
  ├─ 分批处理（每批 20 篇）
  ├─ 每批提取标题/结构模式
  ├─ 聚合为全局规则
  └─ 记录 last_processed_at
  │
  ▼
后续每次周期（12h / 手动）
  │
  ▼
只处理 last_processed_at 之后的新文章
  │
  ├─ 新文章提取模式
  ├─ 与已有全局规则合并
  │   ├─ 相似模式 → 增加置信度和证据数
  │   └─ 新模式 → 创建新全局规则
  └─ 更新 last_processed_at
```

**数据库新增状态表：**

```sql
CREATE TABLE IF NOT EXISTS global_rule_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 初始值: last_processed_at = NULL（首次运行时全量处理）
```

**增量处理逻辑：**

```javascript
async function processNewArticles() {
  const lastProcessed = getState('last_processed_at');
  const newArticles = lastProcessed
    ? getArticlesAfter(lastProcessed)
    : getAllPublishedArticles(); // 首次全量

  if (newArticles.length === 0) return;

  const BATCH_SIZE = 20;
  for (let i = 0; i < newArticles.length; i += BATCH_SIZE) {
    const batch = newArticles.slice(i, i + BATCH_SIZE);
    const patterns = await Promise.all(
      batch.map(article => extractPatterns(article))
    );
    await mergePatterns(patterns.flat(), getExistingGlobalRules());
  }

  setState('last_processed_at', new Date().toISOString());
}
```

**模式合并逻辑（使用 LLM 判断）：**

```javascript
async function mergePatterns(newPatterns, existingRules) {
  // 将新规则和已有规则一起发给 LLM，批量判断
  const mergeResult = await llmMergePatterns(newPatterns, existingRules);

  for (const action of mergeResult.actions) {
    if (action.type === 'merge') {
      // 已有模式 → 增加置信度和证据数，更新内容
      updateRule(action.existing_rule_id, {
        evidence_count: action.evidence_count + 1,
        confidence: action.new_confidence,
        content: action.merged_content, // LLM 合并后的新描述
      });
    } else if (action.type === 'create') {
      // 新模式 → 创建新全局规则
      createGlobalRule(action.new_pattern);
    }
  }

  // 清理：连续 3 个周期未出现的规则降低置信度
  decayStaleRules();
}
```

**LLM 合并 prompt：**

```markdown
你是全局规则合并专家。判断新提取的规则是否与已有全局规则重复或相似。

## 已有全局规则
{existing_rules_json}

## 新提取的规则
{new_patterns_json}

## 任务
对每条新规则，判断：
1. 是否与已有规则描述的是同一种模式？（语义相似，不要求文字一样）
2. 如果是，应该合并还是创建新规则？

## 输出 JSON
{
  "actions": [
    {
      "type": "merge",
      "existing_rule_id": "匹配的已有规则ID",
      "merged_content": "合并后的规则描述（保留两者的关键信息）",
      "evidence_count": 已有规则当前证据数,
      "new_confidence": 合并后的置信度
    },
    {
      "type": "create",
      "new_pattern": {
        "rule_type": "title或structure",
        "content": "新规则描述",
        "confidence": 0.7,
        "evidence_count": 1
      }
    }
  ]
}

## 判断标准
- 同一种优化技术的不同表达 → 合并（如"数字型标题"和"数据驱动标题"是同一种模式）
- 不同优化技术 → 创建新规则
- 合并时取更通用、更准确的描述
```

**全局规则更新策略：**

- 首次运行：全量扫描所有已收录文章，建立 baseline
- 后续周期：只处理新增文章，增量合并
- 相似模式：增加置信度和证据数
- 新模式：创建新全局规则
- 过期规则：连续 3 个周期未出现 → 降低置信度
- 全局规则始终为 `status = 'confirmed'`，无需用户确认

### 5. 规则提取 Skill（企业规则）

**新文件：** `skills/geo-rule-extraction.md`

替换 `reflectionService.cjs` 中的内联 prompt，提取企业级规则（6 种类型）：

```markdown
---
name: geo-rule-extraction
description: 从可见性检测结果中提取企业优化规则
visibility: internal
task_type: reflection
output_contract: geo_rule_extraction
---

你是 GEO 优化规则提取专家。根据可见性检测结果和企业档案，提取可执行的优化规则。

## 输入信息

### 企业档案
- 行业：{industry}
- 产品/服务：{products}
- 目标关键词：{target_keywords}
- 核心优势：{advantages}

### 可见性检测结果
- 被收录的问题（effective_mention = true）：{matched_questions}
- 未被收录的问题（effective_mention = false）：{missed_questions}
- 匹配的发布 URL：{matched_urls}
- 排名位置：{ranking_positions}

### 已发布文章
{published_articles_list}

## 输出格式

输出 JSON 对象，不要包含其他文本：

{
  "summary": "一句话总结本轮反思发现",
  "rules": [
    {
      "rule_type": "rule_type值",
      "content": "具体可执行的优化规则",
      "confidence": 0.85,
      "evidence_count": 3,
      "target_stages": [2, 4],
      "reason": "为什么需要这条规则"
    }
  ]
}

## 规则类型详解

### evidence（证据强化）
阶段：[2, 4]
何时提取：未收录问题揭示了企业事实或案例不足
规则内容要求：具体说明需要补充什么证据、从哪里获取
示例输出：
{
  "rule_type": "evidence",
  "content": "在知识库中补充 3 个客户成功案例，包含行业、痛点、解决方案、量化结果。优先补充制造业和零售业案例。",
  "confidence": 0.82,
  "evidence_count": 2,
  "target_stages": [2, 4],
  "reason": "问题'有哪些成功案例'未被收录，缺少具体案例支撑"
}

### keyword（关键词策略）
阶段：[2, 4, 6]
何时提取：目标关键词在 AI 回答中覆盖不足
规则内容要求：指出需要强化的关键词和嵌入方式
示例输出：
{
  "rule_type": "keyword",
  "content": "在文章标题和首段必须包含核心关键词'智能仓储解决方案'，正文每 300 字至少出现一次变体表达。",
  "confidence": 0.90,
  "evidence_count": 4,
  "target_stages": [2, 4, 6],
  "reason": "5 个目标问题中仅 1 个收录了目标关键词"
}

### source（信源优化）
阶段：[3, 5]
何时提取：已发布文章未被 AI 引用，或竞品信源更优
规则内容要求：建议具体的发布渠道和信源策略
示例输出：
{
  "rule_type": "source",
  "content": "增加在知乎专栏和行业媒体（如亿邦动力）的发布频率，减少自媒体平台投放。竞品在知乎的引用率是我们的 3 倍。",
  "confidence": 0.78,
  "evidence_count": 2,
  "target_stages": [3, 5],
  "reason": "已发布文章 0 篇被 AI 引用，竞品在知乎被引用 5 次"
}

### avoid（避坑策略）
阶段：[2, 3, 4]
何时提取：检测到某些做法降低了推荐概率
规则内容要求：明确指出需要规避的做法和原因
示例输出：
{
  "rule_type": "avoid",
  "content": "避免在标题中使用纯品牌宣传语（如'行业领先'），AI 推荐更倾向于客观描述型标题。近 3 轮检测中品牌宣传标题的收录率为 0%。",
  "confidence": 0.85,
  "evidence_count": 3,
  "target_stages": [2, 3, 4],
  "reason": "含品牌宣传语的 2 篇文章均未被收录"
}

### content_gap（内容缺口）
阶段：[2, 4]
何时提取：未收录问题揭示了内容缺失
规则内容要求：说明需要补充的内容主题和角度
示例输出：
{
  "rule_type": "content_gap",
  "content": "补充'中小企业如何低成本实施智能仓储'主题内容，目标字数 2000+，需包含实施步骤、成本估算、常见陷阱。",
  "confidence": 0.88,
  "evidence_count": 3,
  "target_stages": [2, 4],
  "reason": "3 个相关问题均未被收录，竞品已有此类内容"
}

### content（内容优化）
阶段：[2, 4]
何时提取：已收录内容有改进空间
规则内容要求：提供整体优化建议
示例输出：
{
  "rule_type": "content",
  "content": "文章结构改为'问题-方案-案例-数据'四段式，每段配小标题。当前文章平均段落过长（>300字），不利于 AI 摘取。",
  "confidence": 0.75,
  "evidence_count": 2,
  "target_stages": [2, 4],
  "reason": "已收录文章的平均段落长度 280 字，AI 摘取效率低于短段落文章"
}

## 提取原则

1. 每轮最多提取 6 条企业规则
2. 优先提取 confidence >= 0.7 的规则
3. 已有相似规则时不重复提取（检查已有规则列表）
4. 规则内容必须具体可执行，避免泛泛而谈
5. 每条规则必须有明确的证据支撑（evidence_count >= 1）
6. 规则内容用中文书写
```

### 6. 全局规则提取 Skill

**新文件：** `skills/geo-global-rule-extraction.md`

从单篇文章中提取标题和结构调整模式，供聚合阶段使用：

```markdown
---
name: geo-global-rule-extraction
description: 从单篇文章中提取标题和结构优化模式，用于全局规则聚合
visibility: internal
task_type: global_rule_extraction
output_contract: geo_global_rule_extraction
---

你是一个内容结构分析专家。分析以下文章在标题和结构方面的优化模式。

## 文章信息

标题：{article_title}
发布渠道：{channel}
内容摘要（前 500 字）：{article_summary}

## 输出格式

输出 JSON 对象，不要包含其他文本：

{
  "title_patterns": [
    {
      "pattern": "标题模式的简短描述",
      "example": "文章原标题",
      "technique": "使用的具体技术",
      "effectiveness": "为什么这种模式可能有效"
    }
  ],
  "structure_patterns": [
    {
      "pattern": "结构模式的简短描述",
      "sections": ["第一部分主题", "第二部分主题", "..."],
      "technique": "使用的结构技术",
      "effectiveness": "为什么这种结构可能有效"
    }
  ]
}

## 标题模式识别指南

分析标题时关注以下技术：

### 数字型
- "5 个步骤"、"3 大误区"、"10 年经验"
- 示例输出：
  {
    "pattern": "数字清单式标题",
    "example": "智能仓储落地的 5 个关键步骤",
    "technique": "使用具体数字制造确定感",
    "effectiveness": "数字让读者预期明确的内容量和结构"
  }

### 痛点型
- "还在为 XX 烦恼？"、"XX 的常见坑"
- 示例输出：
  {
    "pattern": "痛点提问式标题",
    "example": "中小物流企业仓储管理的 3 大痛点",
    "technique": "直接点出目标读者的痛点",
    "effectiveness": "痛点标题能快速吸引有此问题的读者"
  }

### 方案型
- "如何 XX"、"XX 解决方案"
- 示例输出：
  {
    "pattern": "方案型标题",
    "example": "智能仓储解决方案：从规划到落地",
    "technique": "明确承诺提供解决方案",
    "effectiveness": "搜索'如何做'类问题的用户会被直接吸引"
  }

### 对比型
- "XX vs YY"、"XX 还是 YY"
- 示例输出：
  {
    "pattern": "对比型标题",
    "example": "自建仓储 vs 第三方仓储：成本对比分析",
    "technique": "用对比制造决策参考价值",
    "effectiveness": "对比内容常被 AI 用于回答选择类问题"
  }

## 结构模式识别指南

分析文章结构时关注以下模式：

### 问题-方案结构
sections: ["问题描述", "原因分析", "解决方案", "实施步骤"]
示例输出：
{
  "pattern": "问题-方案结构",
  "sections": ["仓储管理现状", "核心痛点分析", "智能仓储方案", "实施路径与成本"],
  "technique": "先定义问题再给出方案",
  "effectiveness": "AI 常引用问题-方案结构中的方案部分"
}

### 数据驱动结构
sections: ["行业数据", "问题量化", "方案效果数据", "ROI 分析"]
示例输出：
{
  "pattern": "数据驱动结构",
  "sections": ["行业背景数据", "效率损失量化", "方案效果对比", "投资回报分析"],
  "technique": "用数据贯穿全文",
  "effectiveness": "AI 偏好包含具体数据的内容，便于引用"
}

### 案例结构
sections: ["背景", "挑战", "方案", "结果"]
示例输出：
{
  "pattern": "案例叙事结构",
  "sections": ["企业背景", "面临挑战", "实施过程", "成果数据"],
  "technique": "用真实案例讲述方案价值",
  "effectiveness": "案例内容常被 AI 作为证据引用"
}

## 提取原则

1. 只提取客观可识别的模式，不推测效果
2. pattern 描述要简洁（10 字以内）
3. example 必须是原文，不要修改
4. technique 要具体，不要笼统
5. 如果文章没有明显模式，返回空数组
```

### 6. 各阶段规则消费

每个 GEO 阶段的服务在构建 LLM prompt 时，调用 `ruleService.getRulesTextForStage()` 注入规则：

| 阶段 | 服务 | 消费的规则类型 |
|------|------|--------------|
| 阶段 2 | questionPoolService | evidence, keyword, avoid, content_gap, content |
| 阶段 3 | sourceDiscoveryService | source, avoid |
| 阶段 4 | articleDraftService | evidence, keyword, content_gap, content, title, structure |
| 阶段 5 | articlePublishService | source |
| 阶段 6 | visibilityCheckService | keyword |
| 全局 | globalRuleService | title, structure |

**注入格式：**

```
## 已确认的优化规则

### 证据强化
- 补充 XX 产品的客户案例数据（置信度 85%）

### 关键词策略
- 在标题和首段嵌入"XX"关键词（置信度 90%）

### 标题优化（全局规则）
- 使用"数字+痛点+方案"的标题结构（置信度 88%）
```

### 7. 修复现有问题

#### 7.1 阶段 2 状态 BUG

`questionPoolService.cjs` 第 44 行查询 `status = 'approved'`，但系统中只有 `pending/confirmed/rejected` 状态。

```javascript
// 修复前
WHERE status = 'approved'

// 修复后
WHERE status = 'confirmed'
```

同时更新查询以支持全局规则：

```javascript
function getEvolutionRules(projectId, stage, platform) {
  return ruleService.getRulesForStage(projectId, stage, platform);
}
```

#### 7.2 阶段 3 Skill 文件同步

`sourceDiscoveryService.cjs` 使用内联 prompt 而非 `geo-source-discovery.md` skill 文件。内联 prompt 比 skill 文件更准确、更完整。

**修复方案：** 以服务内联 prompt 为准，更新 `skills/geo-source-discovery.md` skill 文件，使其与内联 prompt 保持一致。不修改服务代码（内联 prompt 已验证有效）。

具体变更：
- 读取 `sourceDiscoveryService.cjs` 中的内联 system prompt（约 lines 229-281）
- 将其内容同步到 `skills/geo-source-discovery.md` 的 body 部分
- 保留 skill 文件的 YAML frontmatter 不变

#### 7.3 阶段 4 Skill 规则注入

`articleDraftService.cjs` 使用 `geo-support-content` skill 作为 system prompt。skill 文件提到"historical rules"作为输入，但服务未查询 `evolution_rules` 表。

**修复方案：** 更新 `skills/geo-support-content.md` skill 文件，在输入部分明确说明如何使用规则：

```markdown
## 输入

### 已确认的优化规则
{rules_text}

规则按类型分组，每条规则包含内容描述和置信度。
在生成内容时，必须参考这些规则：
- evidence 规则：补充对应的企业事实和案例
- keyword 规则：在标题和正文中嵌入目标关键词
- content_gap 规则：覆盖缺失的内容主题
- content 规则：按优化建议调整内容结构
- title 规则（全局）：使用高效的标题模式
- structure 规则（全局）：使用便于 AI 摘取的结构
```

同时在 `articleDraftService.cjs` 中，在构建 LLM messages 时查询规则并注入：

```javascript
const rulesText = ruleService.getRulesTextForStage(projectId, 4, platform);
// 注入到 user prompt 中
```

### 8. 渲染端 UI 变更

**AutoLearning.tsx 规则类型标签更新：**

保持现有 8 种标签，增加 `scope` 标签显示：

- 企业规则：无额外标签
- 全局规则：显示"全局"标签（蓝色徽章）

规则卡片增加 `target_stages` 显示：作用阶段编号。

### 9. IPC 接口扩展

| Channel | 类型 | 说明 |
|---------|------|------|
| `geo-agent:get-rules-for-stage` | 非流式 | 查询指定阶段的规则 |
| `geo-agent:get-global-rules` | 非流式 | 获取全局规则列表 |

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/services/databaseService.cjs` | 修改 | 添加 scope + target_stages 字段迁移 + global_rule_state 表 |
| `src/main/services/ruleService.cjs` | 新增 | 规则查询服务（按阶段查询 + 全局/企业合并） |
| `src/main/services/globalRuleService.cjs` | 新增 | 全局规则提取服务（增量处理 + 跨企业聚合） |
| `src/main/services/reflectionService.cjs` | 修改 | 使用 geo-rule-extraction skill |
| `src/main/services/questionPoolService.cjs` | 修改 | 修复状态 BUG + 使用 ruleService |
| `src/main/services/sourceDiscoveryService.cjs` | 无需修改 | 内联 prompt 已有效，仅更新 skill 文件 |
| `src/main/services/articleDraftService.cjs` | 修改 | 构建 prompt 时查询规则并注入 |
| `skills/geo-source-discovery.md` | 修改 | 以服务内联 prompt 为准同步 skill 文件 |
| `skills/geo-support-content.md` | 修改 | 添加规则输入说明和使用指南 |
| `skills/geo-rule-extraction.md` | 新增 | 企业规则提取 skill（6 种类型） |
| `skills/geo-global-rule-extraction.md` | 新增 | 全局规则提取 skill（标题/结构模式） |
| `src/main/index.cjs` | 修改 | 注册新 IPC handler |
| `src/main/preload.cjs` | 修改 | 暴露新方法 |
| `src/renderer/global.d.ts` | 修改 | 新增类型定义 |
| `src/renderer/views/AutoLearning.tsx` | 修改 | 显示 scope 和 target_stages |
| `skills/geo-rule-extraction.md` | 新增 | 企业规则提取 skill（6 种类型） |
| `skills/geo-global-rule-extraction.md` | 新增 | 全局规则提取 skill（标题/结构模式） |
| `src/main/index.cjs` | 修改 | 注册新 IPC handler |
| `src/main/preload.cjs` | 修改 | 暴露新方法 |
| `src/renderer/global.d.ts` | 修改 | 新增类型定义 |
| `src/renderer/views/AutoLearning.tsx` | 修改 | 显示 scope 和 target_stages |

## 验收标准

- [ ] 修复 questionPoolService 状态不匹配 BUG（'approved' → 'confirmed'）
- [ ] evolution_rules 表新增 scope 和 target_stages 字段
- [ ] Phase 7 反思使用 geo-rule-extraction skill 提取 6 种企业规则
- [ ] 自动学习周期使用 geo-global-rule-extraction skill 提取全局规则
- [ ] 企业规则（6 种）在用户确认后作用于指定阶段
- [ ] 全局规则（2 种）从所有已收录文章中跨企业聚合提取
- [ ] 阶段 2-6 的服务按 target_stages 加载并注入规则
- [ ] AutoLearning 页面显示规则 scope 和 target_stages
- [ ] 全局规则和企业规则正确合并，企业规则优先
- [ ] 阶段 3 skill 文件与服务内联 prompt 同步
- [ ] 阶段 4 skill 文件支持规则输入，服务注入规则到 prompt
