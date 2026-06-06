const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeText, parseAssets } = require('../parsers/documentParser.cjs');
const { getDb, getDbPath } = require('./databaseService.cjs');
const { embedTexts, embeddingConfig, isEmbeddingEnabled } = require('./embeddingService.cjs');
const { extractKnowledgeDraft, extractKnowledgeDraftStream } = require('./knowledgeExtractionService.cjs');
const {
  compactEvidenceProfile,
  fieldText,
  fieldValue,
  normalizeText: normalizeProfileText,
  toEvidenceField,
} = require('./profileFieldService.cjs');
const projectService = require('./projectService.cjs');
const {
  PROFILE_FIELD_DEFINITIONS,
  PROFILE_FIELD_KEYS,
  REQUIRED_PROFILE_FIELDS,
} = require('../../shared/profileSchema.cjs');

const PROFILE_ENTRY_TYPE = 'enterprise_profile';
const ASSET_ENTRY_TYPE = 'asset';
const ASSET_DIRNAME = 'knowledge-assets';
const VECTOR_TABLE_NAME = 'knowledge_chunk_vectors';
const UNKNOWN_COMPANY_NAME = '待确认企业名称';

let vectorLoadState = null;

const PROFILE_FIELDS = PROFILE_FIELD_DEFINITIONS.map((field) => [field.key, field.label]);
const REQUIRED_FIELDS = REQUIRED_PROFILE_FIELDS;

const FACT_PATTERNS = [
  { field: 'company_name', label: '企业名称', pattern: /(?:公司名称|企业名称|品牌名称|名称)[:：]\s*([^\n，。；;]{2,80})/i, confidence: 0.9 },
  { field: 'short_name', label: '企业简称', pattern: /(?:公司简称|企业简称|简称)[:：]\s*([^\n，。；;]{2,60})/i, confidence: 0.82 },
  { field: 'industry_category', label: '所属行业分类', pattern: /(?:所属行业|行业|领域)[:：]\s*([^\n。；;]{2,120})/i, confidence: 0.78 },
  { field: 'offerings', label: '产品与服务项目', pattern: /(?:主营业务|业务范围|核心业务|产品服务|产品与服务|服务内容|解决方案)[:：]\s*([^\n]{4,700})/i, confidence: 0.82 },
  { field: 'detailed_address', label: '详细经营地址', pattern: /(?:详细地址|经营地址|门店地址|地址)[:：]\s*([^\n]{4,300})/i, confidence: 0.86 },
  { field: 'associated_brands', label: '关联与代理品牌', pattern: /(?:代理品牌|授权品牌|合作品牌|关联品牌)[:：]\s*([^\n]{2,500})/i, confidence: 0.78 },
  { field: 'target_audiences', label: '目标客户/适用人群', pattern: /(?:目标客群|目标客户|适用人群|适用车型|服务车主|目标用户)[:：]\s*([^\n]{2,500})/i, confidence: 0.74 },
  { field: 'user_pain_points', label: '用户痛点', pattern: /(?:用户痛点|客户痛点|解决痛点|痛点)[:：]\s*([^\n]{4,700})/i, confidence: 0.72 },
  { field: 'trust_endorsements', label: '信任背书', pattern: /(?:信任背书|资质|认证|荣誉|授权|合作伙伴)[:：]\s*([^\n]{4,700})/i, confidence: 0.72 },
  { field: 'proven_cases', label: '客户案例', pattern: /(?:客户案例|成功案例|案例)[:：]\s*([^\n]{4,700})/i, confidence: 0.74 },
  { field: 'business_regions', label: '服务区域', pattern: /(?:服务区域|覆盖区域|业务区域|地区)[:：]\s*([^\n]{2,300})/i, confidence: 0.7 },
  { field: 'core_advantages', label: '核心优势', pattern: /(?:核心优势|竞争优势|优势)[:：]\s*([^\n]{4,700})/i, confidence: 0.74 },
  { field: 'target_keywords', label: '目标关键词', pattern: /(?:目标关键词|关键词|核心关键词)[:：]\s*([^\n]{2,300})/i, confidence: 0.7 },
  { field: 'contact_info', label: '联系方式', pattern: /(?:联系电话|联系方式|客服热线|电话|微信)[:：]\s*([^\n]{2,120})/i, confidence: 0.8 },
];

function nowIso() {
  return new Date().toISOString();
}

function jsonString(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeFilename(filename = '') {
  return normalizeText(filename)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
    || 'untitled.txt';
}

function decodeAssetBuffer(asset = {}) {
  const rawBase64 = String(asset.content_base64 || '').replace(/^data:[^,]+,/, '');
  return Buffer.from(rawBase64, 'base64');
}

function draftAssetsForStorage(assets = []) {
  return (Array.isArray(assets) ? assets : [])
    .map((asset) => ({
      filename: asset.filename || 'untitled.txt',
      content_type: asset.content_type || asset.mediaType || null,
      content_base64: asset.content_base64 || null,
    }))
    .filter((asset) => asset.content_base64);
}

function dataRootDir() {
  const dbPath = getDbPath();
  if (!dbPath) throw new Error('Database has not been initialized.');
  return path.dirname(dbPath);
}

function assetAbsolutePath(storagePath = '') {
  return path.join(dataRootDir(), storagePath);
}

function saveOriginalAssetFile({ projectId, assetId, filename, buffer }) {
  const safeName = safeFilename(filename);
  const relativeDir = path.join(ASSET_DIRNAME, projectId, assetId);
  const absoluteDir = path.join(dataRootDir(), relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const relativePath = path.join(relativeDir, safeName);
  fs.writeFileSync(path.join(dataRootDir(), relativePath), buffer);
  return relativePath;
}

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    filename: row.original_filename,
    content_type: row.mime_type || null,
    file_path: row.storage_path,
    source_type: ASSET_ENTRY_TYPE,
    status: row.parse_status,
    embedding_status: row.embedding_status,
    file_size: row.file_size || 0,
    sha256: row.sha256,
    error_message: row.error_message || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && String(entryValue).trim() !== '')
  );
}

function profileCompanyName(profile = {}) {
  return normalizeProfileText(fieldText(profile, 'company_name') || fieldText(profile, 'short_name') || UNKNOWN_COMPANY_NAME);
}

function profileDescription(profile = {}) {
  return normalizeProfileText(fieldText(profile, 'offerings') || fieldText(profile, 'detailed_intro') || fieldText(profile, 'core_advantages') || '');
}

function projectExists(projectId) {
  if (!projectId) return false;
  return Boolean(getDb().prepare('SELECT id FROM projects WHERE id = ?').get(projectId));
}

function normalizeProfile(profile = {}) {
  const normalized = compactEvidenceProfile(profile, PROFILE_FIELD_KEYS);
  normalized.id = profile.id;
  normalized.project_id = profile.project_id;
  normalized.company_name = toEvidenceField(profile.company_name || profileCompanyName(profile));
  return normalized;
}

function mergeFilledProfiles(...profiles) {
  const output = {};
  profiles.forEach((profile) => {
    if (!profile) return;
    PROFILE_FIELD_KEYS.forEach((field) => {
      if (fieldText(profile, field)) {
        output[field] = profile[field];
      }
    });
    ['id', 'project_id', 'generated_long_tail_keywords'].forEach((field) => {
      if (profile[field]) {
        output[field] = profile[field];
      }
    });
  });
  return output;
}

