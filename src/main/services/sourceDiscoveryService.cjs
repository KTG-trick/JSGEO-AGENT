const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const { responsesStream } = require('./llmGateway.cjs');
const { NETWORK_MODES } = require('./modelPolicyService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const projectService = require('./projectService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

const DEFAULT_PLATFORM = 'doubao';
const SOURCE_ORIGIN = 'doubao_assistant';
const EVIDENCE_MODE = 'doubao_assistant_reasoning_search';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
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

function projectIdFromGeoId(geoProjectId) {
  return String(geoProjectId || '').replace(/^geo-/, '');
}

function getDoubaoModel() {
  return [
    process.env.DOUBAO_ASSISTANT_MODEL,
    process.env.DOUBAO_RESPONSES_MODEL,
    process.env.DOUBAO_MODEL,
    process.env.ARK_MODEL,
  ].find((item) => normalizeText(item)) || null;
}

function getLatestQuestionSet(projectId, platform) {
  const db = getDb();
  const requested = platform
    ? db.prepare(`
        SELECT *
        FROM geo_question_sets
        WHERE project_id = ? AND platform = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `).get(projectId, platform)
    : null;
  if (requested) return requested;
  return db.prepare(`
    SELECT *
    FROM geo_question_sets
    WHERE project_id = ? AND platform = 'doubao'
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(projectId);
}

function normalizeConfirmedQuestions(questionSetRow, fallbackReport) {
  const source = questionSetRow
    ? parseJson(questionSetRow.questions_json, {})
    : fallbackReport?.questions || fallbackReport?.report || fallbackReport || {};
  const candidates = Array.isArray(source.candidate_questions)
    ? source.candidate_questions
    : Array.isArray(source.question_pool)
      ? source.question_pool
      : [];
  const candidateById = new Map();
  candidates.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = normalizeText(item.id) || `q${index + 1}`;
    candidateById.set(id, item);
  });

  const confirmed = Array.isArray(source.confirmed_questions) ? source.confirmed_questions : [];
  const values = confirmed.map((item, index) => {
    if (typeof item === 'string') {
      const candidate = candidateById.get(item);
      return {
        id: item,
        question: normalizeText(candidate?.question || candidate?.query || candidate?.title || item),
        intent: normalizeText(candidate?.intent),
        keyword_layer: normalizeText(candidate?.keyword_layer),
      };
    }
    if (item && typeof item === 'object') {
      const id = normalizeText(item.id) || `q${index + 1}`;
      return {
        id,
        question: normalizeText(item.question || item.query || item.title || item.text),
        intent: normalizeText(item.intent),
        keyword_layer: normalizeText(item.keyword_layer),
      };
    }
    return null;
  }).filter((item) => item && item.question);

  const unique = [];
  const seen = new Set();
  values.forEach((item) => {
    const key = item.id || item.question;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  if (unique.length < 6 || unique.length > 10) {
    throw new Error('请先在阶段二确认 6-10 条核心问题，再执行阶段三豆包助手联网信源发现。');
  }
  return unique;
}

function profileToPrompt(profile = {}) {
  return [
    ['企业名称', fieldText(profile, 'company_name') || fieldText(profile, 'short_name')],
    ['所属行业', fieldText(profile, 'industry_category')],
    ['详细地址', fieldText(profile, 'detailed_address')],
    ['业务区域', fieldText(profile, 'business_regions')],
    ['产品与服务', fieldText(profile, 'offerings')],
    ['关联/代理品牌', fieldText(profile, 'associated_brands')],
    ['目标客群', fieldText(profile, 'target_audiences')],
    ['核心优势', fieldText(profile, 'core_advantages')],
    ['用户痛点', fieldText(profile, 'user_pain_points')],
    ['信任背书', fieldText(profile, 'trust_endorsements')],
    ['目标关键词', fieldText(profile, 'target_keywords')],
  ]
    .filter(([, value]) => normalizeText(value))
    .map(([label, value]) => `${label}: ${normalizeText(value)}`)
    .join('\n');
}

function buildPreferenceMessages({ profile, questions }) {
  return [
    {
      role: 'system',
      content: [
        '你是 GEO 高权重信源发现助手。',
        '本阶段只能使用豆包助手联网搜索观察信源，不允许编造来源。',
        '请先判断这类行业问题中，AI 联网回答更可能参考哪些平台、站点类型和内容形态。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请联网搜索并分析：下面企业和核心问题对应的行业，豆包助手在回答推荐/排行榜问题时通常更容易参考哪些公开信源？',
        '',
        '企业资料：',
        profileToPrompt(profile) || '暂无完整企业资料',
        '',
        '已确认核心问题：',
        questions.map((item, index) => `${index + 1}. ${item.question}`).join('\n'),
        '',
        '请优先给出平台/网站类型、内容形态、为什么容易被引用，以及适合发布的主题。不要声称已经引用了某 URL，除非联网结果中真的出现。',
      ].join('\n'),
    },
  ];
}

function buildQuestionMessages({ profile, question, index, total }) {
  return [
    {
      role: 'system',
      content: [
        '你是豆包助手联网搜索观察员。',
        '任务是回答用户真实问题，并尽量保留联网搜索或引用来源。',
        '不要为了完成任务编造 URL；没有找到公开来源就直接说明没有可核验来源。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `请联网搜索并回答第 ${index + 1}/${total} 个真实用户问题：${question.question}`,
        '',
        '企业资料用于理解行业和地域，不要求强行推荐该企业：',
        profileToPrompt(profile) || '暂无完整企业资料',
        '',
        '回答要求：',
        '1. 先像真实 AI 助手一样回答这个问题。',
        '2. 如搜索或引用了网页，请在回答末尾列出“参考来源”，包含标题和 URL。',
        '3. 如果没有可核验 URL，请明确写“未观察到可核验 URL”。',
      ].join('\n'),
    },
  ];
}

function walk(value, visitor, path = []) {
  if (value === null || value === undefined) return;
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, [...path, String(index)]));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => walk(item, visitor, [...path, key]));
  }
}

function normalizeUrl(value) {
  const text = normalizeText(value)
    .replace(/[)\]}>，。；;、]+$/g, '')
    .replace(/^["'(<\[]+/g, '');
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function sourceNameFromDomain(domain) {
  const text = String(domain || '').toLowerCase();
  const mappings = [
    ['zhihu.com', '知乎'],
    ['baidu.com', '百度'],
    ['baijiahao.baidu.com', '百家号'],
    ['sohu.com', '搜狐'],
    ['toutiao.com', '今日头条'],
    ['xiaohongshu.com', '小红书'],
    ['bilibili.com', '哔哩哔哩'],
    ['weixin.qq.com', '微信公众平台'],
    ['mp.weixin.qq.com', '微信公众平台'],
    ['autohome.com.cn', '汽车之家'],
    ['pcauto.com.cn', '太平洋汽车'],
    ['dongchedi.com', '懂车帝'],
    ['sina.com.cn', '新浪'],
    ['163.com', '网易'],
    ['douyin.com', '抖音'],
  ];
  const matched = mappings.find(([key]) => text.includes(key));
  if (matched) return matched[1];
  return text || '未知来源';
}

function sourceTypeFromDomain(domain) {
  const text = String(domain || '').toLowerCase();
  if (/zhihu|wenda|ask/.test(text)) return 'qa';
  if (/xiaohongshu|douyin|bilibili|weixin|toutiao/.test(text)) return 'social';
  if (/autohome|pcauto|dongchedi/.test(text)) return 'industry_portal';
  if (/baijiahao|sohu|sina|163/.test(text)) return 'media';
  if (/baidu|bing|sogou/.test(text)) return 'search_result';
  return 'other';
}

function guessContentFormat(title = '', url = '') {
  const text = `${title} ${url}`.toLowerCase();
  if (/排行|排名|榜单|top|推荐/.test(text)) return 'ranking';
  if (/测评|评测|review|对比/.test(text)) return 'review';
  if (/案例|施工|客户/.test(text)) return 'case_study';
  if (/避坑|攻略|指南|怎么|如何/.test(text)) return 'guide';
  if (/问答|question|answer/.test(text)) return 'faq';
  return 'guide';
}

function extractUrlsFromText(text, evidenceType, context = {}) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>）)】\]]+/gi) || [];
  return matches
    .map((item) => normalizeUrl(item))
    .filter(Boolean)
    .map((url) => {
      const domain = domainFromUrl(url);
      return {
        url,
        domain,
        title: context.title || '',
        source_name: sourceNameFromDomain(domain),
        source_type: sourceTypeFromDomain(domain),
        content_format: guessContentFormat(context.title, url),
        evidence_type: evidenceType,
        question_id: context.question_id || null,
        question: context.question || null,
      };
    });
}

function extractUrlEvidenceFromRaw(rawValue, context = {}) {
  const found = [];
  const seen = new Set();
  walk(rawValue, (value, path) => {
    const key = path[path.length - 1] || '';
    if (typeof value !== 'string') return;
    const lowerKey = key.toLowerCase();
    const title = /title|name/.test(lowerKey) ? value : context.title || '';
    if (/url|link|href|site|source/.test(lowerKey)) {
      const direct = normalizeUrl(value);
      if (direct) {
        const domain = domainFromUrl(direct);
        const entry = {
          url: direct,
          domain,
          title,
          source_name: sourceNameFromDomain(domain),
          source_type: sourceTypeFromDomain(domain),
          content_format: guessContentFormat(title, direct),
          evidence_type: 'tool_observed',
          question_id: context.question_id || null,
          question: context.question || null,
        };
        if (!seen.has(entry.url)) {
          seen.add(entry.url);
          found.push(entry);
        }
        return;
      }
    }
    extractUrlsFromText(value, 'answer_mentioned', { ...context, title }).forEach((entry) => {
      if (!seen.has(entry.url)) {
        seen.add(entry.url);
        found.push(entry);
      }
    });
  });
  return found;
}

function extractSearchQueries(rawEvents = [], fallbackQuestion = '') {
  const queries = [];
  walk(rawEvents, (value, path) => {
    if (typeof value !== 'string') return;
    const key = (path[path.length - 1] || '').toLowerCase();
    if (/query|keyword|search/.test(key) && value.length <= 160 && !/^https?:\/\//i.test(value)) {
      queries.push(normalizeText(value));
    }
  });
  return Array.from(new Set(queries.filter(Boolean))).slice(0, 8)
    .concat(queries.length ? [] : [fallbackQuestion].filter(Boolean));
}

function answerExcerpt(text) {
  return normalizeText(String(text || '').replace(/\n+/g, ' ')).slice(0, 600);
}

async function runDoubaoAssistantSearch({ messages, onEvent }) {
  return responsesStream({
    messages,
    provider: 'ark',
    model: getDoubaoModel(),
    networkMode: NETWORK_MODES.DOUBAO_ASSISTANT_SEARCH,
    deepThinking: true,
    taskType: 'source_discovery',
    onEvent,
  });
}

async function runPreferenceSearch({ profile, questions, onEvent }) {
  onEvent?.({
    type: 'status',
    step_index: 0,
    step_label: '询问豆包助手信源偏好',
    message: '正在使用豆包助手联网搜索分析行业信源偏好。',
  });
  const result = await runDoubaoAssistantSearch({
    messages: buildPreferenceMessages({ profile, questions }),
    onEvent: (event) => {
      if (event.type === 'reasoning_delta' || event.type === 'delta') {
        onEvent?.({ type: 'summary_delta', text: event.text });
      }
    },
  });
  const rawSources = extractUrlEvidenceFromRaw([result.raw, result.raw_events, result.content], {
    question_id: 'ai_stated_preferences',
    question: 'AI 信源偏好询问',
  });
  return {
    summary: answerExcerpt(result.content),
    content: result.content,
    search_queries: extractSearchQueries(result.raw_events, 'AI 信源偏好'),
    cited_urls: rawSources,
    model: result.model,
    provider: result.provider,
    request_id: result.request_id,
    reasoning_content: result.reasoning_content,
  };
}

async function runQuestionSearch({ profile, question, index, total, onEvent }) {
  onEvent?.({
    type: 'status',
    step_index: index + 1,
    step_label: `联网搜索核心问题 ${index + 1}/${total}`,
    message: `正在用豆包助手联网搜索：${question.question}`,
  });
  const result = await runDoubaoAssistantSearch({
    messages: buildQuestionMessages({ profile, question, index, total }),
    onEvent: (event) => {
      if (event.type === 'reasoning_delta') {
        onEvent?.({ type: 'summary_delta', text: event.text });
      }
    },
  });
  const citedUrls = extractUrlEvidenceFromRaw([result.raw, result.raw_events, result.content], {
    question_id: question.id,
    question: question.question,
  });
  const searchQueries = extractSearchQueries(result.raw_events, question.question);
  onEvent?.({
    type: 'search',
    question_id: question.id,
    question: question.question,
    search_queries: searchQueries,
    cited_urls: citedUrls,
  });
  return {
    question_id: question.id,
    question: question.question,
    intent: question.intent || '',
    keyword_layer: question.keyword_layer || '',
    status: 'completed',
    search_queries: searchQueries,
    answer_excerpt: answerExcerpt(result.content),
    cited_urls: citedUrls,
    model: result.model,
    provider: result.provider,
    request_id: result.request_id,
    reasoning_content: result.reasoning_content,
  };
}

function normalizePreferenceChannels(preferenceRun) {
  const fromUrls = (preferenceRun.cited_urls || []).map((item) => ({
    ...item,
    reason: '豆包助手信源偏好联网分析中出现的来源。',
    priority_score: 0.45,
    recommended_topics: [],
  }));
  if (fromUrls.length) return fromUrls;
  return [{
    source_name: '豆包助手自述偏好',
    source_url: null,
    source_type: 'other',
    content_format: 'guide',
    priority_score: 0.35,
    reason: preferenceRun.summary || '豆包助手对行业信源偏好的联网分析结果。',
    observed_in_answers: preferenceRun.summary || '',
    recommended_topics: [],
    evidence_type: 'ai_stated_preference',
  }];
}

function buildRecommendedTopics(domainEvidence, questions) {
  const ranking = questions.find((item) => item.intent === 'ranking_rec')?.question;
  const educational = questions.find((item) => item.intent === 'educational')?.question;
  const comparison = questions.find((item) => item.intent === 'comparison')?.question;
  return [ranking, educational, comparison]
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => item.replace(/[？?]$/g, ''));
}

function aggregateChannels({ preferenceRun, questionRuns, questions }) {
  const sourceMap = new Map();
  const addEvidence = (item, baseScore, sourceLabel) => {
    const domain = item.domain || domainFromUrl(item.url || '');
    const key = domain || item.source_name || item.source_url || sourceLabel;
    if (!key) return;
    const current = sourceMap.get(key) || {
      source_name: item.source_name || sourceNameFromDomain(domain),
      source_url: item.url || item.source_url || null,
      source_type: item.source_type || sourceTypeFromDomain(domain),
      content_format: item.content_format || guessContentFormat(item.title, item.url),
      priority_score: 0,
      reason_parts: [],
      observed_questions: new Set(),
      urls: new Map(),
      evidence_types: new Set(),
    };
    current.priority_score += baseScore;
    if (item.question_id && item.question_id !== 'ai_stated_preferences') {
      current.observed_questions.add(item.question_id);
    }
    if (item.url) {
      current.urls.set(item.url, {
        url: item.url,
        title: item.title || '',
        evidence_type: item.evidence_type || sourceLabel,
        question_id: item.question_id || null,
        question: item.question || null,
      });
    }
    current.evidence_types.add(item.evidence_type || sourceLabel);
    if (item.reason) current.reason_parts.push(item.reason);
    sourceMap.set(key, current);
  };

  normalizePreferenceChannels(preferenceRun).forEach((item) => addEvidence(item, 0.25, 'ai_stated_preference'));
  questionRuns.forEach((run) => {
    (run.cited_urls || []).forEach((item) => {
      const score = item.evidence_type === 'tool_observed' ? 1.2 : 0.85;
      addEvidence(item, score, item.evidence_type);
    });
  });

  const channels = Array.from(sourceMap.values()).map((item) => {
    const observedCount = item.observed_questions.size;
    const urlCount = item.urls.size;
    const score = Math.min(1, (item.priority_score + observedCount * 0.35 + urlCount * 0.15) / 5);
    const topics = buildRecommendedTopics(item, questions);
    const evidenceTypes = Array.from(item.evidence_types);
    const hasObserved = evidenceTypes.some((type) => type === 'tool_observed' || type === 'answer_mentioned');
    return {
      source_name: item.source_name,
      source_url: item.source_url,
      source_type: item.source_type,
      content_format: item.content_format,
      priority_score: Number(score.toFixed(2)),
      reason: hasObserved
        ? `在 ${observedCount || urlCount} 个核心问题的豆包助手联网回答中观察到相关来源，实测 URL 权重大于 AI 自述偏好。`
        : item.reason_parts[0] || '来自豆包助手信源偏好分析，尚需后续 URL 实测补强。',
      observed_in_answers: Array.from(item.urls.values()).map((url) => url.question || url.title || url.url).filter(Boolean).slice(0, 3).join('；'),
      recommended_topics: topics,
      observed_question_count: observedCount,
      observed_url_count: urlCount,
      evidence_types: evidenceTypes,
      evidence_urls: Array.from(item.urls.values()).slice(0, 8),
    };
  }).sort((a, b) => b.priority_score - a.priority_score);

  return channels;
}

function buildDiscovery({ preferenceRun, questionRuns, questions, streamMeta = {} }) {
  const observedCitationSources = questionRuns.flatMap((run) => run.cited_urls || []);
  const verifiedObservedSources = observedCitationSources.filter((item) => item.url);
  const channelPriorities = aggregateChannels({ preferenceRun, questionRuns, questions });
  const missingEvidence = questionRuns
    .filter((run) => !Array.isArray(run.cited_urls) || run.cited_urls.length === 0)
    .map((run) => `问题「${run.question}」未观察到可核验 URL。`);

  return {
    evidence_mode: EVIDENCE_MODE,
    source_result_origin: SOURCE_ORIGIN,
    summary: `已使用豆包助手联网搜索观察 ${questionRuns.length} 条核心问题，提取 ${verifiedObservedSources.length} 条可核验 URL，形成 ${channelPriorities.length} 个发布渠道优先级。`,
    status: 'completed',
    input_confirmed_questions: questions,
    input_questions: questions.map((item) => item.question),
    ai_stated_preferences: preferenceRun,
    observed_search_runs: questionRuns,
    observed_citation_sources: observedCitationSources,
    verified_observed_sources: verifiedObservedSources,
    candidate_sources: channelPriorities,
    channel_priorities: channelPriorities,
    source_scores: channelPriorities.map((item) => ({
      source: item.source_name,
      score: item.priority_score,
      reason: item.reason,
    })),
    content_distribution_strategy: {
      primary_channels: channelPriorities.slice(0, 5).map((item) => item.source_name),
      content_formats: Array.from(new Set(channelPriorities.map((item) => item.content_format).filter(Boolean))).slice(0, 5),
      citation_structure: '优先在豆包助手实测出现过 URL 的平台发布；稿件结构采用问题标题、行业判断标准、企业事实证据、案例/测评数据、推荐理由闭环。',
      next_step: '基于渠道优先级生成首轮 9 篇内容矩阵，并在稿件管理页先分发支撑稿、后分发排行榜稿。',
    },
    missing_evidence: missingEvidence,
    extraction_model: streamMeta.model || null,
    extraction_provider: streamMeta.provider || 'ark',
    task_policy: {
      task_type: 'source_discovery',
      api_family: 'responses',
      network_mode: NETWORK_MODES.DOUBAO_ASSISTANT_SEARCH,
      deep_thinking: true,
    },
  };
}

function rowToDiscovery(row, requestedPlatform = null) {
  if (!row) return null;
  const discovery = parseJson(row.discovery_json, {});
  if (!discovery.source_result_origin) discovery.source_result_origin = SOURCE_ORIGIN;
  if (!discovery.evidence_mode) discovery.evidence_mode = EVIDENCE_MODE;
  return {
    id: row.id,
    geo_project_id: `geo-${row.project_id}`,
    enterprise_project_id: row.project_id,
    project_id: row.project_id,
    question_set_id: row.question_set_id || null,
    platform: requestedPlatform || row.platform,
    status: row.status,
    source_name: row.source_name || null,
    source_url: row.source_url || null,
    source_type: row.source_type || null,
    content_format: row.content_format || null,
    priority_score: Number(row.priority_score || 0),
    reason: row.reason || null,
    observed_in_answers: row.observed_in_answers || null,
    recommended_topics: parseJson(row.recommended_topics, []),
    discovery,
    confirmed_at: row.confirmed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function insertWorkflowEvent(db, discovery) {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO workflow_events (
      id, project_id, stage_key, event_type, status, title, content,
      artifact_type, artifact_id, metadata_json, created_at, updated_at
    )
    VALUES (
      @id, @project_id, 'stage_3', 'source_discovery_completed', @status, @title, @content,
      'geo_source_discovery', @artifact_id, @metadata_json, @created_at, @updated_at
    )
  `).run({
    id: crypto.randomUUID(),
    project_id: discovery.project_id,
    status: discovery.status,
    title: '豆包助手联网信源发现完成',
    content: discovery.discovery.summary || '',
    artifact_id: discovery.id,
    metadata_json: JSON.stringify({
      platform: discovery.platform,
      question_set_id: discovery.question_set_id,
      source_result_origin: SOURCE_ORIGIN,
      evidence_mode: EVIDENCE_MODE,
    }),
    created_at: timestamp,
    updated_at: timestamp,
  });
}

async function buildAndSaveDiscovery({ geoProjectId, projectId, questionSetId = null, platform = DEFAULT_PLATFORM, fallbackReport = null, onEvent = null } = {}) {
  const enterpriseProjectId = projectId || projectIdFromGeoId(geoProjectId);
  if (!enterpriseProjectId) throw new Error('projectId is required.');
  projectService.getProject(enterpriseProjectId);

  const profileResponse = knowledgeService.getKnowledgeProfile(enterpriseProjectId);
  const profile = profileResponse.profile || {};
  const questionSetRow = questionSetId
    ? getDb().prepare('SELECT * FROM geo_question_sets WHERE id = ? AND project_id = ?').get(questionSetId, enterpriseProjectId)
    : getLatestQuestionSet(enterpriseProjectId, platform);
  const questions = normalizeConfirmedQuestions(questionSetRow, fallbackReport);

  onEvent?.({
    type: 'status',
    step_index: 0,
    step_label: '准备豆包助手联网搜索',
    message: `阶段三将统一使用豆包助手联网搜索 ${questions.length} 条核心问题。`,
  });

  const preferenceRun = await runPreferenceSearch({ profile, questions, onEvent });
  const questionRuns = [];
  for (let index = 0; index < questions.length; index += 1) {
    try {
      questionRuns.push(await runQuestionSearch({
        profile,
        question: questions[index],
        index,
        total: questions.length,
        onEvent,
      }));
    } catch (error) {
      questionRuns.push({
        question_id: questions[index].id,
        question: questions[index].question,
        intent: questions[index].intent || '',
        keyword_layer: questions[index].keyword_layer || '',
        status: 'failed',
        search_queries: [questions[index].question],
        answer_excerpt: '',
        cited_urls: [],
        error_message: normalizeText(error.message || error),
      });
    }
  }

  onEvent?.({
    type: 'status',
    step_index: questions.length + 1,
    step_label: '聚合渠道优先级',
    message: '正在按实测 URL 权重聚合信源渠道优先级。',
  });

  const discoveryJson = buildDiscovery({
    preferenceRun,
    questionRuns,
    questions,
    streamMeta: preferenceRun,
  });

  const primary = discoveryJson.channel_priorities[0] || {};
  const timestamp = nowIso();
  const row = {
    id: crypto.randomUUID(),
    project_id: enterpriseProjectId,
    question_set_id: questionSetRow?.id || questionSetId || fallbackReport?.id || null,
    platform,
    status: 'completed',
    source_name: primary.source_name || null,
    source_url: primary.source_url || null,
    source_type: primary.source_type || null,
    content_format: primary.content_format || null,
    priority_score: primary.priority_score || 0,
    reason: primary.reason || null,
    observed_in_answers: primary.observed_in_answers || null,
    recommended_topics: JSON.stringify(primary.recommended_topics || []),
    discovery_json: JSON.stringify(discoveryJson),
    created_at: timestamp,
    updated_at: timestamp,
  };

  const db = getDb();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO geo_source_discoveries (
        id, project_id, question_set_id, platform, status, source_name, source_url,
        source_type, content_format, priority_score, reason, observed_in_answers,
        recommended_topics, discovery_json, created_at, updated_at
      )
      VALUES (
        @id, @project_id, @question_set_id, @platform, @status, @source_name, @source_url,
        @source_type, @content_format, @priority_score, @reason, @observed_in_answers,
        @recommended_topics, @discovery_json, @created_at, @updated_at
      )
    `).run(row);
    insertWorkflowEvent(db, { ...row, discovery: discoveryJson });
  })();

  return rowToDiscovery({ ...row, confirmed_at: null });
}

async function generateSourceDiscovery(params = {}) {
  return buildAndSaveDiscovery(params);
}

async function generateSourceDiscoveryStream(params = {}, onEvent = null) {
  const discovery = await buildAndSaveDiscovery({ ...params, onEvent });
  onEvent?.({ type: 'result', source_discovery: discovery });
  return discovery;
}

function getSourceDiscovery(discoveryId) {
  if (!discoveryId) throw new Error('discoveryId is required.');
  const row = getDb().prepare('SELECT * FROM geo_source_discoveries WHERE id = ?').get(discoveryId);
  if (!row) throw new Error('高权重信源发现结果不存在。');
  return rowToDiscovery(row);
}

function getLatestSourceDiscovery(geoProjectId, platform = DEFAULT_PLATFORM) {
  const projectId = projectIdFromGeoId(geoProjectId);
  if (!projectId) throw new Error('geoProjectId is required.');
  const db = getDb();
  const requested = db.prepare(`
    SELECT *
    FROM geo_source_discoveries
    WHERE project_id = ? AND platform = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(projectId, platform);
  if (requested) return rowToDiscovery(requested);

  const fallback = db.prepare(`
    SELECT *
    FROM geo_source_discoveries
    WHERE project_id = ? AND json_extract(discovery_json, '$.source_result_origin') = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(projectId, SOURCE_ORIGIN);
  if (fallback) return rowToDiscovery(fallback, platform);
  throw new Error('暂无豆包助手联网信源发现结果。');
}

function listSourceDiscoveries(projectId, platform = null) {
  if (!projectId) throw new Error('projectId is required.');
  projectService.getProject(projectId);
  const rows = platform
    ? getDb().prepare(`
        SELECT * FROM geo_source_discoveries
        WHERE project_id = ? AND platform = ?
        ORDER BY datetime(created_at) DESC
      `).all(projectId, platform)
    : getDb().prepare(`
        SELECT * FROM geo_source_discoveries
        WHERE project_id = ?
        ORDER BY datetime(created_at) DESC
      `).all(projectId);
  return { discoveries: rows.map(rowToDiscovery) };
}

function confirmSourceDiscovery(discoveryId) {
  if (!discoveryId) throw new Error('discoveryId is required.');
  const timestamp = nowIso();
  const result = getDb().prepare(`
    UPDATE geo_source_discoveries
    SET status = 'confirmed',
        confirmed_at = COALESCE(confirmed_at, @confirmed_at),
        updated_at = @updated_at
    WHERE id = @id
  `).run({ id: discoveryId, confirmed_at: timestamp, updated_at: timestamp });
  if (!result.changes) throw new Error('高权重信源发现结果不存在。');
  return getSourceDiscovery(discoveryId);
}

module.exports = {
  confirmSourceDiscovery,
  generateSourceDiscovery,
  generateSourceDiscoveryStream,
  getLatestSourceDiscovery,
  getSourceDiscovery,
  listSourceDiscoveries,
};
