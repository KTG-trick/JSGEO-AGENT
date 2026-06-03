const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  closeDatabase,
  getDb,
  getDbPath,
  initializeDatabase,
} = require('./services/databaseService.cjs');
const knowledgeService = require('./services/knowledgeService.cjs');
const conversationService = require('./services/conversationService.cjs');
const projectService = require('./services/projectService.cjs');
const sourceDiscoveryService = require('./services/sourceDiscoveryService.cjs');
const questionPoolService = require('./services/questionPoolService.cjs');
const skillService = require('./services/skillService.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3000';

let mainWindow = null;

function nowIso() {
  return new Date().toISOString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitTextDeltas(sender, channel, text, chunkSize = 8) {
  const content = String(text || '');
  for (let index = 0; index < content.length; index += chunkSize) {
    sender.send(channel, { type: 'delta', text: content.slice(index, index + chunkSize) });
    await wait(8);
  }
}

function loadEnvFile() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      const separator = trimmed.indexOf('=');
      if (separator <= 0) {
        return;
      }

      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      if (!key || process.env[key] !== undefined) {
        return;
      }

      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    });
}

function emptyIndexStatus(projectId = null) {
  return {
    project_id: projectId,
    embedding_model: process.env.ARK_EMBEDDING_MODEL || 'not-configured',
    vector_backend: 'fts',
    embedding_backend: process.env.ARK_API_KEY ? 'volcengine-ark-pending' : 'disabled',
    pending: 0,
    indexed: 0,
    failed: 0,
    asset_count: 0,
    assets: [],
  };
}

function getKnowledgeSnapshot(projectId) {
  if (!projectId) {
    return { profile: null, index_status: emptyIndexStatus(null) };
  }

  try {
    return knowledgeService.getKnowledgeProfile(projectId);
  } catch {
    return { profile: null, index_status: emptyIndexStatus(projectId) };
  }
}

