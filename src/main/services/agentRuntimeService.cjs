const conversationService = require('./conversationService.cjs');
const contextWindowService = require('./contextWindowService.cjs');
const llmGateway = require('./llmGateway.cjs');
const articleDraftService = require('./articleDraftService.cjs');
const knowledgeService = require('./knowledgeService.cjs');
const attachmentService = require('./attachmentService.cjs');
const traceService = require('./agentTraceService.cjs');
const { getDb } = require('./databaseService.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const { fieldText } = require('./profileFieldService.cjs');

const MAX_ADDITIONAL_ARTICLES = 6;
const PROFILE_FIELD_HINTS = [
  ['company_name', ['公司名称', '企业名称', '品牌名称']],
  ['short_name', ['简称', '公司简称', '品牌简称']],
  ['industry_category', ['行业', '行业分类']],
  ['business_regions', ['业务区域', '服务区域']],
  ['offerings', ['产品服务', '服务', '产品']],
  ['target_audiences', ['目标客户', '目标客群', '客户群']],
  ['core_advantages', ['核心优势', '优势']],
  ['trust_endorsements', ['信任背书', '资质', '荣誉']],
  ['proven_cases', ['案例', '客户案例']],
  ['target_keywords', ['目标关键词', '关键词']],
  ['official_website', ['官网', '官方网站']],
  ['contact_info', ['联系方式', '电话', '联系人']],
];

function clampCount(value) {
  const number = Number(value || 1);
  if (!Number.isFinite(number)) return 1;
  return Math.min(MAX_ADDITIONAL_ARTICLES, Math.max(1, Math.floor(number)));
}

function formatRetryMessage(attempt, maxAttempts, errorType) {
  const typeText = {
    timeout: 'API 超时',
    network: '网络连接异常',
    server: '服务暂不可用',
    api: '请求失败',
  }[errorType] || '请求失败';
  return `${typeText}，重试${attempt}/${maxAttempts}…`;
}

function parseRequestedArticleCount(text) {
  const value = String(text || '');
  const digitMatch = value.match(/(\d{1,2})\s*(篇|个|条)?/);
  if (digitMatch) return clampCount(digitMatch[1]);
  const cnMap = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cnMatch = value.match(/([一两二三四五六七八九十])\s*(篇|个|条)?/);
  return cnMatch ? clampCount(cnMap[cnMatch[1]] || 1) : 1;
}

function inferAdditionalArticleRequest(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const asksArticle = /(文章|稿件|内容|排行榜稿|支撑稿|测评稿|咨询稿)/.test(value);
  const asksMore = /(继续|再|另|补充|加|生成|写|来)/.test(value);
  if (!asksArticle || !asksMore) return null;
  return {
    count: parseRequestedArticleCount(value),
    articleRole: /(排行|榜单|TOP|top)/.test(value)
      ? 'ranking'
      : /(支撑|科普|咨询|测评|案例|品牌)/.test(value)
        ? 'support'
        : 'auto',
    instruction: value,
  };
}

function inferKnowledgeUpdateRequest(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const mentionsKnowledge = /(知识库|企业资料|公司信息|品牌信息|补充资料)/.test(value);
  const asksMutation = /(更新|修改|补充|写入|记录|加入|新增|改成|修正)/.test(value);
  if (!mentionsKnowledge || !asksMutation) return null;
  return { instruction: value };
}

function inferArticleRevisionRequest(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const mentionsDraft = /(这篇|该篇|稿件|文章|正文|标题)/.test(value);
  const asksRevision = /(修改|改写|润色|重写|优化|调整|语气|客观|补充|删除)/.test(value);
  if (!mentionsDraft || !asksRevision) return null;
  return { instruction: value };
}

function inferViewKnowledgeRequest(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (/(查看|列出|展示|当前).*(知识库|企业资料|企业信息)/.test(value)) {
    return { instruction: value };
  }
  return null;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function contextUsagePayload(tokenUsage, modelId = '') {
  const total = Number(tokenUsage?.total || 0);
  const maxTokens = Number(tokenUsage?.maxTokens || 0);
  return {
    usedTokens: total,
    maxTokens,
    usagePercentage: Number(tokenUsage?.usagePercentage || (maxTokens ? Math.round((total / maxTokens) * 100) : 0)),
    modelId,
    inputTokens: total,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheTokens: 0,
  };
}

function profileValue(profile, key) {
  return fieldText(profile || {}, key);
}

function makeEvidenceValue(value) {
  const text = normalizeText(value);
  return { value: text, source_quote: '来自本轮对话指令', confidence: 0.72 };
}

function extractKnowledgePatch(instruction, currentProfile = {}) {
  const patch = {};
  const changes = [];
  const text = String(instruction || '');
  PROFILE_FIELD_HINTS.forEach(([key, labels]) => {
    for (const label of labels) {
      const pattern = new RegExp(`${label}\\s*[：:]\\s*([^\\n；;。]+)`);
      const match = text.match(pattern);
      if (!match) continue;
      const nextValue = normalizeText(match[1]);
      if (!nextValue) continue;
      patch[key] = makeEvidenceValue(nextValue);
      changes.push({
        field: key,
        label,
        oldValue: profileValue(currentProfile, key) || '',
        newValue: nextValue,
        source: instruction,
      });
      break;
    }
  });
  return { patch, changes };
}

function latestArticleDraft(projectId) {
  if (!projectId) return null;
  const row = getDb().prepare(`
    SELECT id
    FROM geo_article_drafts
    WHERE project_id = ?
    ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
    LIMIT 1
  `).get(projectId);
  return row?.id ? articleDraftService.getArticleDraft(row.id) : null;
}

function suggestionsFor({ intent, pendingAction = null, additionalResult = null, contextPack = null } = {}) {
  if (pendingAction) {
    return [
      { label: '查看待确认内容', value: pendingAction.title, actionType: 'propose_action', payload: pendingAction },
      { label: '查看当前知识库', value: '请查看当前企业知识库的完整内容。', actionType: 'send_message' },
      { label: '取消这次操作', value: '取消这次待确认操作。', actionType: 'send_message' },
    ];
  }
  if (intent === 'generate_additional_articles' || additionalResult) {
    return [
      { label: '再生成 1 篇排行榜稿', value: '再生成 1 篇排行榜稿', actionType: 'send_message' },
      { label: '生成 3 篇支撑稿', value: '再生成 3 篇支撑稿', actionType: 'send_message' },
      { label: '前往稿件管理校对', value: 'drafts', actionType: 'navigate', payload: { view: 'drafts' } },
    ];
  }
  if (contextPack?.draftState) {
    return [
      { label: '继续生成 1 篇稿件', value: '继续生成 1 篇完整文章', actionType: 'send_message' },
      { label: '把最近稿件改客观', value: '把最近这篇稿件的语气改得更客观', actionType: 'send_message' },
      { label: '前往稿件管理', value: 'drafts', actionType: 'navigate', payload: { view: 'drafts' } },
    ];
  }
  if (contextPack?.projectMemory) {
    return [
      { label: '分析 GEO 缺口', value: '基于当前企业知识库，分析豆包和 DeepSeek 的 GEO 缺口。', actionType: 'send_message' },
      { label: '生成关键词', value: '根据当前企业知识库生成目标关键词和长尾用户问题。', actionType: 'send_message' },
      { label: '生成知识库更新提案', value: '根据刚才的内容生成待确认知识库更新。', actionType: 'propose_action' },
    ];
  }
  return [
    { label: '建立企业知识库', value: '我想建立企业知识库，请引导我上传资料并生成草稿。', actionType: 'send_message' },
    { label: '了解录入要求', value: '请说明建立企业知识库需要准备哪些资料。', actionType: 'send_message' },
  ];
}

function makeTraceSummary({ run, intent, contextPack, localSteps, startedAt, status = 'completed', error = null }) {
  return {
    runId: run.id,
    intent,
    status,
    contextSummary: contextPack.summary,
    elapsedMs: Date.now() - startedAt,
    error,
    steps: localSteps.map((step) => ({
      type: step.stepType,
      toolName: step.toolName || null,
      status: step.status,
      title: step.title || step.toolName || step.stepType,
      artifactType: step.artifactType || null,
      artifactId: step.artifactId || null,
    })),
  };
}

function makeToolCall(toolName, status, title, extra = {}) {
  return { name: toolName, status, title, ...extra };
}

function recordLocalStep(localSteps, step) {
  localSteps.push(step);
  return step;
}

function validation(ok, message = '', data = {}) {
  return { ok, message, data };
}

function buildPendingKnowledgeAction({ projectId, conversationId, instruction, currentProfile }) {
  const { patch, changes } = extractKnowledgePatch(instruction, currentProfile);
  return {
    type: 'knowledge_update',
    title: '待确认知识库更新',
    summary: changes.length
      ? `将更新 ${changes.length} 个知识库字段，确认前不会写入。`
      : '暂未识别到明确字段值，请补充“字段：值”后再确认写入。',
    payload: {
      projectId,
      conversationId,
      instruction,
      patch,
      changes,
    },
  };
}

function buildPendingArticleRevisionAction({ projectId, conversationId, instruction }) {
  const draft = latestArticleDraft(projectId);
  return {
    type: 'article_revision',
    title: '待确认稿件修改',
    summary: draft
      ? `目标稿件：${draft.draft?.title || draft.id}。确认前不会覆盖原稿。`
      : '未找到可修改的最近稿件，请先在稿件管理中选择目标稿件。',
    payload: {
      projectId,
      conversationId,
      articleId: draft?.id || null,
      articleTitle: draft?.draft?.title || null,
      instruction,
      patch: {},
      changes: draft ? [{ label: '修改要求', oldValue: draft.draft?.title || draft.id, newValue: instruction }] : [],
    },
  };
}

const toolDefinitions = {
  generate_additional_articles: {
    name: 'generate_additional_articles',
    description: '阶段四完成后追加生成完整稿件，并保存为 draft。',
    inputSchema: {
      type: 'object',
      required: ['geoProjectId', 'platform', 'count'],
      properties: {
        geoProjectId: { type: 'string' },
        platform: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: MAX_ADDITIONAL_ARTICLES },
        articleRole: { enum: ['support', 'ranking', 'auto'] },
        instruction: { type: 'string' },
      },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
    taskPolicy: 'support_content_generation',
    validate: ({ projectId, input }) => {
      if (!projectId) return validation(false, '继续生成稿件需要先选择企业知识库项目。');
      if (!input) return validation(false, '缺少生成参数。');
      return validation(true);
    },
    execute: async ({ input, projectId, conversation, run, sender, channel, localSteps }) => {
      const platform = input.platform || 'doubao';
      const request = {
        count: clampCount(input.count),
        articleRole: input.articleRole || 'auto',
        instruction: input.instruction || '',
      };
      const stageMessage = conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content: `正在继续生成 ${request.count} 篇完整稿件，生成后会保存到稿件管理。`,
        metadata: {
          type: 'geo_additional_articles',
          status: 'streaming',
          phase: 4,
          platform,
          request,
          run_id: run.id,
        },
      });
      sender.send(channel, {
        type: 'meta',
        conversation_id: conversation.id,
        message: stageMessage,
        platform,
        action: 'additional_articles',
        run_id: run.id,
      });
      traceService.addStep({
        runId: run.id,
        stepIndex: 2,
        stepType: 'tool_call',
        toolName: 'generate_additional_articles',
        status: 'running',
        title: '追加生成完整稿件',
        input: request,
      });
      recordLocalStep(localSteps, {
        stepType: 'tool_call',
        toolName: 'generate_additional_articles',
        status: 'running',
        title: '追加生成完整稿件',
      });
      const additionalResult = await articleDraftService.generateAdditionalArticlesStream(
        {
          geoProjectId: `geo-${projectId}`,
          platform,
          ...request,
        },
        (streamEvent) => sender.send(channel, streamEvent),
      );
      const succeeded = additionalResult.status === 'completed';
      const content = succeeded
        ? `已继续生成 ${additionalResult.total || request.count} 篇完整稿件，均已保存到稿件管理，可继续校对、预览和发布。`
        : `继续生成稿件失败：${additionalResult.error_message || '请稍后重试。'}`;
      const savedMessage = conversationService.updateConversationMessage({
        messageId: stageMessage.id,
        conversationId: conversation.id,
        projectId,
        content,
        metadata: {
          type: 'geo_additional_articles',
          status: additionalResult.status || 'completed',
          phase: 4,
          platform,
          request,
          additional_articles: additionalResult,
          confirmation_state: 'output-available',
          confirmation_approved: true,
          run_id: run.id,
        },
      });
      traceService.addStep({
        runId: run.id,
        stepIndex: 3,
        stepType: 'tool_result',
        toolName: 'generate_additional_articles',
        status: succeeded ? 'completed' : 'failed',
        output: { total: additionalResult.total, status: additionalResult.status },
        artifactType: 'geo_article_drafts',
        artifactId: additionalResult.drafts?.[0]?.id || null,
        errorMessage: succeeded ? null : additionalResult.error_message || 'failed',
      });
      localSteps[localSteps.length - 1] = {
        stepType: 'tool_result',
        toolName: 'generate_additional_articles',
        status: succeeded ? 'completed' : 'failed',
        title: '追加生成完整稿件',
        artifactType: 'geo_article_drafts',
        artifactId: additionalResult.drafts?.[0]?.id || null,
      };
      return {
        content,
        message: savedMessage,
        additional_articles: additionalResult,
        artifactType: 'geo_article_drafts',
        artifactId: additionalResult.drafts?.[0]?.id || null,
        error: succeeded ? null : additionalResult.error_message || 'failed',
        status: succeeded ? 'completed' : 'failed',
      };
    },
    toSuggestions: ({ result, contextPack }) => suggestionsFor({
      intent: 'generate_additional_articles',
      additionalResult: result?.additional_articles,
      contextPack,
    }),
  },
  propose_knowledge_update: {
    name: 'propose_knowledge_update',
    description: '生成待确认知识库更新动作；确认前不写库。',
    inputSchema: {
      type: 'object',
      required: ['instruction'],
      properties: {
        instruction: { type: 'string' },
      },
    },
    riskLevel: 'medium',
    requiresConfirmation: true,
    taskPolicy: 'rag_chat',
    validate: ({ projectId, input }) => {
      if (!projectId) return validation(false, '知识库更新需要先选择企业知识库项目。');
      if (!normalizeText(input?.instruction)) return validation(false, '缺少知识库更新指令。');
      return validation(true);
    },
    execute: async ({ input, projectId, conversation, run, contextPack, localSteps }) => {
      const currentProfile = knowledgeService.getKnowledgeProfile(projectId).profile || {};
      const pendingAction = buildPendingKnowledgeAction({
        projectId,
        conversationId: conversation.id,
        instruction: input.instruction,
        currentProfile,
      });
      const content = [
        '我已生成一个待确认的知识库更新动作。',
        '',
        pendingAction.summary,
      ].join('\n');
      const savedMessage = conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content,
        metadata: {
          type: 'agent_pending_action',
          status: 'pending',
          pending_action: pendingAction,
          confirmation_state: 'approval-requested',
          run_id: run.id,
        },
      });
      traceService.addStep({
        runId: run.id,
        stepIndex: 2,
        stepType: 'approval_request',
        toolName: 'propose_knowledge_update',
        status: 'completed',
        input: pendingAction.payload,
        artifactType: 'pending_action',
        artifactId: savedMessage.id,
      });
      recordLocalStep(localSteps, {
        stepType: 'approval_request',
        toolName: 'propose_knowledge_update',
        status: 'completed',
        title: '生成知识库更新确认卡',
        artifactType: 'pending_action',
        artifactId: savedMessage.id,
      });
      return {
        content,
        message: savedMessage,
        pending_action: pendingAction,
        artifactType: 'pending_action',
        artifactId: savedMessage.id,
        status: 'completed',
        contextPack,
      };
    },
    toSuggestions: ({ result, contextPack }) => suggestionsFor({ pendingAction: result?.pending_action, contextPack }),
  },
  propose_article_revision: {
    name: 'propose_article_revision',
    description: '生成待确认稿件修改动作；确认前不覆盖原稿。',
    inputSchema: {
      type: 'object',
      required: ['instruction'],
      properties: {
        instruction: { type: 'string' },
      },
    },
    riskLevel: 'medium',
    requiresConfirmation: true,
    taskPolicy: 'support_content_generation',
    validate: ({ projectId, input }) => {
      if (!projectId) return validation(false, '稿件修改需要先选择企业知识库项目。');
      if (!normalizeText(input?.instruction)) return validation(false, '缺少稿件修改指令。');
      return validation(true);
    },
    execute: async ({ input, projectId, conversation, run, localSteps }) => {
      const pendingAction = buildPendingArticleRevisionAction({
        projectId,
        conversationId: conversation.id,
        instruction: input.instruction,
      });
      const content = [
        '我已生成一个待确认的稿件修改动作。',
        '',
        pendingAction.summary,
      ].join('\n');
      const savedMessage = conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content,
        metadata: {
          type: 'agent_pending_action',
          status: 'pending',
          pending_action: pendingAction,
          confirmation_state: 'approval-requested',
          run_id: run.id,
        },
      });
      traceService.addStep({
        runId: run.id,
        stepIndex: 2,
        stepType: 'approval_request',
        toolName: 'propose_article_revision',
        status: 'completed',
        input: pendingAction.payload,
        artifactType: 'pending_action',
        artifactId: savedMessage.id,
      });
      recordLocalStep(localSteps, {
        stepType: 'approval_request',
        toolName: 'propose_article_revision',
        status: 'completed',
        title: '生成稿件修改确认卡',
        artifactType: 'pending_action',
        artifactId: savedMessage.id,
      });
      return {
        content,
        message: savedMessage,
        pending_action: pendingAction,
        artifactType: 'pending_action',
        artifactId: savedMessage.id,
        status: 'completed',
      };
    },
    toSuggestions: ({ result, contextPack }) => suggestionsFor({ pendingAction: result?.pending_action, contextPack }),
  },
  view_knowledge_profile: {
    name: 'view_knowledge_profile',
    description: '查看当前企业知识库摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string' },
      },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
    taskPolicy: 'rag_chat',
    validate: ({ projectId }) => {
      if (!projectId) return validation(false, '查看知识库需要先选择企业知识库项目。');
      return validation(true);
    },
    execute: async ({ projectId, conversation, run, localSteps }) => {
      const profile = knowledgeService.getKnowledgeProfile(projectId).profile || {};
      const fields = PROFILE_FIELD_HINTS.map(([key, labels]) => {
        const value = profileValue(profile, key);
        return value ? `- ${labels[0]}：${value}` : '';
      }).filter(Boolean);
      const content = fields.length
        ? ['当前企业知识库摘要：', '', ...fields].join('\n')
        : '当前企业知识库还没有可展示的核心字段。';
      const savedMessage = conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content,
        metadata: {
          type: 'chat_response',
          status: 'complete',
          tool_name: 'view_knowledge_profile',
          run_id: run.id,
        },
      });
      traceService.addStep({
        runId: run.id,
        stepIndex: 2,
        stepType: 'tool_result',
        toolName: 'view_knowledge_profile',
        status: 'completed',
        output: { field_count: fields.length },
      });
      recordLocalStep(localSteps, {
        stepType: 'tool_result',
        toolName: 'view_knowledge_profile',
        status: 'completed',
        title: '查看企业知识库',
      });
      return { content, message: savedMessage, status: 'completed' };
    },
    toSuggestions: ({ contextPack }) => suggestionsFor({ contextPack }),
  },
  chat_with_context: {
    name: 'chat_with_context',
    description: '围绕当前企业、阶段、稿件和历史对话回答。',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string' },
      },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
    taskPolicy: 'rag_chat',
    validate: () => validation(true),
    execute: async ({ input, projectId, conversation, run, contextPack, sender, channel, localSteps, signal }) => {
      const policy = getTaskPolicy('rag_chat');
      let assistantContent = '';
      let provider = policy.provider || 'ark';
      let model = policy.model || process.env.DOUBAO_MODEL || process.env.ARK_MODEL || '';
      let reasoningContent = null;
      traceService.addStep({
        runId: run.id,
        stepIndex: 2,
        stepType: 'model_call',
        toolName: 'chat_with_context',
        status: 'running',
        title: '上下文对话',
        input: { message: input.message, context_summary: contextPack.summary },
      });
      recordLocalStep(localSteps, {
        stepType: 'model_call',
        toolName: 'chat_with_context',
        status: 'running',
        title: '上下文对话',
      });
      let isAborted = false;
      try {
        await llmGateway.streamLLM({
          messages: contextPack.modelMessages,
          temperature: 0.7,
          maxTokens: 4000,
          taskType: 'agent_chat',
          provider,
          model,
          apiFamily: policy.api_family,
          networkMode: policy.network_mode,
          deepThinking: policy.deep_thinking,
          signal,
          onRetry: ({ attempt, maxRetries, errorType }) => {
            sender.send(channel, {
              type: 'retry',
              attempt,
              max_attempts: maxRetries,
              error_type: errorType,
              message: formatRetryMessage(attempt, maxRetries, errorType),
              conversation_id: conversation.id,
              run_id: run.id,
            });
          },
          onEvent: (streamEvent) => {
            if (streamEvent.type === 'model_start' || streamEvent.type === 'model_status') {
              provider = streamEvent.provider || provider;
              model = streamEvent.model || model;
              sender.send(channel, {
                type: 'meta',
                conversation_id: conversation.id,
                provider,
                model,
                run_id: run.id,
                context_usage: contextUsagePayload(contextPack.tokenUsage, model || provider),
                context_pack_summary: contextPack.summary,
              });
            }
            if (streamEvent.type === 'status') {
              sender.send(channel, {
                type: 'status',
                message: streamEvent.message || '正在处理...',
                conversation_id: conversation.id,
                run_id: run.id,
              });
            }
            if (streamEvent.type === 'reasoning_delta' && streamEvent.text) {
              reasoningContent = (reasoningContent || '') + streamEvent.text;
              sender.send(channel, { type: 'reasoning_delta', text: streamEvent.text, run_id: run.id });
            }
            if (streamEvent.type === 'delta' && streamEvent.text) {
              assistantContent += streamEvent.text;
              sender.send(channel, { type: 'delta', text: streamEvent.text, run_id: run.id });
            }
          },
        });
      } catch (error) {
        isAborted = error.name === 'AbortError' || signal?.aborted;
        if (!isAborted) throw error;
      }
      const savedMessage = conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content: assistantContent,
        metadata: {
          type: 'chat_response',
          provider,
          model,
          status: isAborted ? 'cancelled' : 'complete',
          context_usage: contextUsagePayload(contextPack.tokenUsage, model || provider),
          context_pack_summary: contextPack.summary,
          run_id: run.id,
        },
      });
      traceService.addStep({
        runId: run.id,
        stepIndex: 3,
        stepType: 'model_result',
        toolName: 'chat_with_context',
        status: isAborted ? 'cancelled' : 'completed',
        output: { content_length: assistantContent.length, aborted: isAborted },
      });
      localSteps[localSteps.length - 1] = {
        stepType: 'model_result',
        toolName: 'chat_with_context',
        status: isAborted ? 'cancelled' : 'completed',
        title: '上下文对话',
      };
      return {
        content: assistantContent,
        message: savedMessage,
        provider,
        model,
        reasoning_content: reasoningContent,
        status: isAborted ? 'cancelled' : 'completed',
      };
    },
    toSuggestions: ({ contextPack }) => suggestionsFor({ intent: 'chat', contextPack }),
  },
};

