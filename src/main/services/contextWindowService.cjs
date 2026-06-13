const conversationService = require('./conversationService.cjs');
const { getDb } = require('./databaseService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

const GEO_MESSAGE_TYPES = [
  'knowledge_draft',
  'knowledge_confirmed',
  'knowledge_draft_request',
  'knowledge_draft_task',
  'geo_phase_prompt',
  'geo_phase_result',
  'chat_response',
];

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function previewText(value, maxLength = 600) {
  const text = normalizeText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function estimateTokens(text) {
  const value = String(text || '');
  if (!value) return 0;
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = value.length - cjk;
  return Math.ceil(cjk * 1.5 + other * 0.75);
}

function messageMetadata(message) {
  return message?.metadata || parseJson(message?.metadata_json, {});
}

function isGeoMessage(message) {
  return GEO_MESSAGE_TYPES.includes(messageMetadata(message).type);
}

function formatMessage(message) {
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: previewText(message.content, isGeoMessage(message) ? 900 : 700),
  };
}

function profileSummary(projectId) {
  if (!projectId) return '';
  const row = getDb().prepare('SELECT profile_json FROM enterprise_profiles WHERE project_id = ?').get(projectId);
  if (!row) return '';
  const profile = parseJson(row.profile_json, {});
  const fields = [
    ['company_name', '企业名称'],
    ['short_name', '简称'],
    ['industry_category', '行业'],
    ['business_regions', '业务区域'],
    ['offerings', '产品服务'],
    ['target_audiences', '目标客群'],
    ['core_advantages', '核心优势'],
    ['trust_endorsements', '信任背书'],
    ['proven_cases', '案例'],
    ['target_keywords', '目标关键词'],
  ];
  return fields
    .map(([key, label]) => {
      const value = fieldText(profile, key);
      return value ? `${label}: ${previewText(value, 220)}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function workflowSummary(projectId) {
  if (!projectId) return '';
  const events = getDb().prepare(`
    SELECT stage_key, event_type, status, title, content, created_at
    FROM workflow_events
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 8
  `).all(projectId);
  if (!events.length) return '';
  return events
    .map((event) => `${event.stage_key || 'stage'} / ${event.status}: ${event.title || event.event_type}${event.content ? ` - ${previewText(event.content, 160)}` : ''}`)
    .join('\n');
}

function articleSummary(projectId) {
  if (!projectId) return '';
  const rows = getDb().prepare(`
    SELECT id, article_type, status, draft_json, created_at
    FROM geo_article_drafts
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 8
  `).all(projectId);
  if (!rows.length) return '';
  return rows.map((row) => {
    const draft = parseJson(row.draft_json, {});
    return [
      draft.title || row.article_type || row.id,
      `状态: ${row.status}`,
      draft.article_role ? `角色: ${draft.article_role}` : '',
      draft.article_theme ? `主题: ${previewText(draft.article_theme, 120)}` : '',
      draft.target_question ? `问题: ${previewText(draft.target_question, 120)}` : '',
    ].filter(Boolean).join('；');
  }).join('\n');
}

function buildSystemPrompt(projectId, conversationSummary = '') {
  const sections = [
    '你是 GEO-Agent Studio 的工作流智能助手。请用中文回答。',
    '你不是泛聊天机器人：回答要围绕当前企业知识库、GEO 阶段、稿件和用户最近意图推进工作。',
    '如果用户要求写入知识库、覆盖稿件或投递发稿，只能提出待确认动作，不能在普通聊天回答中宣称已经执行。',
  ];
  const profile = profileSummary(projectId);
  if (profile) sections.push(`[当前企业知识库]\n${profile}`);
  const workflow = workflowSummary(projectId);
  if (workflow) sections.push(`[最近 GEO 阶段状态]\n${workflow}`);
  const articles = articleSummary(projectId);
  if (articles) sections.push(`[最近稿件]\n${articles}`);
  if (conversationSummary) sections.push(`[历史会话摘要]\n${conversationSummary}`);
  return sections.join('\n\n');
}

function truncateMessages(messages, maxTokens, recentCount) {
  if (!messages.length) return [];
  const protectedMessages = messages.filter(isGeoMessage).slice(-10);
  const recentMessages = messages.filter((message) => !isGeoMessage(message)).slice(-recentCount);
  const selected = [...protectedMessages, ...recentMessages]
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  const output = [];
  let used = 0;
  for (const message of selected) {
    const formatted = formatMessage(message);
    const tokens = estimateTokens(formatted.content);
    if (used + tokens > maxTokens && output.length > 0) continue;
    output.push(formatted);
    used += tokens;
  }
  return output;
}

async function buildContextWindow(conversationId, projectId, options = {}) {
  const maxTokens = Number(options.maxTokens || 100000);
  const recentMessageCount = Number(options.recentMessageCount || 10);
  let messages = [];
  let conversationSummary = '';

  if (conversationId) {
    try {
      const data = await conversationService.getConversation(conversationId, { refreshSummary: false });
      messages = data?.messages || [];
      conversationSummary = normalizeText(data?.conversation?.summary || '');
    } catch (error) {
      console.warn('[contextWindowService] failed to load conversation:', error?.message || error);
    }
  }

  const systemPrompt = buildSystemPrompt(projectId, conversationSummary);
  const historyBudget = Math.max(1000, Math.floor(maxTokens * 0.7));
  const history = truncateMessages(messages, historyBudget, recentMessageCount);
  const systemTokens = estimateTokens(systemPrompt);
  const historyTokens = history.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const total = systemTokens + historyTokens;

  return {
    systemPrompt,
    history,
    tokenUsage: {
      system: systemTokens,
      history: historyTokens,
      total,
      maxTokens,
      usagePercentage: Math.min(100, Math.round((total / maxTokens) * 100)),
    },
  };
}

module.exports = {
  estimateTokens,
  truncateMessages,
  buildSystemPrompt,
  buildContextWindow,
  isGeoMessage,
  GEO_MESSAGE_TYPES,
};