function buildProfileContent(profile = {}) {
  return PROFILE_FIELDS
    .filter(([field]) => fieldText(profile, field))
    .map(([field, label]) => `## ${label}\n${fieldText(profile, field)}`)
    .join('\n\n');
}

function rowToProfile(row) {
  if (!row) return null;
  const profile = normalizeProfile(parseJson(row.profile_json, {}));
  const companyName = profileCompanyName(profile) || row.name;
  return {
    ...profile,
    id: row.project_id,
    project_id: row.project_id,
    company_name: toEvidenceField(companyName),
    short_name: profile.short_name || toEvidenceField(companyName),
    detailed_intro: profile.detailed_intro || toEvidenceField(row.description || null),
    entry_count: row.entry_count || 0,
    created_at: row.profile_created_at || row.created_at,
    updated_at: row.profile_updated_at || row.updated_at,
  };
}

function rowToEntry(row) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.id,
    project_id: row.project_id,
    parent_id: row.entry_id || null,
    title: row.title || '知识片段',
    content: row.content || '',
    source_type: row.type || row.source_type || 'manual',
    metadata,
    chunk_index: Number(row.chunk_index ?? metadata.chunk_index ?? 0),
    embedding_status: row.embedding_status || 'indexed',
    error_message: row.error_message || null,
    retrieval_source: row.retrieval_source || metadata.retrieval_source || null,
    score: row.score === undefined || row.score === null ? null : Number(row.score),
    matched_chunk: row.matched_chunk || row.content || '',
    asset_id: row.asset_id || metadata.asset_id || null,
    source_filename: row.source_filename || metadata.filename || null,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

function serializeFloat32(values = []) {
  return Buffer.from(new Float32Array(values.map((value) => Number(value) || 0)).buffer);
}

