const { getDb } = require('./databaseService.cjs');
const articlePublishService = require('./articlePublishService.cjs');
const chaojimeijieService = require('./chaojimeijieService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? '').trim();
}

function jsonParse(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function projectIdFromGeoId(geoProjectId) {
  return String(geoProjectId || '').replace(/^geo-/, '');
}

/**
 * 获取稿件推荐的发稿平台列表
 */
function getRecommendedChannels(draft) {
  const draftData = jsonParse(draft.draft_json, {});
  const channels = [];

  // 从 suggested_channel 提取
  if (draftData.suggested_channel) {
    channels.push(text(draftData.suggested_channel));
  }

  // 从 publish_target 提取
  if (draftData.publish_target) {
    channels.push(text(draftData.publish_target));
  }

  // 从 latest_resource_recommendations 提取
  const recommendations = draftData.publication_evidence?.latest_resource_recommendations;
  if (Array.isArray(recommendations)) {
    for (const rec of recommendations) {
      if (rec.resource?.name) {
        channels.push(text(rec.resource.name));
      }
    }
  }

  return [...new Set(channels.filter(Boolean))];
}

/**
 * 获取企业上下文信息
 */
function getEnterpriseContext(projectId) {
  const profileResponse = knowledgeService.getKnowledgeProfile(projectId);
  const profile = profileResponse.profile || {};

  return {
    company: fieldText(profile, 'company_name') || fieldText(profile, 'short_name'),
    industry: fieldText(profile, 'industry_category'),
    regions: fieldText(profile, 'business_regions'),
    keywords: fieldText(profile, 'target_keywords'),
    audiences: fieldText(profile, 'target_audiences'),
    advantages: fieldText(profile, 'core_advantages'),
  };
}

/**
 * 获取可用的媒体资源（status=2，排除测试资源）
 */
function getAvailableResources(resourceType = 'all') {
  const types = resourceType === 'all' ? ['media', 'we-media'] : [resourceType];
  const allResources = [];

  for (const type of types) {
    const resources = chaojimeijieService.listResources({
      resourceType: type,
      status: 2,
      limit: 500,
    });
    allResources.push(...resources);
  }

  // 过滤掉测试资源
  return allResources.filter((resource) => {
    const name = text(resource.name).toLowerCase();
    return !name.includes('测试') && !name.includes('test');
  });
}

/**
 * 匹配推荐平台与可用资源
 * 只返回在超级媒介中存在的资源
 */
function matchRecommendedWithAvailable(recommendedChannels, availableResources) {
  if (!recommendedChannels.length) return [];

  const matched = [];
  for (const resource of availableResources) {
    const resourceName = text(resource.name).toLowerCase();
    const raw = jsonParse(resource.raw_json, {});
    const platformName = text(raw.platform_name).toLowerCase();
    const mediaName = text(raw.media_name).toLowerCase();

    // 检查资源名称或平台名称是否包含推荐渠道关键词
    for (const channel of recommendedChannels) {
      const channelLower = channel.toLowerCase();
      if (
        resourceName.includes(channelLower) ||
        channelLower.includes(resourceName) ||
        platformName.includes(channelLower) ||
        channelLower.includes(platformName) ||
        mediaName.includes(channelLower)
      ) {
        matched.push(resource);
        break;
      }
    }
  }

  return matched;
}

/**
 * 检查资源是否应该被跳过（去重）
 * 同一公司不能在同一媒体账号发布同类型文章
 */
function shouldSkipResource(resource, draft, publishedOrders) {
  const resourceId = resource.resource_id;
  const articleType = draft.article_type || '';
  const projectId = draft.project_id;

  // 检查是否已有一篇同类型文章投递到同一资源
  return publishedOrders.some((order) => {
    if (order.resource_id !== resourceId) return false;
    if (order.project_id !== projectId) return false;

    // 获取订单对应的稿件类型
    const orderDraft = getDraftById(order.article_id);
    if (!orderDraft) return false;

    return orderDraft.article_type === articleType;
  });
}

/**
 * 根据 ID 获取稿件
 */
function getDraftById(draftId) {
  const row = getDb().prepare('SELECT * FROM geo_article_drafts WHERE id = ?').get(draftId);
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    article_type: row.article_type,
    draft_json: row.draft_json,
  };
}

