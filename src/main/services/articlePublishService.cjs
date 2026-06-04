const { getDb } = require('./databaseService.cjs');
const articleDraftService = require('./articleDraftService.cjs');
const chaojimeijieService = require('./chaojimeijieService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const ossPreviewService = require('./ossPreviewService.cjs');
const publishRecommendationService = require('./publishRecommendationService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

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
  if (existing.preview_url && existing.preview_object_key) {
    return {
      url: existing.preview_url,
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

function supportPublishingReady(projectId, platform) {
  const { drafts } = listArticleDrafts(projectId, { platform, article_role: 'support' });
  const supportDrafts = drafts.filter((draft) => articleRoleOf(draft) === 'support');
  const ready = supportDrafts.filter((draft) => {
    const status = text(publicationOf(draft).status || draft.status);
    return ['reviewed', 'published'].includes(status);
  });
  return supportDrafts.length >= 6 && ready.length >= 6;
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

  const { owner, title } = buildPreviewInput(draft);
  const preview = await prepareArticlePreview(draft.id);
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
  if (articleRoleOf(draft) === 'ranking' && !supportPublishingReady(draft.enterprise_project_id, draft.platform)) {
    throw new Error('请先将 6 篇支撑稿标记为已校对或已发布，再投递排行榜稿。');
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
  const orders = await chaojimeijieService.syncOrdersByProject(projectId);
  return {
    project_id: projectId,
    drafts: orders.map((order) => applySyncedOrderToDraft(order.article_id, order)),
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
  listArticleDrafts,
  listPublishResources,
  managePublishOrder,
  updateArticleDraft,
  markArticleReviewed,
  prepareArticlePreview,
  publishArticle,
  recommendPublishResources,
  syncPublishStatus,
  syncChaojimeijieResources,
  syncPublishOrder,
  syncPublishOrders,
  recordPublishedUrl,
};
