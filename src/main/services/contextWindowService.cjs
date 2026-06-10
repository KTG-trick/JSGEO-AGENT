/**
 * 上下文窗口管理服务
 *
 * 负责构建发送给 LLM 的上下文消息，包括：
 * - Token 计数和估算
 * - 消息截断策略
 * - 动态 System Prompt 构建
 * - GEO 流程消息保护
 */

const conversationService = require('./conversationService.cjs');
const { getDb } = require('./databaseService.cjs');

// GEO 消息类型识别 - 这些消息永远不会被截断或压缩
const GEO_MESSAGE_TYPES = [
  'knowledge_draft',
  'geo_phase',
  'source_discovery',
  'article_draft',
  'support_articles',
  'knowledge_draft_request',
  'knowledge_draft_confirmed',
];

/**
 * 判断是否为 GEO 流程消息
 * @param {Object} message - 消息对象
 * @returns {boolean}
 */
function isGeoMessage(message) {
  try {
    const metadata = JSON.parse(message.metadata_json || '{}');
    return GEO_MESSAGE_TYPES.includes(metadata.type);
  } catch {
    return false;
  }
}

/**
 * 估算文本的 Token 数量
 * 中文约 1.5 token/字，英文约 0.75 token/word
 * @param {string} text - 文本内容
 * @returns {number} 估算的 token 数量
 */
function estimateTokens(text) {
  if (!text) return 0;

  // 统计中文字符数
  const chineseChars = (text.match(/[一-龥]/g) || []).length;

  // 统计其他字符数（英文、数字、标点等）
  const otherChars = text.length - chineseChars;

  // 中文约 1.5 token/字，英文约 0.75 token/word
  return Math.ceil(chineseChars * 1.5 + otherChars * 0.75);
}

/**
 * 压缩消息为摘要
 * @param {Array} messages - 需要压缩的消息数组
 * @returns {string} 压缩后的摘要文本
 */
function compressMessages(messages) {
  if (!messages || messages.length === 0) return '';

  const summaryParts = [];

  for (const msg of messages) {
    const role = msg.role === 'user' ? '用户' : '助手';
    const content = msg.content || '';

    // 截取前 200 字符作为摘要
    const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;

    if (truncated) {
      summaryParts.push(`${role}：${truncated}`);
    }
  }

  return summaryParts.join('\n');
}

/**
 * 构建动态 System Prompt
 * @param {string} projectId - 企业项目 ID
 * @returns {Promise<string>} System Prompt
 */
async function buildSystemPrompt(projectId) {
  const basePrompt = '你是一个智能助手，可以帮助用户进行对话、分析文件、建立企业知识库等任务。请用中文回复。';

  if (!projectId) return basePrompt;

  try {
    // 获取企业知识库信息
    const profile = getDb().prepare('SELECT * FROM enterprise_profiles WHERE project_id = ?').get(projectId);
    if (!profile) return basePrompt;

    const sections = [];

    // 基础信息
    if (profile.company_name && profile.company_name !== '待补充') {
      sections.push(`企业名称：${profile.company_name}`);
    }
    if (profile.industry_category && profile.industry_category !== '待补充') {
      sections.push(`所属行业：${profile.industry_category}`);
    }
    if (profile.offerings && profile.offerings !== '待补充') {
      sections.push(`产品与服务：${profile.offerings}`);
    }
    if (profile.target_keywords && profile.target_keywords !== '待补充') {
      sections.push(`目标关键词：${profile.target_keywords}`);
    }
    if (profile.detailed_intro && profile.detailed_intro !== '待补充') {
      // 截取前 500 字符作为简介
      const intro = profile.detailed_intro.length > 500
        ? profile.detailed_intro.substring(0, 500) + '...'
        : profile.detailed_intro;
      sections.push(`企业简介：${intro}`);
    }

    if (sections.length > 0) {
      return `${basePrompt}\n\n[当前企业知识库]\n${sections.join('\n')}`;
    }
  } catch (error) {
    console.warn('[contextWindowService] Failed to build dynamic system prompt:', error.message);
  }

  return basePrompt;
}

/**
 * 截断消息以适应上下文窗口
 * @param {Array} messages - 完整的消息历史（数据库格式）
 * @param {number} maxTokens - 最大 token 数量
 * @param {number} recentCount - 保留最近的消息数量
 * @returns {Array} 截断后的消息数组（LLM API 格式：{role, content}）
 */
function truncateMessages(messages, maxTokens, recentCount) {
  if (!messages || messages.length === 0) return [];

  // 将数据库消息转换为 LLM API 格式
  const formatMessage = (msg) => ({
    role: msg.role || 'user',
    content: msg.content || '',
  });

  // 分离 GEO 消息和普通消息
  const geoMessages = [];
  const normalMessages = [];

  for (const msg of messages) {
    if (isGeoMessage(msg)) {
      geoMessages.push(msg);
    } else {
      normalMessages.push(msg);
    }
  }

  // 计算 GEO 消息的 token 数量
  const geoTokens = geoMessages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

  // 计算普通消息的可用 token 预算
  const availableTokens = maxTokens - geoTokens;

  // 如果普通消息未超限，返回全部（转换格式）
  const normalTokens = normalMessages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
  if (normalTokens <= availableTokens * 0.7) {
    return messages.map(formatMessage);
  }

  // 超限时，保留最近的普通消息，压缩早期消息
  const recentNormal = normalMessages.slice(-recentCount);
  const earlyNormal = normalMessages.slice(0, -recentCount);

  // 压缩早期消息
  const earlySummary = compressMessages(earlyNormal);

  // 构建结果：早期摘要 + 最近普通消息 + GEO 消息（转换格式）
  const result = [];

  if (earlySummary) {
    result.push({
      role: 'system',
      content: `[历史摘要] ${earlySummary}`,
    });
  }

  result.push(...recentNormal.map(formatMessage));
  result.push(...geoMessages.map(formatMessage));

  return result;
}

/**
 * 构建上下文窗口
 * @param {string} conversationId - 对话 ID
 * @param {string} projectId - 企业项目 ID
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 构建好的上下文
 */
async function buildContextWindow(conversationId, projectId, options = {}) {
  const {
    maxTokens = 100000,
    recentMessageCount = 8,
  } = options;

  // 1. 构建动态 System Prompt
  const systemPrompt = await buildSystemPrompt(projectId);

  // 2. 获取历史消息
  let messages = [];
  if (conversationId) {
    try {
      const conversationData = await conversationService.getConversation(conversationId);
      messages = conversationData?.messages || [];
    } catch (error) {
      console.warn('[contextWindowService] Failed to get conversation messages:', error.message);
    }
  }

  // 3. Token 计数和截断
  const history = truncateMessages(messages, maxTokens, recentMessageCount);

  // 4. 计算 token 使用情况
  const systemTokens = estimateTokens(systemPrompt);
  const historyTokens = history.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

  return {
    systemPrompt,
    history,
    tokenUsage: {
      system: systemTokens,
      history: historyTokens,
      total: systemTokens + historyTokens,
      maxTokens,
      usagePercentage: Math.round(((systemTokens + historyTokens) / maxTokens) * 100),
    },
  };
}

module.exports = {
  estimateTokens,
  truncateMessages,
  buildSystemPrompt,
  buildContextWindow,
  isGeoMessage,
  GEO_MESSAGE_TYPES,
};
