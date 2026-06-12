const { getDb } = require('./databaseService.cjs');
const articlePublishService = require('./articlePublishService.cjs');
const chaojimeijieService = require('./chaojimeijieService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const { fieldText } = require('./profileFieldService.cjs');
const llmGateway = require('./llmGateway.cjs');

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

// ─── 行业关键词映射 ───

const INDUSTRY_MAP = {
  '食品': ['食品', '餐饮', '预制菜', '速冻', '食材', '饮料', '酒水', '零食', '农产品', '火锅', '调味', '酱料', '炒菜', '外卖', '厨房'],
  '汽车': ['汽车', '车', '驾驶', '新能源', '电动', '4S', '二手车', '修车', '保养', '车载'],
  '房产': ['房产', '楼盘', '房地产', '物业', '装修', '家居', '建材', '家装'],
  '教育': ['教育', '培训', '学校', '课程', '学习', '高考', '留学', '辅导', '幼儿园'],
  '医疗': ['医疗', '健康', '医药', '医院', '诊所', '养生', '保健', '药品', '中医'],
  '科技': ['科技', '互联网', 'AI', '软件', '数字化', '区块链', '智能', '数据', '云计算'],
  '金融': ['金融', '银行', '投资', '理财', '保险', '贷款', '证券', '基金'],
  '美妆': ['美妆', '护肤', '化妆品', '美容', '口红', '面膜'],
  '母婴': ['母婴', '婴儿', '儿童', '孕', '奶粉', '童装'],
  '服装': ['服装', '服饰', '穿搭', '潮牌', '鞋', '衣'],
  '体育': ['体育', '运动', '健身', '球', '赛事', '马拉松'],
  '游戏': ['游戏', '电竞', '手游', '网游', '玩家'],
  '旅游': ['旅游', '旅行', '景区', '酒店', '民宿', '攻略'],
  '房产家居': ['家具', '家电', '智能家居', '灯饰', '窗帘'],
  '娱乐': ['娱乐', '明星', '影视', '综艺', '音乐', '演唱会'],
};

// ─── 频道类型 → 行业映射（API channel_type 字段）───

const CHANNEL_TYPE_INDUSTRY = {
  1: '科技',
  2: '消费',
  3: '时尚',
  4: '娱乐',
  5: '游戏',
  6: '汽车',
  7: '教育',
  8: '旅游',
  9: '医疗',
  10: '房产家居',
  11: '金融',
  16: '娱乐',
  17: '体育',
  18: '食品',
  20: '母婴',
};

// ─── 文章行业分析 ───

/**
 * 从文章标题和内容中提取行业关键词
 */
function extractArticleIndustryKeywords(title, content) {
  const combined = `${title} ${content}`.toLowerCase();
  const matched = [];
  for (const [industry, keywords] of Object.entries(INDUSTRY_MAP)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      matched.push(industry);
    }
  }
  return matched;
}

// ─── 资源行业标签解析 ───

/**
 * 从超级媒介资源的结构化字段中提取行业标签
 */
function getResourceIndustryTags(resource) {
  const raw = jsonParse(resource.raw_json, {});
  const tags = [];

  // 1. 从频道类型推断（API 有 channel_type 字段，可能是数字或文字）
  const channelType = Number(raw.channel_type);
  if (CHANNEL_TYPE_INDUSTRY[channelType]) {
    tags.push(CHANNEL_TYPE_INDUSTRY[channelType]);
  }
  // 也处理 channel_type_label 文字字段（如"食品餐饮"）
  const channelTypeLabel = text(raw.channel_type_label || '').toLowerCase();
  if (channelTypeLabel) {
    for (const [industry, keywords] of Object.entries(INDUSTRY_MAP)) {
      if (keywords.some((kw) => channelTypeLabel.includes(kw))) {
        tags.push(industry);
      }
    }
  }

  // 2. 从行业分类字段推断（API 有 industry_category 字段，仅自媒体）
  const industryCategory = Number(raw.industry_category);
  if (industryCategory) {
    const categoryIndustryMap = {
      1: '娱乐', 2: '娱乐', 3: '食品', 4: '金融', 5: '科技',
      6: '体育', 7: '汽车', 8: '娱乐', 9: '时尚', 10: '医疗',
      11: '教育', 12: '母婴', 13: '食品', 14: '旅游', 16: '游戏',
      19: '房产家居', 23: '新闻',
    };
    if (categoryIndustryMap[industryCategory]) {
      tags.push(categoryIndustryMap[industryCategory]);
    }
  }

  // 3. 从备注中提取（作为补充，关键词匹配）
  const remark = text(raw.remark || '').toLowerCase();
  for (const [industry, keywords] of Object.entries(INDUSTRY_MAP)) {
    if (keywords.some((kw) => remark.includes(kw))) {
      tags.push(industry);
    }
  }

  return [...new Set(tags)];
}

