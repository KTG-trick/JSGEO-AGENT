/**
 * 附件管理服务
 *
 * 负责附件的生命周期管理：
 * - 上传和持久化存储
 * - 附件内容解析
 * - 附件与消息关联
 * - 附件清理
 */

const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');

/**
 * 上传附件
 * @param {Object} options - 附件信息
 * @param {string} options.projectId - 企业项目 ID
 * @param {string} options.conversationId - 对话 ID
 * @param {string} options.messageId - 消息 ID
 * @param {string} options.filename - 文件名
 * @param {string} options.mimeType - MIME 类型
 * @param {string} options.content - 解析后的文本内容
 * @returns {Object} 附件信息
 */
function uploadAttachment({ projectId, conversationId, messageId, filename, mimeType, content }) {
  const id = crypto.randomUUID();
  const contentPreview = content && content.length > 500
    ? content.substring(0, 500) + '...'
    : content || '';
  const fileSize = content ? Buffer.byteLength(content, 'utf8') : 0;

  getDb().prepare(`
    INSERT INTO chat_attachments (
      id, project_id, conversation_id, message_id,
      filename, mime_type, file_size, content, content_preview,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId || null,
    conversationId || null,
    messageId || null,
    filename,
    mimeType || null,
    fileSize,
    content || null,
    contentPreview,
    new Date().toISOString()
  );

  return {
    id,
    filename,
    mimeType,
    fileSize,
    contentPreview,
  };
}

/**
 * 获取附件
 * @param {string} attachmentId - 附件 ID
 * @returns {Object|null} 附件信息
 */
function getAttachment(attachmentId) {
  return getDb().prepare('SELECT * FROM chat_attachments WHERE id = ?').get(attachmentId);
}

/**
 * 获取附件的完整内容
 * @param {string} attachmentId - 附件 ID
 * @returns {string|null} 附件内容
 */
function getAttachmentContent(attachmentId) {
  const attachment = getDb().prepare('SELECT content FROM chat_attachments WHERE id = ?').get(attachmentId);
  return attachment?.content || null;
}

/**
 * 获取消息关联的附件
 * @param {string} messageId - 消息 ID
 * @returns {Array} 附件列表
 */
function getAttachmentsForMessage(messageId) {
  return getDb().prepare(`
    SELECT id, filename, mime_type, file_size, content_preview, created_at
    FROM chat_attachments
    WHERE message_id = ?
    ORDER BY created_at ASC
  `).all(messageId);
}

/**
 * 获取对话的所有附件
 * @param {string} conversationId - 对话 ID
 * @returns {Array} 附件列表
 */
function getAttachmentsForConversation(conversationId) {
  return getDb().prepare(`
    SELECT id, filename, mime_type, file_size, content_preview, created_at
    FROM chat_attachments
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId);
}

/**
 * 获取企业的所有附件
 * @param {string} projectId - 企业项目 ID
 * @returns {Array} 附件列表
 */
function getAttachmentsForProject(projectId) {
  return getDb().prepare(`
    SELECT id, filename, mime_type, file_size, content_preview, created_at
    FROM chat_attachments
    WHERE project_id = ?
    ORDER BY created_at DESC
  `).all(projectId);
}

/**
 * 关联附件到消息
 * @param {string} attachmentId - 附件 ID
 * @param {string} messageId - 消息 ID
 */
function linkToMessage(attachmentId, messageId) {
  getDb().prepare(`
    UPDATE chat_attachments SET message_id = ? WHERE id = ?
  `).run(messageId, attachmentId);
}

/**
 * 关联附件到对话
 * @param {string} attachmentId - 附件 ID
 * @param {string} conversationId - 对话 ID
 */
function linkToConversation(attachmentId, conversationId) {
  getDb().prepare(`
    UPDATE chat_attachments SET conversation_id = ? WHERE id = ?
  `).run(conversationId, attachmentId);
}

/**
 * 删除附件
 * @param {string} attachmentId - 附件 ID
 * @returns {boolean} 是否删除成功
 */
function deleteAttachment(attachmentId) {
  const result = getDb().prepare('DELETE FROM chat_attachments WHERE id = ?').run(attachmentId);
  return result.changes > 0;
}

/**
 * 删除消息关联的所有附件
 * @param {string} messageId - 消息 ID
 * @returns {number} 删除的附件数量
 */
function deleteAttachmentsForMessage(messageId) {
  const result = getDb().prepare('DELETE FROM chat_attachments WHERE message_id = ?').run(messageId);
  return result.changes;
}

/**
 * 删除对话关联的所有附件
 * @param {string} conversationId - 对话 ID
 * @returns {number} 删除的附件数量
 */
function deleteAttachmentsForConversation(conversationId) {
  const result = getDb().prepare('DELETE FROM chat_attachments WHERE conversation_id = ?').run(conversationId);
  return result.changes;
}

/**
 * 清理无关联的附件（孤儿附件）
 * @returns {number} 清理的附件数量
 */
function cleanupOrphanedAttachments() {
  // 删除没有关联到任何消息或对话的附件（超过 24 小时）
  const result = getDb().prepare(`
    DELETE FROM chat_attachments
    WHERE message_id IS NULL
      AND conversation_id IS NULL
      AND created_at < datetime('now', '-24 hours')
  `).run();
  return result.changes;
}

module.exports = {
  uploadAttachment,
  getAttachment,
  getAttachmentContent,
  getAttachmentsForMessage,
  getAttachmentsForConversation,
  getAttachmentsForProject,
  linkToMessage,
  linkToConversation,
  deleteAttachment,
  deleteAttachmentsForMessage,
  deleteAttachmentsForConversation,
  cleanupOrphanedAttachments,
};
