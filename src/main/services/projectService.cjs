const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const { fieldText, toEvidenceField } = require('./profileFieldService.cjs');

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeProjectPayload(payload = {}) {
  const name = String(payload.name || payload.company_name || payload.companyName || '').trim();
  if (!name) {
    throw new Error('企业名称不能为空。');
  }

  return {
    name,
    description: payload.description ? String(payload.description).trim() : null,
  };
}

function projectRowToSummary(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createProject(payload = {}) {
  const db = getDb();
  const data = normalizeProjectPayload(payload);
  const timestamp = nowIso();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO projects (id, name, description, status, created_at, updated_at)
    VALUES (@id, @name, @description, 'active', @created_at, @updated_at)
  `).run({
    id,
    name: data.name,
    description: data.description,
    created_at: timestamp,
    updated_at: timestamp,
  });

  return { project: getProject(id).project };
}

function listProjects() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, description, status, created_at, updated_at
    FROM projects
    ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
  `).all();

  return rows.map(projectRowToSummary);
}

function getProject(projectId) {
  if (!projectId) {
    throw new Error('projectId is required.');
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT id, name, description, status, created_at, updated_at
    FROM projects
    WHERE id = ?
  `).get(projectId);

  if (!row) {
    throw new Error('企业项目不存在。');
  }

  return { project: projectRowToSummary(row) };
}

function deleteProject(projectId) {
  if (!projectId) {
    throw new Error('projectId is required.');
  }

  const db = getDb();
  const deleteTx = db.transaction((id) => {
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE project_id = ?').run(id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes;
  });

  return { ok: deleteTx(projectId) > 0 };
}

function countKnowledgeEntries(db, projectId) {
  return db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries WHERE project_id = ?')
    .get(projectId).count;
}

function buildCompatibleProfile(row) {
  const profile = parseJson(row.profile_json, {});
  const companyName = fieldText(profile, 'company_name') || row.name;

  return {
    id: row.profile_id || row.project_id,
    project_id: row.project_id,
    ...profile,
    company_name: profile.company_name || toEvidenceField(companyName),
    short_name: profile.short_name || toEvidenceField(companyName),
    detailed_intro: profile.detailed_intro || toEvidenceField(row.description || null),
    official_website: profile.official_website || null,
    official_media: profile.official_media || null,
    generated_long_tail_keywords: profile.generated_long_tail_keywords || null,
    entry_count: row.entry_count || 0,
    created_at: row.profile_created_at || row.created_at,
    updated_at: row.profile_updated_at || row.updated_at,
  };
}

function listKnowledgeProfiles() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      p.id AS project_id,
      p.name,
      p.description,
      p.created_at,
      p.updated_at,
      ep.project_id AS profile_id,
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
    WHERE p.status = 'active'
    ORDER BY datetime(p.updated_at) DESC, datetime(p.created_at) DESC
  `).all();

  return rows.map(buildCompatibleProfile);
}

function getKnowledgeProfile(projectId, indexStatus = null) {
  getProject(projectId);

  const db = getDb();
  const row = db.prepare(`
    SELECT
      p.id AS project_id,
      p.name,
      p.description,
      p.created_at,
      p.updated_at,
      ep.project_id AS profile_id,
      ep.profile_json,
      ep.created_at AS profile_created_at,
      ep.updated_at AS profile_updated_at,
      ? AS entry_count
    FROM projects p
    LEFT JOIN enterprise_profiles ep ON ep.project_id = p.id
    WHERE p.id = ?
  `).get(countKnowledgeEntries(db, projectId), projectId);

  return {
    profile: buildCompatibleProfile(row),
    entries: [],
    total: 0,
    index_status: indexStatus,
  };
}

module.exports = {
  createProject,
  deleteProject,
  getKnowledgeProfile,
  getProject,
  listKnowledgeProfiles,
  listProjects,
};
