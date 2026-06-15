const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  DB_FILENAME,
  closeDatabase,
  getDatabasePath,
  getDb,
  getDbPath,
  initializeDatabase,
} = require('./services/databaseService.cjs');
const knowledgeService = require('./services/knowledgeService.cjs');
const conversationService = require('./services/conversationService.cjs');
const projectService = require('./services/projectService.cjs');
const sourceDiscoveryService = require('./services/sourceDiscoveryService.cjs');
const questionPoolService = require('./services/questionPoolService.cjs');
const articleDraftService = require('./services/articleDraftService.cjs');
const articlePublishService = require('./services/articlePublishService.cjs');
const visibilityCheckService = require('./services/visibilityCheckService.cjs');
const reflectionService = require('./services/reflectionService.cjs');
const skillService = require('./services/skillService.cjs');
const autoLearningScheduler = require('./services/autoLearningScheduler.cjs');
const { fieldText } = require('./services/profileFieldService.cjs');
const llmGateway = require('./services/llmGateway.cjs');
const contextWindowService = require('./services/contextWindowService.cjs');
const agentRuntimeService = require('./services/agentRuntimeService.cjs');
const ruleService = require('./services/ruleService.cjs');
const attachmentService = require('./services/attachmentService.cjs');
const webBuilderService = require('./services/webBuilderService.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3000';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');

let mainWindow = null;
let databaseStartupWarning = null;
const activeStreams = new Map(); // requestId -> { abortController, channel, sender }

function canWriteDirectory(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function ensureWritableUserDataPath() {
  const primaryDir = app.getPath('userData');
  if (canWriteDirectory(primaryDir)) {
    return;
  }
  const fallbackDir = path.join(app.getPath('temp'), 'GEO-Agent Studio', 'user-data');
  fs.mkdirSync(fallbackDir, { recursive: true });
  app.setPath('userData', fallbackDir);
  databaseStartupWarning = `默认用户数据目录不可写，已切换到备用目录：${fallbackDir}`;
}

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

function updateEnvFile(updates) {
  const envPath = path.join(rootDir, '.env');
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  }

  const updatedKeys = new Set();
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return line;
    const key = trimmed.slice(0, separator).trim();
    if (key in updates) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // 追加尚未存在的 key
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
}

function emptyIndexStatus(projectId = null) {
  return {
    project_id: projectId,
    embedding_model: 'not-enabled',
    vector_backend: 'fts5',
    embedding_backend: 'disabled',
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
  const keywords = fieldText(profile || {}, 'target_keywords');
  if (!keywords) {
    return [];
  }

  return String(keywords)
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createShellGeoProject(projectId) {
  const timestamp = nowIso();
  const snapshot = getKnowledgeSnapshot(projectId);
  const profile = snapshot.profile;
  const indexStatus = snapshot.index_status || emptyIndexStatus(projectId);
  const companyName = fieldText(profile || {}, 'company_name') || '待录入企业';
  const knowledgeReady = Boolean(companyName !== '待录入企业' && indexStatus.indexed > 0);

  return {
    id: `geo-${projectId || 'shell'}`,
    project_id: projectId || '',
    company_name: companyName,
    industry: fieldText(profile || {}, 'industry_category') || null,
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

function parseRequestedArticleCount(text) {
  const value = String(text || '');
  const digitMatch = value.match(/(\d{1,2})\s*篇/);
  if (digitMatch) return Math.min(6, Math.max(1, Number(digitMatch[1] || 1)));
  const cnMap = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cnMatch = value.match(/([一两二三四五六七八九十])\s*篇/);
  if (cnMatch) return Math.min(6, Math.max(1, cnMap[cnMatch[1]] || 1));
  return 1;
}

function inferAdditionalArticleRequest(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const asksArticle = /(文章|稿件|内容|排行榜稿|支撑稿|测评稿|咨询稿)/.test(value);
  const asksMore = /(继续|再|另|多|补充|加|生成|写|来)/.test(value);
  if (!asksArticle || !asksMore) return null;
  const articleRole = /(排行|榜单|TOP|top)/.test(value)
    ? 'ranking'
    : /(支撑|科普|咨询|测评|案例|品牌)/.test(value)
      ? 'support'
      : 'auto';
  return {
    count: parseRequestedArticleCount(value),
    articleRole,
    instruction: value,
  };
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

function prepareKnowledgeDraftContext(payload = {}) {
  const intent = payload.intent || 'create';
  let projectId = intent === 'create' && !payload.reuse_draft_project
    ? null
    : payload.project_id || payload.projectId || null;
  const shouldCreateProject = intent === 'create' && !projectId;
  if (shouldCreateProject) {
    const project = projectService.createProject({
      name: fieldText(payload.profile || {}, 'company_name') || '待确认企业知识库',
      description: '知识库草稿确认前自动创建的占位项目。',
    }).project;
    projectId = project.id;
    payload.project_id = projectId;
    payload.projectId = projectId;
    payload.conversation_id = null;
  }
  return { projectId, shouldCreateProject };
}

function createShellWorkflowState(geoProjectId) {
  const projectId = String(geoProjectId || '').replace(/^geo-/, '');
  const snapshot = getKnowledgeSnapshot(projectId);
  const profile = snapshot.profile;
  const indexStatus = snapshot.index_status || emptyIndexStatus(projectId);
  const companyName = fieldText(profile || {}, 'company_name') || '待录入企业';
  const knowledgeReady = Boolean(companyName !== '待录入企业' && indexStatus.indexed > 0);

  const stage = (stageNumber, key, label, description, status = 'not_started', artifactId = null, artifacts = {}) => ({
    stage: stageNumber,
    key,
    label,
    status,
    description,
    artifact_id: artifactId,
    artifacts,
  });

  const platformState = (platform, label) => {
    let questionSet = null;
    let discovery = null;
    let articleStats = { total: 0, published: 0, reviewed: 0 };
    let visibilityCheck = null;
    let pendingRules = 0;
    try {
      const db = getDb();
      questionSet = db.prepare(`
        SELECT id, status FROM geo_question_sets
        WHERE project_id = ? AND platform = ?
        ORDER BY datetime(created_at) DESC LIMIT 1
      `).get(projectId, platform);
      discovery = db.prepare(`
        SELECT id, status FROM geo_source_discoveries
        WHERE project_id = ? AND platform = ?
        ORDER BY datetime(created_at) DESC LIMIT 1
      `).get(projectId, platform);
      const articleRows = db.prepare(`
        SELECT status, draft_json FROM geo_article_drafts
        WHERE project_id = ? AND platform = ?
      `).all(projectId, platform);
      articleStats = articleRows.reduce((acc, row) => {
        acc.total += 1;
        const parsed = JSON.parse(row.draft_json || '{}');
        const status = parsed?.publication_evidence?.status || row.status;
        if (status === 'published') acc.published += 1;
        if (['reviewed', 'published'].includes(status)) acc.reviewed += 1;
        return acc;
      }, { total: 0, published: 0, reviewed: 0 });
      visibilityCheck = db.prepare(`
        SELECT id, status FROM ai_visibility_checks
        WHERE project_id = ? AND platform = ?
        ORDER BY datetime(created_at) DESC LIMIT 1
      `).get(projectId, platform);
      pendingRules = db.prepare(`
        SELECT COUNT(*) AS count FROM evolution_rules
        WHERE project_id = ? AND platform = ? AND status = 'pending'
      `).get(projectId, platform)?.count || 0;
    } catch {
      // Keep shell state available before database initialization.
    }
    const stage2Status = questionSet ? 'completed' : (knowledgeReady ? 'ready' : 'not_started');
    const stage3Status = discovery ? 'completed' : (questionSet ? 'ready' : 'not_started');
    const stage4Status = articleStats.total >= 9 ? 'completed' : (discovery ? 'ready' : 'not_started');
    const stage5Status = articleStats.published > 0 ? 'completed' : (articleStats.total > 0 ? 'ready' : 'not_started');
    const stage6Status = visibilityCheck ? 'completed' : (articleStats.published > 0 ? 'ready' : 'not_started');
    const stage7Status = pendingRules > 0 ? 'pending' : (visibilityCheck ? 'ready' : 'not_started');
    return {
      platform,
      label,
      stages: {
        stage_2: stage(2, 'stage_2', 'AI 问题池', '基于企业知识库和目标词生成 10 条核心问题。', stage2Status, questionSet?.id || null),
        stage_3: stage(3, 'stage_3', '信源发现', '使用豆包助手联网搜索观察真实引用来源。', stage3Status, discovery?.id || null),
        stage_4: stage(4, 'stage_4', '内容资产生成', '生成首轮支撑文章和排行榜文章草稿。', stage4Status, null, articleStats),
        stage_5: stage(5, 'stage_5', '稿件管理与发布', '校对稿件、生成 OSS 预览、选择媒体投递并同步订单状态。', stage5Status, null, articleStats),
        stage_6: stage(6, 'stage_6', 'AI 推荐可见性检测', '有已发布文章 URL 后自动检测核心问题，并每 10 分钟复查。', stage6Status, visibilityCheck?.id || null),
        stage_7: stage(7, 'stage_7', '反思优化/自动学习', '仅在文章被 AI 推荐或排名上升时生成待确认学习规则。', stage7Status, null, { pending_rules: pendingRules }),
      },
    };
  };

  return {
    geo_project_id: geoProjectId,
    enterprise_project_id: projectId,
    company_name: companyName,
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
      <h1>GEO-Agent Studio 鏈兘鍔犺浇鍓嶇椤甸潰</h1>
      <p>${escapeHtml(reason)}</p>
      <p>寮€鍙戞ā寮忚浣跨敤 <code>npm run dev</code> 鍚姩锛屽畠浼氬悓鏃跺惎鍔?Vite 鍜?Electron銆?/p>
      <p>濡傛灉鍙惎鍔ㄤ簡 Electron锛岃鍏堣繍琛?<code>npm run build</code>锛屽簲鐢ㄤ細鍥為€€鍔犺浇鏈湴 dist 椤甸潰銆?/p>
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

  // 处理 <a target="_blank"> 链接，在外部浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 窗口关闭/重载时清理活跃流，避免向已销毁的 webContents 发送消息
  mainWindow.webContents.on('destroyed', () => {
    clearAllActiveStreams();
  });

  if (isDev) {
    if (await canReachUrl(devServerUrl)) {
      try {
        await mainWindow.loadURL(devServerUrl);
        return;
      } catch (error) {
        console.warn(`[startup] Failed to load ${devServerUrl}; falling back to built dist.`, error);
      }
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
    database_warning: databaseStartupWarning,
    timestamp: nowIso(),
  });

  ipcMain.handle('app:ping', health);
  ipcMain.handle('geo-agent:health-check', health);

  // 绐楀彛鎺у埗
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

  ipcMain.handle('geo-agent:get-settings', async () => {
    const rows = getDb().prepare('SELECT key, value FROM app_settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  ipcMain.handle('geo-agent:save-settings', async (_event, settings) => {
    const upsert = getDb().prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    );
    const timestamp = new Date().toISOString();
    const envUpdates = {};
    const saveMany = getDb().transaction((entries) => {
      for (const [key, value] of entries) {
        upsert.run(key, String(value), timestamp);
        envUpdates[key] = String(value);
      }
    });
    saveMany(Object.entries(settings));

    // 运行时更新 process.env
    for (const [key, value] of Object.entries(envUpdates)) {
      process.env[key] = value;
    }

    // 持久化到 .env 文件
    updateEnvFile(envUpdates);

    return { ok: true };
  });

  ipcMain.handle('geo-agent:get-skills', async () => ({
    skills: skillService.getUserSkills(),
  }));

  ipcMain.handle('geo-agent:get-projects', async () => ({
    projects: projectService.listProjects(),
  }));
  ipcMain.handle('geo-agent:create-project', async (_event, payload) => projectService.createProject(payload));
  ipcMain.handle('geo-agent:get-project', async (_event, projectId) => projectService.getProject(projectId));
  ipcMain.handle('geo-agent:delete-project', async (_event, projectId) => projectService.deleteProject(projectId));

  // 项目管理：企业优化阶段进度聚合
  ipcMain.handle('geo-agent:get-project-summaries', async () => ({
    projects: projectService.listProjectsWithStageProgress(),
  }));
  ipcMain.handle('geo-agent:get-project-summary', async (_event, projectId) =>
    projectService.getProjectSummary(projectId));
  ipcMain.handle('geo-agent:set-reflection-enabled', async (_event, projectId, enabled) =>
    projectService.setReflectionEnabled(projectId, enabled));

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
  ipcMain.handle('geo-agent:reparse-knowledge-asset', async (_event, assetId) =>
    knowledgeService.reparseKnowledgeAsset(assetId));
  ipcMain.handle('geo-agent:delete-knowledge-asset', async (_event, assetId) =>
    knowledgeService.deleteKnowledgeAsset(assetId));
  ipcMain.handle('geo-agent:create-knowledge-draft', async (_event, draft = {}) => {
    prepareKnowledgeDraftContext(draft);
    return knowledgeService.createKnowledgeDraft(draft);
  });
  ipcMain.handle('geo-agent:create-knowledge-draft-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:create-knowledge-draft-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    const isCreateIntent = (payload.intent || 'create') === 'create';
    const canReuseDraftConversation = isCreateIntent
      && payload.conversation_id
      && conversationService.canReuseDraftConversationForCreate(payload.conversation_id);
    if (isCreateIntent) {
      payload.reuse_draft_project = Boolean(canReuseDraftConversation);
    }
    const context = prepareKnowledgeDraftContext(payload);
    const projectId = context.projectId;
    let conversation = null;
    let draftMessage = null;
    let processingDraft = null;
    let processingMessage = null;
    try {
      try {
        if (true) {
        // 尝试复用最近的 geo_workflow 会话；没有则创建新的会话。
        let effectiveConversationId = payload.conversation_id || null;
        if (!effectiveConversationId && projectId && !isCreateIntent) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          if (latest) {
            effectiveConversationId = latest.id;
          }
        }
        if (effectiveConversationId && projectId) {
          const row = getDb()
            .prepare('SELECT project_id FROM conversations WHERE id = ?')
            .get(effectiveConversationId);
          if (row && row.project_id !== projectId) {
            effectiveConversationId = null;
          }
        }
        conversation = conversationService.ensureConversation({
          projectId,
          conversationId: effectiveConversationId,
          firstMessage: payload.message || '创建企业知识库',
          kind: 'geo_workflow',
        });
        payload.conversation_id = conversation.id;
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
        processingDraft = knowledgeService.createProcessingDraft(payload);
        payload.processing_draft_id = processingDraft.id;
        processingMessage = conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'assistant',
          content: '正在生成企业知识库草稿。若软件关闭或流程中断，可稍后在对话历史中恢复该任务。',
          metadata: {
            type: 'knowledge_draft_task',
            draft: processingDraft,
            status: 'processing',
            confirmation_state: 'approval-responded',
          },
        });
        safeSend(event.sender, channel, {
          type: 'meta',
          task: 'knowledge_extraction',
          conversation_id: conversation.id,
          project_id: projectId,
          draft: processingDraft,
          message: processingMessage,
          can_proceed: false,
        });
      }
      const draft = await knowledgeService.createKnowledgeDraft(payload, (streamEvent) => {
        safeSend(event.sender, channel, streamEvent);
      });
      if (draft.extraction_status === 'failed' || draft.status === 'failed') {
        const error = draft.error_message || draft.warnings?.[0] || '知识库草稿创建失败。';
        if (processingMessage && conversation) {
          draftMessage = conversationService.updateConversationMessage({
            messageId: processingMessage.id,
            conversationId: conversation.id,
            projectId,
            content: error,
            metadata: {
              type: 'knowledge_draft_task',
              draft: { ...draft, conversation_id: conversation.id },
              status: 'failed',
              confirmation_state: 'output-available',
            },
          });
        }
        safeSend(event.sender, channel, { type: 'error', error, draft, can_proceed: false });
        return { type: 'error', error, draft, can_proceed: false };
      }
      if (conversation) {
        const messagePayload = {
          messageId: processingMessage?.id,
          conversationId: conversation.id,
          projectId,
          content: '已根据资料生成企业知识库草稿。请核对字段和来源片段，确认后再正式建立知识库。',
          metadata: {
            type: 'knowledge_draft',
            draft: { ...draft, conversation_id: conversation.id },
            status: 'complete',
            confirmation_state: 'approval-requested',
          },
        };
        draftMessage = processingMessage
          ? conversationService.updateConversationMessage(messagePayload)
          : conversationService.addMessage({ ...messagePayload, role: 'assistant' });
        draft.conversation_id = conversation.id;
      }
      safeSend(event.sender, channel, { type: 'done', draft, conversation_id: conversation?.id, project_id: projectId, message: draftMessage, can_proceed: true });
      return { type: 'done', draft, conversation_id: conversation?.id, project_id: projectId, message: draftMessage, can_proceed: true };
    } catch (error) {
      const message = error.message || String(error);
      if (processingMessage && conversation) {
        try {
          conversationService.updateConversationMessage({
            messageId: processingMessage.id,
            conversationId: conversation.id,
            projectId,
            content: message,
            metadata: {
              type: 'knowledge_draft_task',
              draft: processingDraft ? { ...processingDraft, status: 'failed', error_message: message } : null,
              status: 'failed',
              confirmation_state: 'output-available',
            },
          });
        } catch {
          // 保留原始错误返回；恢复消息更新失败不应吞掉主错误。
        }
      }
      safeSend(event.sender, channel, { type: 'error', error: message, can_proceed: false });
      return { type: 'error', error: message, can_proceed: false };
    }
  } finally {
    activeStreams.delete(requestId);
  }
});
  ipcMain.handle('geo-agent:confirm-knowledge-draft', async (_event, payload = {}) => {
    const response = await knowledgeService.confirmKnowledgeDraft(payload);
    const projectId = response.project_id;
    if (projectId) {
      try {
        // 确认草稿后继续使用同一知识库的 geo_workflow 会话，避免历史被拆到别的项目。
        let effectiveConversationId = payload.draft?.conversation_id || payload.conversationId || null;
        if (!effectiveConversationId) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          if (latest) {
            effectiveConversationId = latest.id;
          }
        }
        let conversation = null;
        if (effectiveConversationId) {
          try {
            conversation = conversationService.bindConversationToProject(effectiveConversationId, projectId);
          } catch {
            effectiveConversationId = null;
          }
        }
        if (!conversation && !effectiveConversationId) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          effectiveConversationId = latest?.id || null;
        }
        if (!conversation) {
          conversation = conversationService.ensureConversation({
            projectId,
            conversationId: effectiveConversationId,
            title: `${fieldText(response.profile || {}, 'company_name') || response.profile.company_name || '企业'} GEO 优化`,
            firstMessage: '开始 GEO 优化流程',
            kind: 'geo_workflow',
          });
        }
        conversationService.updateConversationTitle(
          conversation.id,
          `${fieldText(response.profile || {}, 'company_name') || response.profile.company_name || '企业'} GEO 优化`
        );
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
          content: `已建立「${fieldText(response.profile || {}, 'company_name') || response.profile.company_name || '企业'}」企业知识库，并完成本地索引。`,
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
  ipcMain.handle('geo-agent:build-knowledge-diff', async (_event, payload = {}) =>
    knowledgeService.buildDraftDiff(payload));
  ipcMain.handle('geo-agent:build-knowledge-update-proposal', async (_event, payload = {}) =>
    knowledgeService.buildKnowledgeUpdateProposal(payload));
  ipcMain.handle('geo-agent:apply-knowledge-diff', async (_event, payload = {}) =>
    knowledgeService.applyDraftDiff(payload));

  ipcMain.handle('geo-agent:get-conversations', async (_event, payload = {}) => {
    knowledgeService.markInterruptedDrafts();
    return conversationService.listConversations(payload.projectId || payload.project_id || null, payload.limit, {
      reason: payload.reason || 'history_open',
    });
  });
  ipcMain.handle('geo-agent:get-recoverable-draft-conversations', async (_event, payload = {}) => {
    knowledgeService.markInterruptedDrafts();
    return conversationService.listRecoverableDraftConversations(payload.limit, {
      reason: payload.reason || 'history_open',
    });
  });
  ipcMain.handle('geo-agent:get-public-conversations', async (_event, payload = {}) => {
    knowledgeService.markInterruptedDrafts();
    return conversationService.listPublicConversations(payload.limit);
  });
  ipcMain.handle('geo-agent:get-geo-projects', async () => ({ projects: [] }));
  ipcMain.handle('geo-agent:ensure-geo-project', async (_event, projectId) => createShellGeoProject(projectId));
  ipcMain.handle('geo-agent:get-geo-project', async (_event, geoProjectId) => createShellGeoProject(geoProjectId));
  ipcMain.handle('geo-agent:get-geo-workflow-state', async (_event, geoProjectId) => createShellWorkflowState(geoProjectId));

  ipcMain.handle('geo-agent:send-chat', async (_event, payloadOrMessage, conversationId = null, selectedModel = null) => {
    const payload = typeof payloadOrMessage === 'object' && payloadOrMessage !== null
      ? payloadOrMessage
      : { message: payloadOrMessage, conversation_id: conversationId, selected_model: selectedModel };
    const projectId = payload.project_id || payload.projectId;
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
  });

  ipcMain.handle('geo-agent:cancel-stream', async (_event, { requestId }) => {
    const stream = activeStreams.get(requestId);
    if (stream?.abortController) {
      stream.abortController.abort();
      return { ok: true };
    }
    return { ok: false, reason: 'stream_not_found' };
  });

  // 安全发送：检查 webContents 是否已销毁
  function safeSend(sender, channel, data) {
    try {
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, data);
      }
    } catch (err) {
      console.warn('[IPC] safeSend 失败:', err.message);
    }
  }

  // 清理所有活跃流（窗口关闭/重载时调用）
  function clearAllActiveStreams() {
    for (const [id, stream] of activeStreams.entries()) {
      try {
        if (stream.abortController) stream.abortController.abort();
      } catch (_) { /* 忽略 */ }
    }
    activeStreams.clear();
  }

  ipcMain.handle('geo-agent:send-chat-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:chat-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    try {
      const doneEvent = await agentRuntimeService.runChatStream({
        payload,
        sender: event.sender,
        channel,
        signal: abortController.signal,
      });
      safeSend(event.sender, channel, doneEvent);
      return doneEvent;
    } catch (error) {
      const isAbort = error.name === 'AbortError' || abortController.signal.aborted;
      if (isAbort) {
        const cancelledEvent = {
          type: 'cancelled',
          conversation_id: payload.conversation_id || null,
          error: null,
        };
        safeSend(event.sender, channel, cancelledEvent);
        return cancelledEvent;
      }
      const message = error.message || String(error);
      safeSend(event.sender, channel, { type: 'error', error: message });
      return { type: 'error', error: message };
    } finally {
      activeStreams.delete(requestId);
    }
  });

  ipcMain.handle('geo-agent:run-agent-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:run-agent-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    try {
      const doneEvent = await agentRuntimeService.runChatStream({
        payload,
        sender: event.sender,
        channel,
        signal: abortController.signal,
      });
      safeSend(event.sender, channel, doneEvent);
      return doneEvent;
    } catch (error) {
      const isAbort = error.name === 'AbortError' || abortController.signal.aborted;
      if (isAbort) {
        const cancelledEvent = {
          type: 'cancelled',
          conversation_id: payload.conversation_id || null,
          error: null,
        };
        safeSend(event.sender, channel, cancelledEvent);
        return cancelledEvent;
      }
      const message = error.message || String(error);
      safeSend(event.sender, channel, { type: 'error', error: message });
      return { type: 'error', error: message };
    } finally {
      activeStreams.delete(requestId);
    }
  });

  ipcMain.handle('geo-agent:approve-agent-action', async (_event, payload = {}) => {
    const action = payload.type ? payload : payload.pendingAction || payload.pending_action || {};
    const actionPayload = action.payload || payload.payload || {};
    if (action.type === 'knowledge_update') {
      const projectId = actionPayload.projectId || actionPayload.project_id;
      const patch = actionPayload.patch || actionPayload.profile || payload.patch || payload.profile || null;
      if (!projectId) throw new Error('projectId is required.');
      if (!patch || Object.keys(patch).length === 0) {
        return {
          ok: false,
          status: 'needs_patch',
          message: '该知识库更新提案还没有明确字段 patch，未写入知识库。',
          payload,
        };
      }
      const result = await knowledgeService.updateKnowledgeProfile(projectId, patch);
      return { ok: true, status: 'applied', result };
    }
    if (action.type === 'article_revision') {
      const articleId = actionPayload.articleId || actionPayload.article_id;
      const patch = actionPayload.patch || payload.patch || null;
      if (!articleId) throw new Error('articleId is required.');
      if (!patch || Object.keys(patch).length === 0) {
        return {
          ok: false,
          status: 'needs_patch',
          message: '该稿件修改提案还没有可覆盖的 patch，未修改原稿。',
          payload,
        };
      }
      const result = await articleDraftService.updateArticleDraft(articleId, patch);
      return { ok: true, status: 'applied', result };
    }
    return {
      ok: false,
      status: 'unsupported_action',
      message: '当前动作类型暂不支持统一审批执行。',
      payload,
    };
  });

  ipcMain.handle('geo-agent:reject-agent-action', async (_event, payload = {}) => ({
    ok: true,
    status: 'rejected',
    payload,
  }));

  ipcMain.handle('geo-agent:get-conversation', async (_event, conversationId) =>
    conversationService.getConversation(conversationId));
  ipcMain.handle('geo-agent:touch-conversation-summary', async (_event, payload = {}) =>
    conversationService.touchConversationForSummary(payload.conversationId || payload.conversation_id, payload.reason || 'manual'));
  ipcMain.handle('geo-agent:clear-conversation-history', async (_event, payload = {}) =>
    conversationService.clearConversationHistory(payload));
  ipcMain.handle('geo-agent:delete-conversation', async (_event, conversationId) =>
    conversationService.deleteConversation(conversationId));

  // 附件管理 IPC handlers
  ipcMain.handle('geo-agent:upload-chat-attachment', async (_event, payload = {}) => {
    return attachmentService.uploadAttachment({
      projectId: payload.projectId,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      content: payload.content,
      contentBase64: payload.contentBase64 || payload.content_base64,
      assetStatus: payload.assetStatus || payload.asset_status,
      sourceMessageId: payload.sourceMessageId || payload.source_message_id,
    });
  });

  ipcMain.handle('geo-agent:get-chat-attachment', async (_event, attachmentId) => {
    return attachmentService.getAttachment(attachmentId);
  });

  ipcMain.handle('geo-agent:get-chat-attachment-content', async (_event, attachmentId) => {
    return attachmentService.getAttachmentContent(attachmentId);
  });

  ipcMain.handle('geo-agent:get-attachments-for-message', async (_event, messageId) => {
    return attachmentService.getAttachmentsForMessage(messageId);
  });

  ipcMain.handle('geo-agent:get-attachments-for-conversation', async (_event, conversationId) => {
    return attachmentService.getAttachmentsForConversation(conversationId);
  });

  ipcMain.handle('geo-agent:delete-chat-attachment', async (_event, attachmentId) => {
    return attachmentService.deleteAttachment(attachmentId);
  });

  // 企业图片管理 IPC handlers
  const enterpriseImageService = require('./services/enterpriseImageService.cjs');

  ipcMain.handle('geo-agent:upload-enterprise-image', async (_event, payload = {}) => {
    return enterpriseImageService.uploadImage({
      projectId: payload.projectId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      content: payload.content,
    });
  });

  ipcMain.handle('geo-agent:get-enterprise-images', async (_event, projectId) => {
    return enterpriseImageService.getImagesByProject(projectId);
  });

  ipcMain.handle('geo-agent:delete-enterprise-image', async (_event, imageId) => {
    return enterpriseImageService.deleteImage(imageId);
  });

  ipcMain.handle('geo-agent:update-enterprise-image-sort', async (_event, imageIds) => {
    return enterpriseImageService.updateImageSort(imageIds);
  });

  ipcMain.handle('geo-agent:run-geo-source-discovery', async (_event, geoProjectId, platform, fallbackReport = null) =>
    sourceDiscoveryService.generateSourceDiscovery({ geoProjectId, platform, fallbackReport }));
  ipcMain.handle('geo-agent:run-geo-source-discovery-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:run-geo-source-discovery-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    try {
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
        const runningMessage = conversationService.findRunningPhaseMessage({
          conversationId: conversation.id,
          projectId,
          phase: 3,
          platform: payload.platform,
        });
        if (runningMessage) {
          safeSend(event.sender, channel, {
            type: 'meta',
            platform: payload.platform,
            phase: 3,
            conversation_id: conversation.id,
            message: runningMessage,
          });
          safeSend(event.sender, channel, {
            type: 'done',
            status: 'already_running',
            already_running: true,
            conversation_id: conversation.id,
            message: runningMessage,
          });
          return {
            type: 'done',
            status: 'already_running',
            already_running: true,
            conversation_id: conversation.id,
            message: runningMessage,
          };
        }
        stageMessage = conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'assistant',
          content: `正在发现 ${payload.platform || 'GEO'} 高权重信源。`,
          metadata: {
            type: 'geo_phase_prompt',
            status: 'streaming',
            phase: 3,
            platform: payload.platform,
            parent_message_id: payload.parentMessageId || null,
          },
        });
      }
      safeSend(event.sender, channel, {
        type: 'meta',
        platform: payload.platform,
        phase: 3,
        conversation_id: conversation?.id,
        message: stageMessage,
      });
      const discovery = await sourceDiscoveryService.generateSourceDiscoveryStream(payload, (streamEvent) => {
        safeSend(event.sender, channel, streamEvent);
      });
      if (conversation && projectId) {
        stageMessage = conversationService.updateConversationMessage({
          messageId: stageMessage.id,
          conversationId: conversation.id,
          projectId,
          content: `已完成 ${payload.platform || 'GEO'} 高权重信源发现。`,
          metadata: {
            type: 'geo_phase_prompt',
            status: discovery.status || 'completed',
            phase: 3,
            platform: discovery.platform || payload.platform,
            source_discovery: discovery,
            artifact_id: discovery.id,
          },
        });
      }
      safeSend(event.sender, channel, {
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
      safeSend(event.sender, channel, { type: 'error', error: errorMessage, conversation_id: conversation?.id });
      return { type: 'error', error: errorMessage, conversation_id: conversation?.id };
    }
  } finally {
    activeStreams.delete(requestId);
  }
});
  ipcMain.handle('geo-agent:get-latest-geo-source-discovery', async (_event, geoProjectId, platform) => {
    try {
      return sourceDiscoveryService.getLatestSourceDiscovery(geoProjectId, platform);
    } catch (error) {
      if (String(error?.message || '').includes('暂无豆包助手联网信源发现结果')) {
        return null;
      }
      throw error;
    }
  });
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
    if (effectiveConversationId) {
      const row = getDb().prepare('SELECT project_id FROM conversations WHERE id = ?').get(effectiveConversationId);
      if (row && row.project_id !== projectId) {
        effectiveConversationId = null;
      }
    }
    if (!effectiveConversationId) {
      // 只复用同一知识库下的 geo_workflow 会话。
      const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
      if (latest) {
        effectiveConversationId = latest.id;
      }
    }
    const conversation = conversationService.ensureConversation({
      projectId,
      conversationId: effectiveConversationId,
      title: `${project.company_name || '企业'} GEO 阶段二`,
      firstMessage: '准备生成 AI 核心问题池',
      kind: 'geo_workflow',
    });
    const platformLabel = platform === 'deepseek' ? 'DeepSeek' : '豆包';
    const message = conversationService.addMessage({
      conversationId: conversation.id,
      projectId,
      role: 'assistant',
      content: `已准备进入${platformLabel}阶段二：AI 核心问题池生成。\n\n确认后会基于企业知识库和 target_keywords 直接生成 10 条核心问题，并自动确认为本轮 GEO 北极星问题。`,
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

  // 闃舵浜岋細AI 闂姹?- 纭
  ipcMain.handle('geo-agent:confirm-geo-phase-two', async (_event, geoProjectId, platform = 'doubao', messageId = null, confirmedQuestionIds = []) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    const questionSet = await questionPoolService.getLatestQuestionSet(projectId, platform);

    if (!questionSet) {
      throw new Error('未找到阶段二问题池，请先生成问题池。');
    }

    // 纭闂闆?
    // 鏇存柊 conversation 娑堟伅
    const confirmedQuestionSet = await questionPoolService.confirmQuestionSet(questionSet.id, confirmedQuestionIds);

    if (messageId) {
      const db = getDb();
      const row = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(messageId);
      if (row) {
        conversationService.updateConversationMessage({
          messageId,
          conversationId: row.conversation_id,
          projectId,
          content: `已确认${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二问题池，共 ${questionSet.questions.confirmed_questions?.length || questionSet.questions.question_pool?.length || 0} 个问题。`,
          metadata: {
            type: 'geo_phase_prompt',
            platform,
            phase: 2,
            question_set: confirmedQuestionSet,
            status: 'completed',
            confirmation_state: 'output-available',
            confirmation_approved: true,
          },
        });
      }
    }

    return {
      project: createShellGeoProject(projectId),
      question_set: confirmedQuestionSet,
    };
  });

  // 闃舵浜岋細AI 闂姹?- 鍙栨秷
  ipcMain.handle('geo-agent:cancel-geo-phase-two', async (_event, geoProjectId, platform = 'doubao', messageId = null) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);

    // 鏇存柊 conversation 娑堟伅
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
            type: 'geo_phase_prompt',
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

  // 闃舵浜岋細AI 闂姹?- 娴佸紡鐢熸垚
  ipcMain.handle('geo-agent:run-geo-phase-two-report-stream', async (event, request = {}) => {
    // 从 request 对象中解析参数，preload.cjs 发送的是 { requestId, payload } 格式。
    const requestId = request.requestId;
    const payload = request.payload || request;
    const geoProjectId = payload.geoProjectId;
    const platform = payload.platform || 'doubao';
    const messageId = payload.messageId || null;
    let conversationId = payload.conversationId || null;

    // 使用前端 requestId 构建 channel，确保事件能被前端正确接收。
    const channel = `geo-agent:run-geo-phase-two-report-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    if (conversationId) {
      const row = getDb().prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId);
      if (row && row.project_id !== projectId) {
        conversationId = null;
      }
    }

    try {
      try {
        if (!conversationId) {
        const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
        if (latest) {
          conversationId = latest.id;
        }
      }
      // 纭繚 conversation
      const conversation = conversationService.ensureConversation({
        projectId,
        conversationId,
        title: `${platform === 'doubao' ? '璞嗗寘' : 'DeepSeek'} 闃舵浜岄棶棰樻睜鐢熸垚`,
        kind: 'geo_workflow',
      });
      let runningPromptMessage = null;
      if (messageId) {
        try {
          runningPromptMessage = conversationService.updateConversationMessage({
            messageId,
            conversationId: conversation.id,
            projectId,
            content: `正在生成${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二排行榜问题池。`,
            metadata: {
              type: 'geo_phase_prompt',
              platform,
              phase: 2,
              status: 'streaming',
              confirmation_state: 'approval-responded',
              confirmation_approved: true,
            },
          });
        } catch {
          runningPromptMessage = null;
        }
      }

      // 鍙戦€?meta 浜嬩欢
      safeSend(event.sender, channel, {
        type: 'meta',
        conversation_id: conversation.id,
        message: runningPromptMessage || { id: messageId || `assistant-${Date.now()}`, role: 'assistant', content: '' },
      });

      // 璋冪敤娴佸紡鐢熸垚
      const questionSet = await questionPoolService.generateQuestionPoolStream({
        projectId,
        platform,
        conversationId: conversation.id,
        onEvent: (streamEvent) => {
          safeSend(event.sender, channel, streamEvent);
        },
      });

      // 鏇存柊 conversation 娑堟伅
      const resultMessage = conversationService.addMessage({
        conversationId: conversation.id,
        projectId,
        role: 'assistant',
        content: `已生成${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二核心问题池，共 ${questionSet.questions.confirmed_questions?.length || questionSet.questions.question_pool?.length || 0} 条问题。`,
        metadata: {
          type: 'geo_phase_result',
          platform,
          phase: 2,
          question_set: questionSet,
          status: 'completed',
          confirmation_state: 'output-available',
        },
      });
      if (messageId) {
        try {
          conversationService.updateConversationMessage({
            messageId,
            conversationId: conversation.id,
            projectId,
            content: `已完成${platform === 'doubao' ? '豆包' : 'DeepSeek'}阶段二排行榜问题池。`,
            metadata: {
              type: 'geo_phase_prompt',
              platform,
              phase: 2,
              status: 'completed',
              confirmation_state: 'output-available',
              confirmation_approved: true,
            },
          });
        } catch {
          // 阶段二结果消息已保存，提示消息更新失败不阻断主流程。
        }
      }

      // 鍙戦€?done 浜嬩欢
      safeSend(event.sender, channel, {
        type: 'done',
        content: questionSet.questions.summary,
        status: 'completed',
        message: resultMessage,
      });

      return { type: 'done', question_set: questionSet, message: resultMessage };
    } catch (error) {
      console.error('[geo-phase-two] 娴佸紡璋冪敤澶辫触:', error.message);
      safeSend(event.sender, channel, { type: 'error', error: error.message });
      return { type: 'error', error: error.message };
    }
  } finally {
    activeStreams.delete(requestId);
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

  // 闃舵浜岋細鑾峰彇鎶ュ憡
  ipcMain.handle('geo-agent:get-geo-report', async (_event, reportId) => {
    return questionPoolService.getQuestionSet(reportId);
  });

  // 闃舵浜岋細鑾峰彇鏈€鏂伴棶棰橀泦
  ipcMain.handle('geo-agent:get-latest-geo-question-set', async (_event, geoProjectId, platform) => {
    const projectId = projectIdFromGeoProjectId(geoProjectId);
    return questionPoolService.getLatestQuestionSet(projectId, platform);
  });

  // 阶段二：获取问题集
  ipcMain.handle('geo-agent:get-geo-question-set', async (_event, questionSetId) => {
    return questionPoolService.getQuestionSet(questionSetId);
  });

  ipcMain.handle('geo-agent:run-geo-article-draft', async (_event, geoProjectId, platform = 'doubao', articleType = 'consulting', options = {}) => {
    return articleDraftService.generateArticleDraft({
      geoProjectId,
      platform,
      articleType,
      onEvent: typeof options?.onEvent === 'function' ? options.onEvent : null,
    });
  });

  ipcMain.handle('geo-agent:run-geo-support-articles', async (_event, geoProjectId, platform = 'doubao') => {
    return articleDraftService.generateSupportArticles({ geoProjectId, platform });
  });

  ipcMain.handle('geo-agent:run-geo-support-articles-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || request;
    const options = payload.options || {};
    const channel = `geo-agent:run-geo-support-articles-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    const projectId = projectIdFromGeoProjectId(payload.geoProjectId || payload.geo_project_id);
    let conversation = null;
    let stageMessage = null;
    try {
      try {
        if (projectId) {
        let effectiveConversationId = options.conversationId || options.conversation_id || null;
        if (!effectiveConversationId) {
          const latest = conversationService.findLatestConversation(projectId, 'geo_workflow');
          if (latest) {
            effectiveConversationId = latest.id;
          }
        }
        conversation = conversationService.ensureConversation({
          projectId,
          conversationId: effectiveConversationId,
          title: `${payload.platform || 'GEO'} 阶段四内容资产`,
          firstMessage: '生成阶段四内容资产',
          kind: 'geo_workflow',
        });
        const runningMessage = conversationService.findRunningPhaseMessage({
          conversationId: conversation.id,
          projectId,
          phase: 4,
          platform: payload.platform || 'doubao',
        });
        if (runningMessage) {
          safeSend(event.sender, channel, {
            type: 'meta',
            platform: payload.platform,
            phase: 4,
            conversation_id: conversation.id,
            message: runningMessage,
          });
          safeSend(event.sender, channel, {
            type: 'done',
            status: 'already_running',
            already_running: true,
            conversation_id: conversation.id,
            message: runningMessage,
          });
          return {
            type: 'done',
            status: 'already_running',
            already_running: true,
            conversation_id: conversation.id,
            message: runningMessage,
          };
        }
        if (!options.messageId) {
          stageMessage = conversationService.addMessage({
            conversationId: conversation.id,
            projectId,
            role: 'assistant',
            content: `正在生成 ${payload.platform || 'GEO'} 阶段四内容资产。`,
            metadata: {
              type: 'geo_phase_prompt',
              status: 'streaming',
              phase: 4,
              platform: payload.platform || 'doubao',
              parent_message_id: options.parentMessageId || null,
            },
          });
          safeSend(event.sender, channel, {
            type: 'meta',
            platform: payload.platform,
            phase: 4,
            conversation_id: conversation.id,
            message: stageMessage,
          });
        }
      }
      const result = await articleDraftService.generateSupportArticlesStream(
        {
          geoProjectId: payload.geoProjectId,
          platform: payload.platform || 'doubao',
        },
        (streamEvent) => {
          safeSend(event.sender, channel, streamEvent);
        },
      );
      if (conversation && projectId) {
        const messageContent = result.status === 'completed'
          ? `已完成${payload.platform === 'deepseek' ? 'DeepSeek' : '豆包'}阶段四内容资产。`
          : `阶段四内容资产部分生成失败：${result.error_message || '请查看失败项并重试。'}`;
        const metadata = {
          type: 'geo_phase_result',
          status: result.status || 'completed',
          phase: 4,
          platform: result.platform || payload.platform || 'doubao',
          support_articles: result,
          artifact_id: result.run_id || null,
          parent_message_id: options.parentMessageId || null,
          confirmation_state: 'output-available',
          confirmation_approved: true,
        };
        stageMessage = stageMessage
          ? conversationService.updateConversationMessage({
            messageId: stageMessage.id,
            conversationId: conversation.id,
            projectId,
            content: messageContent,
            metadata,
          })
          : conversationService.addMessage({
            conversationId: conversation.id,
            projectId,
            role: 'assistant',
            content: messageContent,
            metadata,
          });
      }
      safeSend(event.sender, channel, {
        type: 'done',
        status: 'completed',
        conversation_id: conversation?.id,
        message: stageMessage,
        support_articles: result,
      });
      return { type: 'done', conversation_id: conversation?.id, message: stageMessage, support_articles: result };
    } catch (error) {
      console.error('[geo-article-draft] 流式生成失败:', error.message);
      if (conversation && projectId) {
        try {
          conversationService.addMessage({
            conversationId: conversation.id,
            projectId,
            role: 'assistant',
            content: error.message || String(error),
            metadata: {
              type: 'geo_phase_result',
              status: 'error',
              phase: 4,
              platform: payload.platform || 'doubao',
              error: error.message || String(error),
            },
          });
        } catch (archiveError) {
          console.warn('[conversation] failed to archive support articles error', archiveError);
        }
      }
      safeSend(event.sender, channel, { type: 'error', error: error.message, conversation_id: conversation?.id });
      return { type: 'error', error: error.message, conversation_id: conversation?.id };
    }
  } finally {
    activeStreams.delete(requestId);
  }
});

  ipcMain.handle('geo-agent:run-geo-additional-articles-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || request;
    const options = payload.options || {};
    const channel = `geo-agent:run-geo-additional-articles-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    const projectId = projectIdFromGeoProjectId(payload.geoProjectId || payload.geo_project_id);
    let conversation = null;
    let stageMessage = null;
    try {
      try {
        if (projectId) {
        conversation = conversationService.ensureConversation({
          projectId,
          conversationId: options.conversationId || options.conversation_id || null,
          title: `${payload.platform || 'GEO'} 追加稿件生成`,
          firstMessage: options.instruction || '继续生成完整稿件',
          kind: 'geo_workflow',
        });
        stageMessage = conversationService.addMessage({
          conversationId: conversation.id,
          projectId,
          role: 'assistant',
          content: `正在继续生成 ${Math.min(6, Math.max(1, Number(options.count || 1)))} 篇完整稿件。`,
          metadata: {
            type: 'geo_additional_articles',
            status: 'streaming',
            phase: 4,
            platform: payload.platform || 'doubao',
          },
        });
        safeSend(event.sender, channel, {
          type: 'meta',
          platform: payload.platform,
          phase: 4,
          conversation_id: conversation.id,
          message: stageMessage,
        });
      }
      const result = await articleDraftService.generateAdditionalArticlesStream(
        {
          geoProjectId: payload.geoProjectId || payload.geo_project_id,
          platform: payload.platform || 'doubao',
          count: options.count,
          articleRole: options.articleRole || options.article_role || 'auto',
          instruction: options.instruction || '',
        },
        (streamEvent) => safeSend(event.sender, channel, streamEvent),
      );
      if (conversation && stageMessage && projectId) {
        stageMessage = conversationService.updateConversationMessage({
          messageId: stageMessage.id,
          conversationId: conversation.id,
          projectId,
          content: `已继续生成 ${result.total || 0} 篇完整稿件，均已保存到稿件管理。`,
          metadata: {
            type: 'geo_additional_articles',
            status: result.status || 'completed',
            phase: 4,
            platform: result.platform || payload.platform || 'doubao',
            additional_articles: result,
            confirmation_state: 'output-available',
            confirmation_approved: true,
          },
        });
      }
      safeSend(event.sender, channel, {
        type: 'done',
        status: 'completed',
        conversation_id: conversation?.id,
        message: stageMessage,
        additional_articles: result,
      });
      return { type: 'done', status: 'completed', conversation_id: conversation?.id, message: stageMessage, additional_articles: result };
    } catch (error) {
      const message = error.message || String(error);
      if (conversation && projectId) {
        try {
          conversationService.addMessage({
            conversationId: conversation.id,
            projectId,
            role: 'assistant',
            content: `继续生成稿件失败：${message}`,
            metadata: { type: 'geo_additional_articles', status: 'failed', phase: 4, error: message },
          });
        } catch (archiveError) {
          console.warn('[conversation] failed to archive additional articles error', archiveError);
        }
      }
      safeSend(event.sender, channel, { type: 'error', error: message, conversation_id: conversation?.id });
      return { type: 'error', error: message, conversation_id: conversation?.id };
    }
  } finally {
    activeStreams.delete(requestId);
  }
});

  ipcMain.handle('geo-agent:get-latest-geo-article-draft', async (_event, geoProjectId, platform = 'doubao', articleType = null) => {
    return articleDraftService.getLatestArticleDraft(geoProjectId, platform, articleType);
  });

  ipcMain.handle('geo-agent:get-geo-article-draft', async (_event, articleId) => {
    return articleDraftService.getArticleDraft(articleId);
  });

  ipcMain.handle('geo-agent:confirm-geo-article-draft', async (_event, articleId) => {
    return articleDraftService.confirmArticleDraft(articleId);
  });

  ipcMain.handle('geo-agent:update-geo-article-draft', async (_event, articleId, draft) => {
    return articleDraftService.updateArticleDraft(articleId, draft);
  });

  ipcMain.handle('geo-agent:list-article-drafts', async (_event, projectId, filters = {}) => {
    return articlePublishService.listArticleDrafts(projectId, filters);
  });

  ipcMain.handle('geo-agent:update-article-draft', async (_event, articleId, patch = {}) => {
    return articlePublishService.updateArticleDraft(articleId, patch);
  });

  ipcMain.handle('geo-agent:revise-article-draft', async (_event, articleId, options = {}) => {
    return articleDraftService.reviseArticleDraft(articleId, options);
  });

  ipcMain.handle('geo-agent:propose-knowledge-update', async (_event, payload = {}) => {
    const projectId = payload.projectId || payload.project_id;
    const instruction = String(payload.instruction || '').trim();
    if (!projectId) throw new Error('projectId is required.');
    if (!instruction) throw new Error('instruction is required.');
    const current = knowledgeService.getKnowledgeProfile(projectId).profile || {};
    return {
      id: `knowledge-update-${Date.now()}`,
      project_id: projectId,
      instruction,
      current_profile: current,
      patch: {},
      summary: '已生成待确认知识库更新请求。请在确认前补充具体字段和值；确认后才会写入知识库。',
      requires_confirmation: true,
    };
  });

  ipcMain.handle('geo-agent:apply-knowledge-update', async (_event, payload = {}) => {
    const projectId = payload.projectId || payload.project_id;
    const patch = payload.patch || payload.profile || {};
    if (!projectId) throw new Error('projectId is required.');
    return knowledgeService.updateKnowledgeProfile(projectId, patch);
  });

  ipcMain.handle('geo-agent:mark-article-reviewed', async (_event, articleId) => {
    return articlePublishService.markArticleReviewed(articleId);
  });

  ipcMain.handle('geo-agent:prepare-article-preview', async (_event, articleId) => {
    return articlePublishService.prepareArticlePreview(articleId);
  });

  ipcMain.handle('geo-agent:get-article-preview-html', async (_event, articleId) => {
    return articlePublishService.getArticlePreviewHtml(articleId);
  });

  ipcMain.handle('geo-agent:delete-article-oss-preview', async (_event, articleId) => {
    return articlePublishService.deleteArticleOssPreview(articleId);
  });

  ipcMain.handle('geo-agent:sync-chaojimeijie-resources', async (_event, resourceType = 'media', page = 1, size = 200) => {
    return articlePublishService.syncChaojimeijieResources(resourceType, page, size);
  });

  ipcMain.handle('geo-agent:sync-all-resources', async (_event) => {
    const chaojimeijieService = require('./services/chaojimeijieService');
    return chaojimeijieService.syncAllResources();
  });

  ipcMain.handle('geo-agent:list-publish-resources', async (_event, filters = {}) => {
    return articlePublishService.listPublishResources(filters);
  });

  ipcMain.handle('geo-agent:recommend-publish-resources', async (_event, articleId, options = {}) => {
    return articlePublishService.recommendPublishResources(articleId, options);
  });

  ipcMain.handle('geo-agent:publish-article', async (_event, articleId, adapterId = 'external_api_pending', options = {}) => {
    return articlePublishService.publishArticle(articleId, adapterId, options);
  });

  ipcMain.handle('geo-agent:ranked-publish-quota', async (_event, projectId, platform) => {
    return articlePublishService.getRankedPublishQuota(projectId, platform);
  });

  ipcMain.handle('geo-agent:auto-publish-articles', async (_event, projectId, options = {}) => {
    const autoPublishService = require('./services/autoPublishService.cjs');
    return autoPublishService.autoPublishArticles(projectId, options);
  });

  ipcMain.handle('geo-agent:sync-publish-order', async (_event, articleId) => {
    return articlePublishService.syncPublishOrder(articleId);
  });

  ipcMain.handle('geo-agent:sync-publish-orders', async (_event, projectId) => {
    return articlePublishService.syncPublishOrders(projectId);
  });

  ipcMain.handle('geo-agent:manage-publish-order', async (_event, articleId, action, payload = {}) => {
    return articlePublishService.managePublishOrder(articleId, action, payload);
  });

  ipcMain.handle('geo-agent:record-published-url', async (_event, articleId, payload = {}) => {
    return articlePublishService.recordPublishedUrl(articleId, payload);
  });

  ipcMain.handle('geo-agent:run-visibility-check-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || request;
    const channel = `geo-agent:run-visibility-check-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    try {
      try {
        const check = await visibilityCheckService.runVisibilityCheckStream(payload, (streamEvent) => {
          safeSend(event.sender, channel, streamEvent);
        });
      safeSend(event.sender, channel, { type: 'done', status: check.status, visibility_check: check });
      return { type: 'done', visibility_check: check };
    } catch (error) {
      const message = error.message || String(error);
      console.error('[visibility-check] 运行失败:', message);
      safeSend(event.sender, channel, { type: 'error', error: message });
      return { type: 'error', error: message };
    }
  } finally {
    activeStreams.delete(requestId);
  }
});

  ipcMain.handle('geo-agent:get-latest-visibility-check', async (_event, geoProjectId, platform = 'doubao') => {
    return visibilityCheckService.getLatestVisibilityCheck(geoProjectId, platform);
  });

  ipcMain.handle('geo-agent:generate-reflection', async (_event, geoProjectId, platform = 'doubao', visibilityCheckId = null) => {
    return reflectionService.generateReflection(geoProjectId, platform, visibilityCheckId);
  });

  ipcMain.handle('geo-agent:confirm-evolution-rule', async (_event, ruleId) => {
    return reflectionService.confirmEvolutionRule(ruleId);
  });

  ipcMain.handle('geo-agent:reject-evolution-rule', async (_event, ruleId) => {
    return reflectionService.rejectEvolutionRule(ruleId);
  });

  ipcMain.handle('geo-agent:list-evolution-rules', async (_event, projectId, filters = {}) => {
    return reflectionService.listEvolutionRules(projectId, filters);
  });

  ipcMain.handle('geo-agent:get-rules-for-stage', async (_event, projectId, stage, platform) => {
    return ruleService.getRulesForStage(projectId, stage, platform);
  });

  ipcMain.handle('geo-agent:get-global-rules', async (_event, platform) => {
    return ruleService.getGlobalRules(platform);
  });

  ipcMain.handle('geo-agent:get-auto-learning-status', async () => {
    return autoLearningScheduler.getStatus();
  });

  ipcMain.handle('geo-agent:trigger-auto-learning-now', async (event, request = {}) => {
    const requestId = request.requestId || `auto-learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = `geo-agent:trigger-auto-learning-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });

    autoLearningScheduler.runCycle()
      .then((result) => {
        safeSend(event.sender, channel, { type: 'result', result });
        safeSend(event.sender, channel, { type: 'done' });
      })
      .catch((error) => {
        safeSend(event.sender, channel, { type: 'error', message: error.message });
        safeSend(event.sender, channel, { type: 'done' });
      })
      .finally(() => {
        activeStreams.delete(requestId);
      });

    return { requestId, channel };
  });

  ipcMain.handle('geo-agent:set-auto-learning-interval', async (_event, payload) => {
    const { intervalMs } = payload || {};
    return autoLearningScheduler.setIntervalMs(intervalMs);
  });

  // --- Web Builder: AI 网页生成与托管 ---
  ipcMain.handle('geo-agent:list-websites', async (_event, projectId) =>
    webBuilderService.listWebsites(projectId));

  ipcMain.handle('geo-agent:get-website', async (_event, websiteId) =>
    webBuilderService.getWebsite(websiteId));

  ipcMain.handle('geo-agent:get-website-pages', async (_event, websiteId) =>
    webBuilderService.getWebsitePages(websiteId));

  ipcMain.handle('geo-agent:get-website-page', async (_event, pageId) =>
    webBuilderService.getWebsitePage(pageId));

  ipcMain.handle('geo-agent:get-website-preview-html', async (_event, { websiteId, pageSlug }) =>
    webBuilderService.getWebsitePreviewHtml(websiteId, pageSlug));

  ipcMain.handle('geo-agent:get-website-preview-base-url', async (_event, websiteId) =>
    webBuilderService.getWebsitePreviewBaseUrl(websiteId));

  ipcMain.handle('geo-agent:delete-website', async (_event, websiteId) =>
    webBuilderService.deleteWebsite(websiteId));

  ipcMain.handle('geo-agent:export-website', async (_event, websiteId) =>
    webBuilderService.exportWebsiteZip(websiteId));

  ipcMain.handle('geo-agent:generate-website-stream', async (event, request = {}) => {
    const requestId = request.requestId;
    const payload = request.payload || {};
    const channel = `geo-agent:generate-website-stream:${requestId}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, { abortController, channel, sender: event.sender });
    const { projectId, ...options } = payload;

    console.log('[WebBuilder] generate-website-stream called', { requestId, projectId, options });

    try {
      await webBuilderService.generateWebsite(projectId, options, (streamEvent) => {
        safeSend(event.sender, channel, streamEvent);
      });
      // 只有成功时才发 done；generateWebsite 内部已发 done，这里不再重复
    } catch (err) {
      console.error('[WebBuilder] generate error:', err);
      safeSend(event.sender, channel, { type: 'error', error: err.message || String(err) });
      // 不发 done，让 invokeStream 保持 reject 状态
    } finally {
      activeStreams.delete(requestId);
    }
    return { type: 'done' };
  });
}

function shouldUseDatabaseFallback(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('readonly database')
    || message.includes('read-only')
    || message.includes('eacces')
    || message.includes('eperm');
}

function copyDatabaseIfPossible(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  [DB_FILENAME, `${DB_FILENAME}-wal`, `${DB_FILENAME}-shm`].forEach((filename) => {
    const source = path.join(sourceDir, filename);
    const target = path.join(targetDir, filename);
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.copyFileSync(source, target);
    }
  });
}

function initializeDatabaseForCurrentUser() {
  const primaryDir = app.getPath('userData');
  try {
    initializeDatabase(primaryDir);
    return;
  } catch (error) {
    if (!shouldUseDatabaseFallback(error)) {
      throw error;
    }
    const fallbackDir = path.join(app.getPath('temp'), 'GEO-Agent Studio', 'runtime-db');
    try {
      copyDatabaseIfPossible(primaryDir, fallbackDir);
    } catch (copyError) {
      databaseStartupWarning = `原数据库无法写入，且复制到备用目录失败：${copyError instanceof Error ? copyError.message : String(copyError)}`;
    }
    initializeDatabase(fallbackDir);
    databaseStartupWarning = databaseStartupWarning
      || `原数据库只读，已切换到可写备用库：${getDatabasePath(fallbackDir)}`;
  }
}

ensureWritableUserDataPath();
loadEnvFile();
registerHandlers();

// 全局异常处理
process.on('uncaughtException', (error) => {
  console.error('[主进程] 未捕获的异常:', error);
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('main-process-error', { type: 'uncaughtException', message: error.message || String(error) });
      }
    });
  } catch (_) { /* 忽略通知失败 */ }
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason);
  console.error('[主进程] 未处理的 Promise rejection:', message);
  try {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('main-process-error', { type: 'unhandledRejection', message });
      }
    });
  } catch (_) { /* 忽略通知失败 */ }
  setTimeout(() => process.exit(1), 500);
});

app.whenReady().then(async () => {
  initializeDatabaseForCurrentUser();
  autoLearningScheduler.init(getDb());
  knowledgeService.markInterruptedDrafts({ olderThanMs: 0 });
  await createWindow();
  autoLearningScheduler.start();
});

app.on('before-quit', () => {
  autoLearningScheduler.stop();
  clearAllActiveStreams();
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
