const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');

const PROVIDER = 'chaojimeijie';
const API_BASE_URL = 'https://vip.chaojimeijie.com/api';
const ORDER_STATUS_MAP = {
  1: 'publishing',
  2: 'failed',
  3: 'publishing',
  4: 'published',
  5: 'failed',
  6: 'failed',
  7: 'failed',
  8: 'failed',
  9: 'failed',
  10: 'publishing',
  11: 'published',
  12: 'published',
};

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

function jsonString(value) {
  return JSON.stringify(value ?? null);
}

function requiredEnv(name) {
  const value = text(process.env[name]);
  if (!value) {
    throw new Error(`缺少 ${name}，无法调用超级媒介 API。`);
  }
  return value;
}

function normalizeResourceType(value) {
  return value === 'we-media' ? 'we-media' : 'media';
}

function endpointFor(resourceType, action) {
  const prefix = normalizeResourceType(resourceType) === 'we-media' ? '/we-media' : '/media';
  if (action === 'resource') return `${prefix}/resource`;
  if (action === 'resource-query') return `${prefix}/resource/query`;
  if (action === 'order') return `${prefix}/order`;
  if (action === 'order-query') return `${prefix}/order/query`;
  if (action === 'order-urge') return `${prefix}/order/urge`;
  if (action === 'order-cancel') return `${prefix}/order/cancel`;
  if (action === 'order-refund') return `${prefix}/order/apply-refund`;
  if (action === 'order-republish' && prefix === '/media') return `${prefix}/order/apply-republish`;
  throw new Error(`Unknown chaojimeijie action: ${action}`);
}

function flatten(value, separator = '') {
  if (Array.isArray(value)) {
    return [...value]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((item) => (item && typeof item === 'object' ? flatten(item, separator) : String(item ?? '')))
      .join(separator);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((key) => key !== 'signature')
      .sort()
      .map((key) => {
        const item = value[key];
        const nextValue = item && typeof item === 'object' ? flatten(item, separator) : String(item ?? '');
        return `${key}=${nextValue}`;
      })
      .join(separator);
  }
  return String(value ?? '');
}

function signPayload(payload, secret) {
  // 超级媒介 API 签名算法：HMAC-SHA256(secret, sorted_key_value_string)
  // 所有参数按 key 字母排序，拼接为 key1=value1key2=value2... 格式（无分隔符）
  // 注意：需要跳过 undefined、null 和空字符串值，与 encodeQuery 行为保持一致
  const stringToSign = Object.keys(payload)
    .filter((key) => key !== 'signature' && payload[key] != null && payload[key] !== '')
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('');
  return crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
}

function withAuth(params = {}) {
  const appid = requiredEnv('CHAOJIMEIJIE_APPID');
  const secret = requiredEnv('CHAOJIMEIJIE_SECRET');
  const payload = {
    appid,
    timestamp: Math.floor(Date.now() / 1000),
    algorithm: 'sha256',
    ...params,
  };
  payload.signature = signPayload(payload, secret);
  return payload;
}

function encodeQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(`${key}[]`, String(item)));
      return;
    }
    query.append(key, String(value));
  });
  return query.toString();
}

function encodeBody(params) {
  // 对于 POST 请求，手动拼接请求体，不使用 URL 编码
  // 因为签名是基于原始值计算的，URL 编码会导致签名不匹配
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((item) => `${key}[]=${item}`).join('&');
      }
      return `${key}=${value}`;
    })
    .join('&');
}

