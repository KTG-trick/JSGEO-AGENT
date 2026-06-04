const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const projectService = require('./projectService.cjs');
const questionPoolService = require('./questionPoolService.cjs');
const sourceDiscoveryService = require('./sourceDiscoveryService.cjs');
const skillService = require('./skillService.cjs');
const { streamLLM, parseJsonContent } = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

const SUPPORT_PLAN = [
  { article_type: 'brand_profile', article_role: 'support', theme: '企业介绍 / 品牌形象建设' },
  { article_type: 'brand_story', article_role: 'support', theme: '企业优势 / 信任背书' },
  { article_type: 'local_service', article_role: 'support', theme: '本地服务 / 售后承诺' },
  { article_type: 'business_review', article_role: 'support', theme: '业务产品 / 服务测评' },
  { article_type: 'case_review', article_role: 'support', theme: '真实案例 / 口碑展示' },
  { article_type: 'process_standard', article_role: 'support', theme: '工艺流程 / 选择标准' },
];

const RANKING_PLAN = [
  { article_type: 'ranking_core', article_role: 'ranking', theme: '综合推荐 / 行业排行' },
  { article_type: 'ranking_regional', article_role: 'ranking', theme: '区域推荐 / 本地榜单' },
  { article_type: 'ranking_scenario', article_role: 'ranking', theme: '细分场景 / 人群推荐' },
];

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

function projectIdFromGeoId(geoProjectId) {
  return String(geoProjectId || '').replace(/^geo-/, '');
}

