const { contextBridge, ipcRenderer } = require('electron');

function invokeStream(channelName, payload, onEvent) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = `${channelName}:${requestId}`;
  return new Promise((resolve, reject) => {
    const cleanup = () => ipcRenderer.removeListener(channel, listener);
    const listener = (_event, streamEvent) => {
      if (typeof onEvent === 'function') {
        onEvent(streamEvent);
      }
      if (streamEvent.type === 'done') {
        cleanup();
        resolve(streamEvent);
      }
      if (streamEvent.type === 'error') {
        cleanup();
        reject(new Error(streamEvent.error || 'Stream failed'));
      }
    };

    ipcRenderer.on(channel, listener);
    ipcRenderer.invoke(channelName, { requestId, payload }).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

contextBridge.exposeInMainWorld('geoAgent', {
  // 窗口控制
  windowMinimize: () => ipcRenderer.invoke('geo-agent:window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('geo-agent:window-maximize'),
  windowClose: () => ipcRenderer.invoke('geo-agent:window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('geo-agent:window-is-maximized'),
  onWindowMaximizedChanged: (callback) => {
    ipcRenderer.on('geo-agent:window-maximized-changed', (_, isMaximized) => callback(isMaximized));
  },
  healthCheck: () => ipcRenderer.invoke('geo-agent:health-check'),
  getConfigStatus: () => ipcRenderer.invoke('geo-agent:get-config-status'),
  sendChatStream: (message, conversationId, selectedModelOrOptions = null, optionsOrEvent = {}, maybeOnEvent) => {
    const legacySignature = typeof maybeOnEvent === 'function';
    const selectedModel = legacySignature ? selectedModelOrOptions : null;
    const options = legacySignature ? (optionsOrEvent || {}) : (selectedModelOrOptions || {});
    const onEvent = legacySignature ? maybeOnEvent : optionsOrEvent;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = `geo-agent:chat-stream:${requestId}`;
    const payload = {
      message,
      conversation_id: conversationId,
      selected_model: selectedModel,
      skill_id: options.skillId,
      project_id: options.projectId,
    };

    return new Promise((resolve, reject) => {
      const cleanup = () => ipcRenderer.removeListener(channel, listener);
      const listener = (_event, streamEvent) => {
        if (typeof onEvent === 'function') {
          onEvent(streamEvent);
        }
        if (streamEvent.type === 'done') {
          cleanup();
          resolve(streamEvent);
        }
        if (streamEvent.type === 'error') {
          cleanup();
          reject(new Error(streamEvent.error || 'Chat stream failed'));
        }
      };

      ipcRenderer.on(channel, listener);
      ipcRenderer.invoke('geo-agent:send-chat-stream', { requestId, payload }).catch((error) => {
        cleanup();
        reject(error);
      });
    });
  },
  sendChat: (message, conversationId, selectedModelOrOptions = null, maybeOptions = {}) => {
    const selectedModel = typeof selectedModelOrOptions === 'string' ? selectedModelOrOptions : null;
    const options = typeof selectedModelOrOptions === 'string' ? maybeOptions : (selectedModelOrOptions || {});
    return ipcRenderer.invoke('geo-agent:send-chat', {
      message,
      conversation_id: conversationId,
      selected_model: selectedModel,
      skill_id: options.skillId,
      project_id: options.projectId,
    });
  },
  getProjects: () => ipcRenderer.invoke('geo-agent:get-projects'),
  createProject: (payload) => ipcRenderer.invoke('geo-agent:create-project', payload),
  getProject: (projectId) => ipcRenderer.invoke('geo-agent:get-project', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('geo-agent:delete-project', projectId),
  ensureGeoProject: (projectId) => ipcRenderer.invoke('geo-agent:ensure-geo-project', projectId),
  getGeoProjects: (projectId) => ipcRenderer.invoke('geo-agent:get-geo-projects', projectId),
  getGeoProject: (geoProjectId) => ipcRenderer.invoke('geo-agent:get-geo-project', geoProjectId),
  getGeoWorkflowState: (geoProjectId) => ipcRenderer.invoke('geo-agent:get-geo-workflow-state', geoProjectId),
  createGeoPhaseTwoPrompt: (geoProjectId, platform, conversationId) => ipcRenderer.invoke('geo-agent:create-geo-phase-two-prompt', geoProjectId, platform, conversationId),
  confirmGeoPhaseTwo: (geoProjectId, platform, messageId, confirmedQuestionIds = []) => ipcRenderer.invoke('geo-agent:confirm-geo-phase-two', geoProjectId, platform, messageId, confirmedQuestionIds),
  runGeoPhaseTwoReport: (geoProjectId, platform, messageId) => ipcRenderer.invoke('geo-agent:run-geo-phase-two-report', geoProjectId, platform, messageId),
  runGeoPhaseTwoReportStream: (geoProjectId, platform, messageId, conversationId, onEvent) => invokeStream('geo-agent:run-geo-phase-two-report-stream', { geoProjectId, platform, messageId, conversationId }, onEvent),
  getLatestGeoReport: (geoProjectId, platform) => ipcRenderer.invoke('geo-agent:get-latest-geo-report', geoProjectId, platform),
  getGeoReport: (reportId) => ipcRenderer.invoke('geo-agent:get-geo-report', reportId),
  getLatestGeoQuestionSet: (geoProjectId, platform) => ipcRenderer.invoke('geo-agent:get-latest-geo-question-set', geoProjectId, platform),
  getGeoQuestionSet: (questionSetId) => ipcRenderer.invoke('geo-agent:get-geo-question-set', questionSetId),
  runGeoSourceDiscovery: (geoProjectId, platform, fallbackReport = null, messageId = null) => ipcRenderer.invoke('geo-agent:run-geo-source-discovery', geoProjectId, platform, fallbackReport, messageId),
  runGeoSourceDiscoveryStream: (geoProjectId, platform, fallbackReport = null, messageId = null, conversationId = null, parentMessageId = null, onEvent) => invokeStream('geo-agent:run-geo-source-discovery-stream', { geoProjectId, platform, fallbackReport, messageId, conversationId, parentMessageId }, onEvent),
  getLatestGeoSourceDiscovery: (geoProjectId, platform) => ipcRenderer.invoke('geo-agent:get-latest-geo-source-discovery', geoProjectId, platform),
  getGeoSourceDiscovery: (discoveryId) => ipcRenderer.invoke('geo-agent:get-geo-source-discovery', discoveryId),
  getSourceDiscoveries: (projectId, platform = null) => ipcRenderer.invoke('geo-agent:get-source-discoveries', { projectId, platform }),
  confirmSourceDiscovery: (discoveryId) => ipcRenderer.invoke('geo-agent:confirm-source-discovery', discoveryId),
  runGeoArticleDraft: (geoProjectId, platform, articleType, options = {}) => ipcRenderer.invoke('geo-agent:run-geo-article-draft', geoProjectId, platform, articleType, options),
  runGeoSupportArticles: (geoProjectId, platform, options = {}) => ipcRenderer.invoke('geo-agent:run-geo-support-articles', geoProjectId, platform, options),
  runGeoSupportArticlesStream: (geoProjectId, platform, options = {}, onEvent) => invokeStream('geo-agent:run-geo-support-articles-stream', { geoProjectId, platform, options }, onEvent),
  getLatestGeoArticleDraft: (geoProjectId, platform, articleType) => ipcRenderer.invoke('geo-agent:get-latest-geo-article-draft', geoProjectId, platform, articleType),
  getGeoArticleDraft: (articleId) => ipcRenderer.invoke('geo-agent:get-geo-article-draft', articleId),
  confirmGeoArticleDraft: (articleId, messageId = null) => ipcRenderer.invoke('geo-agent:confirm-geo-article-draft', articleId, messageId),
  updateGeoArticleDraft: (articleId, draft, messageId = null) => ipcRenderer.invoke('geo-agent:update-geo-article-draft', articleId, draft, messageId),
  listArticleDrafts: (projectId, filters = {}) => ipcRenderer.invoke('geo-agent:list-article-drafts', projectId, filters),
  updateArticleDraft: (articleId, patch = {}) => ipcRenderer.invoke('geo-agent:update-article-draft', articleId, patch),
  reviseArticleDraft: (articleId, options = {}) => ipcRenderer.invoke('geo-agent:revise-article-draft', articleId, options),
  markArticleReviewed: (articleId) => ipcRenderer.invoke('geo-agent:mark-article-reviewed', articleId),
  prepareArticlePreview: (articleId) => ipcRenderer.invoke('geo-agent:prepare-article-preview', articleId),
  syncChaojimeijieResources: (resourceType = 'media', page = 1, size = 200) => ipcRenderer.invoke('geo-agent:sync-chaojimeijie-resources', resourceType, page, size),
  listPublishResources: (filters = {}) => ipcRenderer.invoke('geo-agent:list-publish-resources', filters),
  recommendPublishResources: (articleId, options = {}) => ipcRenderer.invoke('geo-agent:recommend-publish-resources', articleId, options),
  publishArticle: (articleId, adapterId = 'external_api_pending', options = {}) => ipcRenderer.invoke('geo-agent:publish-article', articleId, adapterId, options),
  syncPublishOrder: (articleId) => ipcRenderer.invoke('geo-agent:sync-publish-order', articleId),
  syncPublishOrders: (projectId) => ipcRenderer.invoke('geo-agent:sync-publish-orders', projectId),
  managePublishOrder: (articleId, action, payload = {}) => ipcRenderer.invoke('geo-agent:manage-publish-order', articleId, action, payload),
  recordPublishedUrl: (articleId, payload = {}) => ipcRenderer.invoke('geo-agent:record-published-url', articleId, payload),
  runVisibilityCheckStream: (geoProjectId, platform = 'doubao', onEvent) => invokeStream('geo-agent:run-visibility-check-stream', { geoProjectId, platform }, onEvent),
  getLatestVisibilityCheck: (geoProjectId, platform = 'doubao') => ipcRenderer.invoke('geo-agent:get-latest-visibility-check', geoProjectId, platform),
  generateReflection: (geoProjectId, platform = 'doubao', visibilityCheckId = null) => ipcRenderer.invoke('geo-agent:generate-reflection', geoProjectId, platform, visibilityCheckId),
  confirmEvolutionRule: (ruleId) => ipcRenderer.invoke('geo-agent:confirm-evolution-rule', ruleId),
  rejectEvolutionRule: (ruleId) => ipcRenderer.invoke('geo-agent:reject-evolution-rule', ruleId),
  listEvolutionRules: (projectId, filters) => ipcRenderer.invoke('geo-agent:list-evolution-rules', projectId, filters || {}),
  getConversations: (projectId, limit) => ipcRenderer.invoke('geo-agent:get-conversations', { projectId: projectId || null, limit }),
  getPublicConversations: (limit) => ipcRenderer.invoke('geo-agent:get-public-conversations', { limit }),
  getConversation: (conversationId) => ipcRenderer.invoke('geo-agent:get-conversation', conversationId),
  touchConversationSummary: (conversationId, reason = 'manual') => ipcRenderer.invoke('geo-agent:touch-conversation-summary', { conversationId, reason }),
  deleteConversation: (conversationId) => ipcRenderer.invoke('geo-agent:delete-conversation', conversationId),
  clearConversationHistory: (payload) => ipcRenderer.invoke('geo-agent:clear-conversation-history', payload),
  getKnowledgeEntries: (projectId, limit) => ipcRenderer.invoke('geo-agent:get-knowledge-entries', { projectId, limit }),
  createKnowledgeEntry: (entry) => ipcRenderer.invoke('geo-agent:create-knowledge-entry', entry),
  searchKnowledge: (query, projectId, limit) => ipcRenderer.invoke('geo-agent:search-knowledge', { query, projectId, limit }),
  saveEnterpriseProfile: (profile) => ipcRenderer.invoke('geo-agent:save-enterprise-profile', profile),
  getKnowledgeProfiles: () => ipcRenderer.invoke('geo-agent:get-knowledge-profiles'),
  getKnowledgeProfile: (projectId) => ipcRenderer.invoke('geo-agent:get-knowledge-profile', projectId),
  updateKnowledgeProfile: (projectId, profile) => ipcRenderer.invoke('geo-agent:update-knowledge-profile', { projectId, profile }),
  deleteKnowledgeProfile: (projectId) => ipcRenderer.invoke('geo-agent:delete-knowledge-profile', projectId),
  createKnowledgeAsset: (asset) => ipcRenderer.invoke('geo-agent:create-knowledge-asset', asset),
  reparseKnowledgeAsset: (assetId) => ipcRenderer.invoke('geo-agent:reparse-knowledge-asset', assetId),
  deleteKnowledgeAsset: (assetId) => ipcRenderer.invoke('geo-agent:delete-knowledge-asset', assetId),
  createKnowledgeDraft: (draft) => ipcRenderer.invoke('geo-agent:create-knowledge-draft', draft),
  createKnowledgeDraftStream: (draft, onEvent) => invokeStream('geo-agent:create-knowledge-draft-stream', draft, onEvent),
  confirmKnowledgeDraft: (draftId, profile, conversationId = null, draft = null) => ipcRenderer.invoke('geo-agent:confirm-knowledge-draft', { draftId, profile, conversationId, draft }),
  rejectKnowledgeDraft: (draftId) => ipcRenderer.invoke('geo-agent:reject-knowledge-draft', draftId),
  reindexKnowledge: (projectId) => ipcRenderer.invoke('geo-agent:reindex-knowledge', projectId),
  getKnowledgeIndexStatus: (projectId) => ipcRenderer.invoke('geo-agent:get-knowledge-index-status', projectId),
  getSkills: () => ipcRenderer.invoke('geo-agent:get-skills'),
});
