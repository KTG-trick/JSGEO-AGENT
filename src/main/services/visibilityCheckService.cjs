const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const questionPoolService = require('./questionPoolService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const articlePublishService = require('./articlePublishService.cjs');
const { responsesStream } = require('./llmGateway.cjs');
const { getTaskPolicy, NETWORK_MODES } = require('./modelPolicyService.cjs');
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
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function projectIdFromGeoId(value) {
  return String(value || '').replace(/^geo-/, '');
}

function extractUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s)"'<>，。；、]+/gi) || [];
  return Array.from(new Set(matches.map((url) => url.replace(/[)\].,;，。；、]+$/, ''))));
}

function rowToCheck(row) {
  const result = jsonParse(row.result_json, {});
  return {
    id: row.id,
    geo_project_id: `geo-${row.project_id}`,
    enterprise_project_id: row.project_id,
    platform: row.platform,
    question_ids: jsonParse(row.question_ids_json, []),
    result,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getConfirmedQuestions(projectId, platform) {
  const questionSet = questionPoolService.getLatestQuestionSet(projectId, platform);
  if (!questionSet) throw new Error('推荐检测需要先完成阶段二 10 条核心问题。');
  const questions = questionSet.questions || {};
  const confirmed = Array.isArray(questions.confirmed_questions) ? questions.confirmed_questions : [];
  const normalized = confirmed
    .map((item, index) => ({
      id: text(item.id) || `q${index + 1}`,
      question: text(item.question || item.text || item.title),
      intent: text(item.intent),
      keyword_layer: text(item.keyword_layer),
    }))
    .filter((item) => item.question);
  if (normalized.length !== 10) {
    throw new Error('推荐检测需要阶段二 confirmed_questions 正好 10 条。');
  }
  return normalized;
}

function getPublishedUrls(projectId) {
  const { drafts } = articlePublishService.listArticleDrafts(projectId);
  return drafts
    .map((draft) => {
      const evidence = draft.draft.publication_evidence || {};
      return {
        article_id: draft.id,
        title: draft.draft.title || '',
        article_role: draft.draft.article_role || '',
        url: text(evidence.published_url),
        platform: text(evidence.published_platform),
      };
    })
    .filter((item) => item.url);
}

function buildMessages({ profile, question, publishedUrls }) {
  const companyName = fieldText(profile, 'company_name') || fieldText(profile, 'short_name') || '';
  const shortName = fieldText(profile, 'short_name') || companyName;
  return [
    {
      role: 'system',
      content: [
        '你是 GEO 推荐可见性检测助手。',
        '你必须使用豆包助手联网搜索回答用户问题，并观察目标企业是否被推荐、提及或引用。',
        '不要为了照顾目标企业而改写答案；按真实联网搜索结果判断。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `用户真实问题：${question.question}`,
        '',
        `目标企业官方名：${companyName || '未知'}`,
        `目标企业简称：${shortName || '未知'}`,
        `行业：${fieldText(profile, 'industry_category') || '未知'}`,
        `业务区域：${fieldText(profile, 'business_regions') || fieldText(profile, 'detailed_address') || '未知'}`,
        '',
        '请联网搜索并直接回答这个用户问题。',
        '回答后补充一段检测信息：目标企业是否出现、是否进入推荐名单、如有排名或推荐顺序请指出、出现了哪些竞品、回答中引用了哪些 URL。',
        publishedUrls.length
          ? `本轮已发布内容 URL：\n${publishedUrls.map((item) => `- ${item.url}`).join('\n')}`
          : '本轮暂无已发布内容 URL。',
      ].join('\n'),
    },
  ];
}

function analyzeAnswer({ answer, profile, publishedUrls }) {
  const companyName = fieldText(profile, 'company_name');
  const shortName = fieldText(profile, 'short_name');
  const aliases = [companyName, shortName].map(text).filter(Boolean);
  const body = String(answer || '');
  const mentioned = aliases.some((alias) => body.includes(alias));
  const urls = extractUrls(body);
  const matchedPublishedUrls = publishedUrls
    .filter((item) => urls.includes(item.url) || body.includes(item.url))
    .map((item) => item.url);
  const effectiveMention = mentioned || matchedPublishedUrls.length > 0;
  const matchedAlias = aliases.find((alias) => body.includes(alias));
  const rankingPosition = matchedAlias
    ? Math.max(1, Math.min(10, Math.floor(body.indexOf(matchedAlias) / Math.max(body.length / 8, 1)) + 1))
    : null;
  const competitorCandidates = Array.from(new Set(
    (body.match(/[\u4e00-\u9fa5A-Za-z0-9（）()路]{2,24}(?:公司|门店|机构|品牌|供应商|厂家|平台)/g) || [])
      .filter((item) => !aliases.some((alias) => item.includes(alias)))
      .slice(0, 8)
  ));
  return {
    target_mentioned: mentioned,
    effective_mention: effectiveMention,
    ranking_position: rankingPosition,
    cited_urls: urls,
    matched_published_urls: matchedPublishedUrls,
    competitors: competitorCandidates,
  };
}

async function runVisibilityCheck(geoProjectId, platform = 'doubao', onEvent = null) {
  const projectId = projectIdFromGeoId(geoProjectId);
  if (!projectId) throw new Error('geoProjectId is required.');
  const profile = knowledgeService.getKnowledgeProfile(projectId).profile || {};
  const questions = getConfirmedQuestions(projectId, platform);
  const publishedUrls = getPublishedUrls(projectId);
  const policy = getTaskPolicy('visibility_check', { platform: 'doubao' });
  const questionResults = [];

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    onEvent?.({
      type: 'status',
      step_index: index,
      total: questions.length,
      question_id: question.id,
      message: `正在检测：${question.question}`,
    });
    const response = await responsesStream({
      messages: buildMessages({ profile, question, publishedUrls }),
      temperature: 0.1,
      maxTokens: 5000,
      provider: policy.provider,
      model: policy.model,
      networkMode: NETWORK_MODES.DOUBAO_ASSISTANT_SEARCH,
      deepThinking: true,
      taskType: 'visibility_check',
      onEvent: (event) => {
        if (event.type === 'reasoning_delta') onEvent?.(event);
      },
    });
    const analysis = analyzeAnswer({ answer: response.content, profile, publishedUrls });
    const item = {
      question_id: question.id,
      question: question.question,
      answer: response.content,
      ...analysis,
    };
    questionResults.push(item);
    onEvent?.({ type: 'question_result', result: item });
  }

  const effectiveCount = questionResults.filter((item) => item.effective_mention).length;
  const result = {
    evidence_mode: 'doubao_assistant_reasoning_search',
    source_result_origin: 'doubao_assistant',
    target_company: fieldText(profile, 'company_name') || fieldText(profile, 'short_name'),
    checked_questions: questions,
    published_urls: publishedUrls,
    question_results: questionResults,
    visibility_rate: effectiveCount / questions.length,
    effective_mentions: effectiveCount,
    total_questions: questions.length,
    missing_evidence: questionResults
      .filter((item) => !item.cited_urls.length)
      .map((item) => item.question_id),
    generated_at: nowIso(),
  };

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  getDb().prepare(`
    INSERT INTO ai_visibility_checks (id, project_id, platform, question_ids_json, result_json, status, created_at, updated_at)
    VALUES (@id, @project_id, @platform, @question_ids_json, @result_json, @status, @created_at, @updated_at)
  `).run({
    id,
    project_id: projectId,
    platform,
    question_ids_json: jsonString(questions.map((item) => item.id)),
    result_json: jsonString(result),
    status: 'completed',
    created_at: timestamp,
    updated_at: timestamp,
  });

  const saved = getVisibilityCheck(id);
  onEvent?.({ type: 'result', visibility_check: saved });
  return saved;
}

async function runVisibilityCheckStream(payload = {}, onEvent = null) {
  return runVisibilityCheck(payload.geoProjectId || payload.geo_project_id, payload.platform || 'doubao', onEvent);
}

function getVisibilityCheck(checkId) {
  if (!checkId) throw new Error('checkId is required.');
  const row = getDb().prepare('SELECT * FROM ai_visibility_checks WHERE id = ?').get(checkId);
  if (!row) throw new Error('推荐检测结果不存在。');
  return rowToCheck(row);
}

function getLatestVisibilityCheck(geoProjectId, platform = 'doubao') {
  const projectId = projectIdFromGeoId(geoProjectId);
  if (!projectId) throw new Error('geoProjectId is required.');
  const row = getDb().prepare(`
    SELECT * FROM ai_visibility_checks
    WHERE project_id = ? AND platform = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(projectId, platform);
  return row ? rowToCheck(row) : null;
}

module.exports = {
  runVisibilityCheck,
  runVisibilityCheckStream,
  getVisibilityCheck,
  getLatestVisibilityCheck,
};
