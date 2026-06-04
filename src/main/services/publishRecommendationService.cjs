const articleDraftService = require('./articleDraftService.cjs');
const chaojimeijieService = require('./chaojimeijieService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const { chatCompletion, parseJsonContent } = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? '').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeResourceType(value) {
  if (value === 'we-media') return 'we-media';
  if (value === 'all') return 'all';
  return 'media';
}

function articleRoleOf(draft) {
  return text(draft?.draft?.article_role || draft?.draft?.articleRole || draft?.article_type);
}

function parseRate(value) {
  const match = text(value).match(/[\d.]+/);
  return match ? number(match[0], 0) : 0;
}

function compactResource(resource) {
  return {
    id: resource.id,
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    name: resource.name,
    price: resource.price,
    platform: resource.platform,
    area: resource.area,
    category: resource.category,
    status: resource.status,
    published_rate: resource.raw?.published_rate ?? resource.raw?.publish_rate ?? null,
    published_avg: resource.raw?.published_avg ?? resource.raw?.publish_avg ?? null,
    remark: resource.raw?.remark ?? null,
  };
}

function heuristicScore(resource, context) {
  const raw = resource.raw || {};
  const haystack = [
    resource.name,
    raw.remark,
    raw.media_name,
    raw.channel_name,
    raw.industry_name,
    raw.area_name,
    raw.platform_name,
  ].map(text).join(' ');
  const keywords = [
    context.industry,
    context.regions,
    context.keywords,
    context.articleTheme,
    context.targetQuestion,
  ].join(' ').split(/[\s,，、。；;|/]+/).map(text).filter((item) => item.length >= 2);
  const matches = keywords.filter((keyword) => haystack.includes(keyword)).length;
  const rate = parseRate(raw.published_rate ?? raw.publish_rate);
  const price = number(resource.price, 0);
  const typeBonus = context.role === 'ranking' && resource.resource_type === 'media' ? 12 : 0;
  const rateBonus = Math.min(rate, 100) * 0.25;
  const matchBonus = Math.min(matches, 8) * 7;
  const pricePenalty = price > 0 ? Math.min(price / 80, 18) : 0;
  return Math.max(1, Math.min(100, Math.round(48 + typeBonus + rateBonus + matchBonus - pricePenalty)));
}

function recommendationFromResource(resource, score, source = 'heuristic') {
  const raw = resource.raw || {};
  const reasons = [];
  if (resource.resource_type === 'media') reasons.push('新闻媒体更适合承接搜索与推荐可见性资产。');
  if (resource.resource_type === 'we-media') reasons.push('自媒体适合补充内容覆盖和账号场景分发。');
  if (raw.published_rate || raw.publish_rate) reasons.push(`发稿率参考：${raw.published_rate || raw.publish_rate}`);
  if (raw.published_avg || raw.publish_avg) reasons.push(`平均发稿时间参考：${raw.published_avg || raw.publish_avg}`);
  if (!reasons.length) reasons.push('资源价格和状态符合当前筛选条件。');
  return {
    resource,
    score,
    reasons,
    risk_flags: resource.status && Number(resource.status) !== 2 ? ['资源状态不是文档中的可发布状态，请投递前复核。'] : [],
    suggested_options: resource.resource_type === 'we-media'
      ? { publishForm: 1, publishType: 1, accountRule: 3 }
      : {},
    source,
  };
}

function collectResources(options = {}) {
  const resourceType = normalizeResourceType(options.resourceType || options.resource_type || 'all');
  const types = resourceType === 'all' ? ['media', 'we-media'] : [resourceType];
  const maxPrice = options.maxPrice ?? options.max_price;
  return types.flatMap((type) => chaojimeijieService.listResources({
    resourceType: type,
    status: options.includeUnavailable ? undefined : 2,
    query: options.query,
    maxPrice,
    limit: options.limit || 200,
  }));
}

function buildContext(draft, profile) {
  return {
    articleId: draft.id,
    role: articleRoleOf(draft),
    title: text(draft.draft.title),
    articleTheme: text(draft.draft.article_theme || draft.draft.theme),
    targetQuestion: text(draft.draft.target_question),
    company: fieldText(profile, 'company_name') || fieldText(profile, 'short_name'),
    industry: fieldText(profile, 'industry_category'),
    regions: fieldText(profile, 'business_regions'),
    keywords: fieldText(profile, 'target_keywords'),
    audiences: fieldText(profile, 'target_audiences'),
    advantages: fieldText(profile, 'core_advantages'),
  };
}

