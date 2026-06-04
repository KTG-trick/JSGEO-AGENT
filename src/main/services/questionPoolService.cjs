const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const { streamLLM, parseJsonContent } = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const { getSkill } = require('./skillService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToQuestionSet(row) {
  return {
    id: row.id,
    geo_project_id: row.project_id,
    enterprise_project_id: row.project_id,
    platform: row.platform,
    questions: parseJson(row.questions_json, {}),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getEnterpriseProfile(projectId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM enterprise_profiles WHERE project_id = ?').get(projectId);
  return row ? parseJson(row.profile_json, {}) : null;
}

function getEvolutionRules(projectId, platform) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM evolution_rules
    WHERE project_id = ? AND status = 'approved'
    AND (platform = ? OR platform IS NULL)
  `).all(projectId, platform);

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    rule_type: row.rule_type,
    confidence: row.confidence,
  }));
}

function buildQuestionPoolMessages({ profile, platform, evolutionRules }) {
  const skill = getSkill('geo-question-set');
  if (!skill) {
    throw new Error('geo-question-set skill not found');
  }

  const platformLabel = platform === 'doubao' ? 'Doubao' : 'DeepSeek';
  const profileLines = [
    ['company_name', fieldText(profile, 'company_name')],
    ['short_name', fieldText(profile, 'short_name')],
    ['industry_category', fieldText(profile, 'industry_category')],
    ['detailed_address', fieldText(profile, 'detailed_address')],
    ['business_regions', fieldText(profile, 'business_regions')],
    ['offerings', fieldText(profile, 'offerings')],
    ['associated_brands', fieldText(profile, 'associated_brands')],
    ['target_audiences', fieldText(profile, 'target_audiences')],
    ['core_advantages', fieldText(profile, 'core_advantages')],
    ['trust_endorsements', fieldText(profile, 'trust_endorsements')],
    ['user_pain_points', fieldText(profile, 'user_pain_points')],
    ['proven_cases', fieldText(profile, 'proven_cases')],
    ['target_keywords', fieldText(profile, 'target_keywords')],
    ['contact_info', fieldText(profile, 'contact_info')],
  ]
    .map(([label, value]) => `- ${label}: ${value || 'not provided'}`)
    .join('\n');

  const rulesText = evolutionRules.length > 0
    ? `\nApproved optimization rules:\n${evolutionRules.map((rule) => `- ${rule.content}`).join('\n')}`
    : '';

  const userPrompt = `请基于以下企业知识库和 target_keywords 生成第二阶段 GEO 核心问题池。

企业知识库字段：
${profileLines}

目标 AI 平台：${platformLabel}
${rulesText}

执行要求：
- 先判断 business_scope，只能是 district_local、city_local、province_regional、national_industry 之一。
- target_keywords 是主线，但必须结合企业知识库事实生成问题。
- target_keywords 组成逻辑为：地区范围 + 行业规范统称 + 主体。
- 固定生成 10 条核心问题，不要生成候选池供用户筛选。
- 10 条问题应偏向排行榜、推荐、哪家好、口碑、性价比、对比决策。
- 本地/区域企业优先生成本地和区域问题，但允许少量更宽泛的问题；全国/ToB/SaaS/供应链企业优先生成全国或行业问题。
- 不得硬编码城市；只允许使用 detailed_address、business_regions 或 target_keywords 中出现的地域词。
- 返回一个合法 JSON 对象，必须包含 business_scope、target_keyword_basis、knowledge_basis、candidate_questions、question_pool、recommended_core_questions、confirmed_questions、intent_distribution、keyword_layer_distribution、content_asset_mapping。
- candidate_questions 必须正好 10 条；recommended_core_questions 必须是 q1-q10；confirmed_questions 必须保存同一批 10 条核心问题。`;

  return [
    {
      role: 'system',
      content: skill.content,
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];
}

function normalizeGeographicScale(value) {
  return ['district', 'city', 'national'].includes(value) ? value : 'city';
}

function normalizeBusinessScope(value) {
  const scope = safeText(value).toLowerCase();
  if (['district_local', 'city_local', 'province_regional', 'national_industry'].includes(scope)) {
    return scope;
  }
  if (scope === 'district') return 'district_local';
  if (scope === 'city') return 'city_local';
  if (scope === 'province' || scope === 'regional') return 'province_regional';
  if (scope === 'national') return 'national_industry';
  return 'city_local';
}

function safeText(value, fallback = '') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized || fallback;
  } catch {
    return fallback;
  }
}

const QUESTION_PAYLOAD_WRAPPER_KEYS = ['data', 'result', 'question_set', 'question_pool_result', 'output', 'json'];
const QUESTION_ARRAY_KEYS = ['candidate_questions', 'question_pool', 'questions', 'items', 'list'];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapQuestionPayload(payload, depth = 0) {
  if (depth > 5 || Array.isArray(payload) || !isRecord(payload)) {
    return payload;
  }

  for (const key of QUESTION_PAYLOAD_WRAPPER_KEYS) {
    if (payload[key] !== undefined) {
      const unwrapped = unwrapQuestionPayload(payload[key], depth + 1);
      if (Array.isArray(unwrapped) || isRecord(unwrapped)) {
        return unwrapped;
      }
    }
  }

  return payload;
}

function findQuestionArray(payload, depth = 0) {
  if (depth > 5) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of QUESTION_ARRAY_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (isRecord(value)) {
      const nested = findQuestionArray(value, depth + 1);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function normalizeIntent(value) {
  const intent = safeText(value).toLowerCase();
  if (['ranking_rec', 'comparison', 'educational', 'local_price', 'scenario_price', 'educational_trust'].includes(intent)) {
    return intent;
  }
  if (/rank|recommend/.test(intent)) return 'ranking_rec';
  if (/compare/.test(intent)) return 'comparison';
  if (/price|local|near|budget|scenario|pain/.test(intent)) return 'scenario_price';
  if (/educat|guide|avoid|trust|standard/.test(intent)) return 'educational_trust';
  return 'ranking_rec';
}

function normalizeKeywordLayer(value) {
  const layer = safeText(value).toLowerCase();
  if (['core', 'regional', 'scenario', 'long_tail'].includes(layer)) {
    return layer;
  }
  if (/region|local|district|city|near|area/.test(layer)) return 'regional';
  if (/scenario|pain|need|audience/.test(layer)) return 'scenario';
  if (/long|tail|guide|question|price/.test(layer)) return 'long_tail';
  return 'core';
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => safeText(item)).filter(Boolean);
  }
  const text = safeText(value);
  return text ? [text] : [];
}

function normalizePriority(value, fallback = 5) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(1, Math.min(10, Math.round(numeric)));
  }
  return fallback;
}

function normalizeQuestionItem(item, index) {
  if (typeof item === 'string') {
    const question = item.trim();
    return question ? {
      id: `q${index + 1}`,
      question,
      intent: 'ranking_rec',
      keyword_layer: 'core',
      priority: 5,
      related_keywords: [],
      conversion_value: 'medium',
      suggested_confirm: false,
      target_keyword_used: '',
      knowledge_fields_used: [],
      geo_terms_used: [],
      scope_reason: '',
      ranking_bias: 'medium',
      mapped_asset_ids: [],
    } : null;
  }

  if (!isRecord(item)) {
    return null;
  }

  const question = safeText(item.question ?? item.query ?? item.text ?? item.title ?? item.prompt ?? item.user_question);
  if (!question) {
    return null;
  }

  return {
    ...item,
    id: safeText(item.id, `q${index + 1}`),
    question,
    intent: normalizeIntent(item.intent ?? item.type ?? item.category),
    keyword_layer: normalizeKeywordLayer(item.keyword_layer ?? item.layer),
    priority: normalizePriority(item.priority ?? item.score),
    related_keywords: normalizeStringArray(item.related_keywords),
    conversion_value: safeText(item.conversion_value, 'medium'),
    suggested_confirm: Boolean(item.suggested_confirm),
    target_keyword_used: safeText(item.target_keyword_used ?? item.target_keyword ?? item.keyword_used),
    knowledge_fields_used: normalizeStringArray(item.knowledge_fields_used),
    geo_terms_used: normalizeStringArray(item.geo_terms_used),
    scope_reason: safeText(item.scope_reason ?? item.reason),
    ranking_bias: ['high', 'medium', 'low'].includes(safeText(item.ranking_bias).toLowerCase())
      ? safeText(item.ranking_bias).toLowerCase()
      : (normalizeIntent(item.intent ?? item.type ?? item.category) === 'ranking_rec' ? 'high' : 'medium'),
    mapped_asset_ids: normalizeStringArray(item.mapped_asset_ids),
  };
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => isRecord(item) ? item.id : item)
    .map((item) => safeText(item))
    .filter(Boolean);
}

function questionSortScore(question) {
  const intentBoost = question.intent === 'ranking_rec'
    ? 3
    : question.intent === 'comparison'
      ? 2
      : question.intent === 'local_price'
        ? 1
        : 0;
  return (question.suggested_confirm ? 100 : 0) + (question.priority || 0) * 10 + intentBoost;
}

function normalizeRecommendedCoreIds(candidateQuestions, rawIds) {
  const candidateIds = new Set(candidateQuestions.map((question) => question.id));
  const selected = [];
  normalizeIdList(rawIds).forEach((id) => {
    if (candidateIds.has(id) && !selected.includes(id)) {
      selected.push(id);
    }
  });

  const sortedCandidates = [...candidateQuestions].sort((a, b) => questionSortScore(b) - questionSortScore(a));
  for (const question of sortedCandidates) {
    if (selected.length >= 10) break;
    if (!selected.includes(question.id)) {
      selected.push(question.id);
    }
  }

  return selected.slice(0, 10);
}

function normalizeConfirmedQuestions(candidateQuestions, rawConfirmed) {
  const candidateById = new Map(candidateQuestions.map((question) => [question.id, question]));
  const confirmedIds = normalizeIdList(rawConfirmed);
  const selectedIds = confirmedIds.length > 0 ? confirmedIds : candidateQuestions.map((question) => question.id);
  return selectedIds
    .map((id) => candidateById.get(id))
    .filter(Boolean)
    .map((question) => ({ ...question, status: 'confirmed', confirmed: true }));
}

function normalizeQuestionPayload(payload) {
  const source = unwrapQuestionPayload(payload);
  const sourceRecord = isRecord(source) ? source : {};
  const candidateQuestions = findQuestionArray(source)
    .map((question, index) => normalizeQuestionItem(question, index))
    .filter(Boolean);
  const recommendedCoreIds = normalizeRecommendedCoreIds(candidateQuestions, sourceRecord.recommended_core_questions);
  const rawRankingQuestions = Array.isArray(sourceRecord.ranking_questions) ? sourceRecord.ranking_questions : [];
  const rankingQuestions = rawRankingQuestions.length > 0
    ? rawRankingQuestions
      .map((question, index) => normalizeQuestionItem(question, index))
      .filter(Boolean)
    : candidateQuestions.filter((question) => (
      question.intent === 'ranking_rec'
      || question.priority >= 7
      || recommendedCoreIds.includes(question.id)
    ));

  return {
    ...sourceRecord,
    summary: safeText(
      sourceRecord.summary,
      `已基于企业知识库和 target_keywords 生成 ${candidateQuestions.length} 条 GEO 核心问题。`
    ),
    candidate_questions: candidateQuestions,
    confirmed_questions: normalizeConfirmedQuestions(candidateQuestions, sourceRecord.confirmed_questions),
    recommended_core_questions: recommendedCoreIds,
    geographic_scale: normalizeGeographicScale(sourceRecord.geographic_scale),
    business_scope: normalizeBusinessScope(sourceRecord.business_scope ?? sourceRecord.geographic_scale),
    target_keyword_basis: Array.isArray(sourceRecord.target_keyword_basis) ? sourceRecord.target_keyword_basis : [],
    knowledge_basis: isRecord(sourceRecord.knowledge_basis) ? sourceRecord.knowledge_basis : {},
    question_pool: candidateQuestions,
    ranking_questions: rankingQuestions,
    intent_distribution: isRecord(sourceRecord.intent_distribution) ? sourceRecord.intent_distribution : {},
    keyword_layer_distribution: isRecord(sourceRecord.keyword_layer_distribution) ? sourceRecord.keyword_layer_distribution : {},
    content_asset_mapping: Array.isArray(sourceRecord.content_asset_mapping) ? sourceRecord.content_asset_mapping : [],
  };
}

function parseQuestionPoolContent(content) {
  const text = String(content || '');

  try {
    return parseJsonContent(text);
  } catch (error) {
    console.warn('[question-pool] parseJsonContent failed:', error.message);
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (error) {
      console.warn('[question-pool] code block JSON parse failed:', error.message);
    }
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch (error) {
      console.warn('[question-pool] array JSON parse failed:', error.message);
    }
  }

  console.warn('[question-pool] unparseable model output preview:', text.slice(0, 500));
  return null;
}

function assertValidQuestionPayload(normalized) {
  if (!Array.isArray(normalized.candidate_questions) || normalized.candidate_questions.length === 0) {
    throw new Error('The model returned content, but it did not include valid candidate_questions. Please retry or switch model.');
  }
  const count = normalized.candidate_questions.length;
  if (count !== 10) {
    throw new Error(`The model returned ${count} questions; stage two requires exactly 10 core questions.`);
  }
  if (!Array.isArray(normalized.recommended_core_questions) || normalized.recommended_core_questions.length !== 10) {
    throw new Error('The model returned an invalid recommended_core_questions list; stage two requires exactly 10 valid question ids.');
  }
  if (!Array.isArray(normalized.confirmed_questions) || normalized.confirmed_questions.length !== 10) {
    throw new Error('The model returned an invalid confirmed_questions list; stage two requires exactly 10 confirmed questions.');
  }
}

function prepareGeneratedQuestionPayload(questions) {
  const normalized = normalizeQuestionPayload(questions);
  normalized.candidate_questions = normalized.candidate_questions.slice(0, 10);
  normalized.recommended_core_questions = normalizeRecommendedCoreIds(
    normalized.candidate_questions,
    normalized.recommended_core_questions
  );
  normalized.confirmed_questions = normalizeConfirmedQuestions(normalized.candidate_questions, normalized.recommended_core_questions);
  normalized.candidate_questions = normalized.candidate_questions.map((question) => ({
    ...question,
    status: 'confirmed',
    confirmed: true,
  }));
  normalized.question_pool = normalized.candidate_questions;
  normalized.confirmed_questions = normalized.candidate_questions.map((question) => ({
    ...question,
    status: 'confirmed',
    confirmed: true,
  }));
  normalized.recommended_core_questions = normalized.candidate_questions.map((question) => question.id);
  normalized.ranking_questions = normalized.candidate_questions.filter((question) => (
    question.intent === 'ranking_rec'
    || question.ranking_bias === 'high'
    || question.priority >= 8
  ));
  return normalized;
}

async function repairQuestionPayload({ messages, policy, normalized, reason }) {
  const repairMessages = [
    ...messages,
    {
      role: 'user',
      content: JSON.stringify({
        task: 'repair_question_pool_json',
        reason,
        current_question_pool: normalized,
        requirements: [
          'Return one valid JSON object only.',
          'candidate_questions must contain exactly 10 core questions.',
          'question_pool must contain the same 10 core questions.',
          'recommended_core_questions must contain exactly q1-q10 or 10 valid candidate question ids.',
          'confirmed_questions must contain the same 10 core questions because stage two auto-confirms them.',
          'Keep business_scope, target_keyword_basis, knowledge_basis, intent_distribution, keyword_layer_distribution, and content_asset_mapping.',
        ],
      }),
    },
  ];
  const result = await streamLLM({
    messages: repairMessages,
    temperature: 0,
    maxTokens: 5000,
    provider: policy.provider,
    model: policy.model,
    networkMode: policy.network_mode,
    deepThinking: policy.deep_thinking,
    onEvent: null,
    apiFamily: policy.api_family,
  });
  return prepareGeneratedQuestionPayload(parseQuestionPoolContent(result.content));
}

async function ensureGeneratedQuestionPayload({ questions, messages, policy }) {
  const normalized = prepareGeneratedQuestionPayload(questions);
  try {
    assertValidQuestionPayload(normalized);
    return normalized;
  } catch (error) {
    console.warn('[question-pool] generated payload needs repair:', error.message);
    const repaired = await repairQuestionPayload({
      messages,
      policy,
      normalized,
      reason: error.message,
    });
    assertValidQuestionPayload(repaired);
    return repaired;
  }
}

function saveQuestionSet({ projectId, platform, questions, status }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const normalized = prepareGeneratedQuestionPayload(questions);
  assertValidQuestionPayload(normalized);
  normalized.summary = safeText(
    normalized.summary,
    `已基于企业知识库和 target_keywords 生成 ${normalized.candidate_questions.length} 条 GEO 核心问题。`
  );

  db.prepare(`
    INSERT INTO geo_question_sets (id, project_id, platform, questions_json, status, created_at, updated_at)
    VALUES (@id, @project_id, @platform, @questions_json, @status, @created_at, @updated_at)
  `).run({
    id,
    project_id: projectId,
    platform,
    questions_json: JSON.stringify(normalized),
    status,
    created_at: timestamp,
    updated_at: timestamp,
  });

  db.prepare(`
    INSERT INTO workflow_events (id, project_id, stage_key, event_type, status, title, content, artifact_type, artifact_id, created_at, updated_at)
    VALUES (@id, @project_id, @stage_key, @event_type, @status, @title, @content, @artifact_type, @artifact_id, @created_at, @updated_at)
  `).run({
    id: crypto.randomUUID(),
    project_id: projectId,
    stage_key: `phase_two_${platform}`,
    event_type: 'question_set_generated',
    status,
    title: `${platform === 'doubao' ? 'Doubao' : 'DeepSeek'} question pool generated`,
    content: normalized.summary,
    artifact_type: 'geo_question_set',
    artifact_id: id,
    created_at: timestamp,
    updated_at: timestamp,
  });

  return getQuestionSet(id);
}

async function generateQuestionPool({ projectId, platform }) {
  const profile = getEnterpriseProfile(projectId);
  if (!profile) {
    throw new Error('Enterprise knowledge base not found');
  }

  const evolutionRules = getEvolutionRules(projectId, platform);
  const messages = buildQuestionPoolMessages({ profile, platform, evolutionRules });
  const policy = getTaskPolicy('question_pool_generation', { platform });

  const result = await responsesStream({
    messages,
    temperature: 0.3,
    maxTokens: 5000,
    provider: policy.provider,
    model: policy.model,
    networkMode: policy.network_mode,
    deepThinking: policy.deep_thinking,
    onEvent: null,
  });

  const normalizedQuestions = await ensureGeneratedQuestionPayload({
    questions: parseQuestionPoolContent(result.content),
    messages,
    policy,
  });

  return saveQuestionSet({
    projectId,
    platform,
    questions: normalizedQuestions,
    status: 'confirmed',
  });
}

async function generateQuestionPoolStream({ projectId, platform, onEvent }) {
  const profile = getEnterpriseProfile(projectId);
  if (!profile) {
    throw new Error('Enterprise knowledge base not found');
  }

  const evolutionRules = getEvolutionRules(projectId, platform);
  const messages = buildQuestionPoolMessages({ profile, platform, evolutionRules });
  const policy = getTaskPolicy('question_pool_generation', { platform });

  onEvent?.({
    type: 'status',
    step_index: 1,
    message: `Calling ${policy.provider}/${policy.model} to generate question pool...`,
  });

  const streamResult = await streamLLM({
    messages,
    temperature: 0.3,
    maxTokens: 5000,
    provider: policy.provider,
    model: policy.model,
    networkMode: policy.network_mode,
    deepThinking: policy.deep_thinking,
    apiFamily: policy.api_family,
    onEvent: (event) => {
      if (event.type === 'reasoning_delta' && event.text) {
        onEvent?.({ type: 'reasoning_delta', text: event.text });
      }
    },
  });

  onEvent?.({ type: 'status', step_index: 2, message: 'Parsing question pool...' });

  const normalizedQuestions = await ensureGeneratedQuestionPayload({
    questions: parseQuestionPoolContent(streamResult.content),
    messages,
    policy,
  });

  onEvent?.({
    type: 'status',
    step_index: 3,
    message: `Generated and confirmed ${normalizedQuestions.candidate_questions.length} core questions.`,
  });

  const questionSet = saveQuestionSet({
    projectId,
    platform,
    questions: normalizedQuestions,
    status: 'confirmed',
  });

  onEvent?.({ type: 'status', step_index: 4, message: 'Question pool saved.' });
  onEvent?.({ type: 'result', question_set: questionSet });

  return questionSet;
}

function getQuestionSet(questionSetId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM geo_question_sets WHERE id = ?').get(questionSetId);
  return row ? rowToQuestionSet(row) : null;
}

function getLatestQuestionSet(projectId, platform) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM geo_question_sets
    WHERE project_id = ? AND platform = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(projectId, platform);
  return row ? rowToQuestionSet(row) : null;
}

function confirmQuestionSet(questionSetId, confirmedQuestionIds = []) {
  const db = getDb();
  const timestamp = nowIso();
  const questionSet = getQuestionSet(questionSetId);
  if (!questionSet) {
    throw new Error('Question set not found.');
  }

  const normalized = normalizeQuestionPayload(questionSet.questions);
  const selectedIds = normalizeIdList(confirmedQuestionIds);
  const uniqueIds = Array.from(new Set(selectedIds));
  if (uniqueIds.length !== 10) {
    throw new Error('Stage two requires exactly 10 confirmed core questions.');
  }

  const candidateById = new Map(normalized.candidate_questions.map((question) => [question.id, question]));
  const invalidIds = uniqueIds.filter((id) => !candidateById.has(id));
  if (invalidIds.length > 0) {
    throw new Error(`Invalid confirmed question ids: ${invalidIds.join(', ')}`);
  }

  const confirmedSet = new Set(uniqueIds);
  const nextQuestions = {
    ...normalized,
    candidate_questions: normalized.candidate_questions.map((question) => ({
      ...question,
      status: confirmedSet.has(question.id)
        ? 'confirmed'
        : normalized.recommended_core_questions.includes(question.id)
          ? 'recommended'
          : 'candidate',
      confirmed: confirmedSet.has(question.id),
    })),
    confirmed_questions: uniqueIds.map((id) => ({
      ...candidateById.get(id),
      status: 'confirmed',
      confirmed: true,
    })),
  };
  nextQuestions.question_pool = nextQuestions.candidate_questions;

  db.prepare(`
    UPDATE geo_question_sets SET questions_json = ?, status = 'confirmed', updated_at = ? WHERE id = ?
  `).run(JSON.stringify(nextQuestions), timestamp, questionSetId);

  return getQuestionSet(questionSetId);
}

module.exports = {
  generateQuestionPool,
  generateQuestionPoolStream,
  getQuestionSet,
  getLatestQuestionSet,
  confirmQuestionSet,
};