function keywordListFromProfile(profile) {
  if (!profile?.target_keywords) {
    return [];
  }

  return String(profile.target_keywords)
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createShellGeoProject(projectId) {
  const timestamp = nowIso();
  const snapshot = getKnowledgeSnapshot(projectId);
  const profile = snapshot.profile;
  const indexStatus = snapshot.index_status || emptyIndexStatus(projectId);
  const companyName = profile?.company_name || '待录入企业';
  const knowledgeReady = Boolean(profile?.company_name && indexStatus.indexed > 0);

  return {
    id: `geo-${projectId || 'shell'}`,
    project_id: projectId || '',
    company_name: companyName,
    industry: profile?.industry || null,
    region: null,
    current_phase: knowledgeReady ? 'ready_for_check' : 'collecting',
    platforms: ['doubao', 'deepseek'],
    knowledge_base_ready: knowledgeReady,
    initial_keywords: keywordListFromProfile(profile),
    phase_status: {
      stage_1: { status: knowledgeReady ? 'completed' : 'not_started', label: '企业知识库' },
      platforms: {
        doubao: { stage_2: { status: knowledgeReady ? 'ready' : 'not_started', label: 'AI 问题池' } },
        deepseek: { stage_2: { status: knowledgeReady ? 'ready' : 'not_started', label: 'AI 问题池' } },
      },
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function projectIdFromGeoProjectId(geoProjectId) {
  return String(geoProjectId || '').replace(/^geo-/, '');
}

function createShellWorkflowState(geoProjectId) {
  const projectId = String(geoProjectId || '').replace(/^geo-/, '');
  const snapshot = getKnowledgeSnapshot(projectId);
  const profile = snapshot.profile;
  const indexStatus = snapshot.index_status || emptyIndexStatus(projectId);
  const knowledgeReady = Boolean(profile?.company_name && indexStatus.indexed > 0);

  const stage = (stageNumber, key, label, description, status = 'not_started') => ({
    stage: stageNumber,
    key,
    label,
    status,
    description,
    artifact_id: null,
    artifacts: {},
  });

  const platformState = (platform, label) => ({
    platform,
    label,
    stages: {
      stage_2: stage(
        2,
        'stage_2',
        'AI 问题池',
        '基于企业知识库生成真实 AI 用户会问的推荐、对比和采购问题。',
        knowledgeReady ? 'ready' : 'not_started'
      ),
      stage_3: stage(3, 'stage_3', '支撑内容策略', '规划被 AI 引用和推荐所需的内容证据。'),
      stage_4: stage(4, 'stage_4', '支撑内容生成', '生成咨询类、测评类和推荐理由类内容草稿。'),
    },
  });

  return {
    geo_project_id: geoProjectId,
    enterprise_project_id: projectId,
    company_name: profile?.company_name || '待录入企业',
    current_phase: knowledgeReady ? 'ready_for_check' : 'collecting',
    knowledge_base_ready: knowledgeReady,
    stage_1: stage(
      1,
      'stage_1',
      '企业知识库',
      '上传或粘贴企业资料，确认后建立本地知识库。',
      knowledgeReady ? 'completed' : 'ready'
    ),
    platforms: {
      doubao: platformState('doubao', '豆包'),
      deepseek: platformState('deepseek', 'DeepSeek'),
    },
  };
}

function notImplemented(name) {
  return new Error(`${name} 尚未接入新的 Electron-only 服务层，将在后续阶段实现。`);
}

function canReachUrl(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function startupFallbackHtml(reason) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>GEO-Agent Studio startup</title>
    <style>
      body { margin: 0; font-family: "Microsoft YaHei", sans-serif; background: #f7f7f5; color: #2f2f2f; }
      main { max-width: 720px; margin: 12vh auto; padding: 32px; border-radius: 24px; background: #fff; box-shadow: 0 24px 80px rgba(32, 28, 20, 0.12); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { line-height: 1.7; color: #69645d; }
      code { padding: 2px 6px; border-radius: 6px; background: #f1eee8; color: #3a332a; }
    </style>
  </head>
  <body>
    <main>
      <h1>GEO-Agent Studio 未能加载前端页面</h1>
      <p>${escapeHtml(reason)}</p>
      <p>开发模式请使用 <code>npm run dev</code> 启动，它会同时启动 Vite 和 Electron。</p>
      <p>如果只启动了 Electron，请先运行 <code>npm run build</code>，应用会回退加载本地 dist 页面。</p>
    </main>
  </body>
</html>`;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#f7f7f5',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // 监听窗口最大化状态变化
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('geo-agent:window-maximized-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('geo-agent:window-maximized-changed', false);
  });

  if (isDev) {
    if (await canReachUrl(devServerUrl)) {
      await mainWindow.loadURL(devServerUrl);
      return;
    }

    const distIndex = path.join(rootDir, 'dist', 'index.html');
    if (fs.existsSync(distIndex)) {
      console.warn(`[startup] Vite dev server unavailable at ${devServerUrl}; loading built dist instead.`);
      await mainWindow.loadFile(distIndex);
      return;
    }

    console.warn(`[startup] Vite dev server unavailable at ${devServerUrl}, and dist/index.html was not found.`);
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupFallbackHtml(
      `未检测到开发服务器：${devServerUrl}，且没有找到 dist/index.html。`
    ))}`);
    return;
  }

  await mainWindow.loadFile(path.join(rootDir, 'dist', 'index.html'));
}

function getConfigStatus() {
  return {
    providers: {
      openai: {
        provider: 'openai',
        configured: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.OPENAI_MODEL || 'not-configured',
        base_url: process.env.OPENAI_BASE_URL || '',
      },
      deepseek: {
        provider: 'deepseek',
        configured: Boolean(process.env.DEEPSEEK_API_KEY),
        model: process.env.DEEPSEEK_MODEL || 'not-configured',
        base_url: process.env.DEEPSEEK_BASE_URL || '',
      },
      ark: {
        provider: 'volcengine-ark',
        configured: Boolean(process.env.ARK_API_KEY),
        model: process.env.ARK_MODEL || process.env.ARK_EMBEDDING_MODEL || 'not-configured',
        base_url: process.env.ARK_BASE_URL || process.env.ARK_EMBEDDING_BASE_URL || '',
      },
    },
  };
}

function registerHandlers() {
  const health = async () => ({
    ok: true,
    service: 'geo-agent-electron-main',
    mode: 'electron-only-local',
    database_path: getDbPath(),
    timestamp: nowIso(),
  });

  ipcMain.handle('app:ping', health);
  ipcMain.handle('geo-agent:health-check', health);

  // 窗口控制
  ipcMain.handle('geo-agent:window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('geo-agent:window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('geo-agent:window-close', () => mainWindow?.close());
  ipcMain.handle('geo-agent:window-is-maximized', () => mainWindow?.isMaximized());

  ipcMain.handle('geo-agent:get-config-status', async () => getConfigStatus());

  ipcMain.handle('geo-agent:get-skills', async () => ({
    skills: skillService.getUserSkills(),
  }));

  ipcMain.handle('geo-agent:get-projects', async () => ({
    projects: projectService.listProjects(),
  }));
  ipcMain.handle('geo-agent:create-project', async (_event, payload) => projectService.createProject(payload));
  ipcMain.handle('geo-agent:get-project', async (_event, projectId) => projectService.getProject(projectId));
  ipcMain.handle('geo-agent:delete-project', async (_event, projectId) => projectService.deleteProject(projectId));

  ipcMain.handle('geo-agent:get-knowledge-profiles', async () => ({
    profiles: projectService.listKnowledgeProfiles(),
  }));
  ipcMain.handle('geo-agent:get-knowledge-profile', async (_event, projectId) =>
    knowledgeService.getKnowledgeProfile(projectId));
  ipcMain.handle('geo-agent:delete-knowledge-profile', async (_event, projectId) =>
    projectService.deleteProject(projectId));
  ipcMain.handle('geo-agent:get-knowledge-entries', async (_event, payload = {}) =>
    knowledgeService.getKnowledgeEntries(payload.projectId || payload.project_id, payload.limit));
  ipcMain.handle('geo-agent:search-knowledge', async (_event, payload = {}) =>
    knowledgeService.searchKnowledge(payload));
  ipcMain.handle('geo-agent:get-knowledge-index-status', async (_event, projectId = null) =>
    knowledgeService.getKnowledgeIndexStatus(projectId));
  ipcMain.handle('geo-agent:reindex-knowledge', async (_event, projectId) =>
    knowledgeService.reindexKnowledge(projectId));
  ipcMain.handle('geo-agent:save-enterprise-profile', async (_event, profile) =>
    knowledgeService.saveEnterpriseProfile(profile));
  ipcMain.handle('geo-agent:update-knowledge-profile', async (_event, payload = {}) =>
    knowledgeService.updateKnowledgeProfile(payload.projectId, payload.profile));
  ipcMain.handle('geo-agent:create-knowledge-entry', async (_event, entry) =>
    knowledgeService.createKnowledgeEntry(entry));
  ipcMain.handle('geo-agent:create-knowledge-asset', async (_event, asset) =>
    knowledgeService.createKnowledgeAsset(asset));
  ipcMain.handle('geo-agent:create-knowledge-draft', async (_event, draft) =>
    knowledgeService.createKnowledgeDraft(draft));
  ipcMain.handle('geo-agent:create-knowledge-draft-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:create-knowledge-draft-stream:${requestId}`;
    const projectId = payload.project_id || payload.projectId || null;
    let conversation = null;
    try {
      if (projectId) {
        // 尝试复用最近的 geo_workflow 会话，如果都没有则创建新的
        let effectiveConversationId = payload.conversation_id || null;
        if (!effectiveConversationId) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          if (latest) {
            effectiveConversationId = latest.id;
          }
        }
        conversation = conversationService.ensureConversation({
          projectId,
          conversationId: effectiveConversationId,
          firstMessage: payload.message || '创建企业知识库',
          kind: 'geo_workflow',
        });
        conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'user',
          content: payload.message || `已上传 ${(payload.assets || []).length} 个附件创建企业知识库`,
          metadata: {
            type: 'knowledge_draft_request',
            asset_count: Array.isArray(payload.assets) ? payload.assets.length : 0,
          },
        });
        event.sender.send(channel, {
          type: 'meta',
          task: 'knowledge_extraction',
          conversation_id: conversation.id,
          can_proceed: false,
        });
      }
      event.sender.send(channel, { type: 'meta', task: 'knowledge_extraction', can_proceed: false });
      const draft = await knowledgeService.createKnowledgeDraft(payload, (streamEvent) => {
        event.sender.send(channel, streamEvent);
      });
      if (draft.extraction_status === 'failed' || draft.status === 'failed') {
        const error = draft.error_message || draft.warnings?.[0] || '知识库草稿创建失败。';
        event.sender.send(channel, { type: 'error', error, draft, can_proceed: false });
        return { type: 'error', error, draft, can_proceed: false };
      }
      if (conversation && projectId) {
        conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'assistant',
          content: '已根据资料生成企业知识库草稿。请核对字段和来源片段，确认后再正式建立知识库。',
          metadata: {
            type: 'knowledge_draft',
            draft: { ...draft, conversation_id: conversation.id },
            status: 'complete',
            confirmation_state: 'approval-requested',
          },
        });
        draft.conversation_id = conversation.id;
      }
      event.sender.send(channel, { type: 'done', draft, conversation_id: conversation?.id, can_proceed: true });
      return { type: 'done', draft, conversation_id: conversation?.id, can_proceed: true };
    } catch (error) {
      const message = error.message || String(error);
      event.sender.send(channel, { type: 'error', error: message, can_proceed: false });
      return { type: 'error', error: message, can_proceed: false };
    }
  });
  ipcMain.handle('geo-agent:confirm-knowledge-draft', async (_event, payload = {}) => {
    const response = knowledgeService.confirmKnowledgeDraft(payload);
    const projectId = response.project_id;
    if (projectId) {
      try {
        // 尝试复用最近的 geo_workflow 会话（包含知识库创建后的后续阶段）
        // 如果没有，则创建新的 geo_workflow 会话
        let effectiveConversationId = payload.conversationId || null;
        if (!effectiveConversationId) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          if (latest) {
            effectiveConversationId = latest.id;
          }
        }
        const conversation = conversationService.ensureConversation({
          projectId,
          conversationId: effectiveConversationId,
          title: `${response.profile.company_name || '企业'} GEO 优化`,
          firstMessage: '开始 GEO 优化流程',
          kind: 'geo_workflow',
        });
        payload.conversationId = conversation.id;
        const confirmedDraftMessage = conversationService.markKnowledgeDraftConfirmed({
          conversationId: conversation.id,
          projectId,
          draftId: payload.draftId || payload.id,
        });
        if (!confirmedDraftMessage && payload.draft) {
          conversationService.addMessage({
            conversationId: conversation.id,
            projectId,
            role: 'assistant',
            content: '已根据资料生成企业知识库草稿。该草稿已确认并写入本地知识库。',
            metadata: {
              type: 'knowledge_draft',
              draft: {
                ...payload.draft,
                conversation_id: conversation.id,
                project_id: projectId,
                status: 'confirmed',
                confirmation_state: 'output-available',
              },
              status: 'confirmed',
              confirmation_state: 'output-available',
              confirmation_approved: true,
              archived_after_confirm: true,
            },
          });
        }
        conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'assistant',
          content: `已建立「${response.profile.company_name || '企业'}」企业知识库，并完成本地索引。`,
          metadata: {
            type: 'knowledge_confirmed',
            draft_id: payload.draftId || payload.id,
            project_id: projectId,
            profile: response.profile,
            total: response.total,
            index_status: response.index_status || null,
            status: 'confirmed',
            confirmation_state: 'output-available',
            confirmation_approved: true,
          },
        });
        response.conversation_id = conversation.id;
      } catch (error) {
        console.warn('[conversation] failed to archive confirmed draft', error);
      }
    }
    return response;
  });
  ipcMain.handle('geo-agent:reject-knowledge-draft', async (_event, draftId) =>
    knowledgeService.rejectKnowledgeDraft(draftId));

  ipcMain.handle('geo-agent:get-conversations', async (_event, payload = {}) =>
    conversationService.listConversations(payload.projectId || payload.project_id || null, payload.limit, {
      reason: payload.reason || 'history_open',
    }));
  ipcMain.handle('geo-agent:get-public-conversations', async (_event, payload = {}) =>
    conversationService.listPublicConversations(payload.limit));
  ipcMain.handle('geo-agent:get-geo-projects', async () => ({ projects: [] }));
  ipcMain.handle('geo-agent:ensure-geo-project', async (_event, projectId) => createShellGeoProject(projectId));
  ipcMain.handle('geo-agent:get-geo-project', async (_event, geoProjectId) => createShellGeoProject(geoProjectId));
  ipcMain.handle('geo-agent:get-geo-workflow-state', async (_event, geoProjectId) => createShellWorkflowState(geoProjectId));

  ipcMain.handle('geo-agent:send-chat', async (_event, payloadOrMessage, conversationId = null, selectedModel = null) => {
    const payload = typeof payloadOrMessage === 'object' && payloadOrMessage !== null
      ? payloadOrMessage
      : { message: payloadOrMessage, conversation_id: conversationId, selected_model: selectedModel };
    const projectId = payload.project_id || payload.projectId;
    const conversation = conversationService.ensureConversation({
      projectId,
      conversationId: payload.conversation_id || null,
      firstMessage: payload.message,
    });
    conversationService.addMessage({
      conversationId: conversation.id,
      projectId,
      role: 'user',
      content: payload.message || '',
      metadata: { type: 'chat_user' },
    });
    const assistantContent = '新的 Electron-only 服务层正在重建中。当前已接入本地企业数据库、知识库草稿、文档解析、FTS 基础索引和聊天历史；普通 RAG 聊天能力会在后续阶段接入。';
    conversationService.addMessage({
      conversationId: conversation.id,
      projectId,
      role: 'assistant',
      content: assistantContent,
      metadata: {
        type: 'chat_response',
        provider: 'electron-main',
        model: payload.selected_model || 'not-connected',
        status: 'complete',
      },
    });

    return {
      role: 'assistant',
      content: assistantContent,
      conversation_id: conversation.id,
      provider: 'electron-main',
      model: payload.selected_model || 'not-connected',
      error: null,
      sources: [],
      search_queries: [],
      search_actions: [],
      search_usage: {},
      reasoning_content: null,
    };

    return {
      role: 'assistant',
      content: '新的 Electron-only 服务层正在重建中。阶段 1 已接入本地企业数据库，阶段 2A 已接入本地知识库保存、切片和 FTS 检索。聊天能力将在后续阶段接入。',
      conversation_id: payload.conversation_id || `shell-${Date.now()}`,
      provider: 'electron-main',
      model: payload.selected_model || 'not-connected',
      error: null,
      sources: [],
      search_queries: [],
      search_actions: [],
      search_usage: {},
      reasoning_content: null,
    };
  });

  ipcMain.handle('geo-agent:send-chat-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:chat-stream:${requestId}`;
    try {
      const projectId = payload.project_id || payload.projectId;
      const conversation = conversationService.ensureConversation({
        projectId,
        conversationId: payload.conversation_id || null,
        firstMessage: payload.message,
      });
      conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'user',
        content: payload.message || '',
        metadata: { type: 'chat_user' },
      });

      const provider = 'electron-main';
      const model = payload.selected_model || 'auto-placeholder';
      const assistantContent = '新的 Electron-only 智能助手正在接入本地 RAG。当前这条回复已通过流式通道返回，并已写入当前企业的聊天历史。';
      event.sender.send(channel, {
        type: 'meta',
        conversation_id: conversation.id,
        provider,
        model,
      });
      event.sender.send(channel, {
        type: 'status',
        message: '正在写入当前企业聊天历史...',
        conversation_id: conversation.id,
      });
      await emitTextDeltas(event.sender, channel, assistantContent);

      conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content: assistantContent,
        metadata: {
          type: 'chat_response',
          provider,
          model,
          status: 'complete',
        },
      });
      event.sender.send(channel, {
        type: 'done',
        conversation_id: conversation.id,
        provider,
        model,
        content: assistantContent,
        error: null,
        sources: [],
        search_queries: [],
        search_actions: [],
        search_usage: {},
        reasoning_content: null,
      });
      return {
        type: 'done',
        conversation_id: conversation.id,
        provider,
        model,
        content: assistantContent,
        error: null,
        sources: [],
        search_queries: [],
        search_actions: [],
        search_usage: {},
        reasoning_content: null,
      };
    } catch (error) {
      const message = error.message || String(error);
      event.sender.send(channel, { type: 'error', error: message });
      return { type: 'error', error: message };
    }
  });

  ipcMain.handle('geo-agent:get-conversation', async (_event, conversationId) =>
    conversationService.getConversation(conversationId));
  ipcMain.handle('geo-agent:touch-conversation-summary', async (_event, payload = {}) =>
    conversationService.touchConversationForSummary(payload.conversationId || payload.conversation_id, payload.reason || 'manual'));
  ipcMain.handle('geo-agent:clear-conversation-history', async (_event, payload = {}) =>
    conversationService.clearConversationHistory(payload));
  ipcMain.handle('geo-agent:delete-conversation', async (_event, conversationId) =>
    conversationService.deleteConversation(conversationId));
  ipcMain.handle('geo-agent:run-geo-source-discovery', async (_event, geoProjectId, platform, fallbackReport = null) =>
    sourceDiscoveryService.generateSourceDiscovery({ geoProjectId, platform, fallbackReport }));
  ipcMain.handle('geo-agent:run-geo-source-discovery-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:run-geo-source-discovery-stream:${requestId}`;
    const projectId = payload.projectId || projectIdFromGeoProjectId(payload.geoProjectId || payload.geo_project_id);
    let conversation = null;
    let stageMessage = null;
    try {
      if (projectId) {
        let effectiveConversationId = payload.conversationId || payload.conversation_id || null;
        if (!effectiveConversationId) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          if (latest) {
            effectiveConversationId = latest.id;
          }
        }
        conversation = conversationService.ensureConversation({
          projectId,
          conversationId: effectiveConversationId,
          title: `${payload.platform || 'GEO'} 高权重信源发现`,
          firstMessage: '发现高权重信源',
          kind: 'geo_workflow',
        });
        stageMessage = conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'assistant',
          content: `正在发现 ${payload.platform || 'GEO'} 高权重信源。`,
          metadata: {
            type: 'geo_phase_result',
            status: 'streaming',
            phase: 3,
            platform: payload.platform,
            parent_message_id: payload.parentMessageId || null,
          },
        });
      }
      event.sender.send(channel, {
        type: 'meta',
        platform: payload.platform,
        phase: 3,
        conversation_id: conversation?.id,
        message: stageMessage,
      });
      const discovery = await sourceDiscoveryService.generateSourceDiscoveryStream(payload, (streamEvent) => {
        event.sender.send(channel, streamEvent);
      });
      if (conversation && projectId) {
        stageMessage = conversationService.updateConversationMessage({
          messageId: stageMessage.id,
          conversationId: conversation.id,
          projectId,
          content: `已完成 ${payload.platform || 'GEO'} 高权重信源发现。`,
          metadata: {
            type: 'geo_phase_result',
            status: discovery.status || 'completed',
            phase: 3,
            platform: discovery.platform || payload.platform,
            source_discovery: discovery,
            artifact_id: discovery.id,
          },
        });
      }
      event.sender.send(channel, {
        type: 'done',
        status: discovery.status || 'completed',
        conversation_id: conversation?.id,
        message: stageMessage,
      });
      return {
        type: 'done',
        status: discovery.status || 'completed',
        conversation_id: conversation?.id,
        message: stageMessage,
      };
    } catch (error) {
      const errorMessage = error.message || String(error);
      if (conversation && projectId) {
        try {
          conversationService.addMessage({
            conversationId: conversation.id,
            projectId,
            role: 'assistant',
            content: errorMessage,
            metadata: {
              type: 'geo_phase_result',
              status: 'error',
              phase: 3,
              platform: payload.platform,
              error: errorMessage,
            },
          });
        } catch (archiveError) {
          console.warn('[conversation] failed to archive source discovery error', archiveError);
        }
      }
      event.sender.send(channel, { type: 'error', error: errorMessage, conversation_id: conversation?.id });
      return { type: 'error', error: errorMessage, conversation_id: conversation?.id };
    }
  });
  ipcMain.handle('geo-agent:get-latest-geo-source-discovery', async (_event, geoProjectId, platform) =>
    sourceDiscoveryService.getLatestSourceDiscovery(geoProjectId, platform));
  ipcMain.handle('geo-agent:get-geo-source-discovery', async (_event, discoveryId) =>
    sourceDiscoveryService.getSourceDiscovery(discoveryId));
  ipcMain.handle('geo-agent:get-source-discoveries', async (_event, payload = {}) =>
    sourceDiscoveryService.listSourceDiscoveries(payload.projectId || payload.project_id, payload.platform || null));
  ipcMain.handle('geo-agent:confirm-source-discovery', async (_event, discoveryId) =>
    sourceDiscoveryService.confirmSourceDiscovery(discoveryId));

  ipcMain.handle('geo-agent:create-geo-phase-two-prompt', async (_event, geoProjectId, platform = 'doubao', conversationId = null) => {
    const project = createShellGeoProject(projectIdFromGeoProjectId(geoProjectId));
    const projectId = project.project_id;
    let effectiveConversationId = conversationId;
    if (!effectiveConversationId) {
      // 只复用同一知识库的 geo_workflow 类型会话
      const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
      if (latest) {
        effectiveConversationId = latest.id;
      }
    }
    const conversation = conversationService.ensureConversation({
      projectId,
      conversationId: effectiveConversationId,
      title: `${project.company_name || '企业'} GEO 阶段二`,
      firstMessage: '准备生成 AI 问题池',
      kind: 'geo_workflow',
    });
    const platformLabel = platform === 'deepseek' ? 'DeepSeek' : '豆包';
    const message = conversationService.addMessage({
      conversationId: conversation.id,
      projectId,
      role: 'assistant',
      content: `已准备进入${platformLabel}阶段二：AI 问题池生成。\n\n确认后会基于企业知识库生成${platformLabel}平台的用户真实问题池和高优先级排行榜问题，并保存到独立平台状态，不写入企业知识库事实条目。`,
      metadata: {
        type: 'geo_phase_prompt',
        project,
        platform,
        status: 'pending',
        confirmation_state: 'approval-requested',
      },
    });
    return { conversation_id: conversation.id, message };
  });

  // 阶段二：AI 问题池 - 确认
  ipcMain.handle('geo-agent:confirm-geo-phase-two', async (_event, geoProjectId, platform = 'doubao', messageId = null) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    const questionSet = await questionPoolService.getLatestQuestionSet(projectId, platform);

    if (!questionSet) {
      throw new Error('未找到阶段二问题池，请先生成问题池');
    }

    // 确认问题集
    await questionPoolService.confirmQuestionSet(questionSet.id);

    // 更新 conversation 消息
    if (messageId) {
      const db = getDb();
      const row = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(messageId);
      if (row) {
        conversationService.updateConversationMessage({
          messageId,
          conversationId: row.conversation_id,
          projectId,
          content: `已确认${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二问题池，共 ${questionSet.questions.question_pool?.length || 0} 个问题。`,
          metadata: {
            type: 'geo_phase_result',
            platform,
            phase: 2,
            question_set: questionSet,
            status: 'completed',
            confirmation_state: 'output-available',
            confirmation_approved: true,
          },
        });
      }
    }

    return createShellGeoProject(projectId);
  });

  // 阶段二：AI 问题池 - 取消
  ipcMain.handle('geo-agent:cancel-geo-phase-two', async (_event, geoProjectId, platform = 'doubao', messageId = null) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);

    // 更新 conversation 消息
    if (messageId) {
      const db = getDb();
      const row = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(messageId);
      if (row) {
        conversationService.updateConversationMessage({
          messageId,
          conversationId: row.conversation_id,
          projectId,
          content: `已暂缓进入${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二。`,
          metadata: {
            type: 'geo_phase_result',
            platform,
            phase: 2,
            status: 'user_deferred',
            confirmation_state: 'output-available',
            confirmation_approved: false,
          },
        });
      }
    }

    return createShellGeoProject(projectId);
  });

  // 阶段二：AI 问题池 - 流式生成
  ipcMain.handle('geo-agent:run-geo-phase-two-report-stream', async (event, request = {}) => {
    // 从 request 对象中解析参数（preload.cjs 发送的是 { requestId, payload } 格式）
    const requestId = request.requestId;
    const payload = request.payload || request;
    const geoProjectId = payload.geoProjectId;
    const platform = payload.platform || 'doubao';
    const messageId = payload.messageId || null;
    let conversationId = payload.conversationId || null;

    // 使用前端的 requestId 构建 channel，确保事件能被前端正确接收
    const channel = `geo-agent:run-geo-phase-two-report-stream:${requestId}`;
    const projectId = projectIdFromGeoProjectId(geoProjectId);

    try {
      if (!conversationId) {
        const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
        if (latest) {
          conversationId = latest.id;
        }
      }
      // 确保 conversation
      const conversation = conversationService.ensureConversation({
        projectId,
        conversationId,
        title: `${platform === 'doubao' ? '豆包' : 'DeepSeek'} 阶段二问题池生成`,
        kind: 'geo_workflow',
      });

      // 发送 meta 事件
      event.sender.send(channel, {
        type: 'meta',
        conversation_id: conversation.id,
        message: { id: messageId || `assistant-${Date.now()}`, role: 'assistant', content: '' },
      });

      // 调用流式生成
      const questionSet = await questionPoolService.generateQuestionPoolStream({
        projectId,
        platform,
        conversationId: conversation.id,
        onEvent: (streamEvent) => {
          event.sender.send(channel, streamEvent);
        },
      });

      // 更新 conversation 消息
      conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content: `已生成${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二问题池，共 ${questionSet.questions.question_pool?.length || 0} 个问题。`,
        metadata: {
          type: 'geo_phase_result',
          platform,
          phase: 2,
          question_set: questionSet,
          status: 'completed',
          confirmation_state: 'approval-requested',
        },
      });

      // 发送 done 事件
      event.sender.send(channel, {
        type: 'done',
        content: questionSet.questions.summary,
        status: 'completed',
      });

      return { type: 'done', question_set: questionSet };
    } catch (error) {
      console.error('[geo-phase-two] 流式调用失败:', error.message);
      event.sender.send(channel, { type: 'error', error: error.message });
      return { type: 'error', error: error.message };
    }
  });

  // 阶段二：AI 问题池 - 非流式生成
  ipcMain.handle('geo-agent:run-geo-phase-two-report', async (_event, geoProjectId, platform = 'doubao', messageId = null) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    return questionPoolService.generateQuestionPool({ projectId, platform });
  });

  // 阶段二：获取最新报告
  ipcMain.handle('geo-agent:get-latest-geo-report', async (_event, geoProjectId, platform) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    return questionPoolService.getLatestQuestionSet(projectId, platform);
  });

  // 阶段二：获取报告
  ipcMain.handle('geo-agent:get-geo-report', async (_event, reportId) => {
    return questionPoolService.getQuestionSet(reportId);
  });

  // 阶段二：获取最新问题集
  ipcMain.handle('geo-agent:get-latest-geo-question-set', async (_event, geoProjectId, platform) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    return questionPoolService.getLatestQuestionSet(projectId, platform);
  });

  // 阶段二：获取问题集
  ipcMain.handle('geo-agent:get-geo-question-set', async (_event, questionSetId) => {
    return questionPoolService.getQuestionSet(questionSetId);
  });

  const pendingApis = [
    'geo-agent:run-geo-article-draft',
    'geo-agent:run-geo-support-articles',
    'geo-agent:run-geo-support-articles-stream',
    'geo-agent:get-latest-geo-article-draft',
    'geo-agent:get-geo-article-draft',
    'geo-agent:confirm-geo-article-draft',
    'geo-agent:update-geo-article-draft',
  ];

  pendingApis.forEach((channel) => {
    ipcMain.handle(channel, async () => {
      throw notImplemented(channel);
    });
  });
}

loadEnvFile();
registerHandlers();

app.whenReady().then(async () => {
  initializeDatabase(app.getPath('userData'));
  await createWindow();
});

app.on('before-quit', () => {
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