async function request(resourceType, action, params = {}, method = 'GET') {
  const baseUrl = text(process.env.CHAOJIMEIJIE_API_BASE_URL) || API_BASE_URL;
  const payload = withAuth(params);
  const endpoint = endpointFor(resourceType, action);
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${endpoint}`);
  const init = { method };
  if (method === 'GET') {
    const query = encodeQuery(payload);
    if (query) url.search = query;
  } else {
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    init.body = encodeBody(payload);
  }

  const response = await fetch(url, init);
  const responseText = await response.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(`超级媒介响应不是 JSON：${responseText.slice(0, 200)}`);
  }
  if (!response.ok || Number(json.code) !== 200) {
    throw new Error(json.message || `超级媒介请求失败：${response.status}`);
  }
  return json.data;
}

function rowToResource(row) {
  const raw = jsonParse(row.raw_json, {});
  return {
    id: row.id,
    provider: row.provider,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    name: row.name,
    price: row.price,
    platform: row.platform,
    area: row.area,
    category: row.category,
    status: row.status,
    raw,
    synced_at: row.synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function saveResources(resourceType, items = []) {
  const db = getDb();
  const timestamp = nowIso();
  const statement = db.prepare(`
    INSERT INTO publish_resources (
      id, provider, resource_type, resource_id, name, price, platform, area, category, status, raw_json, synced_at, created_at, updated_at
    ) VALUES (
      @id, @provider, @resource_type, @resource_id, @name, @price, @platform, @area, @category, @status, @raw_json, @synced_at, @created_at, @updated_at
    )
    ON CONFLICT(provider, resource_type, resource_id) DO UPDATE SET
      name = excluded.name,
      price = excluded.price,
      platform = excluded.platform,
      area = excluded.area,
      category = excluded.category,
      status = excluded.status,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `);
  const normalizedType = normalizeResourceType(resourceType);
  const saveMany = db.transaction((records) => {
    records.forEach((item) => {
      const category = normalizedType === 'we-media' ? item.industry_category : item.channel_type;
      statement.run({
        id: `${PROVIDER}:${normalizedType}:${item.id}`,
        provider: PROVIDER,
        resource_type: normalizedType,
        resource_id: Number(item.id),
        name: text(item.name) || `资源 ${item.id}`,
        price: Number(item.price ?? 0),
        platform: item.platform == null ? null : Number(item.platform),
        area: item.area == null ? null : Number(item.area),
        category: category == null ? null : Number(category),
        status: item.status == null ? null : Number(item.status),
        raw_json: jsonString(item),
        synced_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      });
    });
  });
  saveMany(Array.isArray(items) ? items : []);
}

async function syncResources(resourceType = 'media', page = 1, size = 200) {
  const normalizedType = normalizeResourceType(resourceType);
  const pageSize = Math.max(1, Math.min(Number(size || 200), 500));
  const startPage = Math.max(1, Number(page || 1));
  const allItems = [];
  let total = 0;
  for (let currentPage = startPage; currentPage < startPage + 100; currentPage += 1) {
    const data = await request(normalizedType, 'resource', { page: currentPage, size: pageSize }, 'GET');
    const items = Array.isArray(data?.items) ? data.items : [];
    total = Number(data?.total || total || items.length);
    allItems.push(...items);
    saveResources(normalizedType, items);
    if (items.length < pageSize || allItems.length >= total) {
      break;
    }
  }
  return {
    resource_type: normalizedType,
    total: total || allItems.length,
    synced: allItems.length,
    items: listResources({ resourceType: normalizedType, limit: pageSize }),
  };
}

async function queryResources(resourceType = 'media', ids = []) {
  const normalizedType = normalizeResourceType(resourceType);
  const data = await request(normalizedType, 'resource-query', { id: ids }, 'GET');
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  saveResources(normalizedType, items);
  return items;
}

function listResources(filters = {}) {
  const db = getDb();
  const clauses = ['provider = ?'];
  const params = [PROVIDER];
  const resourceType = normalizeResourceType(filters.resourceType || filters.resource_type || 'media');
  clauses.push('resource_type = ?');
  params.push(resourceType);
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    clauses.push('status = ?');
    params.push(Number(filters.status));
  }
  if (filters.query) {
    clauses.push('name LIKE ?');
    params.push(`%${text(filters.query)}%`);
  }
  if (filters.maxPrice !== undefined && filters.maxPrice !== null && filters.maxPrice !== '') {
    clauses.push('price <= ?');
    params.push(Number(filters.maxPrice));
  }
  const limit = Math.max(1, Math.min(Number(filters.limit || 100), 500));
  const rows = db.prepare(`
    SELECT *
    FROM publish_resources
    WHERE ${clauses.join(' AND ')}
    ORDER BY status ASC, price ASC, resource_id ASC
    LIMIT ?
  `).all(...params, limit);
  return rows.map(rowToResource);
}

function rowToOrder(row) {
  return {
    id: row.id,
    article_id: row.article_id,
    project_id: row.project_id,
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
    last_synced_at: row.last_synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getLatestOrderByArticle(articleId) {
  const row = getDb().prepare(`
    SELECT *
    FROM publish_orders
    WHERE article_id = ? AND provider = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(articleId, PROVIDER);
  return row ? rowToOrder(row) : null;
}