function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return normalizeText(value.value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function rowToDraft(row) {
  const draft = jsonParse(row.draft_json, {});
  return {
    id: row.id,
    geo_project_id: `geo-${row.project_id}`,
    enterprise_project_id: row.project_id,
    platform: row.platform,
    article_type: row.article_type,
    status: row.status,
    draft,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getConfirmedQuestions(questionSet) {
  const questions = questionSet?.questions || {};
  const confirmed = Array.isArray(questions.confirmed_questions) ? questions.confirmed_questions : [];
  const pool = Array.isArray(questions.question_pool) ? questions.question_pool : [];
  return (confirmed.length ? confirmed : pool)
    .map((item, index) => ({
      id: normalizeText(item.id) || `q${index + 1}`,
      question: normalizeText(item.question ?? item.text ?? item.title),
      intent: normalizeText(item.intent),
      keyword_layer: normalizeText(item.keyword_layer),
      priority: Number(item.priority || 0),
    }))
    .filter((item) => item.question);
}

function selectQuestionsForSlot(questions, slot, index) {
  if (!questions.length) return [];
  if (slot.article_role === 'ranking') {
    const ranking = questions.filter((question) => question.intent === 'ranking_rec');
    return (ranking.length ? ranking : questions).slice(index, index + 3);
  }
  if (/case|review|standard/.test(slot.article_type)) {
    return questions.filter((question) => ['scenario_price', 'educational_trust', 'comparison'].includes(question.intent)).slice(0, 3)
      .concat(questions.slice(0, 2))
      .slice(0, 3);
  }
  return questions.slice(index, index + 3).concat(questions.slice(0, 2)).slice(0, 3);
}

function profileSnapshot(profile = {}) {
  const fields = [
    'company_name',
    'short_name',
    'industry_category',
    'detailed_address',
    'business_regions',
    'offerings',
    'associated_brands',
    'target_audiences',
    'core_advantages',
    'trust_endorsements',
    'user_pain_points',
    'proven_cases',
    'target_keywords',
    'contact_info',
  ];
  return Object.fromEntries(fields.map((field) => [field, fieldText(profile, field)]));
}

function compactSources(discovery = {}) {
  const data = discovery.discovery || {};
  const sources = data.verified_observed_sources
    || data.observed_citation_sources
    || data.channel_priorities
    || data.candidate_sources
    || [];
  return Array.isArray(sources) ? sources.slice(0, 8) : [];
}

function buildRagQuery(profile, questions, slot) {
  return [
    fieldText(profile, 'company_name'),
    fieldText(profile, 'short_name'),
    fieldText(profile, 'industry_category'),
    fieldText(profile, 'offerings'),
    fieldText(profile, 'target_keywords'),
    slot.theme,
    questions.map((item) => item.question).join(' '),
  ].filter(Boolean).join(' ');
}

function normalizeDraftPayload(payload, slot, context) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const targetQuestion = normalizeText(record.target_question) || context.questions[0]?.question || '';
  const title = normalizeText(record.title) || `${context.profile.company_name || context.profile.short_name || '企业'}：${slot.theme}`;
  const content = normalizeText(record.content) || [
    `# ${title}`,
    '',
    targetQuestion ? `本文围绕“${targetQuestion}”展开。` : '本文围绕企业核心服务和用户决策问题展开。',
    '',
    `企业事实：${context.factsUsed.join('；') || '待补充企业事实'}`,
  ].join('\n');
  const outline = Array.isArray(record.outline) && record.outline.length
    ? record.outline
    : ['用户问题引入', '选择标准与事实依据', '企业服务与案例支撑', '适合人群与发布建议'];
  const factsUsed = Array.isArray(record.facts_used) && record.facts_used.length
    ? record.facts_used
    : context.factsUsed;
  const sourcesToReference = Array.isArray(record.sources_to_reference) && record.sources_to_reference.length
    ? record.sources_to_reference
    : context.sources;
  const mappedQuestionIds = Array.isArray(record.mapped_question_ids)
    ? record.mapped_question_ids.map(normalizeText).filter(Boolean)
    : context.questions.map((question) => question.id);

  return {
    ...record,
    title,
    article_role: slot.article_role,
    article_type: slot.article_type,
    article_theme: slot.theme,
    target_question: targetQuestion,
    mapped_question_ids: mappedQuestionIds,
    publish_target: normalizeText(record.publish_target) || context.publishTarget,
    suggested_channel: normalizeText(record.suggested_channel) || context.publishTarget,
    outline,
    content,
    facts_used: factsUsed,
    sources_to_reference: sourcesToReference,
    rag_chunks_used: context.ragChunks,
    missing_facts: Array.isArray(record.missing_facts) ? record.missing_facts.map(normalizeText).filter(Boolean) : [],
    publication_evidence: {
      status: normalizeText(record.publication_status) || 'draft',
      published_url: normalizeText(record.published_url) || null,
      published_platform: normalizeText(record.published_platform) || null,
      published_at: normalizeText(record.published_at) || null,
    },
    status: 'draft',
  };
}

function parseDraftContent(content) {
  try {
    return parseJsonContent(content);
  } catch {
    const text = String(content || '');
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlock) {
      return JSON.parse(codeBlock[1].trim());
    }
  }
  return {};
}

function buildMessages({ profile, questions, discovery, ragChunks, slot }) {
  const snapshot = profileSnapshot(profile);
  const sources = compactSources(discovery);
  return [
    {
      role: 'system',
      content: `你是 GEO 内容策略写作助手。你的任务是生成可供 AI 推荐引用的事实型文章草稿。

硬性规则：
- 只使用企业知识库、RAG 原文片段、问题池和信源发现中的事实。
- 不编造荣誉、排名、案例、城市覆盖、合作品牌或价格。
- 输出合法 JSON 对象，不输出 Markdown 代码块。
- 文章必须服务 AI 推荐、排行榜、对比或“哪家好”类回答。
- 支撑文章提供事实证据；排行榜文章必须引用支撑事实，不能空写排行榜第一。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'generate_geo_article_draft',
        required_output: {
          title: '文章标题',
          article_role: slot.article_role,
          article_type: slot.article_type,
          article_theme: slot.theme,
          target_question: '对应问题',
          mapped_question_ids: ['q1'],
          publish_target: '建议发布渠道',
          outline: ['大纲'],
          content: '完整 Markdown 正文，1000-1500 字左右',
          facts_used: ['使用的企业事实'],
          sources_to_reference: ['建议信源或平台'],
          missing_facts: [],
        },
        enterprise_profile: snapshot,
        target_questions: questions,
        source_discovery: {
          summary: discovery?.discovery?.summary || '',
          channel_priorities: discovery?.discovery?.channel_priorities || [],
          observed_citation_sources: discovery?.discovery?.observed_citation_sources || [],
          verified_observed_sources: discovery?.discovery?.verified_observed_sources || [],
          content_distribution_strategy: discovery?.discovery?.content_distribution_strategy || {},
        },
        rag_chunks: ragChunks,
      }),
    },
  ];
}

function contextFromInputs({ profile, questions, discovery, ragChunks }) {
  const factsUsed = [
    fieldText(profile, 'company_name'),
    fieldText(profile, 'business_regions'),
    fieldText(profile, 'industry_category'),
    fieldText(profile, 'offerings'),
    fieldText(profile, 'core_advantages'),
    fieldText(profile, 'trust_endorsements'),
    fieldText(profile, 'proven_cases'),
  ].filter(Boolean).slice(0, 8);
  const sources = compactSources(discovery);
  const firstSource = sources[0];
  const publishTarget = normalizeText(firstSource?.platform || firstSource?.domain || firstSource?.name || firstSource?.channel) || '高权重行业平台 / 自有内容阵地';
  return { factsUsed, sources, publishTarget, ragChunks, profile: profileSnapshot(profile), questions };
}

function buildArticleMessages({ profile, questions, discovery, ragChunks, slot }) {
  const snapshot = profileSnapshot(profile);
  const skill = skillService.getSkill('geo-support-content');
  const skillInstruction = skill?.content || '你是 GEO 内容策略写作助手，请基于企业知识库、核心问题和信源发现结果生成文章草稿。';
  return [
    {
      role: 'system',
      content: `${skillInstruction}

运行时硬性规则：
- 企业结构化字段是主事实源，RAG chunks 只作为原文证据辅助。
- 禁止编造荣誉、排名、合作品牌、价格、服务城市、客户案例。
- 每篇文章必须绑定 confirmed_questions，并输出 mapped_question_ids。
- 排行榜文章必须引用支撑事实，不能空写“第一名”“全国第一”。
- 输出必须是合法 JSON，不要输出 Markdown 代码块外的解释文本。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'generate_geo_article_draft',
        required_output: {
          title: '文章标题',
          article_role: slot.article_role,
          article_type: slot.article_type,
          article_theme: slot.theme,
          target_question: '对应问题',
          mapped_question_ids: ['q1'],
          suggested_channel: '建议发布渠道',
          outline: ['大纲'],
          content: '完整 Markdown 正文，1000-1500 字左右',
          facts_used: ['使用的企业事实'],
          sources_to_reference: ['建议信源或平台'],
          rag_chunks_used: ['引用或参考的知识库片段'],
          missing_facts: [],
          publication_evidence: {
            status: 'draft',
            published_url: null,
            published_platform: null,
            published_at: null,
          },
        },
        enterprise_profile: snapshot,
        target_questions: questions,
        source_discovery: {
          summary: discovery?.discovery?.summary || '',
          channel_priorities: discovery?.discovery?.channel_priorities || [],
          observed_citation_sources: discovery?.discovery?.observed_citation_sources || [],
          verified_observed_sources: discovery?.discovery?.verified_observed_sources || [],
          content_distribution_strategy: discovery?.discovery?.content_distribution_strategy || {},
        },
        rag_chunks: ragChunks,
      }),
    },
  ];
}