/**
 * 获取项目已发布的订单（用于去重）
 */
function getPublishedOrders(projectId) {
  const rows = getDb().prepare(`
    SELECT * FROM publish_orders
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(projectId);

  return rows.map((row) => ({
    id: row.id,
    article_id: row.article_id,
    project_id: row.project_id,
    resource_id: row.resource_id,
    status_code: row.status_code,
    created_at: row.created_at,
  }));
}

/**
 * 从资源备注中提取 GEO 相关关键词
 */
function extractGeoKeywords(remark) {
  const remarkLower = text(remark).toLowerCase();
  const geoKeywords = ['geo', '收录', '收率', '搜索引擎', '百度', '谷歌', '优化'];

  return geoKeywords.filter((keyword) => remarkLower.includes(keyword));
}

/**
 * 从资源备注中提取行业相关关键词
 */
function extractIndustryKeywords(remark) {
  const remarkLower = text(remark).toLowerCase();
  const industryKeywords = [
    '汽车', '房产', '教育', '医疗', '金融', '科技', '互联网', '电商',
    '食品', '旅游', '家居', '美妆', '母婴', '服装', '体育', '游戏',
    '企业', '商业', '财经', '化工', '机械', '电子', '能源', '农业',
  ];

  return industryKeywords.filter((keyword) => remarkLower.includes(keyword));
}

/**
 * 评分维度
 */
const SCORE_WEIGHTS = {
  RECOMMENDATION_MATCH: 30,   // 推荐平台匹配
  INDUSTRY_MATCH: 25,         // 行业匹配
  GEO_TAG: 20,               // GEO 标识
  PUBLISH_RATE: 15,          // 出稿率
  AVG_READS: 10,             // 平均阅读量
};

/**
 * 多维度评分
 */
function scoreResource(resource, draft, context) {
  const raw = jsonParse(resource.raw_json, {});
  let score = 0;

  // 1. 推荐平台匹配（30分）
  const recommendedChannels = getRecommendedChannels(draft);
  const resourceName = text(resource.name).toLowerCase();
  const platformName = text(raw.platform_name).toLowerCase();

  for (const channel of recommendedChannels) {
    const channelLower = channel.toLowerCase();
    if (
      resourceName.includes(channelLower) ||
      channelLower.includes(resourceName) ||
      platformName.includes(channelLower)
    ) {
      score += SCORE_WEIGHTS.RECOMMENDATION_MATCH;
      break;
    }
  }

  // 2. 行业匹配（25分）
  const industryKeywords = extractIndustryKeywords(raw.remark || raw.industry_name || '');
  const contextKeywords = [
    context.industry,
    context.keywords,
    context.audiences,
  ].join(' ').toLowerCase().split(/[\s,，、]+/).filter(Boolean);

  const industryMatches = contextKeywords.filter((kw) =>
    industryKeywords.some((ik) => ik.includes(kw) || kw.includes(ik))
  ).length;
  score += Math.min(industryMatches * 8, SCORE_WEIGHTS.INDUSTRY_MATCH);

  // 3. GEO 标识（20分）
  const geoKeywords = extractGeoKeywords(raw.remark || '');
  score += Math.min(geoKeywords.length * 10, SCORE_WEIGHTS.GEO_TAG);

  // 4. 出稿率（15分）
  const publishRate = Number(raw.published_rate || raw.publish_rate || 0);
  score += Math.min(publishRate * 0.15, SCORE_WEIGHTS.PUBLISH_RATE);

  // 5. 平均阅读量（10分）
  const avgReads = Number(raw.avg_reads || raw.average_reads || 0);
  if (avgReads > 0) {
    score += Math.min(avgReads / 10, SCORE_WEIGHTS.AVG_READS);
  }

  return score;
}

/**
 * 为单篇稿件选择最佳媒体资源
 */
async function selectBestResource(draft, context, publishedOrders) {
  // 1. 获取推荐的发稿平台
  const recommendedChannels = getRecommendedChannels(draft);

  // 2. 获取可用资源
  const availableResources = getAvailableResources();

  // 3. 第一轮筛选：匹配推荐平台中存在的资源
  let candidates = matchRecommendedWithAvailable(recommendedChannels, availableResources);

  // 4. 如果没有匹配的推荐平台，使用所有可用资源
  if (candidates.length === 0) {
    candidates = availableResources;
  }

  // 5. 过滤已发布过的（同一公司+同一媒体+同类型文章）
  candidates = candidates.filter(
    (resource) => !shouldSkipResource(resource, draft, publishedOrders)
  );

  if (candidates.length === 0) return null;

  // 6. 多维度评分排序
  const scored = candidates.map((resource) => ({
    resource,
    score: scoreResource(resource, draft, context),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.resource || null;
}

/**
 * 批量自动发布稿件
 */
async function autoPublishArticles(projectId, options = {}) {
  const { dryRun = false, maxArticles = 50, articleRole = 'support' } = options;

  // 1. 获取该项目所有待发布的稿件（包括draft、reviewed、confirmed状态）
  const { drafts } = articlePublishService.listArticleDrafts(projectId, {
    article_role: articleRole,
  });

  // 2. 获取已发布的订单（用于去重）
  const publishedOrders = getPublishedOrders(projectId);

  // 3. 获取企业上下文
  const context = getEnterpriseContext(projectId);

  // 4. 逐篇匹配资源并发布
  const results = [];
  const toPublish = drafts.filter((d) => {
    const role = text(d.draft?.article_role);
    const roleMatch = role === articleRole || (!role && d.article_type?.includes(articleRole));
    // 过滤掉已发布或发布中的稿件
    const status = text(d.draft?.publication_evidence?.status || d.status);
    const statusMatch = !['published', 'publishing', 'archived'].includes(status);
    return roleMatch && statusMatch;
  });

  for (const draft of toPublish.slice(0, maxArticles)) {
    try {
      // 自动标记为已校对（生成OSS预览）
      const publishStatus = text(draft.draft?.publication_evidence?.status || draft.status);
      if (['draft', 'confirmed'].includes(publishStatus)) {
        await articlePublishService.markArticleReviewed(draft.id);
      }

      // 选择最佳资源
      const resource = await selectBestResource(draft, context, publishedOrders);
      if (!resource) {
        results.push({
          draftId: draft.id,
          title: text(draft.draft?.title),
          status: 'skipped',
          reason: '没有匹配的资源',
        });
        continue;
      }

      if (dryRun) {
        results.push({
          draftId: draft.id,
          title: text(draft.draft?.title),
          status: 'dry_run',
          resource: {
            id: resource.id,
            name: resource.name,
            price: resource.price,
          },
        });
        continue;
      }

      // 执行发布
      const order = await articlePublishService.publishArticle(draft.id, 'chaojimeijie', {
        resourceId: resource.resource_id,
        resourceType: resource.resource_type,
      });

      results.push({
        draftId: draft.id,
        title: text(draft.draft?.title),
        status: 'publishing',
        orderId: order?.id,
        resource: {
          id: resource.id,
          name: resource.name,
          price: resource.price,
        },
      });

      // 记录已发布，避免重复
      publishedOrders.push({
        article_id: draft.id,
        project_id: projectId,
        resource_id: resource.resource_id,
      });
    } catch (error) {
      results.push({
        draftId: draft.id,
        title: text(draft.draft?.title),
        status: 'failed',
        error: error.message || String(error),
      });
    }
  }

  return {
    projectId,
    total: toPublish.length,
    submitted: results.filter((r) => r.status === 'publishing').length,
    published: 0,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

module.exports = {
  autoPublishArticles,
  selectBestResource,
  getRecommendedChannels,
  matchRecommendedWithAvailable,
  shouldSkipResource,
  scoreResource,
  getEnterpriseContext,
  getAvailableResources,
};