// ─── GEO 标识检测 ───

/**
 * 检查资源是否有 GEO 相关标识（收录率、SEO、搜索引擎等）
 */
function hasGeoTag(resource) {
  const raw = jsonParse(resource.raw_json, {});
  const remark = text(raw.remark || '').toLowerCase();
  const geoKeywords = ['geo', '收录', '收率好', '搜索引擎', '百度收录', '谷歌', 'SEO', '优化'];
  // 包收录资源（record_situation=2）也算 GEO 标识
  if (Number(raw.record_situation) === 2) return true;
  return geoKeywords.some((kw) => remark.includes(kw));
}

// ─── 推荐平台匹配 ───

/**
 * 获取稿件推荐的发稿平台列表
 */
function getRecommendedChannels(draft) {
  const draftData = jsonParse(draft.draft_json, {});
  const channels = [];

  if (draftData.suggested_channel) {
    channels.push(text(draftData.suggested_channel));
  }
  if (draftData.publish_target) {
    channels.push(text(draftData.publish_target));
  }
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
 * 匹配推荐平台与可用资源（单向匹配，避免误命中）
 * 只在超级媒介中存在的资源中选择
 */
function matchRecommendedWithAvailable(recommendedChannels, availableResources) {
  if (!recommendedChannels.length) return [];

  const matched = [];
  for (const resource of availableResources) {
    const resourceName = text(resource.name).toLowerCase();
    const raw = jsonParse(resource.raw_json, {});
    const platformName = text(raw.platform_name || '').toLowerCase();
    const mediaName = text(raw.media_name || '').toLowerCase();

    for (const channel of recommendedChannels) {
      const channelLower = channel.toLowerCase();
      // 单向匹配：推荐渠道名包含资源名，或推荐渠道名包含平台名
      // 不做反向匹配，避免推荐「财经」却匹配到「新浪科技」的情况
      if (
        channelLower.includes(resourceName) ||
        resourceName.includes(channelLower) ||
        channelLower.includes(platformName) ||
        channelLower.includes(mediaName)
      ) {
        matched.push(resource);
        break;
      }
    }
  }

  return matched;
}

// ─── 企业上下文 ───

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

// ─── 资源筛选 ───

/**
 * 获取可用的媒体资源（status=2，排除测试资源，可选价格上限）
 */
function getAvailableResources(resourceType = 'all', maxPrice = null) {
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

  return allResources.filter((resource) => {
    const name = text(resource.name).toLowerCase();
    if (name.includes('测试') || name.includes('test')) return false;
    if (maxPrice && Number(resource.price) > maxPrice) return false;
    return true;
  });
}

// ─── 去重 ───

/**
 * 终态订单状态码（不参与去重）
 */
const TERMINAL_STATUS_CODES = new Set([2, 5, 7, 8, 9]);

/**
 * 检查资源是否应该被跳过（去重）
 * 同一家公司的同类型文章不能发到同一个媒体账号
 * 已取消、已退款等终态订单不参与去重
 */
function shouldSkipResource(resource, draft, publishedOrders) {
  const resourceId = resource.resource_id;
  const articleType = draft.article_type || '';
  const projectId = draft.project_id;

  return publishedOrders.some((order) => {
    if (order.resource_id !== resourceId) return false;
    if (order.project_id !== projectId) return false;
    // 终态订单不参与去重
    const code = Number(order.status_code);
    if (TERMINAL_STATUS_CODES.has(code)) return false;

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

// ─── 评分 ───

/**
 * 评分维度权重（满分 100）
 * 行业匹配优先级最高
 */
const SCORE_WEIGHTS = {
  INDUSTRY_EXACT: 40,   // 行业精确匹配
  RECOMMENDATION: 20,    // 推荐平台匹配
  GEO_TAG: 15,          // GEO 标识
  PUBLISH_RATE: 15,     // 出稿率
  AVG_READS: 10,        // 平均阅读量
};

/**
 * 多维度评分
 */
function scoreResource(resource, draft, context) {
  const raw = jsonParse(resource.raw_json, {});
  let score = 0;

  // 1. 行业精确匹配（40 分）
  // 从文章标题/内容提取行业，与资源的结构化行业标签取交集
  const articleIndustries = extractArticleIndustryKeywords(
    text(draft.draft?.title),
    text(draft.draft?.content),
  );
  const resourceIndustries = getResourceIndustryTags(resource);
  const industryOverlap = articleIndustries.filter((ind) => resourceIndustries.includes(ind));
  if (industryOverlap.length > 0) {
    // 命中 1 个行业得 20 分，2 个得 30 分，3 个及以上得满分
    score += Math.min(20 + (industryOverlap.length - 1) * 10, SCORE_WEIGHTS.INDUSTRY_EXACT);
  } else if (articleIndustries.length === 0) {
    // 文章无法识别行业时，给一个基础分避免完全不匹配
    score += 5;
  }

  // 2. 推荐平台匹配（20 分）— 单向匹配
  const recommendedChannels = getRecommendedChannels(draft);
  const resourceName = text(resource.name).toLowerCase();
  const platformName = text(raw.platform_name || '').toLowerCase();
  for (const channel of recommendedChannels) {
    const channelLower = channel.toLowerCase();
    if (
      channelLower.includes(resourceName) ||
      resourceName.includes(channelLower) ||
      channelLower.includes(platformName)
    ) {
      score += SCORE_WEIGHTS.RECOMMENDATION;
      break;
    }
  }

  // 3. GEO 标识（15 分）
  if (hasGeoTag(resource)) {
    score += SCORE_WEIGHTS.GEO_TAG;
  }

  // 4. 出稿率（15 分）
  const publishRate = Number(raw.published_rate || raw.publish_rate || 0);
  if (publishRate > 0) {
    score += Math.min(publishRate * 0.15, SCORE_WEIGHTS.PUBLISH_RATE);
  }

  // 5. 平均阅读量（10 分）
  const avgReads = Number(raw.avg_reads || raw.average_reads || 0);
  if (avgReads > 0) {
    score += Math.min(avgReads / 10, SCORE_WEIGHTS.AVG_READS);
  }

  return {
    score,
    industryOverlap,
    hasGeo: hasGeoTag(resource),
    publishRate,
    avgReads,
  };
}

// ─── AI 推荐 ───

/**
 * 压缩资源列表为摘要文本，减少 token 消耗
 */
function compressResourceSummary(resource) {
  const raw = jsonParse(resource.raw_json, {});
  const industryTags = getResourceIndustryTags(resource);
  const geo = hasGeoTag(resource) ? '是' : '否';
  const rate = Number(raw.published_rate || raw.publish_rate || 0) || '-';
  const reads = Number(raw.avg_reads || raw.average_reads || 0) || '-';
  const remark = text(raw.remark || '').slice(0, 30);
  return [
    `ID:${resource.resource_id}`,
    text(resource.name),
    `平台:${text(raw.platform_name || resource.resource_type)}`,
    `价格:¥${Number(resource.price || 0).toFixed(0)}`,
    `出稿率:${rate}%`,
    `阅读量:${reads}`,
    `行业:${industryTags.join(',') || '未知'}`,
    `GEO:${geo}`,
    remark ? `备注:${remark}` : '',
  ].filter(Boolean).join(' | ');
}

/**
 * 阶段一：AI 分析文章行业
 * @returns {Object} { "1": "食品", "2": "汽车", ... }
 */
async function classifyArticleIndustries(drafts) {
  const LOG = '[autoPublish]';
  const articleList = drafts.map((draft, i) => {
    const title = text(draft.draft?.title);
    const content = text(draft.draft?.content).slice(0, 200);
    return `${i + 1}. 标题: ${title}\n   内容摘要: ${content}`;
  });

  const prompt = `分析以下文章的所属行业。从这些行业分类中选择最匹配的：食品、汽车、房产、教育、医疗、科技、金融、美妆、母婴、服装、体育、游戏、旅游、房产家居、娱乐。

## 文章列表
${articleList.join('\n')}

## 返回格式
严格返回 JSON，不要其他内容：
{ "1": "食品", "2": "汽车", ... }
编号对应文章序号。`;

  console.log(`${LOG} [行业分析] 调用 AI 分析 ${drafts.length} 篇文章的行业...`);
  console.log(`${LOG} [行业分析] === Prompt ===`);
  console.log(prompt);
  console.log(`${LOG} [行业分析] === Prompt 结束 ===`);

  try {
    const result = await llmGateway.chatJson({
      provider: 'deepseek',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });
    const json = result?.json;
    if (json && typeof json === 'object') {
      console.log(`${LOG} [行业分析] 结果:`);
      for (const [idx, industry] of Object.entries(json)) {
        console.log(`${LOG}   文章${idx} → ${industry}`);
      }
      return json;
    }
    return null;
  } catch (error) {
    console.warn(`${LOG} [行业分析] 失败: ${error.message || String(error)}`);
    return null;
  }
}

/**
 * 根据行业关键词搜索资源（使用 SQL LIKE，和手动搜索逻辑一致）
 * @returns {Array} 匹配的资源列表
 */
function searchResourcesByIndustry(industry, resourceType = 'all', maxPrice = null) {
  const types = resourceType === 'all' ? ['media', 'we-media'] : [resourceType];
  const results = [];

  for (const type of types) {
    const matched = chaojimeijieService.searchResources({
      resourceType: type,
      status: 2,
      query: industry,
      limit: 500,
      maxPrice,
    });
    results.push(...matched);
  }

  // 过滤测试资源
  return results.filter((r) => {
    const name = text(r.name).toLowerCase();
    return !name.includes('测试') && !name.includes('test');
  });
}

/**
 * 根据行业标签过滤资源
 * 先用 SQL LIKE 搜索名称匹配的资源，再补充结构化标签匹配的资源
 */
function filterResourcesByIndustry(resources, industryMap, maxPrice = null) {
  const industries = [...new Set(Object.values(industryMap).map((i) => String(i).toLowerCase()))];
  if (industries.length === 0) return resources;

  console.log(`[autoPublish] [行业过滤] 行业关键词: ${industries.join(',')}`);

  // 1. 用 SQL LIKE 搜索每个行业关键词（和手动搜索一致）
  const sqlMatches = new Map();
  for (const industry of industries) {
    const found = searchResourcesByIndustry(industry, 'all', maxPrice);
    console.log(`[autoPublish] [行业过滤] SQL搜索"${industry}": ${found.length} 个`);
    for (const r of found) {
      sqlMatches.set(r.resource_id, r);
    }
  }

  // 2. 在传入的资源列表中补充结构化标签匹配的
  for (const resource of resources) {
    if (sqlMatches.has(resource.resource_id)) continue;
    const tags = getResourceIndustryTags(resource).map((t) => t.toLowerCase());
    if (industries.some((ind) => tags.some((tag) => tag.includes(ind) || ind.includes(tag)))) {
      sqlMatches.set(resource.resource_id, resource);
    }
  }

  const result = [...sqlMatches.values()];
  console.log(`[autoPublish] [行业过滤] 最终匹配: ${result.length} 个`);
  for (const r of result) {
    console.log(`[autoPublish] [行业过滤]   ${text(r.name)} (ID:${r.resource_id}, ¥${Number(r.price || 0).toFixed(0)})`);
  }

  return result;
}

/**
 * 调用 AI 为批量文章推荐发稿渠道（两步法：行业分析 → 精准推荐）
 * @returns {Object} { articleIndex: [{ id, reason }] }
 */
async function getAiRecommendations(drafts, resources, publishedOrders, context, maxPrice = null) {
  const LOG = '[autoPublish]';
  console.log(`\n${LOG} ========== AI 推荐流程开始 ==========`);

  // ── 阶段 1：API Key 检查 ──
  const deepseekKey = text(process.env.DEEPSEEK_API_KEY);
  console.log(`${LOG} [阶段1] API Key 检查: ${deepseekKey ? '已配置' : '未配置 → 跳过 AI'}`);
  if (!deepseekKey) {
    console.log(`${LOG} ========== AI 推荐流程结束（无 Key）==========\n`);
    return null;
  }

  // ── 阶段 2：AI 行业分析 ──
  console.log(`${LOG} [阶段2] AI 行业分析...`);
  const industryMap = await classifyArticleIndustries(drafts);
  if (!industryMap) {
    console.log(`${LOG} [阶段2] 行业分析失败，跳过 AI 推荐`);
    console.log(`${LOG} ========== AI 推荐流程结束（行业分析失败）==========\n`);
    return null;
  }

  // ── 阶段 3：按行业过滤资源 ──
  const matchedResources = filterResourcesByIndustry(resources, industryMap, maxPrice);
  console.log(`${LOG} [阶段3] 行业过滤: ${resources.length} → ${matchedResources.length} 个相关资源`);
  for (const line of matchedResources.map(compressResourceSummary)) {
    console.log(`${LOG}   ${line}`);
  }

  if (matchedResources.length === 0) {
    console.log(`${LOG} [阶段3] 无行业匹配资源，跳过 AI 推荐`);
    console.log(`${LOG} ========== AI 推荐流程结束（无匹配资源）==========\n`);
    return null;
  }

  // ── 阶段 4：构建精准推荐 Prompt ──
  const articleSummaries = drafts.map((draft, index) => {
    const title = text(draft.draft?.title);
    const role = text(draft.draft?.article_role) || draft.article_type || 'support';
    const industry = industryMap[String(index + 1)] || '未知';
    return `${index + 1}. ${title} | 类型:${role} | 行业:${industry}`;
  });

  const resourceSummaries = matchedResources.map(compressResourceSummary);

  const prompt = `你是媒体投放专家。以下文章已确定行业分类，资源列表已按行业筛选。请为每篇文章推荐 3-4 个发稿渠道（优先级从高到低，排在前面的优先使用）。

## 文章列表（已标注行业）
${articleSummaries.join('\n')}

## 行业匹配资源列表
${resourceSummaries.join('\n')}

## 企业信息
公司：${context.company || '未知'}
关键词：${context.keywords || '未知'}

## 选择规则
1. 从行业匹配的资源中选择最合适的
2. 有 GEO 标识的优先（收录率高）
3. 出稿率高的优先
4. 阅读量高的优先
5. 同一资源不能同时推荐给多篇同类型文章

## 返回格式
严格返回 JSON，不要其他内容：
{ "1": [{"id": 100, "reason": "最匹配行业"}, {"id": 200, "reason": "次匹配"}], "2": [{"id": 300, "reason": "..."}] }
每篇文章至少推荐3个渠道，编号对应文章序号，数组按优先级排序。`;

  console.log(`${LOG} [阶段4] Prompt 构建完成: 长度=${prompt.length} 字符`);
  console.log(`${LOG} [阶段4] === 完整 Prompt ===`);
  console.log(prompt);
  console.log(`${LOG} [阶段4] === Prompt 结束 ===`);

  // ── 阶段 5：调用 AI 推荐 ──
  console.log(`${LOG} [阶段5] 调用模型: deepseek/${process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'}`);
  const startTime = Date.now();
  try {
    const result = await llmGateway.chatJson({
      provider: 'deepseek',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    const elapsed = Date.now() - startTime;
    console.log(`${LOG} [阶段5] AI 响应耗时: ${elapsed}ms`);
    console.log(`${LOG} [阶段5] 原始响应:`, JSON.stringify(result, null, 2));

    // ── 阶段 6：解析响应 ──
    const json = result?.json;
    if (json && typeof json === 'object') {
      console.log(`${LOG} [阶段6] 解析成功: ${Object.keys(json).length} 篇文章有推荐`);
      for (const [articleIdx, recs] of Object.entries(json)) {
        if (Array.isArray(recs)) {
          for (const rec of recs) {
            const matchedResource = matchedResources.find((r) => r.resource_id === Number(rec.id));
            const name = matchedResource ? matchedResource.name : '未知资源';
            console.log(`${LOG}   文章${articleIdx} → ID:${rec.id}(${name}) 理由:${rec.reason || '无'}`);
          }
        }
      }
      console.log(`${LOG} ========== AI 推荐流程结束（成功）==========\n`);
      return { recommendations: json, matchedResources };
    }
    console.warn(`${LOG} [阶段6] AI 返回非对象:`, typeof json, result);
    console.log(`${LOG} ========== AI 推荐流程结束（解析失败）==========\n`);
    return null;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.warn(`${LOG} [阶段5] AI 调用失败 (${elapsed}ms): ${error.message || String(error)}`);
    console.log(`${LOG} ========== AI 推荐流程结束（异常）==========\n`);
    return null;
  }
}

// ─── 资源选择 ───

/**
 * 通过 AI 推荐选择最佳资源（直接从行业匹配资源中查找，不再依赖 availableResources）
 */
function selectByAiRecommendation(articleIndex, aiRecommendations, matchedResources, publishedOrders, batchUsedIds) {
  const recommendations = aiRecommendations[String(articleIndex + 1)];
  if (!Array.isArray(recommendations) || recommendations.length === 0) return null;

  for (const rec of recommendations) {
    const resourceId = Number(rec.id);
    if (!resourceId) continue;
    // 批次内去重
    if (batchUsedIds && batchUsedIds.has(resourceId)) continue;
    const resource = matchedResources.find((r) => r.resource_id === resourceId);
    if (!resource) continue;
    // 检查历史去重
    if (publishedOrders.some((o) => {
      if (o.resource_id !== resourceId) return false;
      const code = Number(o.status_code);
      if (TERMINAL_STATUS_CODES.has(code)) return false;
      const draft = getDraftById(o.article_id);
      return draft && draft.article_type === resource.article_type;
    })) continue;
    return resource;
  }
  return null;
}

/**
 * 为单篇稿件选择最佳媒体资源（关键词匹配 fallback）
 */
function selectByKeywordMatch(draft, availableResources, publishedOrders, context, batchUsedIds) {
  const recommendedChannels = getRecommendedChannels(draft);
  let candidates = matchRecommendedWithAvailable(recommendedChannels, availableResources);
  if (candidates.length === 0) {
    candidates = availableResources;
  }
  candidates = candidates.filter(
    (resource) => !shouldSkipResource(resource, draft, publishedOrders)
      && !(batchUsedIds && batchUsedIds.has(resource.resource_id)),
  );
  if (candidates.length === 0) return null;
  const scored = candidates.map((resource) => ({
    resource,
    ...scoreResource(resource, draft, context),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.resource || null;
}

// ─── 批量自动发布 ───

/**
 * 批量自动发布稿件
 */
async function autoPublishArticles(projectId, options = {}) {
  const { dryRun = false, maxArticles = 50, articleRole = 'support' } = options;
  const maxPrice = Number(options.maxPrice || process.env.AUTO_PUBLISH_MAX_PRICE || 10);

  // 1. 获取该项目所有待发布的稿件
  const { drafts } = articlePublishService.listArticleDrafts(projectId, {
    article_role: articleRole,
  });

  // 2. 获取已发布的订单（用于去重）
  const publishedOrders = getPublishedOrders(projectId);

  // 3. 获取企业上下文
  const context = getEnterpriseContext(projectId);

  // 4. 筛选待发布稿件
  const toPublish = drafts.filter((d) => {
    const role = text(d.draft?.article_role);
    const roleMatch = role === articleRole || (!role && d.article_type?.includes(articleRole));
    const status = text(d.draft?.publication_evidence?.status || d.status);
    const statusMatch = !['published', 'publishing', 'archived'].includes(status);
    return roleMatch && statusMatch;
  }).slice(0, maxArticles);

  // 5. 获取可用资源（含价格过滤）
  const availableResources = getAvailableResources('all', maxPrice);

  // 6. 尝试 AI 批量推荐
  let aiRecommendations = null;
  let matchedResources = [];
  if (toPublish.length > 0) {
    const aiResult = await getAiRecommendations(toPublish, availableResources, publishedOrders, context, maxPrice);
    if (aiResult) {
      aiRecommendations = aiResult.recommendations;
      matchedResources = aiResult.matchedResources;
      console.log(`[autoPublish] AI 推荐成功，覆盖 ${Object.keys(aiRecommendations).length} 篇文章`);
    } else {
      console.log('[autoPublish] AI 推荐未返回结果，使用关键词匹配');
    }
  }

  // 7. 逐篇匹配资源并发布
  const results = [];
  const batchUsedResourceIds = new Set(); // 批次内去重：已选资源不再分配
  for (let i = 0; i < toPublish.length; i++) {
    const draft = toPublish[i];
    const title = text(draft.draft?.title);
    try {
      // 自动标记为已校对（生成OSS预览）
      const publishStatus = text(draft.draft?.publication_evidence?.status || draft.status);
      if (['draft', 'confirmed'].includes(publishStatus)) {
        await articlePublishService.markArticleReviewed(draft.id);
      }

      // 选择最佳资源：优先 AI 推荐（直接从行业匹配资源中取），失败时回退到关键词匹配
      let resource = null;
      let selectMethod = '';
      if (aiRecommendations) {
        resource = selectByAiRecommendation(i, aiRecommendations, matchedResources, publishedOrders, batchUsedResourceIds);
        if (resource) selectMethod = 'AI推荐';
      }
      if (!resource) {
        resource = selectByKeywordMatch(draft, availableResources, publishedOrders, context, batchUsedResourceIds);
        if (resource) selectMethod = '关键词匹配';
      }
      if (!resource) {
        console.log(`[autoPublish] [${i + 1}/${toPublish.length}] "${title}" → 跳过（无匹配资源）`);
        results.push({
          draftId: draft.id,
          title: text(draft.draft?.title),
          status: 'skipped',
          reason: '没有匹配的资源',
        });
        continue;
      }

      console.log(`[autoPublish] [${i + 1}/${toPublish.length}] "${title}" → ${selectMethod} → ${resource.name} (ID:${resource.resource_id}, ¥${Number(resource.price || 0).toFixed(0)})`);

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
      batchUsedResourceIds.add(resource.resource_id);
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
  getRecommendedChannels,
  matchRecommendedWithAvailable,
  shouldSkipResource,
  scoreResource,
  getEnterpriseContext,
  getAvailableResources,
  extractArticleIndustryKeywords,
  getResourceIndustryTags,
  hasGeoTag,
};