async function generateDraftForSlot({ projectId, platform, profile, questionSet, discovery, slot, index, onEvent }) {
  const questions = selectQuestionsForSlot(getConfirmedQuestions(questionSet), slot, index);
  const ragQuery = buildRagQuery(profile, questions, slot);
  const ragResponse = await knowledgeService.searchKnowledge({ projectId, query: ragQuery, limit: 6 });
  const ragChunks = (ragResponse.entries || []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    metadata: entry.metadata || entry.metadata_json || null,
  }));
  const context = contextFromInputs({ profile, questions, discovery, ragChunks });
  const policy = getTaskPolicy('support_content_generation', { platform });

  onEvent?.({
    type: 'status',
    step_index: index,
    step_label: `生成${slot.theme}`,
    message: `正在生成：${slot.theme}`,
  });

  const result = await streamLLM({
    messages: buildArticleMessages({ profile, questions, discovery, ragChunks, slot }),
    temperature: 0.35,
    maxTokens: 6000,
    provider: policy.provider,
    model: policy.model,
    networkMode: policy.network_mode,
    deepThinking: policy.deep_thinking,
    taskType: 'support_content_generation',
    apiFamily: policy.api_family,
    onEvent: (event) => {
      if (event.type === 'reasoning_delta') {
        onEvent?.(event);
      }
    },
  });
  const parsed = parseDraftContent(result.content);
  return normalizeDraftPayload(parsed, slot, context);
}

