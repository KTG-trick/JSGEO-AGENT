'use strict';

const { getDb } = require('./databaseService.cjs');

const BATCH_SIZE = 20;

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

/**
 * 获取需要处理的文章（增量：只取 last_processed_at 之后的新文章；首次：全量）
 */
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

/**
 * 获取已有的全局规则（title/structure 类型）
 */
function getExistingGlobalRules() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM evolution_rules
    WHERE scope = 'global' AND status = 'confirmed'
    AND rule_type IN ('title', 'structure')
  `).all();
}

/**
 * 创建全局规则
 */
function createGlobalRule(pattern) {
  const db = getDb();
  const id = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO evolution_rules (id, project_id, scope, platform, rule_type, content, evidence_count, confidence, status, target_stages, created_at, updated_at)
    VALUES (?, NULL, 'global', ?, ?, ?, 1, ?, 'confirmed', '[4]', datetime('now'), datetime('now'))
  `).run(id, pattern.platform || null, pattern.rule_type, pattern.content, pattern.confidence || 0.7);
}

/**
 * 更新规则置信度
 */
function updateRuleConfidence(ruleId, evidenceCount, confidence) {
  const db = getDb();
  db.prepare(`
    UPDATE evolution_rules SET evidence_count = ?, confidence = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(evidenceCount, confidence, ruleId);
}

/**
 * 计算置信度（随证据数递增，上限 0.95）
 */
function calculateConfidence(evidenceCount) {
  return Math.min(0.95, 0.5 + evidenceCount * 0.05);
}

/**
 * 增量处理新文章，提取全局规则
 * @param {Function} extractPatternsFn - 提取模式的异步函数，接收 article 对象，返回模式数组
 * @param {Function} mergePatternsFn - 合并模式的异步函数，接收 (patterns, existingRules)，返回 { created: number }
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
