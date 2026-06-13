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
    merged.set(rule.rule_type, rule);
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
