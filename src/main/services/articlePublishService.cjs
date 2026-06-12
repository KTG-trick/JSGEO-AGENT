const { getDb } = require('./databaseService.cjs');
const articleDraftService = require('./articleDraftService.cjs');
const chaojimeijieService = require('./chaojimeijieService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const ossPreviewService = require('./ossPreviewService.cjs');
const publishRecommendationService = require('./publishRecommendationService.cjs');
const { fieldText } = require('./profileFieldService.cjs');
const orderRules = require('../../shared/chaojimeijieOrderRules.cjs');

const PUBLISH_STATUSES = new Set(['draft', 'reviewed', 'scheduled', 'publishing', 'published', 'failed', 'confirmed']);

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

function normalizeForPreviewCheck(value) {
  return text(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function projectIdFromGeoId(value) {
  return String(value || '').replace(/^geo-/, '');
}

function getLatestPublishOrder(articleId) {
  const row = getDb().prepare(`
    SELECT *
    FROM publish_orders
    WHERE article_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(articleId);
  if (!row) return null;
  const resourceRow = getDb().prepare(`
    SELECT *
    FROM publish_resources
    WHERE provider = ? AND resource_type = ? AND resource_id = ?
    LIMIT 1
  `).get(row.provider, row.resource_type, Number(row.resource_id));
  return {
    id: row.id,
    provider: row.provider,
    resource_type: row.resource_type,
    partner_sn: row.partner_sn,
    external_sn: row.external_sn,
    resource_id: row.resource_id,
    preview_url: row.preview_url,
    status_code: row.status_code,
    published_url: row.published_url,
    feedback: jsonParse(row.feedback_json, null),
    raw: jsonParse(row.raw_json, null),
    resource: resourceRow ? {
      id: resourceRow.id,
      provider: resourceRow.provider,
      resource_type: resourceRow.resource_type,
      resource_id: resourceRow.resource_id,
      name: resourceRow.name,
      price: resourceRow.price,
      status: resourceRow.status,
      raw: jsonParse(resourceRow.raw_json, null),
    } : null,
    last_synced_at: row.last_synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
    publish_order: getLatestPublishOrder(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function articleRoleOf(draft) {
  return text(draft?.draft?.article_role || draft?.draft?.articleRole);
}

function publicationOf(draft) {
  return draft?.draft?.publication_evidence || {};
}

function listArticleDrafts(projectIdOrGeoId, filters = {}) {
  const projectId = projectIdFromGeoId(projectIdOrGeoId);
  if (!projectId) throw new Error('projectId is required.');

  const rows = getDb().prepare(`
    SELECT * FROM geo_article_drafts
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(projectId);

  let drafts = rows.map(rowToDraft);
  const status = text(filters.status);
  const role = text(filters.article_role || filters.role);
  const platform = text(filters.platform);

  if (!filters.include_archived) {
    drafts = drafts.filter((draft) => {
      const publishStatus = text(publicationOf(draft).status || draft.status);
      return publishStatus !== 'archived' && draft.status !== 'archived';
    });
  }
  if (platform) drafts = drafts.filter((draft) => draft.platform === platform);
  if (status) {
    drafts = drafts.filter((draft) => {
      const publishStatus = text(publicationOf(draft).status || draft.status);
      return publishStatus === status || draft.status === status;
    });
  }
  if (role) drafts = drafts.filter((draft) => articleRoleOf(draft) === role);

  const summary = drafts.reduce((acc, draft) => {
    const publishStatus = text(publicationOf(draft).status || draft.status || 'draft');
    const roleKey = articleRoleOf(draft) || 'unknown_role';
    acc.total += 1;
    acc[publishStatus] = (acc[publishStatus] || 0) + 1;
    acc.by_role[roleKey] = (acc.by_role[roleKey] || 0) + 1;
    return acc;
  }, { total: 0, by_role: {} });

  return { project_id: projectId, drafts, summary };
}

function saveDraftWithStatus(articleId, draftPatch, status = null) {
  const current = articleDraftService.getArticleDraft(articleId);
  const nextDraft = {
    ...current.draft,
    ...draftPatch,
    publication_evidence: {
      ...(current.draft.publication_evidence || {}),
      ...(draftPatch.publication_evidence || {}),
    },
  };
  const nextStatus = text(status || draftPatch.status || current.status);
  getDb().prepare(`
    UPDATE geo_article_drafts
    SET draft_json = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(jsonString(nextDraft), nextStatus, nowIso(), articleId);
  return articleDraftService.getArticleDraft(articleId);
}

function updateArticleDraft(articleId, patch = {}) {
  return articleDraftService.updateArticleDraft(articleId, patch);
}

function buildPreviewInput(draft) {
  const profile = knowledgeService.getKnowledgeProfile(draft.enterprise_project_id).profile || {};
  const owner = fieldText(profile, 'company_name') || fieldText(profile, 'short_name') || '';
  const title = text(draft.draft.title);
  const content = text(draft.draft.content);
  if (!title || !content) throw new Error('稿件标题和正文不能为空。');
  return { owner, title, content };
}

async function prepareArticlePreview(articleId) {
  const draft = articleDraftService.getArticleDraft(articleId);
  const existing = publicationOf(draft);
  if (existing.preview_url && existing.preview_object_key && /\.html?$/i.test(existing.preview_object_key)) {
    const url = ossPreviewService.getPreviewUrl(existing.preview_object_key);
    if (url !== existing.preview_url) {
      const nextDraft = saveDraftWithStatus(articleId, {
        publication_evidence: {
          ...(draft.draft.publication_evidence || {}),
          preview_url: url,
        },
      }, draft.status);
      return {
        url,
        object_key: existing.preview_object_key,
        draft: nextDraft,
      };
    }
    return {
      url,
      object_key: existing.preview_object_key,
      draft,
    };
  }
  const previewInput = buildPreviewInput(draft);
  const preview = await ossPreviewService.uploadPreview({
    projectId: draft.enterprise_project_id,
    articleId: draft.id,
    ...previewInput,
  });
  const nextDraft = saveDraftWithStatus(articleId, {
    publication_evidence: {
      ...(draft.draft.publication_evidence || {}),
      preview_url: preview.url,
      preview_object_key: preview.object_key,
      preview_generated_at: nowIso(),
    },
  }, draft.status);
  return {
    ...preview,
    draft: nextDraft,
  };
}

function getArticlePreviewHtml(articleId) {
  const draft = articleDraftService.getArticleDraft(articleId);
  const previewInput = buildPreviewInput(draft);
  return ossPreviewService.getPreviewHtml(previewInput);
}

async function assertPreviewReadable(previewUrl, { title, content }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(previewUrl, { method: 'GET', signal: controller.signal });
  } catch (error) {
    throw new Error(`稿件预览 URL 无法访问，已停止投递：${error.message || String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`稿件预览 URL 返回 ${response.status}，已停止投递。`);
  }
  const contentDisposition = text(response.headers?.get?.('content-disposition')).toLowerCase();
  if (contentDisposition.includes('attachment')) {
    throw new Error('稿件预览 URL 会触发下载，不是在线预览，已停止投递。');
  }
  const contentType = text(response.headers?.get?.('content-type')).toLowerCase();
  if (!contentType.includes('text/html')) {
    throw new Error(`稿件预览 URL 不是 HTML 页面（${contentType || '未返回 Content-Type'}），已停止投递。`);
  }
}

async function deleteArticleOssPreview(articleId) {
  const draft = articleDraftService.getArticleDraft(articleId);
  const existing = publicationOf(draft);
  if (!existing.preview_object_key) {
    return { success: true, message: '没有需要删除的预览文件' };
  }
  const result = await ossPreviewService.deletePreview(existing.preview_object_key);
  saveDraftWithStatus(articleId, {
    publication_evidence: {
      ...(draft.draft.publication_evidence || {}),
      preview_url: null,
      preview_object_key: null,
      preview_generated_at: null,
    },
  }, draft.status);
  return result;
}

async function markArticleReviewed(articleId) {
  const preview = await prepareArticlePreview(articleId);
  return saveDraftWithStatus(articleId, {
    publication_evidence: {
      status: 'reviewed',
      reviewed_at: nowIso(),
      preview_url: preview.url,
      preview_object_key: preview.object_key,
    },
  }, 'reviewed');
}

/**
 * 计算排行榜发布配额
 * 规则：每发布 1 篇支撑稿 → 可发布 1 篇排行榜稿
 * @returns {{ allowed: number, published: number, remaining: number }}
 *   allowed - 允许发布的排行榜总数（= 已校对/已发布的支撑稿数）
 *   published - 已提交或已发布的排行榜稿数（已占配额）
 *   remaining - 剩余可发布配额
 */
function getRankedPublishQuota(projectId, platform) {
  // 统计已校对/已发布的支撑稿数量 → 允许发布的排行榜数量
  const { drafts: supportDrafts } = listArticleDrafts(projectId, { platform, article_role: 'support' });
  const publishedSupport = supportDrafts.filter((draft) => {
    const s = text(publicationOf(draft).status || draft.status);
    return ['reviewed', 'published'].includes(s);
  }).length;

  // 已提交/已发布的排行榜稿数量 → 已占用配额
  const { drafts: rankDrafts } = listArticleDrafts(projectId, { platform, article_role: 'ranking' });
  const submittedRanking = rankDrafts.filter((draft) => {
    const s = text(publicationOf(draft).status || draft.status);
    return ['publishing', 'published'].includes(s);
  }).length;

  const allowed = publishedSupport;
  return { allowed, published: submittedRanking, remaining: Math.max(0, allowed - submittedRanking) };
}

function supportPublishingReady(projectId, platform) {
  const { remaining } = getRankedPublishQuota(projectId, platform);
  return remaining > 0;
}

function buildPublishPayload(draft) {
  const profile = knowledgeService.getKnowledgeProfile(draft.enterprise_project_id).profile || {};
  return {
    adapter_id: 'external_api_pending',
    article_id: draft.id,
    project_id: draft.enterprise_project_id,
    platform: draft.platform,
    title: draft.draft.title || '',
    markdown: draft.draft.content || '',
    article_role: draft.draft.article_role || '',
    article_type: draft.draft.article_type || draft.article_type,
    target_question: draft.draft.target_question || '',
    mapped_question_ids: draft.draft.mapped_question_ids || [],
    suggested_channel: draft.draft.suggested_channel || draft.draft.publish_target || '',
    enterprise: {
      company_name: fieldText(profile, 'company_name') || fieldText(profile, 'short_name'),
      business_regions: fieldText(profile, 'business_regions'),
      industry_category: fieldText(profile, 'industry_category'),
      target_keywords: fieldText(profile, 'target_keywords'),
    },
    generated_at: nowIso(),
  };
}

async function publishViaChaojimeijie(draft, options = {}) {
  const resourceType = options.resourceType === 'we-media' ? 'we-media' : 'media';
  const resourceId = Number(options.resourceId);
  if (!resourceId) throw new Error('请选择超级媒介资源后再投递。');
  const existingOrder = chaojimeijieService.getLatestOrderByArticle(draft.id);
  if (existingOrder && !orderRules.canCreateNewOrder(existingOrder)) {
    const statusLabel = orderRules.statusLabel(existingOrder.status_code);
    throw new Error(`当前稿件已有超级媒介订单（${existingOrder.partner_sn}，${statusLabel}），不能重复投递。请先同步或处理该订单。`);
  }

  const { owner, title, content } = buildPreviewInput(draft);
  const preview = await prepareArticlePreview(draft.id);
  await assertPreviewReadable(preview.url, { title, content });
  const remark = text(options.remark)
    || `${articleRoleOf(draft) || 'article'}: ${text(draft.draft.target_question).slice(0, 120)}`;
  let order;
  try {
    order = await chaojimeijieService.createOrder({
      articleId: draft.id,
      projectId: draft.enterprise_project_id,
      resourceType,
      resourceId,
      title,
      previewUrl: preview.url,
      remark,
      owner,
      publishLimited: options.publishLimited,
      publishForm: options.publishForm,
      publishType: options.publishType,
      accountRule: options.accountRule,
    });
  } catch (error) {
    saveDraftWithStatus(draft.id, {
      publication_evidence: {
        ...(draft.draft.publication_evidence || {}),
        status: 'failed',
        adapter_id: 'chaojimeijie',
        provider: 'chaojimeijie',
        resource_type: resourceType,
        resource_id: resourceId,
        preview_url: preview.url,
        preview_object_key: preview.object_key,
        failed_at: nowIso(),
        failure_reason: error.message || String(error),
      },
    }, 'failed');
    throw error;
  }

  return saveDraftWithStatus(draft.id, {
    publication_evidence: {
      ...(draft.draft.publication_evidence || {}),
      status: 'publishing',
      adapter_id: 'chaojimeijie',
      provider: 'chaojimeijie',
      resource_type: resourceType,
      resource_id: resourceId,
      partner_sn: order.partner_sn,
      external_sn: order.external_sn,
      preview_url: preview.url,
      preview_object_key: preview.object_key,
      submitted_at: nowIso(),
      published_url: publicationOf(draft).published_url || null,
      published_platform: publicationOf(draft).published_platform || null,
      published_at: publicationOf(draft).published_at || null,
    },
  }, 'publishing');
}

async function publishArticle(articleId, adapterId = 'external_api_pending', options = {}) {
  const draft = articleDraftService.getArticleDraft(articleId);
  if (articleRoleOf(draft) === 'ranking') {
    const quota = getRankedPublishQuota(draft.enterprise_project_id, draft.platform);
    if (quota.remaining <= 0) {
      throw new Error(
        quota.published >= 3
          ? '排行榜稿件已达上限（3篇），无法继续发布。'
          : `当前已发布 ${quota.published} 篇支撑稿，可发布 ${quota.allowed} 篇排行榜稿，已全部投递。请先发布更多支撑稿。`
      );
    }
  }
  if (adapterId === 'chaojimeijie') {
    return publishViaChaojimeijie(draft, options);
  }
  if (adapterId !== 'external_api_pending') {
    throw new Error(`发布适配器 ${adapterId} 尚未接入。`);
  }
  const payload = buildPublishPayload(draft);
  return saveDraftWithStatus(articleId, {
    publication_evidence: {
      status: 'publishing',
      adapter_id: adapterId,
      publish_payload: payload,
      submitted_at: nowIso(),
      published_url: publicationOf(draft).published_url || null,
      published_platform: publicationOf(draft).published_platform || payload.suggested_channel || null,
      published_at: publicationOf(draft).published_at || null,
    },
  }, 'publishing');
}

function syncPublishStatus(articleId) {
  const draft = articleDraftService.getArticleDraft(articleId);
  return {
    ...draft,
    sync_status: 'manual_or_external_pending',
    message: '当前适配器等待外部发布平台回调或人工回填 URL。',
  };
}

function recordPublishedUrl(articleId, payload = {}) {
  const publishedUrl = text(payload.published_url || payload.url);
  if (!/^https?:\/\//i.test(publishedUrl)) {
    throw new Error('published_url 必须是 http 或 https URL。');
  }
  const draft = articleDraftService.getArticleDraft(articleId);
  return saveDraftWithStatus(articleId, {
    publication_evidence: {
      ...(draft.draft.publication_evidence || {}),
      status: 'published',
      published_url: publishedUrl,
      published_platform: text(payload.published_platform || payload.platform) || publicationOf(draft).published_platform || null,
      published_at: text(payload.published_at) || nowIso(),
      external_id: text(payload.external_id) || publicationOf(draft).external_id || null,
    },
  }, 'published');
}

function applySyncedOrderToDraft(articleId, order) {
  const draft = articleDraftService.getArticleDraft(articleId);
  const publishStatus = chaojimeijieService.mapOrderStatus(order.status_code);
  return saveDraftWithStatus(articleId, {
    publication_evidence: {
      ...(draft.draft.publication_evidence || {}),
      status: publishStatus,
      adapter_id: 'chaojimeijie',
      provider: 'chaojimeijie',
      resource_type: order.resource_type,
      resource_id: order.resource_id,
      partner_sn: order.partner_sn,
      external_sn: order.external_sn,
      preview_url: order.preview_url,
      status_code: order.status_code,
      feedback: order.feedback || null,
      last_synced_at: order.last_synced_at || nowIso(),
      published_url: order.published_url || publicationOf(draft).published_url || null,
      published_platform: order.published_url ? '超级媒介' : publicationOf(draft).published_platform || null,
      published_at: order.raw?.published_at || publicationOf(draft).published_at || (order.published_url ? nowIso() : null),
    },
  }, publishStatus);
}

async function syncPublishOrder(articleId) {
  const order = await chaojimeijieService.syncOrderByArticle(articleId);
  return applySyncedOrderToDraft(articleId, order);
}

async function syncPublishOrders(projectIdOrGeoId) {
  const projectId = projectIdFromGeoId(projectIdOrGeoId);
  const synced = await chaojimeijieService.syncOrdersByProject(projectId);
  const orders = Array.isArray(synced) ? synced : synced.orders || [];
  return {
    project_id: projectId,
    drafts: orders.map((order) => applySyncedOrderToDraft(order.article_id, order)),
    errors: Array.isArray(synced?.errors) ? synced.errors : [],
  };
}

async function managePublishOrder(articleId, action, payload = {}) {
  const order = chaojimeijieService.getLatestOrderByArticle(articleId);
  if (!order) {
    throw new Error('当前稿件还没有超级媒介订单。');
  }
  const updatedOrder = await chaojimeijieService.manageOrder(order, action, payload);
  return applySyncedOrderToDraft(articleId, updatedOrder);
}

async function syncChaojimeijieResources(resourceType = 'media', page = 1, size = 200) {
  return chaojimeijieService.syncResources(resourceType, page, size);
}

function listPublishResources(filters = {}) {
  return {
    provider: 'chaojimeijie',
    resource_type: filters.resourceType || filters.resource_type || 'media',
    resources: chaojimeijieService.listResources(filters),
  };
}

function recommendPublishResources(articleId, options = {}) {
  return publishRecommendationService.recommendPublishResources(articleId, options);
}

module.exports = {
  PUBLISH_STATUSES,
  getRankedPublishQuota,
  assertPreviewReadable,
  listArticleDrafts,
  listPublishResources,
  managePublishOrder,
  updateArticleDraft,
  markArticleReviewed,
  prepareArticlePreview,
  getArticlePreviewHtml,
  deleteArticleOssPreview,
  publishArticle,
  recommendPublishResources,
  syncPublishStatus,
  syncChaojimeijieResources,
  syncPublishOrder,
  syncPublishOrders,
  recordPublishedUrl,
};
