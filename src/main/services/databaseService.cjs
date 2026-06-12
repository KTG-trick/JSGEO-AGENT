const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DB_FILENAME = 'geo-agent-studio.sqlite3';

let db = null;
let dbPath = null;

function getDatabasePath(baseDir) {
  if (!baseDir) {
    throw new Error('Database base directory is required.');
  }
  return path.join(baseDir, DB_FILENAME);
}

function initializeDatabase(baseDir) {
  if (db) {
    return db;
  }

  fs.mkdirSync(baseDir, { recursive: true });
  dbPath = getDatabasePath(baseDir);
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    createSchema(db);
  } catch (error) {
    closeDatabase();
    throw error;
  }
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database has not been initialized.');
  }
  return db;
}

function getDbPath() {
  return dbPath;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enterprise_profiles (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      profile_json TEXT NOT NULL,
      source_draft_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      input_text TEXT,
      facts_json TEXT,
      field_reviews_json TEXT,
      profile_json TEXT,
      source_quotes_json TEXT,
      assets_json TEXT,
      warnings_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      parse_status TEXT NOT NULL DEFAULT 'pending',
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_project
      ON knowledge_assets(project_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_sha256
      ON knowledge_assets(project_id, sha256);

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE CASCADE,
      title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project_id
      ON knowledge_chunks(project_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_project_hash
      ON knowledge_chunks(project_id, content_hash);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
      USING fts5(id UNINDEXED, project_id UNINDEXED, title, content);

    CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      embedding_json TEXT NOT NULL,
      embedding_model TEXT,
      dimensions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_embeddings_project
      ON knowledge_chunk_embeddings(project_id);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'chat',
      title TEXT NOT NULL,
      summary TEXT,
      summary_model TEXT,
      summary_updated_at TEXT,
      summary_message_count INTEGER NOT NULL DEFAULT 0,
      summary_dirty INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_preview TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_project_kind_updated
      ON conversations(project_id, kind, updated_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER DEFAULT 0,
      content TEXT,
      content_preview TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_attachments_conversation
      ON chat_attachments(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
      ON chat_attachments(message_id);

    CREATE INDEX IF NOT EXISTS idx_chat_attachments_project
      ON chat_attachments(project_id, created_at);

    CREATE TABLE IF NOT EXISTS enterprise_images (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER DEFAULT 0,
      oss_url TEXT NOT NULL,
      oss_object_key TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_enterprise_images_project
      ON enterprise_images(project_id, sort_order);

    CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      artifact_type TEXT,
      artifact_id TEXT,
      metadata_json TEXT,
      dismissed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_events_project_stage_created
      ON workflow_events(project_id, stage_key, created_at);

    CREATE TABLE IF NOT EXISTS geo_question_sets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_geo_question_sets_project_platform
      ON geo_question_sets(project_id, platform, created_at);

    CREATE TABLE IF NOT EXISTS geo_source_discoveries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      question_set_id TEXT REFERENCES geo_question_sets(id) ON DELETE SET NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT,
      source_type TEXT,
      content_format TEXT,
      priority_score REAL NOT NULL DEFAULT 0,
      reason TEXT,
      observed_in_answers TEXT,
      recommended_topics TEXT,
      discovery_json TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_geo_source_discoveries_project_platform
      ON geo_source_discoveries(project_id, platform, created_at);

    CREATE INDEX IF NOT EXISTS idx_geo_source_discoveries_question_set
      ON geo_source_discoveries(question_set_id, created_at);

    CREATE TABLE IF NOT EXISTS geo_article_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      question_set_id TEXT REFERENCES geo_question_sets(id) ON DELETE SET NULL,
      platform TEXT,
      article_type TEXT NOT NULL,
      status TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_geo_article_drafts_project_status
      ON geo_article_drafts(project_id, status, created_at);

    CREATE TABLE IF NOT EXISTS publish_resources (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      platform INTEGER,
      area INTEGER,
      category INTEGER,
      status INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_resources_provider_type_id
      ON publish_resources(provider, resource_type, resource_id);

    CREATE INDEX IF NOT EXISTS idx_publish_resources_type_status
      ON publish_resources(resource_type, status, synced_at);

    CREATE TABLE IF NOT EXISTS publish_orders (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES geo_article_drafts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      partner_sn TEXT NOT NULL,
      external_sn TEXT,
      resource_id INTEGER NOT NULL,
      preview_url TEXT,
      status_code INTEGER,
      published_url TEXT,
      feedback_json TEXT,
      raw_json TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_orders_provider_partner_sn
      ON publish_orders(provider, partner_sn);

    CREATE INDEX IF NOT EXISTS idx_publish_orders_article
      ON publish_orders(article_id, created_at);

    CREATE TABLE IF NOT EXISTS ai_visibility_checks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      question_ids_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_visibility_checks_project_platform
      ON ai_visibility_checks(project_id, platform, created_at);

    CREATE TABLE IF NOT EXISTS evolution_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      platform TEXT,
      rule_type TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_rules_project_status
      ON evolution_rules(project_id, status, created_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  migrateSchema(database);
}

function migrateSchema(database) {
  // 检查 conversations.project_id 是否仍然是 NOT NULL，如果是则改为允许 NULL
  const convColumns = database.prepare('PRAGMA table_info(conversations)').all();
  const convProjectId = convColumns.find((c) => c.name === 'project_id');
  if (convProjectId && convProjectId.notnull === 1) {
    // SQLite 无法直接 ALTER COLUMN，需要重建表
    database.exec(`
      CREATE TABLE conversations_new (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'chat',
        title TEXT NOT NULL,
        summary TEXT,
        summary_model TEXT,
        summary_updated_at TEXT,
        summary_message_count INTEGER NOT NULL DEFAULT 0,
        summary_dirty INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO conversations_new SELECT * FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;
      CREATE INDEX IF NOT EXISTS idx_conversations_project_kind_updated ON conversations(project_id, kind, updated_at);
    `);
  }

  // 检查 messages.project_id 是否仍然是 NOT NULL，如果是则改为允许 NULL
  const msgColumns = database.prepare('PRAGMA table_info(messages)').all();
  const msgProjectId = msgColumns.find((c) => c.name === 'project_id');
  if (msgProjectId && msgProjectId.notnull === 1) {
    database.exec(`
      CREATE TABLE messages_new (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO messages_new SELECT * FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
    `);
  }

  const columns = database.prepare('PRAGMA table_info(conversations)').all();
  const existing = new Set(columns.map((column) => column.name));
  const addColumn = (name, definition) => {
    if (!existing.has(name)) {
      database.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${definition}`);
    }
  };

  addColumn('summary', 'TEXT');
  addColumn('summary_model', 'TEXT');
  addColumn('summary_updated_at', 'TEXT');
  addColumn('summary_message_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('summary_dirty', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('message_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('last_message_preview', 'TEXT');

  const draftColumns = database.prepare('PRAGMA table_info(knowledge_drafts)').all();
  const draftExisting = new Set(draftColumns.map((column) => column.name));
  if (!draftExisting.has('assets_json')) {
    database.exec('ALTER TABLE knowledge_drafts ADD COLUMN assets_json TEXT');
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS publish_resources (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      platform INTEGER,
      area INTEGER,
      category INTEGER,
      status INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_resources_provider_type_id
      ON publish_resources(provider, resource_type, resource_id);

    CREATE INDEX IF NOT EXISTS idx_publish_resources_type_status
      ON publish_resources(resource_type, status, synced_at);

    CREATE TABLE IF NOT EXISTS publish_orders (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES geo_article_drafts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      partner_sn TEXT NOT NULL,
      external_sn TEXT,
      resource_id INTEGER NOT NULL,
      preview_url TEXT,
      status_code INTEGER,
      published_url TEXT,
      feedback_json TEXT,
      raw_json TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_orders_provider_partner_sn
      ON publish_orders(provider, partner_sn);

    CREATE INDEX IF NOT EXISTS idx_publish_orders_article
      ON publish_orders(article_id, created_at);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      parse_status TEXT NOT NULL DEFAULT 'pending',
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_project
      ON knowledge_assets(project_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_sha256
      ON knowledge_assets(project_id, sha256);

    CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      embedding_json TEXT NOT NULL,
      embedding_model TEXT,
      dimensions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_embeddings_project
      ON knowledge_chunk_embeddings(project_id);
  `);

  database.exec(`
    UPDATE conversations
    SET message_count = (
      SELECT COUNT(*)
      FROM messages
      WHERE messages.conversation_id = conversations.id
    )
    WHERE message_count = 0;

    UPDATE conversations
    SET last_message_preview = (
      SELECT substr(replace(replace(content, char(10), ' '), char(13), ' '), 1, 120)
      FROM messages
      WHERE messages.conversation_id = conversations.id
      ORDER BY datetime(created_at) DESC
      LIMIT 1
    )
    WHERE last_message_preview IS NULL;
  `);

  // P3: 为 messages 表添加 token_count 和 content_type 字段
  const msgTableColumns = database.prepare('PRAGMA table_info(messages)').all();
  const msgTableColumnNames = new Set(msgTableColumns.map((col) => col.name));

  if (!msgTableColumnNames.has('token_count')) {
    database.exec('ALTER TABLE messages ADD COLUMN token_count INTEGER DEFAULT 0');
  }

  if (!msgTableColumnNames.has('content_type')) {
    database.exec("ALTER TABLE messages ADD COLUMN content_type TEXT DEFAULT 'text'");
  }
}

module.exports = {
  DB_FILENAME,
  closeDatabase,
  getDatabasePath,
  getDb,
  getDbPath,
  initializeDatabase,
};