async function scoreWithModel(context, candidates) {
  const policy = getTaskPolicy('publish_channel_recommendation');
  const response = await chatCompletion({
    provider: policy.provider,
    model: policy.model,
    temperature: 0.1,
    maxTokens: 2400,
    messages: [
      {
        role: 'system',
        content: '你是GEO内容分发渠道筛选助手。只返回JSON，不要返回解释性正文。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '从候选超级媒介资源中选出最适合当前稿件投递的Top 5。',
          output_schema: {
            recommendations: [
              {
                resource_id: 'number',
                resource_type: 'media|we-media',
                score: '1-100',
                reasons: ['string'],
                risk_flags: ['string'],
                suggested_options: 'object',
              },
            ],
          },
          context,
          candidates,
        }),
      },
    ],
  });
  const json = parseJsonContent(response.content);
  return Array.isArray(json?.recommendations) ? json.recommendations : [];
}

function mergeModelScores(candidates, modelScores) {
  const byKey = new Map(candidates.map((item) => [`${item.resource.resource_type}:${item.resource.resource_id}`, item]));
  const merged = [];
  modelScores.forEach((item) => {
    const key = `${normalizeResourceType(item.resource_type)}:${Number(item.resource_id)}`;
    const existing = byKey.get(key);
    if (!existing) return;
    merged.push({
      ...existing,
      score: Math.max(1, Math.min(100, Math.round(number(item.score, existing.score)))),
      reasons: Array.isArray(item.reasons) && item.reasons.length ? item.reasons.map(text).filter(Boolean) : existing.reasons,
      risk_flags: Array.isArray(item.risk_flags) ? item.risk_flags.map(text).filter(Boolean) : existing.risk_flags,
      suggested_options: item.suggested_options && typeof item.suggested_options === 'object'
        ? item.suggested_options
        : existing.suggested_options,
      source: 'ai',
    });
  });
  candidates.forEach((item) => {
    if (!merged.find((mergedItem) => mergedItem.resource.id === item.resource.id)) merged.push(item);
  });
  return merged;
}

function saveRecommendations(articleId, recommendations, meta = {}) {
  const current = articleDraftService.getArticleDraft(articleId);
  articleDraftService.updateArticleDraft(articleId, {
    publication_evidence: {
      ...(current.draft.publication_evidence || {}),
      latest_resource_recommendations: recommendations,
      latest_resource_recommendations_at: nowIso(),
      latest_resource_recommendations_meta: meta,
    },
  });
}

async function recommendPublishResources(articleId, options = {}) {
  const draft = articleDraftService.getArticleDraft(articleId);
  const profile = knowledgeService.getKnowledgeProfile(draft.enterprise_project_id).profile || {};
  const context = buildContext(draft, profile);
  const resources = collectResources(options);
  if (!resources.length) {
    return {
      article_id: articleId,
      recommendations: [],
      meta: {
        generated_at: nowIso(),
        ai_used: false,
        message: '没有可推荐的资源，请先同步超级媒介资源或放宽筛选条件。',
      },
    };
  }

  const heuristic = resources
    .map((resource) => recommendationFromResource(resource, heuristicScore(resource, context)))
    .sort((a, b) => b.score - a.score || Number(a.resource.price || 0) - Number(b.resource.price || 0))
    .slice(0, Math.max(5, Math.min(Number(options.aiCandidateLimit || 30), 50)));

  let recommendations = heuristic;
  const meta = { generated_at: nowIso(), ai_used: false, ai_error: null };
  try {
    const modelScores = await scoreWithModel(context, heuristic.map((item) => compactResource(item.resource)));
    recommendations = mergeModelScores(heuristic, modelScores);
    meta.ai_used = true;
  } catch (error) {
    meta.ai_error = error.message || String(error);
  }

  recommendations = recommendations
    .sort((a, b) => b.score - a.score || Number(a.resource.price || 0) - Number(b.resource.price || 0))
    .slice(0, Math.max(1, Math.min(Number(options.limit || 5), 10)));
  saveRecommendations(articleId, recommendations, meta);
  return {
    article_id: articleId,
    recommendations,
    meta,
  };
}

module.exports = {
  recommendPublishResources,
  heuristicScore,
};
