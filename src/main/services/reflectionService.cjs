const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const visibilityCheckService = require('./visibilityCheckService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const articlePublishService = require('./articlePublishService.cjs');
const { chatCompletion, parseJsonContent } = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

function nowIso() {
  return new Date().toISOString();
}

function jsonParse(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonString(value) {
  return JSON.stringify(value ?? null);
}

function text(value) {
  return String(value ?? '').trim();
}

function projectIdFromGeoId(value) {
  return String(value || '').replace(/^geo-/, '');
}

function rowToRule(row) {
  const metadata = jsonParse(row.content, null);
  return {
    id: row.id,
    project_id: row.project_id,
    geo_project_id: `geo-${row.project_id}`,
    platform: row.platform,
    rule_type: row.rule_type,
    content: row.content,
    evidence_count: row.evidence_count,
    confidence: row.confidence,
    status: row.status,
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildMessages({ profile, check, drafts }) {
  return [
    {
      role: 'system',
      content: [
        '你是 GEO 复盘优化助手。',
        '请根据 AI 推荐可见性检测结果，生成下一轮内容优化规则。',
        '规则必须保持 pending 含义：用户确认前不得假设已经生效。',
        '只输出合法 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'generate_geo_reflection_rules',
        required_output: {
          summary: '本轮复盘摘要',
          rules: [
            {
              rule_type: 'content_gap | channel_priority | competitor_gap | evidence_gap',
              content: '下一轮需要执行的优化规则',
              evidence_count: 1,
              confidence: 0.8,
              reason: '提出该规则的检测依据',
            },
          ],
        },
        enterprise_profile: {
          company_name: fieldText(profile, 'company_name'),
          short_name: fieldText(profile, 'short_name'),
          industry_category: fieldText(profile, 'industry_category'),
          business_regions: fieldText(profile, 'business_regions'),
          offerings: fieldText(profile, 'offerings'),
          target_keywords: fieldText(profile, 'target_keywords'),
        },
        visibility_check: check.result,
        published_articles: drafts.map((draft) => ({
          id: draft.id,
          title: draft.draft.title,
          article_role: draft.draft.article_role,
          published_url: draft.draft.publication_evidence?.published_url || null,
          status: draft.draft.publication_evidence?.status || draft.status,
        })),
      }, null, 2),
    },
  ];
}

function normalizeRules(payload, check) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rawRules = Array.isArray(source.rules) ? source.rules : [];
  const missed = (check.result?.question_results || []).filter((item) => !item.effective_mention);
  const fallbackRules = missed.slice(0, 5).map((item) => ({
    rule_type: 'content_gap',
    content: `围绕问题“${item.question}”补充支撑内容，并加强目标企业事实、案例和推荐理由。`,
    evidence_count: 1,
    confidence: 0.7,
    reason: '该问题在本轮推荐检测中没有有效提及目标企业。',
  }));
  return (rawRules.length ? rawRules : fallbackRules)
    .map((rule) => ({
      rule_type: text(rule.rule_type) || 'content_gap',
      content: text(rule.content || rule.rule || rule.suggestion),
      evidence_count: Number(rule.evidence_count || 1),
      confidence: Math.max(0, Math.min(1, Number(rule.confidence || 0.7))),
      reason: text(rule.reason),
    }))
    .filter((rule) => rule.content)
    .slice(0, 8);
}

async function generateReflection(geoProjectId, platform = 'doubao', visibilityCheckId = null) {
  const projectId = projectIdFromGeoId(geoProjectId);
  if (!projectId) throw new Error('geoProjectId is required.');
  const check = visibilityCheckId
    ? visibilityCheckService.getVisibilityCheck(visibilityCheckId)
    : visibilityCheckService.getLatestVisibilityCheck(geoProjectId, platform);
  if (!check) throw new Error('反思优化需要先完成推荐检测。');
  const profile = knowledgeService.getKnowledgeProfile(projectId).profile || {};
  const drafts = articlePublishService.listArticleDrafts(projectId, { platform }).drafts;
  const policy = getTaskPolicy('reflection', { platform });

  let parsed = {};
  try {
    const response = await chatCompletion({
      messages: buildMessages({ profile, check, drafts }),
      temperature: 0.2,
      maxTokens: 5000,
      provider: policy.provider,
      model: policy.model,
    });
    parsed = parseJsonContent(response.content);
  } catch {
    parsed = {};
  }

  const rules = normalizeRules(parsed, check);
  const timestamp = nowIso();
  const inserted = rules.map((rule) => {
    const id = crypto.randomUUID();
    const content = jsonString({
      ...rule,
      visibility_check_id: check.id,
      summary: text(parsed.summary),
    });
    getDb().prepare(`
      INSERT INTO evolution_rules (id, project_id, platform, rule_type, content, evidence_count, confidence, status, created_at, updated_at)
      VALUES (@id, @project_id, @platform, @rule_type, @content, @evidence_count, @confidence, @status, @created_at, @updated_at)
    `).run({
      id,
      project_id: projectId,
      platform,
      rule_type: rule.rule_type,
      content,
      evidence_count: rule.evidence_count,
      confidence: rule.confidence,
      status: 'pending',
      created_at: timestamp,
      updated_at: timestamp,
    });
    return getRule(id);
  });
  return {
    geo_project_id: `geo-${projectId}`,
    enterprise_project_id: projectId,
    platform,
    visibility_check_id: check.id,
    summary: text(parsed.summary) || '已根据推荐检测结果生成待确认优化规则。',
    rules: inserted,
  };
}

function getRule(ruleId) {
  const row = getDb().prepare('SELECT * FROM evolution_rules WHERE id = ?').get(ruleId);
  if (!row) throw new Error('优化规则不存在。');
  return rowToRule(row);
}

function confirmEvolutionRule(ruleId) {
  const result = getDb().prepare(`
    UPDATE evolution_rules SET status = 'confirmed', updated_at = ? WHERE id = ?
  `).run(nowIso(), ruleId);
  if (!result.changes) throw new Error('优化规则不存在。');
  return getRule(ruleId);
}

function rejectEvolutionRule(ruleId) {
  const result = getDb().prepare(`
    UPDATE evolution_rules SET status = 'rejected', updated_at = ? WHERE id = ?
  `).run(nowIso(), ruleId);
  if (!result.changes) throw new Error('优化规则不存在。');
  return getRule(ruleId);
}

function listEvolutionRules(projectIdOrGeoId, { status, platform } = {}) {
  const projectId = projectIdFromGeoId(projectIdOrGeoId);
  if (!projectId) throw new Error('projectId is required.');
  let sql = 'SELECT * FROM evolution_rules WHERE project_id = ?';
  const params = [projectId];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }
  sql += ' ORDER BY created_at DESC';
  return getDb().prepare(sql).all(...params).map(rowToRule);
}

module.exports = {
  generateReflection,
  confirmEvolutionRule,
  getRule,
  rejectEvolutionRule,
  listEvolutionRules,
};