function listTools() {
  return Object.values(toolDefinitions).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    riskLevel: tool.riskLevel,
    requiresConfirmation: tool.requiresConfirmation,
    taskPolicy: tool.taskPolicy,
    validate: Boolean(tool.validate),
    execute: Boolean(tool.execute),
    toSuggestions: Boolean(tool.toSuggestions),
  }));
}

function resolveIntent(payload = {}) {
  const message = payload.message || '';
  const additional = inferAdditionalArticleRequest(message);
  if (additional) {
    return {
      intent: 'generate_additional_articles',
      toolName: 'generate_additional_articles',
      input: {
        geoProjectId: payload.geoProjectId || payload.geo_project_id,
        platform: payload.platform || 'doubao',
        ...additional,
      },
    };
  }
  const knowledgeUpdate = inferKnowledgeUpdateRequest(message);
  if (knowledgeUpdate) {
    return { intent: 'propose_knowledge_update', toolName: 'propose_knowledge_update', input: knowledgeUpdate };
  }
  const articleRevision = inferArticleRevisionRequest(message);
  if (articleRevision) {
    return { intent: 'propose_article_revision', toolName: 'propose_article_revision', input: articleRevision };
  }
  const viewKnowledge = inferViewKnowledgeRequest(message);
  if (viewKnowledge) {
    return { intent: 'view_knowledge_profile', toolName: 'view_knowledge_profile', input: viewKnowledge };
  }
  return { intent: 'chat', toolName: 'chat_with_context', input: { message } };
}