function ensureVectorTable(db) {
  if (vectorLoadState?.checked) return vectorLoadState.ready;

  const config = embeddingConfig();
  if (!config.dimensions) {
    vectorLoadState = { checked: true, ready: false, error: 'missing dimensions' };
    return false;
  }

  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE_NAME} USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${config.dimensions}])`);
    vectorLoadState = { checked: true, ready: true, error: null };
    return true;
  } catch (error) {
    vectorLoadState = { checked: true, ready: false, error: error instanceof Error ? error.message : String(error) };
    return false;
  }
}

function cosineSimilarity(a = [], b = []) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = Number(a[index]) || 0;
    const right = Number(b[index]) || 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function cleanKnowledgeText(content) {
  const seen = new Set();
  const lines = normalizeText(content)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*(第\s*)?\d+\s*(页|\/\s*\d+)?\s*$/.test(line));

  return lines
    .filter((line) => {
      const key = line.trim();
      if (!key) return true;
      if (key.length > 12) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTextIntoChunks(content, maxLength = 900, overlap = 120) {
  const text = cleanKnowledgeText(content);
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  let currentStart = 0;
  let cursor = 0;
  let sectionTitle = '';

  const pushChunk = (chunkContent, start) => {
    const cleanContent = chunkContent.trim();
    if (!cleanContent) return;
    chunks.push({
      content: cleanContent,
      chunk_index: chunks.length,
      section_title: sectionTitle || null,
      source_range: { start, end: start + cleanContent.length },
    });
  };

  paragraphs.forEach((paragraph) => {
    const paragraphStart = text.indexOf(paragraph, cursor);
    cursor = paragraphStart >= 0 ? paragraphStart + paragraph.length : cursor;
    if (/^(#{1,6}\s+|[一二三四五六七八九十0-9]+[、.．]\s*)/.test(paragraph) && paragraph.length <= 80) {
      sectionTitle = paragraph.replace(/^#{1,6}\s+/, '');
    }

    if ((current + '\n\n' + paragraph).trim().length <= maxLength) {
      if (!current) currentStart = Math.max(0, paragraphStart);
      current = (current ? `${current}\n\n${paragraph}` : paragraph).trim();
      return;
    }

    if (current) pushChunk(current, currentStart);
    if (paragraph.length <= maxLength) {
      current = paragraph;
      currentStart = Math.max(0, paragraphStart);
      return;
    }

    for (let index = 0; index < paragraph.length; index += maxLength - overlap) {
      pushChunk(paragraph.slice(index, index + maxLength), Math.max(0, paragraphStart + index));
    }
    current = '';
  });

  if (current) pushChunk(current, currentStart);
  return chunks;
}

function getIndexStatus(projectId = null) {
  const db = getDb();
  const config = embeddingConfig();
  const embeddingsEnabled = isEmbeddingEnabled();
  const vectorReady = ensureVectorTable(db);
  if (!projectId) {
    return {
      project_id: null,
      embedding_model: config.model || 'not-enabled',
      vector_backend: vectorReady ? 'fts5+sqlite-vec' : 'fts5',
      embedding_backend: embeddingsEnabled ? 'ark' : 'disabled',
      pending: 0,
      indexed: 0,
      vector_indexed: 0,
      failed: 0,
      asset_count: 0,
      assets: [],
    };
  }

  const chunkCount = db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE project_id = ?').get(projectId).count;
  const embeddedCount = db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunk_embeddings WHERE project_id = ?').get(projectId).count;
  const failedAssets = db.prepare("SELECT COUNT(*) AS count FROM knowledge_assets WHERE project_id = ? AND parse_status = 'failed'").get(projectId).count;
  const assetCount = db.prepare('SELECT COUNT(*) AS count FROM knowledge_assets WHERE project_id = ?').get(projectId).count;
  const assetRows = db.prepare(`
    SELECT *
    FROM knowledge_assets
    WHERE project_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 20
  `).all(projectId);
  return {
    project_id: projectId,
    embedding_model: config.model || 'not-enabled',
    vector_backend: vectorReady ? 'fts5+sqlite-vec' : 'fts5',
    embedding_backend: embeddingsEnabled ? 'ark' : 'disabled',
    pending: embeddingsEnabled ? Math.max(0, chunkCount - embeddedCount) : 0,
    indexed: chunkCount,
    vector_indexed: embeddedCount,
    failed: failedAssets,
    asset_count: assetCount,
    assets: assetRows.map(rowToAsset),
  };
}

function ensureProjectForProfile(profile) {
  const requestedProjectId = normalizeText(profile.project_id);
  if (requestedProjectId && projectExists(requestedProjectId)) return requestedProjectId;

  const db = getDb();
  const timestamp = nowIso();
  const projectId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO projects (id, name, description, status, created_at, updated_at)
    VALUES (@id, @name, @description, 'active', @created_at, @updated_at)
  `).run({
    id: projectId,
    name: profileCompanyName(profile),
    description: profileDescription(profile) || null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return projectId;
}

function updateProjectSummary(projectId, profile) {
  getDb().prepare(`
    UPDATE projects
    SET name = @name,
        description = @description,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: projectId,
    name: profileCompanyName(profile),
    description: profileDescription(profile) || null,
    updated_at: nowIso(),
  });
}

function contentHash(projectId, entryId, chunkContent, chunkIndex) {
  return crypto.createHash('sha256')
    .update(`${projectId}:${entryId}:${chunkIndex}:${chunkContent}`)
    .digest('hex');
}

function deleteFtsRowsForEntries(db, projectId, type = null) {
  const rows = type
    ? db.prepare('SELECT kc.id FROM knowledge_chunks kc JOIN knowledge_entries ke ON ke.id = kc.entry_id WHERE kc.project_id = ? AND ke.type = ?').all(projectId, type)
    : db.prepare('SELECT id FROM knowledge_chunks WHERE project_id = ?').all(projectId);
  const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE id = ?');
  const deleteEmbedding = db.prepare('DELETE FROM knowledge_chunk_embeddings WHERE chunk_id = ?');
  const hasVectorTable = ensureVectorTable(db);
  const deleteVector = hasVectorTable ? db.prepare(`DELETE FROM ${VECTOR_TABLE_NAME} WHERE chunk_id = ?`) : null;
  rows.forEach((row) => deleteFts.run(row.id));
  rows.forEach((row) => {
    deleteEmbedding.run(row.id);
    deleteVector?.run(row.id);
  });
}

function insertEntryWithChunks(db, { projectId, type, title, content, metadata = {} }) {
  const timestamp = nowIso();
  const entryId = crypto.randomUUID();
  const cleanContent = cleanKnowledgeText(content);
  if (!cleanContent) throw new Error('知识条目内容不能为空。');

  db.prepare(`
    INSERT INTO knowledge_entries (id, project_id, type, title, content, metadata_json, created_at, updated_at)
    VALUES (@id, @project_id, @type, @title, @content, @metadata_json, @created_at, @updated_at)
  `).run({
    id: entryId,
    project_id: projectId,
    type,
    title: title || '知识条目',
    content: cleanContent,
    metadata_json: jsonString(metadata),
    created_at: timestamp,
    updated_at: timestamp,
  });

  const insertChunk = db.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks (id, project_id, entry_id, title, content, content_hash, metadata_json, created_at)
    VALUES (@id, @project_id, @entry_id, @title, @content, @content_hash, @metadata_json, @created_at)
  `);
  const insertFts = db.prepare(`
    INSERT INTO knowledge_chunks_fts (id, project_id, title, content)
    VALUES (@id, @project_id, @title, @content)
  `);

  const insertedChunks = [];
  splitTextIntoChunks(cleanContent).forEach((chunk) => {
    const chunkId = crypto.randomUUID();
    const chunkContent = chunk.content;
    const result = insertChunk.run({
      id: chunkId,
      project_id: projectId,
      entry_id: entryId,
      title,
      content: chunkContent,
      content_hash: contentHash(projectId, entryId, chunkContent, chunk.chunk_index),
      metadata_json: jsonString({
        ...metadata,
        chunk_index: chunk.chunk_index,
        section_title: chunk.section_title,
        source_range: chunk.source_range,
      }),
      created_at: timestamp,
    });
    if (result.changes > 0) {
      insertFts.run({ id: chunkId, project_id: projectId, title, content: chunkContent });
      insertedChunks.push({ id: chunkId, project_id: projectId, content: chunkContent });
    }
  });

  return { entryId, chunks: insertedChunks };
}

async function embedChunks(projectId, chunks = []) {
  if (!isEmbeddingEnabled() || !chunks.length) return;

  const db = getDb();
  const config = embeddingConfig();
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  const timestamp = nowIso();
  const insertEmbedding = db.prepare(`
    INSERT INTO knowledge_chunk_embeddings (chunk_id, project_id, embedding_json, embedding_model, dimensions, created_at)
    VALUES (@chunk_id, @project_id, @embedding_json, @embedding_model, @dimensions, @created_at)
    ON CONFLICT(chunk_id) DO UPDATE SET
      embedding_json = excluded.embedding_json,
      embedding_model = excluded.embedding_model,
      dimensions = excluded.dimensions,
      created_at = excluded.created_at
  `);
  const hasVectorTable = ensureVectorTable(db);
  const deleteVector = hasVectorTable ? db.prepare(`DELETE FROM ${VECTOR_TABLE_NAME} WHERE chunk_id = ?`) : null;
  const insertVector = hasVectorTable
    ? db.prepare(`INSERT INTO ${VECTOR_TABLE_NAME}(chunk_id, embedding) VALUES (?, ?)`)
    : null;

  db.transaction(() => {
    chunks.forEach((chunk, index) => {
      const embedding = embeddings[index];
      if (!Array.isArray(embedding)) return;
      insertEmbedding.run({
        chunk_id: chunk.id,
        project_id: projectId,
        embedding_json: jsonString(embedding),
        embedding_model: config.model,
        dimensions: embedding.length,
        created_at: timestamp,
      });
      deleteVector?.run(chunk.id);
      insertVector?.run(chunk.id, serializeFloat32(embedding));
    });
  })();
}

async function embedPendingChunks(projectId) {
  if (!isEmbeddingEnabled()) return;
  const db = getDb();
  const rows = db.prepare(`
    SELECT kc.id, kc.project_id, kc.content
    FROM knowledge_chunks kc
    LEFT JOIN knowledge_chunk_embeddings kce ON kce.chunk_id = kc.id
    WHERE kc.project_id = ? AND kce.chunk_id IS NULL
    ORDER BY datetime(kc.created_at) ASC
    LIMIT 200
  `).all(projectId);
  await embedChunks(projectId, rows);
}

function listEntries(projectId, limit = 100) {
  if (!projectId) return { entries: [], total: 0 };
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries WHERE project_id = ?').get(projectId).count;
  const rows = db.prepare(`
    SELECT id, project_id, type, title, content, metadata_json, 0 AS chunk_index,
           'indexed' AS embedding_status, NULL AS error_message, created_at, updated_at
    FROM knowledge_entries
    WHERE project_id = ?
    ORDER BY datetime(updated_at) DESC
    LIMIT ?
  `).all(projectId, Number(limit || 100));
  return { entries: rows.map(rowToEntry), total };
}

function getProfileRow(projectId) {
  return getDb().prepare(`
    SELECT
      p.id AS project_id,
      p.name,
      p.description,
      p.created_at,
      p.updated_at,
      ep.profile_json,
      ep.created_at AS profile_created_at,
      ep.updated_at AS profile_updated_at,
      COALESCE(entry_counts.entry_count, 0) AS entry_count
    FROM projects p
    LEFT JOIN enterprise_profiles ep ON ep.project_id = p.id
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS entry_count
      FROM knowledge_entries
      GROUP BY project_id
    ) entry_counts ON entry_counts.project_id = p.id
    WHERE p.id = ?
  `).get(projectId);
}

function getKnowledgeProfile(projectId) {
  projectService.getProject(projectId);
  const profile = rowToProfile(getProfileRow(projectId));
  const entriesResponse = listEntries(projectId);
  return {
    profile,
    entries: entriesResponse.entries,
    total: entriesResponse.total,
    index_status: getIndexStatus(projectId),
  };
}

function saveProfile(profileInput = {}) {
  const db = getDb();
  const timestamp = nowIso();
  const profile = normalizeProfile(profileInput);
  const tx = db.transaction(() => {
    const projectId = ensureProjectForProfile(profile);
    profile.project_id = projectId;
    profile.id = projectId;
    updateProjectSummary(projectId, profile);
    db.prepare(`
      INSERT INTO enterprise_profiles (project_id, profile_json, source_draft_id, created_at, updated_at)
      VALUES (@project_id, @profile_json, @source_draft_id, @created_at, @updated_at)
      ON CONFLICT(project_id) DO UPDATE SET
        profile_json = excluded.profile_json,
        updated_at = excluded.updated_at
    `).run({
      project_id: projectId,
      profile_json: jsonString(profile),
      source_draft_id: profile.source_draft_id || null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    deleteFtsRowsForEntries(db, projectId, PROFILE_ENTRY_TYPE);
    db.prepare('DELETE FROM knowledge_entries WHERE project_id = ? AND type = ?').run(projectId, PROFILE_ENTRY_TYPE);
    insertEntryWithChunks(db, {
      projectId,
      type: PROFILE_ENTRY_TYPE,
      title: `${profileCompanyName(profile)} 企业资料`,
      content: buildProfileContent(profile),
      metadata: { source: 'enterprise_profile' },
    });
    return projectId;
  });
  return getKnowledgeProfile(tx());
}

function saveEnterpriseProfile(profileInput = {}) {
  return saveProfile(profileInput);
}

function updateKnowledgeProfile(projectId, profileInput = {}) {
  if (!projectId) throw new Error('projectId is required.');
  projectService.getProject(projectId);
  return saveProfile({ ...profileInput, project_id: projectId });
}

function createKnowledgeEntry(entry = {}) {
  const projectId = normalizeText(entry.project_id);
  if (!projectId) throw new Error('project_id is required.');
  projectService.getProject(projectId);
  const db = getDb();
  db.transaction(() => {
    insertEntryWithChunks(db, {
      projectId,
      type: entry.source_type || 'manual',
      title: normalizeText(entry.title) || '手动知识条目',
      content: entry.content,
      metadata: { source: 'manual' },
    });
    updateProjectSummary(projectId, rowToProfile(getProfileRow(projectId)) || { company_name: projectId });
  })();
  return listEntries(projectId);
}

function sourceSnippet(text, start, length = 180) {
  return normalizeText(text).slice(Math.max(0, start - 40), start + length).trim();
}

function findFactsInDocument(document) {
  const text = document.text || '';
  const facts = [];
  FACT_PATTERNS.forEach((rule) => {
    const match = text.match(rule.pattern);
    if (!match?.[1]) return;
    const index = match.index ?? 0;
    facts.push({
      id: crypto.randomUUID(),
      field: rule.field,
      label: rule.label,
      value: normalizeText(match[1]),
      source_file: document.filename,
      source_document_id: document.id,
      quote: sourceSnippet(text, index),
      confidence: rule.confidence,
      extraction: 'local-pattern',
    });
  });
  const websiteMatches = text.match(/https?:\/\/[^\s，。；;]+/gi) || [];
  if (websiteMatches[0]) {
    facts.push({
      id: crypto.randomUUID(),
      field: 'official_website',
      label: '官网',
      value: websiteMatches[0],
      source_file: document.filename,
      source_document_id: document.id,
      quote: websiteMatches[0],
      confidence: 0.68,
      extraction: 'local-pattern',
    });
  }
  return facts;
}

function collectFacts(documents = [], message = '') {
  const messageDocument = normalizeText(message)
    ? [{
        id: 'user-message',
        filename: '用户说明',
        content_type: 'text/plain',
        text: normalizeText(message),
        text_length: normalizeText(message).length,
        status: 'parsed',
        error_message: null,
      }]
    : [];
  return [...messageDocument, ...documents]
    .filter((document) => document.status === 'parsed' && document.text)
    .flatMap(findFactsInDocument);
}

function buildSourceQuotes(documents = [], facts = []) {
  const quotes = [];
  const seen = new Set();
  facts.forEach((fact) => {
    const key = `${fact.source_document_id}:${fact.quote}`;
    if (seen.has(key)) return;
    seen.add(key);
    quotes.push({
      id: crypto.randomUUID(),
      source_file: fact.source_file,
      source_document_id: fact.source_document_id,
      quote: fact.quote,
      fields: [fact.field],
    });
  });
  documents
    .filter((document) => document.status === 'parsed' && document.text)
    .slice(0, 3)
    .forEach((document) => {
      const key = `${document.id}:preview`;
      if (seen.has(key)) return;
      seen.add(key);
      quotes.push({
        id: crypto.randomUUID(),
        source_file: document.filename,
        source_document_id: document.id,
        quote: sourceSnippet(document.text, 0, 220),
        fields: ['source_preview'],
      });
    });
  return quotes;
}

function firstDocumentParagraph(documents = [], message = '') {
  const corpus = [message, ...documents.map((document) => document.text)].filter(Boolean).join('\n\n');
  return normalizeText(corpus).split(/\n{2,}|。/).map((item) => item.trim()).find(Boolean) || '';
}

function buildProfileFromFacts(facts = [], documents = [], message = '', projectId = null) {
  const profile = {};
  facts.forEach((fact) => {
    if (!profile[fact.field] || fact.confidence > 0.8) {
      profile[fact.field] = {
        value: fact.value,
        source_quote: fact.quote || null,
        confidence: fact.confidence,
      };
    }
  });
  const corpus = [message, ...documents.map((document) => document.text)].filter(Boolean).join('\n\n');
  const websiteMatch = corpus.match(/https?:\/\/[^\s，。；;]+/i);
  const firstParagraph = firstDocumentParagraph(documents, message);
  return normalizeProfile({
    project_id: projectId,
    company_name: profile.company_name || UNKNOWN_COMPANY_NAME,
    short_name: profile.short_name || null,
    official_website: profile.official_website || websiteMatch?.[0] || null,
    detailed_intro: firstParagraph ? toEvidenceField(normalizeText(corpus).slice(0, 3000)) : null,
    ...profile,
  });
}

function missingFieldsForProfile(profile = {}) {
  return REQUIRED_FIELDS
    .filter(([field]) => !fieldText(profile, field) || fieldText(profile, field) === UNKNOWN_COMPANY_NAME)
    .map(([, label]) => label);
}

function buildFieldReviews(profile = {}, facts = []) {
  return REQUIRED_FIELDS.map(([field, label]) => {
    const relatedFacts = facts.filter((fact) => fact.field === field);
    const value = fieldText(profile, field);
    return {
      field,
      label,
      value: value && value !== UNKNOWN_COMPANY_NAME ? value : '',
      confirmed: false,
      confidence: relatedFacts.length ? Math.max(...relatedFacts.map((fact) => fact.confidence || 0)) : 0,
      source_fact_ids: relatedFacts.map((fact) => fact.id),
      warning: value && value !== UNKNOWN_COMPANY_NAME ? null : '需要人工补充或确认。',
    };
  });
}

function buildLocalExtraction(documents, messageText, projectId) {
  const facts = collectFacts(documents, messageText);
  const profile = buildProfileFromFacts(facts, documents, messageText, projectId);
  const missingFields = missingFieldsForProfile(profile);
  return {
    facts,
    profile,
    missing_fields: missingFields,
    field_reviews: buildFieldReviews(profile, facts),
    source_quotes: buildSourceQuotes(documents, facts),
    warnings: [],
    extraction_status: facts.length ? (missingFields.length ? 'needs_review' : 'completed') : 'needs_review',
    extraction_model: 'local-pattern-extractor',
    extraction_provider: 'local',
  };
}

async function createKnowledgeDraft(payload = {}) {
  const db = getDb();
  const draftId = crypto.randomUUID();
  const timestamp = nowIso();
  const parsedAssets = parseAssets(payload.assets || []);
  const assets = parsedAssets.map(({ asset }) => ({ ...asset, draft_id: draftId }));
  const documents = parsedAssets.map(({ document }) => document);
  const messageText = normalizeText(payload.message);
  const documentText = documents.map((document) => document.text ? `# ${document.filename}\n${document.text}` : '').filter(Boolean).join('\n\n');
  const inputText = [messageText, documentText].filter(Boolean).join('\n\n');

  if (!normalizeText(inputText)) {
    throw new Error('未解析到可用于建库的企业资料。');
  }

  const extraction = payload.debug_local_fallback === true
    ? buildLocalExtraction(documents, messageText, payload.project_id || null)
    : await extractKnowledgeDraft({ documents, message: messageText, projectId: payload.project_id || null });

  const facts = extraction.facts || [];
  const profile = normalizeProfile({
    ...(extraction.profile || {}),
    project_id: projectExists(payload.project_id) ? payload.project_id : extraction.profile?.project_id || null,
  });
  const missingFields = extraction.missing_fields || missingFieldsForProfile(profile);
  const fieldReviews = extraction.field_reviews || buildFieldReviews(profile, facts);
  const sourceQuotes = extraction.source_quotes || buildSourceQuotes(documents, facts);
  const warnings = [
    ...(extraction.warnings || []),
    ...assets.filter((asset) => asset.status === 'failed').map((asset) => `${asset.filename}: ${asset.error_message}`),
    ...(missingFields.length ? [`仍需补充字段：${missingFields.join('、')}`] : []),
  ];
  const sourceSummary = {
    text_length: inputText.length,
    asset_count: assets.length,
    parsed_asset_count: assets.filter((asset) => asset.status !== 'failed').length,
    failed_asset_count: assets.filter((asset) => asset.status === 'failed').length,
    fact_count: facts.length,
    quote_count: sourceQuotes.length,
  };

  db.prepare(`
    INSERT INTO knowledge_drafts (
      id, project_id, status, input_text, facts_json, field_reviews_json,
      profile_json, source_quotes_json, assets_json, warnings_json, created_at, updated_at
    )
    VALUES (
      @id, @project_id, 'pending', @input_text, @facts_json, @field_reviews_json,
      @profile_json, @source_quotes_json, @assets_json, @warnings_json, @created_at, @updated_at
    )
  `).run({
    id: draftId,
    project_id: projectExists(payload.project_id) ? payload.project_id : null,
    input_text: inputText,
    facts_json: jsonString(facts),
    field_reviews_json: jsonString(fieldReviews),
    profile_json: jsonString(profile),
    source_quotes_json: jsonString(sourceQuotes),
    assets_json: jsonString(draftAssetsForStorage(payload.assets)),
    warnings_json: jsonString(warnings),
    created_at: timestamp,
    updated_at: timestamp,
  });

  return {
    id: draftId,
    intent: payload.intent || 'create',
    project_id: projectExists(payload.project_id) ? payload.project_id : null,
    conversation_id: payload.conversation_id || null,
    assistant_message_id: null,
    status: 'pending',
    profile,
    facts,
    field_reviews: fieldReviews,
    missing_fields: missingFields,
    confidence: {
      mode: extraction.extraction_provider === 'local' ? 'local-fact-extraction' : 'llm-fact-extraction',
      fact_count: facts.length,
      average: facts.length
        ? Number((facts.reduce((sum, fact) => sum + (fact.confidence || 0), 0) / facts.length).toFixed(2))
        : 0,
      provider: extraction.extraction_provider || null,
    },
    source_summary: sourceSummary,
    source_quotes: sourceQuotes,
    warnings,
    extraction_status: extraction.extraction_status || (facts.length ? 'completed' : 'needs_review'),
    extraction_model: extraction.extraction_model || 'unknown',
    assets,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function getDraft(draftId) {
  const row = getDb().prepare('SELECT * FROM knowledge_drafts WHERE id = ?').get(draftId);
  if (!row) throw new Error('知识库草稿不存在。');
  return row;
}

async function confirmKnowledgeDraft(payload = {}) {
  const draftId = payload.draftId || payload.id;
  if (!draftId) throw new Error('draftId is required.');

  const draft = getDraft(draftId);
  const draftProfile = normalizeProfile(parseJson(draft.profile_json, {}));
  const existingProfile = projectExists(draft.project_id)
    ? getKnowledgeProfile(draft.project_id).profile
    : null;
  const payloadProfile = normalizeProfile(payload.profile || {});
  const profile = normalizeProfile(mergeFilledProfiles(existingProfile, draftProfile, payloadProfile));
  const response = saveProfile({ ...profile, project_id: projectExists(draft.project_id) ? draft.project_id : profile.project_id });
  const projectId = response.profile.project_id || response.profile.id;
  const draftAssets = draftAssetsForStorage(parseJson(draft.assets_json, []));

  getDb().prepare(`
    UPDATE knowledge_drafts
    SET status = 'confirmed',
        project_id = @project_id,
        updated_at = @updated_at
    WHERE id = @id
  `).run({ id: draftId, project_id: projectId, updated_at: nowIso() });

  for (const asset of draftAssets) {
    await createKnowledgeAsset({
      project_id: projectId,
      filename: asset.filename,
      content_type: asset.content_type,
      content_base64: asset.content_base64,
    });
  }

  const refreshed = getKnowledgeProfile(projectId);
  return {
    ok: true,
    project_id: projectId,
    profile: refreshed.profile,
    entries: refreshed.entries,
    total: refreshed.total,
    index_status: refreshed.index_status,
  };
}

function rejectKnowledgeDraft(draftId) {
  if (!draftId) throw new Error('draftId is required.');
  const result = getDb().prepare(`
    UPDATE knowledge_drafts
    SET status = 'rejected',
        updated_at = ?
    WHERE id = ?
  `).run(nowIso(), draftId);
  return { ok: result.changes > 0 };
}

async function createKnowledgeAsset(asset = {}) {
  const projectId = normalizeText(asset.project_id);
  if (!projectId) throw new Error('project_id is required.');
  projectService.getProject(projectId);

  const db = getDb();
  const assetId = crypto.randomUUID();
  const timestamp = nowIso();
  const filename = safeFilename(asset.filename || 'untitled.txt');
  const buffer = decodeAssetBuffer(asset);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const storagePath = saveOriginalAssetFile({ projectId, assetId, filename, buffer });

  db.prepare(`
    INSERT INTO knowledge_assets (
      id, project_id, original_filename, storage_path, mime_type, file_size,
      sha256, parse_status, embedding_status, error_message, created_at, updated_at
    )
    VALUES (
      @id, @project_id, @original_filename, @storage_path, @mime_type, @file_size,
      @sha256, 'pending', 'pending', NULL, @created_at, @updated_at
    )
  `).run({
    id: assetId,
    project_id: projectId,
    original_filename: filename,
    storage_path: storagePath,
    mime_type: asset.content_type || null,
    file_size: buffer.length,
    sha256,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const [parsed] = await parseAssets([asset]);
  if (!parsed || parsed.asset.status === 'failed') {
    const errorMessage = parsed?.asset?.error_message || 'Document parse failed.';
    db.prepare(`
      UPDATE knowledge_assets
      SET parse_status = 'failed',
          embedding_status = 'failed',
          error_message = @error_message,
          updated_at = @updated_at
      WHERE id = @id
    `).run({ id: assetId, error_message: errorMessage, updated_at: nowIso() });
    const assetRow = db.prepare('SELECT * FROM knowledge_assets WHERE id = ?').get(assetId);
    return {
      asset: rowToAsset(assetRow),
      ...listEntries(projectId),
    };
  }

  let inserted = { entryId: null, chunks: [] };
  db.transaction(() => {
    inserted = insertEntryWithChunks(db, {
      projectId,
      type: ASSET_ENTRY_TYPE,
      title: parsed.asset.filename,
      content: parsed.document.text,
      metadata: {
        asset_id: assetId,
        content_type: parsed.asset.content_type,
        filename: parsed.asset.filename,
        sha256,
        source: 'upload',
      },
    });
    db.prepare(`
      UPDATE knowledge_assets
      SET entry_id = @entry_id,
          parse_status = 'parsed',
          embedding_status = @embedding_status,
          error_message = NULL,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: assetId,
      entry_id: inserted.entryId,
      embedding_status: isEmbeddingEnabled() ? 'pending' : 'not-configured',
      updated_at: nowIso(),
    });
  })();

  if (isEmbeddingEnabled()) {
    try {
      await embedChunks(projectId, inserted.chunks);
      db.prepare(`
        UPDATE knowledge_assets
        SET embedding_status = 'indexed',
            updated_at = ?
        WHERE id = ?
      `).run(nowIso(), assetId);
    } catch (error) {
      db.prepare(`
        UPDATE knowledge_assets
        SET embedding_status = 'failed',
            error_message = @error_message,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
        id: assetId,
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: nowIso(),
      });
    }
  }

  const assetRow = db.prepare('SELECT * FROM knowledge_assets WHERE id = ?').get(assetId);
  return {
    asset: rowToAsset(assetRow),
    ...listEntries(projectId),
  };
}

function getAssetRow(assetId) {
  const row = getDb().prepare('SELECT * FROM knowledge_assets WHERE id = ?').get(assetId);
  if (!row) throw new Error('Knowledge asset does not exist.');
  return row;
}

function deleteEntryIndexRows(db, entryId) {
  const chunks = db.prepare('SELECT id FROM knowledge_chunks WHERE entry_id = ?').all(entryId);
  const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE id = ?');
  const deleteEmbedding = db.prepare('DELETE FROM knowledge_chunk_embeddings WHERE chunk_id = ?');
  const hasVectorTable = ensureVectorTable(db);
  const deleteVector = hasVectorTable ? db.prepare(`DELETE FROM ${VECTOR_TABLE_NAME} WHERE chunk_id = ?`) : null;
  chunks.forEach((chunk) => {
    deleteFts.run(chunk.id);
    deleteEmbedding.run(chunk.id);
    deleteVector?.run(chunk.id);
  });
}

async function reparseKnowledgeAsset(assetId) {
  if (!assetId) throw new Error('assetId is required.');
  const row = getAssetRow(assetId);
  projectService.getProject(row.project_id);
  const buffer = fs.readFileSync(assetAbsolutePath(row.storage_path));
  const [parsed] = await parseAssets([{
    filename: row.original_filename,
    content_type: row.mime_type,
    content_base64: buffer.toString('base64'),
  }]);

  const db = getDb();
  if (!parsed || parsed.asset.status === 'failed') {
    db.prepare(`
      UPDATE knowledge_assets
      SET parse_status = 'failed',
          embedding_status = 'failed',
          error_message = @error_message,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: assetId,
      error_message: parsed?.asset?.error_message || 'Document parse failed.',
      updated_at: nowIso(),
    });
    return getIndexStatus(row.project_id);
  }

  let inserted = { entryId: null, chunks: [] };
  db.transaction(() => {
    if (row.entry_id) {
      deleteEntryIndexRows(db, row.entry_id);
      db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(row.entry_id);
    }
    inserted = insertEntryWithChunks(db, {
      projectId: row.project_id,
      type: ASSET_ENTRY_TYPE,
      title: parsed.asset.filename,
      content: parsed.document.text,
      metadata: {
        asset_id: assetId,
        content_type: parsed.asset.content_type,
        filename: parsed.asset.filename,
        sha256: row.sha256,
        source: 'upload',
      },
    });
    db.prepare(`
      UPDATE knowledge_assets
      SET entry_id = @entry_id,
          parse_status = 'parsed',
          embedding_status = @embedding_status,
          error_message = NULL,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: assetId,
      entry_id: inserted.entryId,
      embedding_status: isEmbeddingEnabled() ? 'pending' : 'not-configured',
      updated_at: nowIso(),
    });
  })();

  if (isEmbeddingEnabled()) {
    try {
      await embedChunks(row.project_id, inserted.chunks);
      db.prepare("UPDATE knowledge_assets SET embedding_status = 'indexed', updated_at = ? WHERE id = ?").run(nowIso(), assetId);
    } catch (error) {
      db.prepare(`
        UPDATE knowledge_assets
        SET embedding_status = 'failed',
            error_message = @error_message,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
        id: assetId,
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: nowIso(),
      });
    }
  }

  return getIndexStatus(row.project_id);
}

function deleteKnowledgeAsset(assetId) {
  if (!assetId) throw new Error('assetId is required.');
  const row = getAssetRow(assetId);
  projectService.getProject(row.project_id);
  const absolutePath = assetAbsolutePath(row.storage_path);
  const db = getDb();
  db.transaction(() => {
    if (row.entry_id) {
      deleteEntryIndexRows(db, row.entry_id);
      db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(row.entry_id);
    }
    db.prepare('DELETE FROM knowledge_assets WHERE id = ?').run(assetId);
  })();

  try {
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    const parentDir = path.dirname(absolutePath);
    if (parentDir.startsWith(path.join(dataRootDir(), ASSET_DIRNAME))) {
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  } catch {
    // Deleting the database record is the source of truth; file cleanup can be retried by reindexing later.
  }

  return getIndexStatus(row.project_id);
}

function makeFtsQuery(query) {
  return normalizeText(query)
    .split(/\s+/)
    .map((token) => token.replace(/"/g, ''))
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(' OR ');
}

function rowsByChunkIds(db, projectId, ids = []) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT kc.id, kc.project_id, kc.entry_id, 'chunk' AS type, kc.title, kc.content,
           kc.metadata_json, json_extract(kc.metadata_json, '$.chunk_index') AS chunk_index,
           CASE WHEN kce.chunk_id IS NULL THEN 'pending' ELSE 'indexed' END AS embedding_status,
           NULL AS error_message, kc.created_at, kc.created_at AS updated_at
    FROM knowledge_chunks kc
    LEFT JOIN knowledge_chunk_embeddings kce ON kce.chunk_id = kc.id
    WHERE kc.project_id = ? AND kc.id IN (${placeholders})
  `).all(projectId, ...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

async function vectorSearchRows(db, projectId, query, limit) {
  if (!isEmbeddingEnabled()) return [];

  let queryEmbedding;
  try {
    [queryEmbedding] = await embedTexts([query]);
  } catch {
    return [];
  }
  if (!Array.isArray(queryEmbedding)) return [];

  if (ensureVectorTable(db)) {
    try {
      const matches = db.prepare(`
        SELECT chunk_id, distance
        FROM ${VECTOR_TABLE_NAME}
        WHERE embedding MATCH ? AND k = ?
      `).all(serializeFloat32(queryEmbedding), limit);
      const distances = new Map(matches.map((match) => [match.chunk_id, Number(match.distance || 0)]));
      return rowsByChunkIds(db, projectId, matches.map((match) => match.chunk_id))
        .map((row) => ({
          ...row,
          retrieval_source: 'vector',
          score: Number((1 / (1 + (distances.get(row.id) || 0))).toFixed(4)),
        }));
    } catch {
      // fall through to JSON cosine fallback
    }
  }

  const rows = db.prepare(`
    SELECT kc.id, kc.project_id, kc.entry_id, 'chunk' AS type, kc.title, kc.content,
           kc.metadata_json, json_extract(kc.metadata_json, '$.chunk_index') AS chunk_index,
           'indexed' AS embedding_status, NULL AS error_message,
           kc.created_at, kc.created_at AS updated_at, kce.embedding_json
    FROM knowledge_chunk_embeddings kce
    JOIN knowledge_chunks kc ON kc.id = kce.chunk_id
    WHERE kce.project_id = ?
    LIMIT 500
  `).all(projectId);

  return rows
    .map((row) => {
      const embedding = parseJson(row.embedding_json, []);
      return {
        ...row,
        retrieval_source: 'vector',
        score: Number(cosineSimilarity(queryEmbedding, embedding).toFixed(4)),
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function mergeSearchRows(rows = [], limit = 10) {
  const byId = new Map();
  rows.forEach((row) => {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      return;
    }
    const score = Math.max(Number(existing.score || 0), Number(row.score || 0));
    byId.set(row.id, {
      ...existing,
      retrieval_source: existing.retrieval_source === row.retrieval_source ? existing.retrieval_source : 'hybrid',
      score,
    });
  });
  return Array.from(byId.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, limit);
}

async function searchKnowledge(payload = {}) {
  const projectId = normalizeText(payload.projectId || payload.project_id);
  const query = normalizeText(payload.query);
  const limit = Number(payload.limit || 10);
  if (!projectId || !query) return { entries: [], total: 0 };

  projectService.getProject(projectId);
  const db = getDb();
  const ftsQuery = makeFtsQuery(query);
  let rows = [];
  if (ftsQuery) {
    rows = db.prepare(`
      SELECT kc.id, kc.project_id, kc.entry_id, 'chunk' AS type, kc.title, kc.content,
             kc.metadata_json, json_extract(kc.metadata_json, '$.chunk_index') AS chunk_index,
             CASE WHEN kce.chunk_id IS NULL THEN 'pending' ELSE 'indexed' END AS embedding_status,
             NULL AS error_message, kc.created_at, kc.created_at AS updated_at,
             'fts' AS retrieval_source, 0.65 AS score
      FROM knowledge_chunks_fts fts
      JOIN knowledge_chunks kc ON kc.id = fts.id
      LEFT JOIN knowledge_chunk_embeddings kce ON kce.chunk_id = kc.id
      WHERE fts.project_id = ? AND knowledge_chunks_fts MATCH ?
      LIMIT ?
    `).all(projectId, ftsQuery, limit);
  }

  if (!rows.length) {
    rows = db.prepare(`
      SELECT kc.id, kc.project_id, kc.entry_id, 'chunk' AS type, kc.title, kc.content,
             kc.metadata_json, json_extract(kc.metadata_json, '$.chunk_index') AS chunk_index,
             CASE WHEN kce.chunk_id IS NULL THEN 'pending' ELSE 'indexed' END AS embedding_status,
             NULL AS error_message, kc.created_at, kc.created_at AS updated_at,
             'like' AS retrieval_source, 0.45 AS score
      FROM knowledge_chunks kc
      LEFT JOIN knowledge_chunk_embeddings kce ON kce.chunk_id = kc.id
      WHERE kc.project_id = @projectId
        AND (kc.content LIKE @likeQuery OR kc.title LIKE @likeQuery)
      ORDER BY datetime(kc.created_at) DESC
      LIMIT @limit
    `).all({ projectId, likeQuery: `%${query}%`, limit });
  }

  const vectorRows = await vectorSearchRows(db, projectId, query, limit);
  const mergedRows = mergeSearchRows([...rows, ...vectorRows], limit);
  return { entries: mergedRows.map(rowToEntry), total: mergedRows.length };
}

async function reindexKnowledge(projectId) {
  if (!projectId) throw new Error('projectId is required.');
  projectService.getProject(projectId);
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM knowledge_chunk_embeddings WHERE project_id = ?').run(projectId);
    if (ensureVectorTable(db)) {
      db.prepare(`DELETE FROM ${VECTOR_TABLE_NAME} WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE project_id = ?)`).run(projectId);
    }
    const rows = db.prepare('SELECT id, project_id, title, content FROM knowledge_chunks WHERE project_id = ?').all(projectId);
    const insertFts = db.prepare('INSERT INTO knowledge_chunks_fts (id, project_id, title, content) VALUES (?, ?, ?, ?)');
    rows.forEach((row) => insertFts.run(row.id, row.project_id, row.title || '', row.content));
  })();
  await embedPendingChunks(projectId);
  return getIndexStatus(projectId);
}

function hasMeaningfulDraftProfile(profile = {}) {
  return [
    'company_name',
    'offerings',
    'detailed_address',
    'business_regions',
    'core_advantages',
    'trust_endorsements',
    'proven_cases',
    'target_keywords',
  ].some((field) => {
    const textValue = fieldText(profile, field);
    return textValue && textValue !== UNKNOWN_COMPANY_NAME;
  });
}

function normalizeDraftError(error, prefix = '知识库草稿创建失败') {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (/API Key|401|Unauthorized/i.test(message)) return `${prefix}：API Key 无效或未配置。`;
  if (/429|rate limit|quota/i.test(message)) return `${prefix}：接口限流或额度不足，请稍后重试。`;
  if (/400|BadRequest|InvalidParameter/i.test(message)) return `${prefix}：请求参数或模型配置不兼容。${message}`;
  return `${prefix}：${message}`;
}

function createFailedDraftResponse({ draftId, payload, assets, documents, messageText, errorMessage, timestamp, extraction = {} }) {
  const sourceSummary = {
    text_length: normalizeText(messageText).length,
    asset_count: assets.length,
    parsed_asset_count: assets.filter((asset) => asset.status === 'parsed').length,
    failed_asset_count: assets.filter((asset) => asset.status === 'failed').length,
    fact_count: 0,
    quote_count: 0,
  };
  const warnings = [
    errorMessage,
    ...assets.filter((asset) => asset.status === 'failed').map((asset) => `${asset.filename}: ${asset.error_message}`),
  ].filter(Boolean);

  return {
    id: draftId,
    intent: payload.intent || 'create',
    project_id: projectExists(payload.project_id) ? payload.project_id : null,
    conversation_id: payload.conversation_id || null,
    assistant_message_id: null,
    status: 'failed',
    profile: normalizeProfile({ project_id: payload.project_id || null }),
    facts: [],
    field_reviews: [],
    missing_fields: REQUIRED_FIELDS.map(([, label]) => label),
    confidence: {
      mode: 'failed',
      fact_count: 0,
      average: 0,
      provider: extraction.extraction_provider || null,
    },
    source_summary: sourceSummary,
    source_quotes: [],
    warnings,
    error_message: errorMessage,
    extraction_status: 'failed',
    extraction_model: extraction.extraction_model || 'not-run',
    assets,
    documents,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function createKnowledgeDraftStrict(payload = {}, onEvent = null) {
  const db = getDb();
  const draftId = crypto.randomUUID();
  const timestamp = nowIso();

  onEvent?.({ type: 'status', step_index: 0, message: '正在解析上传资料...', can_proceed: false });
  const parsedAssets = await parseAssets(payload.assets || []);
  const assets = parsedAssets.map(({ asset }) => ({ ...asset, draft_id: draftId }));
  const documents = parsedAssets.map(({ document }) => document);
  const parsedDocuments = documents.filter((document) => document.status === 'parsed' && normalizeText(document.text));
  const messageText = normalizeText(payload.message);
  const documentText = parsedDocuments.map((document) => `# ${document.filename}\n${document.text}`).join('\n\n');
  const inputText = [messageText, documentText].filter(Boolean).join('\n\n');
  const hasAttachment = assets.length > 0;
  const hasUsefulPastedText = messageText.length >= 40 && !/^已上传\s*\d+\s*个附件/.test(messageText);

  if ((hasAttachment && !parsedDocuments.length && !hasUsefulPastedText) || !normalizeText(inputText)) {
    const errorMessage = assets.some((asset) => asset.status === 'failed')
      ? `资料解析失败：${assets.filter((asset) => asset.status === 'failed').map((asset) => `${asset.filename}: ${asset.error_message}`).join('；')}`
      : '未解析到可用于建库的企业资料。请上传 DOCX/TXT/Markdown，或粘贴完整企业资料。';
    const failedDraft = createFailedDraftResponse({ draftId, payload, assets, documents, messageText, errorMessage, timestamp });
    onEvent?.({ type: 'error', error: errorMessage, draft: failedDraft, can_proceed: false });
    return failedDraft;
  }

  console.info('[knowledge-draft] parsed assets', {
    draftId,
    asset_count: assets.length,
    parsed_asset_count: parsedDocuments.length,
    text_length: inputText.length,
    failed_assets: assets.filter((asset) => asset.status === 'failed').map((asset) => ({
      filename: asset.filename,
      error_message: asset.error_message,
    })),
  });

  onEvent?.({ type: 'status', step_index: 1, message: '正在调用知识库抽取模型...', can_proceed: false });
  let extraction;
  try {
    extraction = payload.debug_local_fallback === true
      ? buildLocalExtraction(parsedDocuments, messageText, payload.project_id || null)
      : await extractKnowledgeDraftStream({
          documents: parsedDocuments,
          message: messageText,
          projectId: payload.project_id || null,
          onEvent,
        });
  } catch (error) {
    const errorMessage = normalizeDraftError(error, '知识库抽取模型调用失败');
    const failedDraft = createFailedDraftResponse({ draftId, payload, assets, documents, messageText, errorMessage, timestamp });
    onEvent?.({ type: 'error', error: errorMessage, draft: failedDraft, can_proceed: false });
    return failedDraft;
  }

  const facts = extraction.facts || [];
  const profile = normalizeProfile({
    ...(extraction.profile || {}),
    project_id: projectExists(payload.project_id) ? payload.project_id : extraction.profile?.project_id || null,
  });
  const extractionFailed = extraction.extraction_status === 'failed' || (!facts.length && !hasMeaningfulDraftProfile(profile));
  if (extractionFailed) {
    const errorMessage = facts.length
      ? '模型返回结果缺少有效企业字段，请补充更完整的企业资料后重试。'
      : '模型未抽取到可追溯的企业事实，请补充更完整的企业资料后重试。';
    const failedDraft = createFailedDraftResponse({ draftId, payload, assets, documents, messageText, errorMessage, timestamp, extraction });
    onEvent?.({ type: 'error', error: errorMessage, draft: failedDraft, can_proceed: false });
    return failedDraft;
  }

  const missingFields = extraction.missing_fields || missingFieldsForProfile(profile);
  const fieldReviews = extraction.field_reviews || buildFieldReviews(profile, facts);
  const sourceQuotes = extraction.source_quotes || buildSourceQuotes(parsedDocuments, facts);
  const warnings = [
    ...(extraction.warnings || []),
    ...assets.filter((asset) => asset.status === 'failed').map((asset) => `${asset.filename}: ${asset.error_message}`),
    ...(missingFields.length ? [`仍需补充字段：${missingFields.join('、')}`] : []),
  ];
  const sourceSummary = {
    text_length: inputText.length,
    asset_count: assets.length,
    parsed_asset_count: assets.filter((asset) => asset.status === 'parsed').length,
    failed_asset_count: assets.filter((asset) => asset.status === 'failed').length,
    fact_count: facts.length,
    quote_count: sourceQuotes.length,
  };

  onEvent?.({
    type: 'status',
    step_index: 2,
    message: `已抽取 ${facts.length} 条可追溯事实，正在生成字段核对草稿...`,
    can_proceed: false,
  });

  db.prepare(`
    INSERT INTO knowledge_drafts (
      id, project_id, status, input_text, facts_json, field_reviews_json,
      profile_json, source_quotes_json, assets_json, warnings_json, created_at, updated_at
    )
    VALUES (
      @id, @project_id, 'pending', @input_text, @facts_json, @field_reviews_json,
      @profile_json, @source_quotes_json, @assets_json, @warnings_json, @created_at, @updated_at
    )
  `).run({
    id: draftId,
    project_id: projectExists(payload.project_id) ? payload.project_id : null,
    input_text: inputText,
    facts_json: jsonString(facts),
    field_reviews_json: jsonString(fieldReviews),
    profile_json: jsonString(profile),
    source_quotes_json: jsonString(sourceQuotes),
    assets_json: jsonString(draftAssetsForStorage(payload.assets)),
    warnings_json: jsonString(warnings),
    created_at: timestamp,
    updated_at: timestamp,
  });

  const draft = {
    id: draftId,
    intent: payload.intent || 'create',
    project_id: projectExists(payload.project_id) ? payload.project_id : null,
    conversation_id: payload.conversation_id || null,
    assistant_message_id: null,
    status: 'pending',
    profile,
    facts,
    field_reviews: fieldReviews,
    missing_fields: missingFields,
    confidence: {
      mode: extraction.extraction_provider === 'local' ? 'local-fact-extraction' : 'llm-fact-extraction',
      fact_count: facts.length,
      average: facts.length
        ? Number((facts.reduce((sum, fact) => sum + (fact.confidence || 0), 0) / facts.length).toFixed(2))
        : 0,
      provider: extraction.extraction_provider || null,
    },
    source_summary: sourceSummary,
    source_quotes: sourceQuotes,
    warnings,
    error_message: null,
    extraction_status: extraction.extraction_status || (facts.length ? 'completed' : 'needs_review'),
    extraction_model: extraction.extraction_model || 'unknown',
    assets,
    created_at: timestamp,
    updated_at: timestamp,
  };

  onEvent?.({
    type: 'draft_section',
    section: 'facts',
    message: `已整理 ${facts.length} 条事实候选`,
    items: facts,
    can_proceed: false,
  });
  onEvent?.({
    type: 'draft_section',
    section: 'field_reviews',
    message: `已生成 ${fieldReviews.length} 个字段核对项`,
    items: fieldReviews,
    can_proceed: false,
  });
  onEvent?.({
    type: 'draft_section',
    section: 'source_quotes',
    message: `已关联 ${sourceQuotes.length} 条来源片段`,
    items: sourceQuotes,
    can_proceed: false,
  });
  onEvent?.({ type: 'result', draft, can_proceed: true });
  onEvent?.({ type: 'done', draft, can_proceed: true });
  return draft;
}

module.exports = {
  confirmKnowledgeDraft,
  createKnowledgeAsset,
  createKnowledgeDraft: createKnowledgeDraftStrict,
  createKnowledgeEntry,
  deleteKnowledgeAsset,
  getKnowledgeEntries: listEntries,
  getKnowledgeIndexStatus: getIndexStatus,
  getKnowledgeProfile,
  reparseKnowledgeAsset,
  reindexKnowledge,
  rejectKnowledgeDraft,
  saveEnterpriseProfile,
  searchKnowledge,
  updateKnowledgeProfile,
};