function createPartnerSn(articleId) {
  const shortId = text(articleId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) || crypto.randomUUID().slice(0, 8);
  return `GA-${shortId}-${Date.now()}`.slice(0, 64);
}

function saveOrder({
  articleId,
  projectId,
  resourceType,
  partnerSn,
  externalSn,
  resourceId,
  previewUrl,
  statusCode = 1,
  raw = null,
}) {
  const timestamp = nowIso();
  getDb().prepare(`
    INSERT INTO publish_orders (
      id, article_id, project_id, provider, resource_type, partner_sn, external_sn, resource_id,
      preview_url, status_code, published_url, feedback_json, raw_json, last_synced_at, created_at, updated_at
    ) VALUES (
      @id, @article_id, @project_id, @provider, @resource_type, @partner_sn, @external_sn, @resource_id,
      @preview_url, @status_code, @published_url, @feedback_json, @raw_json, @last_synced_at, @created_at, @updated_at
    )
  `).run({
    id: crypto.randomUUID(),
    article_id: articleId,
    project_id: projectId,
    provider: PROVIDER,
    resource_type: normalizeResourceType(resourceType),
    partner_sn: partnerSn,
    external_sn: externalSn || null,
    resource_id: Number(resourceId),
    preview_url: previewUrl || null,
    status_code: statusCode,
    published_url: null,
    feedback_json: null,
    raw_json: jsonString(raw),
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getLatestOrderByArticle(articleId);
}

async function createOrder({
  articleId,
  projectId,
  resourceType,
  resourceId,
  title,
  previewUrl,
  remark,
  owner,
  publishLimited,
  publishForm = 1,
  publishType = 1,
  accountRule = 3,
}) {
  const normalizedType = normalizeResourceType(resourceType);
  const partnerSn = createPartnerSn(articleId);
  const payload = {
    sn: partnerSn,
    resource_id: Number(resourceId),
    title: text(title).slice(0, 200),
    content: previewUrl,
    remark: text(remark).slice(0, 500) || undefined,
    owner: text(owner).slice(0, 100) || undefined,
    publish_limited: text(publishLimited) || undefined,
  };
  if (normalizedType === 'we-media') {
    payload.publish_form = Number(publishForm || 1);
    payload.publish_type = Number(publishType || 1);
    payload.account_rule = Number(accountRule || 3);
  }
  const data = await request(normalizedType, 'order', payload, 'POST');
  return saveOrder({
    articleId,
    projectId,
    resourceType: normalizedType,
    partnerSn,
    externalSn: data?.partner_sn || null,
    resourceId,
    previewUrl,
    statusCode: 1,
    raw: data,
  });
}

function updateOrderFromRemote(order, remote) {
  const timestamp = nowIso();
  const statusCode = Number(remote.status || 0) || null;
  getDb().prepare(`
    UPDATE publish_orders
    SET status_code = @status_code,
        published_url = @published_url,
        feedback_json = @feedback_json,
        raw_json = @raw_json,
        last_synced_at = @last_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: order.id,
    status_code: statusCode,
    published_url: text(remote.url || remote.feedback?.url) || order.published_url || null,
    feedback_json: jsonString(remote.feedback || null),
    raw_json: jsonString(remote),
    last_synced_at: timestamp,
    updated_at: timestamp,
  });
  return getLatestOrderByArticle(order.article_id);
}

async function syncOrder(order) {
  const normalizedType = normalizeResourceType(order.resource_type);
  const data = await request(normalizedType, 'order-query', { sn: [order.partner_sn] }, 'GET');
  const items = Array.isArray(data) ? data : [];
  const remote = items.find((item) => item.sn === order.partner_sn) || items[0];
  if (!remote) {
    throw new Error(`未查询到超级媒介订单：${order.partner_sn}`);
  }
  return updateOrderFromRemote(order, remote);
}

async function syncOrderByArticle(articleId) {
  const order = getLatestOrderByArticle(articleId);
  if (!order) {
    throw new Error('当前稿件还没有超级媒介订单。');
  }
  return syncOrder(order);
}

async function syncOrderBatch(resourceType, orders) {
  const normalizedType = normalizeResourceType(resourceType);
  const data = await request(normalizedType, 'order-query', { sn: orders.map((order) => order.partner_sn) }, 'GET');
  const items = Array.isArray(data) ? data : [];
  return orders.map((order) => {
    const remote = items.find((item) => item.sn === order.partner_sn);
    if (!remote) {
      throw new Error(`未查询到超级媒介订单：${order.partner_sn}`);
    }
    return updateOrderFromRemote(order, remote);
  });
}

async function syncOrdersByProject(projectId) {
  const rows = getDb().prepare(`
    SELECT *
    FROM publish_orders
    WHERE project_id = ? AND provider = ?
    ORDER BY datetime(created_at) DESC
  `).all(projectId, PROVIDER);
  const result = [];
  const groups = rows.reduce((acc, row) => {
    const order = rowToOrder(row);
    const resourceType = normalizeResourceType(order.resource_type);
    if (!acc[resourceType]) acc[resourceType] = [];
    acc[resourceType].push(order);
    return acc;
  }, {});
  for (const [resourceType, orders] of Object.entries(groups)) {
    for (let index = 0; index < orders.length; index += 20) {
      result.push(...await syncOrderBatch(resourceType, orders.slice(index, index + 20)));
    }
  }
  return result;
}

async function manageOrder(order, action, payload = {}) {
  const normalizedType = normalizeResourceType(order.resource_type);
  const actionMap = {
    urge: 'order-urge',
    cancel: 'order-cancel',
    'apply-refund': 'order-refund',
    'apply-republish': 'order-republish',
  };
  const endpointAction = actionMap[action];
  if (!endpointAction) {
    throw new Error(`Unknown chaojimeijie order action: ${action}`);
  }
  if (endpointAction === 'order-republish' && normalizedType !== 'media') {
    throw new Error('自媒体订单不支持申请补发。');
  }
  const data = await request(normalizedType, endpointAction, {
    sn: order.partner_sn,
    reason: text(payload.reason) || text(payload.remark) || undefined,
  }, 'POST');
  const timestamp = nowIso();
  const feedback = {
    ...(order.feedback || {}),
    last_action: action,
    last_action_at: timestamp,
    last_action_result: data || null,
  };
  getDb().prepare(`
    UPDATE publish_orders
    SET feedback_json = @feedback_json,
        raw_json = @raw_json,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: order.id,
    feedback_json: jsonString(feedback),
    raw_json: jsonString({ ...(order.raw || {}), last_action: action, last_action_result: data || null }),
    updated_at: timestamp,
  });
  return getLatestOrderByArticle(order.article_id);
}

function mapOrderStatus(statusCode) {
  return ORDER_STATUS_MAP[Number(statusCode)] || 'publishing';
}

module.exports = {
  PROVIDER,
  createOrder,
  flatten,
  getLatestOrderByArticle,
  listResources,
  manageOrder,
  mapOrderStatus,
  queryResources,
  request,
  signPayload,
  syncOrderByArticle,
  syncOrdersByProject,
  syncResources,
  withAuth,
};
