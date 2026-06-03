const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const { chatCompletion } = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');

const SUMMARY_MESSAGE_DELTA = 6;

function nowIso() {
  return new Date().toISOString();
}

function jsonString(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = {}) {
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

function previewText(value, maxLength = 120) {
  const text = normalizeText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function titleFromMessage(message) {
  const text = previewText(message, 32);
  return text || '新对话';
}

function rowToConversation(row) {
  const messageCount = Number(row.message_count || 0);
  return {
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary || null,
    summary_model: row.summary_model || null,
    summary_updated_at: row.summary_updated_at || null,
    summary_message_count: Number(row.summary_message_count || 0),
    summary_dirty: Boolean(row.summary_dirty),
    message_count: messageCount,
    last_message_preview: row.last_message_preview || null,
    last_message: row.last_message_preview || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToMessage(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    metadata: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
  };
}

function isPlaceholderOnlyConversation(conversationId) {
  if (!conversationId) return false;
  const rows = getDb().prepare(`
    SELECT metadata_json
    FROM messages
    WHERE conversation_id = ?
  `).all(conversationId);
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const metadata = parseJson(row.metadata_json, {});
    return metadata.type === 'geo_phase_prompt' && metadata.placeholder === true;
  });
}

function projectExists(projectId) {
  if (!projectId) return false;
  return Boolean(getDb().prepare('SELECT id FROM projects WHERE id = ?').get(projectId));
}

function getConversationRow(conversationId) {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
}

function ensureConversation({ projectId = null, conversationId = null, title = null, firstMessage = '', kind = 'chat' }) {
  // geo_workflow 类型必须绑定有效的 project_id
  if (kind === 'geo_workflow') {
    if (!projectId || !projectExists(projectId)) {
      throw new Error('GEO 优化会话必须绑定有效企业知识库。');
    }
  } else {
    // chat 类型允许 project_id 为 null（公共对话）
    if (projectId && !projectExists(projectId)) {
      throw new Error('当前对话必须绑定有效企业。请先创建或选择企业知识库。');
    }
  }

  const db = getDb();
  if (conversationId) {
    const existing = getConversationRow(conversationId);
    if (existing) {
      if (projectId && existing.project_id !== projectId) {
        throw new Error('这条会话属于其它企业，已阻止跨企业写入。');
      }
      return rowToConversation(existing);
    }
  }

  const timestamp = nowIso();
  const id = conversationId || crypto.randomUUID();
  const nextTitle = normalizeText(title) || titleFromMessage(firstMessage);
  db.prepare(`
    INSERT INTO conversations (
      id, project_id, kind, title, summary_dirty, message_count,
      created_at, updated_at
    )
    VALUES (
      @id, @project_id, @kind, @title, 1, 0,
      @created_at, @updated_at
    )
  `).run({
    id,
    project_id: projectId,
    kind,
    title: nextTitle,
    created_at: timestamp,
    updated_at: timestamp,
  });

  return rowToConversation(getConversationRow(id));
}

function markConversationSummaryDirty(conversationId) {
  getDb().prepare('UPDATE conversations SET summary_dirty = 1 WHERE id = ?').run(conversationId);
}

function updateConversationStats({ conversationId, preview, timestamp }) {
  getDb().prepare(`
    UPDATE conversations
    SET updated_at = @updated_at,
        message_count = (
          SELECT COUNT(*)
          FROM messages
          WHERE conversation_id = @conversation_id
        ),
        last_message_preview = @last_message_preview,
        summary_dirty = 1
    WHERE id = @conversation_id
  `).run({
    conversation_id: conversationId,
    updated_at: timestamp,
    last_message_preview: previewText(preview),
  });
}

function appendConversationMessage({ conversationId, projectId, role, content, metadata = {}, messageId = null }) {
  if (!conversationId) {
    throw new Error('conversationId is required.');
  }
  const cleanContent = String(content || '');
  if (!cleanContent && role !== 'assistant') {
    throw new Error('消息内容不能为空。');
  }

  const db = getDb();
  const conversation = getConversationRow(conversationId);
  if (!conversation) throw new Error('会话不存在。');
  // project_id 为 null 的公共对话不进行 project_id 校验
  if (projectId && conversation.project_id !== null && conversation.project_id !== projectId) {
    throw new Error('会话不属于当前企业。');
  }

  const timestamp = nowIso();
  const id = messageId || crypto.randomUUID();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, project_id, role, content, metadata_json, created_at)
    VALUES (@id, @conversation_id, @project_id, @role, @content, @metadata_json, @created_at)
  `).run({
    id,
    conversation_id: conversationId,
    project_id: projectId,
    role,
    content: cleanContent,
    metadata_json: jsonString(metadata),
    created_at: timestamp,
  });
  updateConversationStats({ conversationId, preview: cleanContent, timestamp });

  return {
    id,
    conversation_id: conversationId,
    project_id: projectId,
    role,
    content: cleanContent,
    metadata,
    created_at: timestamp,
  };
}

function addMessage(payload) {
  return appendConversationMessage(payload);
}

function updateConversationMessage({ messageId, conversationId, projectId, content, metadata = {} }) {
  if (!messageId || !conversationId) {
    throw new Error('messageId and conversationId are required.');
  }
  const db = getDb();
  // 公共对话的消息（project_id 为 null）不校验 projectId
  let existing;
  if (projectId) {
    existing = db.prepare(`
      SELECT *
      FROM messages
      WHERE id = ? AND conversation_id = ? AND project_id = ?
    `).get(messageId, conversationId, projectId);
  } else {
    existing = db.prepare(`
      SELECT *
      FROM messages
      WHERE id = ? AND conversation_id = ? AND project_id IS NULL
    `).get(messageId, conversationId);
  }
  if (!existing) throw new Error('消息不存在。');

  const timestamp = nowIso();
  const nextContent = String(content ?? existing.content ?? '');
  const nextMetadata = {
    ...parseJson(existing.metadata_json, {}),
    ...(metadata || {}),
  };
  db.prepare(`
    UPDATE messages
    SET content = @content,
        metadata_json = @metadata_json
    WHERE id = @id
  `).run({
    id: messageId,
    content: nextContent,
    metadata_json: jsonString(nextMetadata),
  });
  updateConversationStats({ conversationId, preview: nextContent, timestamp });

  return {
    id: messageId,
    conversation_id: conversationId,
    project_id: projectId,
    role: existing.role,
    content: nextContent,
    metadata: nextMetadata,
    created_at: existing.created_at,
  };
}

function markKnowledgeDraftConfirmed({ conversationId, projectId, draftId }) {
  if (!conversationId || !projectId || !draftId) return null;
  const db = getDb();
  const rows = db.prepare(`
    SELECT *
    FROM messages
    WHERE conversation_id = ? AND project_id = ? AND role = 'assistant'
    ORDER BY datetime(created_at) ASC
  `).all(conversationId, projectId);

  const draftMessage = rows.find((row) => {
    const metadata = parseJson(row.metadata_json, {});
    return metadata.type === 'knowledge_draft' && metadata.draft?.id === draftId;
  });
  if (!draftMessage) return null;

  const metadata = parseJson(draftMessage.metadata_json, {});
  const nextDraft = {
    ...(metadata.draft || {}),
    status: 'confirmed',
    confirmation_state: 'output-available',
  };
  return updateConversationMessage({
    messageId: draftMessage.id,
    conversationId,
    projectId,
    content: draftMessage.content,
    metadata: {
      ...metadata,
      draft: nextDraft,
      status: 'confirmed',
      confirmation_state: 'output-available',
      confirmation_approved: true,
    },
  });
}

function shouldSummarize(row, reason) {
  const messageCount = Number(row.message_count || 0);
  const summarizedCount = Number(row.summary_message_count || 0);
  if (messageCount < 2) return false;
  if (!row.summary) return true;
  if (messageCount - summarizedCount >= SUMMARY_MESSAGE_DELTA) return true;
  if ((reason === 'switch' || reason === 'history_open' || reason === 'new_conversation') && row.summary_dirty) {
    return messageCount > summarizedCount;
  }
  return false;
}

function formatMessagesForSummary(messages) {
  return messages
    .slice(-18)
    .map((message) => {
      const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '系统';
      const metadataType = message.metadata?.type ? ` [${message.metadata.type}]` : '';
      return `${role}${metadataType}: ${previewText(message.content, 500)}`;
    })
    .join('\n');
}

async function maybeUpdateConversationSummary(conversationId, reason = 'manual') {
  const row = getConversationRow(conversationId);
  if (!row || !shouldSummarize(row, reason)) {
    return { updated: false, conversation: row ? rowToConversation(row) : null };
  }

  const db = getDb();
  const messages = db.prepare(`
    SELECT *
    FROM messages
    WHERE conversation_id = ?
    ORDER BY datetime(created_at) ASC
  `).all(conversationId).map(rowToMessage);
  if (messages.length < 2) {
    return { updated: false, conversation: rowToConversation(row) };
  }

  const policy = getTaskPolicy('reflection');
  if (!policy.provider || !policy.model) {
    return { updated: false, conversation: rowToConversation(row) };
  }
  if (policy.api_family && policy.api_family !== 'chat_completions') {
    return { updated: false, conversation: rowToConversation(row) };
  }

  try {
    const completion = await chatCompletion({
      provider: policy.provider,
      model: policy.model,
      temperature: 0.2,
      maxTokens: 260,
      forceNoResponseFormat: true,
      messages: [
        {
          role: 'system',
          content: [
            '你是 GEO-Agent Studio 的会话历史摘要器。',
            '请为历史列表生成一个简短中文摘要标题，最多 28 个汉字。',
            '摘要要覆盖这个会话截至最新消息的主要目的，例如建库、问题池、信源发现、支撑内容或普通咨询。',
            '只输出摘要文本，不要 Markdown，不要解释。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: formatMessagesForSummary(messages),
        },
      ],
    });
    const summary = previewText(completion.content, 64) || row.title;
    const timestamp = nowIso();
    db.prepare(`
      UPDATE conversations
      SET summary = @summary,
          summary_model = @summary_model,
          summary_updated_at = @summary_updated_at,
          summary_message_count = @summary_message_count,
          summary_dirty = 0
      WHERE id = @id
    `).run({
      id: conversationId,
      summary,
      summary_model: `${completion.provider}/${completion.model}`,
      summary_updated_at: timestamp,
      summary_message_count: messages.length,
    });
    return { updated: true, conversation: rowToConversation(getConversationRow(conversationId)) };
  } catch (error) {
    console.warn('[conversation] summary update failed', error?.message || error);
    return { updated: false, conversation: rowToConversation(getConversationRow(conversationId) || row) };
  }
}

async function refreshStaleSummaries(rows, reason) {
  const candidates = rows.filter((row) => shouldSummarize(row, reason)).slice(0, 3);
  for (const row of candidates) {
    await maybeUpdateConversationSummary(row.id, reason);
  }
}

async function listConversations(projectId = null, limit = 40, options = {}) {
  const db = getDb();
  let rows;

  if (projectId && !projectExists(projectId)) {
    return { conversations: [] };
  }

  if (projectId) {
    // 返回该知识库的所有对话（包括 geo_workflow）
    rows = db.prepare(`
      SELECT *
      FROM conversations
      WHERE project_id = ?
      ORDER BY datetime(updated_at) DESC
      LIMIT ?
    `).all(projectId, Number(limit || 40));
  } else {
    // projectId 为 null 时，返回公共对话
    rows = db.prepare(`
      SELECT *
      FROM conversations
      WHERE project_id IS NULL AND kind = 'chat'
      ORDER BY datetime(updated_at) DESC
      LIMIT ?
    `).all(Number(limit || 40));
  }

  const visibleRows = rows.filter((row) => !isPlaceholderOnlyConversation(row.id));

  if (options.refreshSummaries !== false) {
    refreshStaleSummaries(visibleRows, options.reason || 'history_open').catch((error) => {
      console.warn('[conversation] background summary refresh failed', error?.message || error);
    });
  }
  return { conversations: visibleRows.map(rowToConversation) };
}

async function getConversation(conversationId, options = {}) {
  if (isPlaceholderOnlyConversation(conversationId)) {
    throw new Error('该历史记录只是旧阶段二占位提示，已自动忽略。');
  }
  if (options.refreshSummary !== false) {
    maybeUpdateConversationSummary(conversationId, options.reason || 'switch').catch((error) => {
      console.warn('[conversation] background summary update failed', error?.message || error);
    });
  }
  const db = getDb();
  const conversation = getConversationRow(conversationId);
  if (!conversation) throw new Error('会话不存在或已删除。');
  const messages = db.prepare(`
    SELECT *
    FROM messages
    WHERE conversation_id = ?
    ORDER BY datetime(created_at) ASC
  `).all(conversationId);
  return {
    conversation: rowToConversation(conversation),
    messages: messages.map(rowToMessage),
  };
}

async function touchConversationForSummary(conversationId, reason = 'manual') {
  return maybeUpdateConversationSummary(conversationId, reason);
}

function deleteConversation(conversationId) {
  const result = getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  return { ok: result.changes > 0 };
}

function clearConversationHistory({ projectId = null, scope = 'project' } = {}) {
  const db = getDb();
  if (scope === 'all') {
    db.prepare("DELETE FROM conversations WHERE kind = 'chat'").run();
    return { ok: true, scope: 'all' };
  }
  if (!projectId) {
    throw new Error('清空历史需要提供 projectId。');
  }
  db.prepare("DELETE FROM conversations WHERE project_id = ? AND kind = 'chat'").run(projectId);
  return { ok: true, scope: 'project', project_id: projectId };
}

function findLatestConversation(projectId, kind = null) {
  const db = getDb();
  let row;
  if (projectId && kind) {
    row = db.prepare(
      `SELECT * FROM conversations WHERE project_id = ? AND kind = ? ORDER BY datetime(updated_at) DESC LIMIT 1`
    ).get(projectId, kind);
  } else if (projectId) {
    row = db.prepare(
      `SELECT * FROM conversations WHERE project_id = ? ORDER BY datetime(updated_at) DESC LIMIT 1`
    ).get(projectId);
  } else {
    // projectId 为 null 时查找公共对话
    row = db.prepare(
      `SELECT * FROM conversations WHERE project_id IS NULL AND kind = 'chat' ORDER BY datetime(updated_at) DESC LIMIT 1`
    ).get();
  }
  return row ? rowToConversation(row) : null;
}

async function listPublicConversations(limit = 40) {
  return listConversations(null, limit);
}

module.exports = {
  addMessage,
  appendConversationMessage,
  clearConversationHistory,
  deleteConversation,
  ensureConversation,
  findLatestConversation,
  getConversation,
  listConversations,
  listPublicConversations,
  markKnowledgeDraftConfirmed,
  markConversationSummaryDirty,
  maybeUpdateConversationSummary,
  touchConversationForSummary,
  updateConversationMessage,
};