async function runChatStream({ payload = {}, sender, channel, signal = null }) {
  const projectId = payload.project_id || payload.projectId || null;
  const attachmentIds = Array.isArray(payload.attachment_ids)
    ? payload.attachment_ids.filter(Boolean)
    : Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.filter(Boolean)
      : [];
  const conversation = conversationService.ensureConversation({
    projectId,
    conversationId: payload.conversation_id || null,
    firstMessage: payload.message,
  });
  const userMessage = conversationService.addMessage({
    conversationId: conversation.id,
    projectId,
    role: 'user',
    content: payload.message || '',
    metadata: { type: 'chat_user', attachment_ids: attachmentIds },
  });
  attachmentService.linkManyToConversation(attachmentIds, conversation.id);
  attachmentService.linkManyToMessage(attachmentIds, userMessage.id);

  const { intent, toolName, input } = resolveIntent(payload);
  const runStartedAt = Date.now();
  const run = traceService.createRun({ conversationId: conversation.id, projectId, intent });
  const localSteps = [];
  const contextPack = await contextWindowService.buildContextPack(
    conversation.id,
    projectId,
    { maxTokens: 100000, recentMessageCount: 8 }
  );
  traceService.addStep({
    runId: run.id,
    stepIndex: 1,
    stepType: 'context_pack',
    status: 'completed',
    title: contextPack.summary,
    output: { summary: contextPack.summary, token_usage: contextPack.tokenUsage },
  });
  recordLocalStep(localSteps, {
    stepType: 'context_pack',
    status: 'completed',
    title: contextPack.summary,
  });

  const tool = toolDefinitions[toolName];
  const validationResult = tool.validate({ input, projectId, conversation, contextPack });
  if (!validationResult.ok) {
    const content = validationResult.message;
    const savedMessage = conversationService.addMessage({
      conversationId: conversation.id,
      projectId,
      role: 'assistant',
      content,
      metadata: { type: 'chat_response', status: 'complete', run_id: run.id },
    });
    traceService.updateRun(run.id, { status: 'completed', token_usage: contextPack.tokenUsage });
    return {
      type: 'done',
      conversation_id: conversation.id,
      message: savedMessage,
      content,
      provider: 'local',
      model: 'agent-runtime',
      error: null,
      run_id: run.id,
      context_usage: contextUsagePayload(contextPack.tokenUsage, 'agent-runtime'),
      context_pack_summary: contextPack.summary,
      tool_calls: [makeToolCall(tool.name, 'skipped', tool.description)],
      traceSummary: makeTraceSummary({ run, intent, contextPack, localSteps, startedAt: runStartedAt }),
      suggestions: suggestionsFor({ contextPack }),
    };
  }

  try {
    const result = await tool.execute({
      input,
      projectId,
      conversation,
      run,
      contextPack,
      sender,
      channel,
      localSteps,
      signal,
    });
    traceService.updateRun(run.id, {
      status: result.status === 'cancelled' ? 'cancelled' : (result.status === 'failed' ? 'failed' : 'completed'),
      provider: result.provider || null,
      model: result.model || null,
      token_usage: contextPack.tokenUsage,
      artifact_type: result.artifactType || null,
      artifact_id: result.artifactId || null,
      error_message: result.error || null,
    });
    const traceSummary = makeTraceSummary({
      run,
      intent,
      contextPack,
      localSteps,
      startedAt: runStartedAt,
      status: result.status === 'cancelled' ? 'cancelled' : (result.status === 'failed' ? 'failed' : 'completed'),
      error: result.error || null,
    });
    return {
      type: 'done',
      conversation_id: conversation.id,
      message: result.message,
      content: result.content,
      additional_articles: result.additional_articles,
      pending_action: result.pending_action,
      provider: result.provider || (tool.requiresConfirmation ? 'local' : ''),
      model: result.model || (tool.requiresConfirmation ? 'agent-runtime' : ''),
      error: result.error || null,
      sources: [],
      search_queries: [],
      search_actions: [],
      search_usage: {},
      reasoning_content: result.reasoning_content || null,
      run_id: run.id,
      context_usage: contextUsagePayload(contextPack.tokenUsage, result.model || result.provider || 'agent-runtime'),
      context_pack_summary: contextPack.summary,
      tool_calls: [
        makeToolCall(tool.name, result.status === 'cancelled' ? 'cancelled' : (result.status === 'failed' ? 'failed' : 'completed'), tool.description, {
          artifactType: result.artifactType || null,
          artifactId: result.artifactId || null,
        }),
      ],
      traceSummary,
      suggestions: tool.toSuggestions({ result, contextPack }),
      status: result.status === 'cancelled' ? 'cancelled' : (result.status === 'failed' ? 'failed' : 'completed'),
    };
  } catch (error) {
    const message = error.message || String(error);
    traceService.updateRun(run.id, {
      status: 'failed',
      token_usage: contextPack.tokenUsage,
      error_message: message,
    });
    throw error;
  }
}

module.exports = {
  MAX_ADDITIONAL_ARTICLES,
  inferAdditionalArticleRequest,
  inferArticleRevisionRequest,
  inferKnowledgeUpdateRequest,
  inferViewKnowledgeRequest,
  listTools,
  resolveIntent,
  runChatStream,
  suggestionsFor,
  toolDefinitions,
};
