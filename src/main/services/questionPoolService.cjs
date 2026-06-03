const crypto = require('node:crypto');
const { getDb } = require('./databaseService.cjs');
const { responsesStream, parseJsonContent } = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const { getSkill } = require('./skillService.cjs');

// 工具函数
function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * 行转对象
 */
function rowToQuestionSet(row) {
  return {
    id: row.id,
    geo_project_id: row.project_id,
    enterprise_project_id: row.project_id,
    platform: row.platform,
    questions: parseJson(row.questions_json, {}),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * 获取企业 Profile
 */
function getEnterpriseProfile(projectId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM enterprise_profiles WHERE project_id = ?').get(projectId);
  if (!row) return null;
  return parseJson(row.profile_json, {});
}

/**
 * 获取已确认的 evolution rules
 */
function getEvolutionRules(projectId, platform) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM evolution_rules
    WHERE project_id = ? AND status = 'approved'
    AND (platform = ? OR platform IS NULL)
  `).all(projectId, platform);
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    rule_type: row.rule_type,
    confidence: row.confidence,
  }));
}

/**
 * 构建 Prompt（使用 skill）
 */
function buildQuestionPoolMessages({ profile, platform, evolutionRules }) {
  // 加载 skill
  const skill = getSkill('geo-question-set');
  if (!skill) {
    throw new Error('未找到 geo-question-set skill');
  }

  const platformLabel = platform === 'doubao' ? '豆包' : 'DeepSeek';

  return [
    {
      role: 'system',
      content: skill.content,
    },
    {
      role: 'user',
      content: `请为以下企业生成 AI 问题池：

## 企业信息
- 公司名称：${profile.company_name || '未填写'}
- 所属行业：${profile.industry || '未填写'}
- 主营业务：${profile.main_business || '未填写'}
- 产品/服务：${profile.products_services || '未填写'}
- 核心优势：${profile.core_advantages || '未填写'}
- 用户痛点：${profile.user_pain_points || '未填写'}
- 业务区域：${profile.business_regions || '未填写'}
- 目标关键词：${profile.target_keywords || '未填写'}

## 目标平台
${platformLabel}

${evolutionRules.length > 0 ? `## 已确认优化规则\n${evolutionRules.map((r) => `- ${r.content}`).join('\n')}` : ''}

请生成 15-25 个问题，覆盖所有 6 种问题类型。`,
    },
  ];
}

/**
 * 保存问题集
 */
function saveQuestionSet({ projectId, platform, questions, status }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const timestamp = nowIso();

  const rankingQuestions = questions.filter((q) => q.priority >= 7);
  const summary = `已生成 ${questions.length} 个问题，其中 ${rankingQuestions.length} 个高优先级问题。`;

  db.prepare(`
    INSERT INTO geo_question_sets (id, project_id, platform, questions_json, status, created_at, updated_at)
    VALUES (@id, @project_id, @platform, @questions_json, @status, @created_at, @updated_at)
  `).run({
    id,
    project_id: projectId,
    platform,
    questions_json: JSON.stringify({
      summary,
      question_pool: questions,
      ranking_questions: rankingQuestions,
    }),
    status,
    created_at: timestamp,
    updated_at: timestamp,
  });

  // 写入 workflow_events
  db.prepare(`
    INSERT INTO workflow_events (id, project_id, stage_key, event_type, status, title, content, artifact_type, artifact_id, created_at, updated_at)
    VALUES (@id, @project_id, @stage_key, @event_type, @status, @title, @content, @artifact_type, @artifact_id, @created_at, @updated_at)
  `).run({
    id: crypto.randomUUID(),
    project_id: projectId,
    stage_key: `phase_two_${platform}`,
    event_type: 'question_set_generated',
    status,
    title: `${platform === 'doubao' ? '豆包' : 'DeepSeek'} 问题池生成`,
    content: summary,
    artifact_type: 'geo_question_set',
    artifact_id: id,
    created_at: timestamp,
    updated_at: timestamp,
  });

  return getQuestionSet(id);
}

/**
 * 非流式生成问题池
 */
async function generateQuestionPool({ projectId, platform }) {
  const profile = getEnterpriseProfile(projectId);
  if (!profile) {
    throw new Error('企业知识库不存在');
  }

  const evolutionRules = getEvolutionRules(projectId, platform);
  const messages = buildQuestionPoolMessages({ profile, platform, evolutionRules });
  const policy = getTaskPolicy('question_pool_generation', { platform });

  const result = await responsesStream({
    messages,
    temperature: 0.3,
    maxTokens: 5000,
    provider: policy.provider,
    model: policy.model,
    networkMode: policy.network_mode,
    deepThinking: policy.deep_thinking,
    onEvent: null,
  });

  const questions = parseJsonContent(result.content);
  return saveQuestionSet({ projectId, platform, questions, status: 'pending' });
}

/**
 * 流式生成问题池
 */
async function generateQuestionPoolStream({ projectId, platform, conversationId, onEvent }) {
  const profile = getEnterpriseProfile(projectId);
  if (!profile) {
    throw new Error('企业知识库不存在');
  }

  // 发送状态事件
  onEvent?.({ type: 'status', step_index: 0, message: '正在读取企业知识库...' });

  const evolutionRules = getEvolutionRules(projectId, platform);
  const messages = buildQuestionPoolMessages({ profile, platform, evolutionRules });
  const policy = getTaskPolicy('question_pool_generation', { platform });

  onEvent?.({
    type: 'status',
    step_index: 1,
    message: `正在调用 ${policy.provider}/${policy.model} 生成问题池...`,
  });

  const streamResult = await responsesStream({
    messages,
    temperature: 0.3,
    maxTokens: 5000,
    provider: policy.provider,
    model: policy.model,
    networkMode: policy.network_mode,
    deepThinking: policy.deep_thinking,
    onEvent: (event) => {
      // 思考过程 → reasoning_delta（前端折叠展示）
      // 注意：豆包助手 API 边想边搜模式下，reasoning_delta 是思考过程
      if (event.type === 'reasoning_delta' && event.text) {
        onEvent?.({ type: 'reasoning_delta', text: event.text });
      }
      // 不转发 delta（原始 JSON 输出）给前端，避免 UI 显示大段原始内容
      // 前端通过 status 事件了解进度，通过 result 事件获取结构化数据
    },
  });

  onEvent?.({ type: 'status', step_index: 2, message: '正在解析问题池...' });

  // 解析 JSON：依次尝试代码块、直接解析、提取数组
  let questions = [];
  const content = streamResult.content || '';

  // 方法 1：提取 ```json ... ``` 代码块
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        questions = parsed;
      } else if (parsed && typeof parsed === 'object') {
        questions = parsed.questions || parsed.question_pool || parsed.data || [];
      }
    } catch {
      // 继续尝试下一个方法
    }
  }

  // 方法 2：直接解析整个内容
  if (questions.length === 0) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        questions = parsed;
      } else if (parsed && typeof parsed === 'object') {
        questions = parsed.questions || parsed.question_pool || parsed.data || [];
      }
    } catch {
      // 继续尝试下一个方法
    }
  }

  // 方法 3：提取 JSON 数组
  if (questions.length === 0) {
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        questions = JSON.parse(arrayMatch[0]);
      } catch {
        // 解析失败
      }
    }
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('模型返回内容无法解析为有效的问题池。');
  }

  onEvent?.({ type: 'status', step_index: 3, message: `已生成 ${questions.length} 个问题` });

  const questionSet = saveQuestionSet({ projectId, platform, questions, status: 'pending' });

  onEvent?.({ type: 'status', step_index: 4, message: '已保存问题池' });
  onEvent?.({ type: 'result', question_set: questionSet });

  return questionSet;
}

/**
 * 获取问题集
 */
function getQuestionSet(questionSetId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM geo_question_sets WHERE id = ?').get(questionSetId);
  return row ? rowToQuestionSet(row) : null;
}

/**
 * 获取最新问题集
 */
function getLatestQuestionSet(projectId, platform) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM geo_question_sets
    WHERE project_id = ? AND platform = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(projectId, platform);
  return row ? rowToQuestionSet(row) : null;
}

/**
 * 确认问题集
 */
function confirmQuestionSet(questionSetId) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(`
    UPDATE geo_question_sets SET status = 'confirmed', updated_at = ? WHERE id = ?
  `).run(timestamp, questionSetId);

  return getQuestionSet(questionSetId);
}

module.exports = {
  generateQuestionPool,
  generateQuestionPoolStream,
  getQuestionSet,
  getLatestQuestionSet,
  confirmQuestionSet,
};