function insertDraft({ projectId, platform, questionSetId, draft }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO geo_article_drafts (id, project_id, question_set_id, platform, article_type, status, draft_json, created_at, updated_at)
    VALUES (@id, @project_id, @question_set_id, @platform, @article_type, @status, @draft_json, @created_at, @updated_at)
  `).run({
    id,
    project_id: projectId,
    question_set_id: questionSetId,
    platform,
    article_type: draft.article_type || 'support',
    status: draft.status || 'draft',
    draft_json: jsonString(draft),
    created_at: timestamp,
    updated_at: timestamp,
  });
  db.prepare(`
    INSERT INTO workflow_events (id, project_id, stage_key, event_type, status, title, content, artifact_type, artifact_id, metadata_json, created_at, updated_at)
    VALUES (@id, @project_id, @stage_key, @event_type, @status, @title, @content, @artifact_type, @artifact_id, @metadata_json, @created_at, @updated_at)
  `).run({
    id: crypto.randomUUID(),
    project_id: projectId,
    stage_key: `phase_four_${platform}`,
    event_type: 'article_draft_generated',
    status: draft.status || 'draft',
    title: draft.title || 'GEO article draft generated',
    content: draft.target_question || '',
    artifact_type: 'geo_article_draft',
    artifact_id: id,
    metadata_json: jsonString({
      article_role: draft.article_role,
      article_type: draft.article_type,
      mapped_question_ids: draft.mapped_question_ids || [],
      suggested_channel: draft.suggested_channel || draft.publish_target || null,
    }),
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getArticleDraft(id);
}

function latestDiscovery(projectId, platform) {
  try {
    return sourceDiscoveryService.getLatestSourceDiscovery(`geo-${projectId}`, platform);
  } catch {
    return null;
  }
}

function requiredInputs({ geoProjectId, platform }) {
  const projectId = projectIdFromGeoId(geoProjectId);
  if (!projectId) throw new Error('geoProjectId is required.');
  projectService.getProject(projectId);
  const profileResponse = knowledgeService.getKnowledgeProfile(projectId);
  const profile = profileResponse.profile || {};
  const questionSet = questionPoolService.getLatestQuestionSet(projectId, platform);
  if (!questionSet) throw new Error('阶段四需要先完成阶段二问题池。');
  const questions = getConfirmedQuestions(questionSet);
  if (!questions.length) throw new Error('阶段四需要阶段二 confirmed_questions。');
  const discovery = latestDiscovery(projectId, platform);
  if (!discovery) throw new Error('阶段四需要先完成阶段三信源发现。');
  return { projectId, profile, questionSet, discovery };
}

async function generateArticleDraft({ geoProjectId, platform = 'doubao', articleType = 'consulting', onEvent = null } = {}) {
  const { projectId, profile, questionSet, discovery } = requiredInputs({ geoProjectId, platform });
  const normalizedType = normalizeText(articleType);
  const slot = normalizedType === 'review'
    ? SUPPORT_PLAN[3]
    : normalizedType === 'ranking'
      ? RANKING_PLAN[0]
      : SUPPORT_PLAN[0];
  const draft = await generateDraftForSlot({
    projectId,
    platform,
    profile,
    questionSet,
    discovery,
    slot,
    index: 0,
    onEvent,
  });
  return insertDraft({ projectId, platform, questionSetId: questionSet.id, draft });
}

async function generateSupportArticles({ geoProjectId, platform = 'doubao', onEvent = null } = {}) {
  const { projectId, profile, questionSet, discovery } = requiredInputs({ geoProjectId, platform });
  const slots = [...SUPPORT_PLAN, ...RANKING_PLAN];
  const drafts = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const draft = await generateDraftForSlot({
      projectId,
      platform,
      profile,
      questionSet,
      discovery,
      slot,
      index,
      onEvent,
    });
    drafts.push(insertDraft({ projectId, platform, questionSetId: questionSet.id, draft }));
  }
  const consultingDraft = drafts.find((draft) => draft.draft.article_type === 'brand_profile') || drafts[0] || null;
  const reviewDraft = drafts.find((draft) => draft.draft.article_type === 'business_review') || drafts[3] || null;
  const rankingDrafts = drafts.filter((draft) => draft.draft.article_role === 'ranking');
  return {
    geo_project_id: `geo-${projectId}`,
    enterprise_project_id: projectId,
    platform,
    status: 'completed',
    consulting_draft: consultingDraft,
    review_draft: reviewDraft,
    support_drafts: drafts.filter((draft) => draft.draft.article_role === 'support'),
    ranking_drafts: rankingDrafts,
    total: drafts.length,
    error_message: null,
  };
}

async function generateSupportArticlesStream(payload = {}, onEvent = null) {
  const result = await generateSupportArticles({ ...payload, onEvent });
  onEvent?.({ type: 'result', support_articles: result });
  return result;
}

function getArticleDraft(articleId) {
  if (!articleId) throw new Error('articleId is required.');
  const row = getDb().prepare('SELECT * FROM geo_article_drafts WHERE id = ?').get(articleId);
  if (!row) throw new Error('文章草稿不存在。');
  return rowToDraft(row);
}

function getLatestArticleDraft(geoProjectId, platform = 'doubao', articleType = null) {
  const projectId = projectIdFromGeoId(geoProjectId);
  const row = articleType
    ? getDb().prepare(`
        SELECT * FROM geo_article_drafts
        WHERE project_id = ? AND platform = ? AND article_type = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `).get(projectId, platform, articleType)
    : getDb().prepare(`
        SELECT * FROM geo_article_drafts
        WHERE project_id = ? AND platform = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `).get(projectId, platform);
  return row ? rowToDraft(row) : null;
}

function confirmArticleDraft(articleId) {
  const timestamp = nowIso();
  const result = getDb().prepare(`
    UPDATE geo_article_drafts SET status = 'confirmed', updated_at = ? WHERE id = ?
  `).run(timestamp, articleId);
  if (!result.changes) throw new Error('文章草稿不存在。');
  return getArticleDraft(articleId);
}

function updateArticleDraft(articleId, draftPatch = {}) {
  const current = getArticleDraft(articleId);
  const timestamp = nowIso();
  const nextDraft = {
    ...current.draft,
    ...draftPatch,
    publication_evidence: {
      ...(current.draft.publication_evidence || {}),
      ...(draftPatch.publication_evidence || {}),
      published_url: normalizeText(draftPatch.published_url) || current.draft.publication_evidence?.published_url || null,
      published_platform: normalizeText(draftPatch.published_platform) || current.draft.publication_evidence?.published_platform || null,
      published_at: normalizeText(draftPatch.published_at) || current.draft.publication_evidence?.published_at || null,
    },
  };
  const nextStatus = normalizeText(draftPatch.status) || current.status;
  getDb().prepare(`
    UPDATE geo_article_drafts SET draft_json = ?, status = ?, updated_at = ? WHERE id = ?
  `).run(jsonString(nextDraft), nextStatus, timestamp, articleId);
  return getArticleDraft(articleId);
}

module.exports = {
  confirmArticleDraft,
  generateArticleDraft,
  generateSupportArticles,
  generateSupportArticlesStream,
  getArticleDraft,
  getLatestArticleDraft,
  updateArticleDraft,
};
