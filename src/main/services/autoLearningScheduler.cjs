'use strict';

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 小时
const STATE_KEY_LAST_RUN = 'last_run_at';
const STATE_KEY_INTERVAL = 'interval_ms';

let timerId = null;
let isRunning = false;
let databaseRef = null;

/**
 * 初始化调度器，传入数据库实例
 * @param {import('better-sqlite3').Database} database
 */
function init(database) {
  databaseRef = database;
}

/**
 * 获取调度状态
 */
function getStatus() {
  if (!databaseRef) return null;
  const row = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?').get(STATE_KEY_LAST_RUN);
  const intervalRow = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?').get(STATE_KEY_INTERVAL);
  const lastRunAt = row?.value || null;
  const intervalMs = intervalRow ? Number(intervalRow.value) : DEFAULT_INTERVAL_MS;
  const nextRunAt = lastRunAt
    ? new Date(new Date(lastRunAt).getTime() + intervalMs).toISOString()
    : new Date().toISOString();
  return {
    isRunning,
    lastRunAt,
    nextRunAt,
    intervalMs,
  };
}

/**
 * 更新调度状态
 */
function setState(key, value) {
  if (!databaseRef) return;
  databaseRef.prepare(`
    INSERT INTO scheduler_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value));
}

/**
 * 执行一次完整的自动学习周期
 */
async function runCycle() {
  if (isRunning || !databaseRef) return null;
  isRunning = true;
  try {
    // 查询所有有已发布文章的项目
    const projects = databaseRef.prepare(`
      SELECT DISTINCT p.id, p.name
      FROM projects p
      INNER JOIN article_drafts ad ON ad.project_id = p.id
      WHERE ad.publication_evidence IS NOT NULL
        AND json_extract(ad.publication_evidence, '$.status') = 'published'
        AND json_extract(ad.publication_evidence, '$.published_url') IS NOT NULL
    `).all();

    let projectsChecked = 0;
    let visibilityDetected = 0;
    let rulesGenerated = 0;

    // 延迟加载服务（避免循环依赖）
    const visibilityCheckService = require('./visibilityCheckService');
    const reflectionService = require('./reflectionService');

    for (const project of projects) {
      try {
        projectsChecked++;
        const projectId = project.id;

        // 获取企业档案
        const enterprise = databaseRef.prepare('SELECT * FROM enterprises WHERE id = ?').get(projectId);
        if (!enterprise) continue;

        // 获取已确认的问题
        const questions = databaseRef.prepare(
          "SELECT * FROM question_pool WHERE project_id = ? AND status = 'confirmed'"
        ).all(projectId);
        if (questions.length === 0) continue;

        // 获取已发布的文章 URL
        const drafts = databaseRef.prepare(
          "SELECT * FROM article_drafts WHERE project_id = ? AND publication_evidence IS NOT NULL"
        ).all(projectId);
        const publishedUrls = drafts
          .map((d) => {
            try { return JSON.parse(d.publication_evidence)?.published_url; }
            catch { return null; }
          })
          .filter(Boolean);
        if (publishedUrls.length === 0) continue;

        // 执行 Phase 6 可见性检测
        const profile = typeof enterprise.profile === 'string'
          ? JSON.parse(enterprise.profile)
          : enterprise.profile;
        const checkResult = await visibilityCheckService.runVisibilityCheck({
          projectId,
          platform: 'doubao',
          profile,
          questions: questions.map((q) => ({ id: q.id, text: q.question_text })),
          publishedUrls,
        });

        if (!checkResult) continue;

        // 分析是否被收录
        const questionResults = checkResult.result?.question_results ?? [];
        const matchedUrls = questionResults.flatMap((r) => r.matched_published_urls || []);
        if (matchedUrls.length > 0) {
          visibilityDetected++;

          // 获取上一次检测结果用于对比
          const previousCheck = databaseRef.prepare(
            "SELECT * FROM ai_visibility_checks WHERE project_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1"
          ).get(projectId, checkResult.id);

          // 执行 Phase 7 反思学习
          const reflectionResult = await reflectionService.generateReflection({
            projectId,
            platform: 'doubao',
            visibilityCheckId: checkResult.id,
            profile,
            publishedArticles: drafts.map((d) => ({
              id: d.id,
              title: d.title,
              url: (() => { try { return JSON.parse(d.publication_evidence)?.published_url; } catch { return null; } })(),
            })).filter((a) => a.url),
          });

          if (reflectionResult?.rules?.length > 0) {
            rulesGenerated += reflectionResult.rules.length;
          }
        }
      } catch (projectError) {
        console.error(`[AutoLearningScheduler] 项目 ${project.id} 执行失败:`, projectError.message);
      }
    }

    // 更新最后执行时间
    setState(STATE_KEY_LAST_RUN, new Date().toISOString());

    const result = { projectsChecked, visibilityDetected, rulesGenerated };
    console.log('[AutoLearningScheduler] 周期执行完成:', result);
    return result;
  } finally {
    isRunning = false;
  }
}

/**
 * 检查是否需要立即执行并启动定时器
 */
function start() {
  if (!databaseRef) {
    console.error('[AutoLearningScheduler] 未初始化数据库，无法启动');
    return;
  }

  const lastRunAt = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?')
    .get(STATE_KEY_LAST_RUN)?.value;
  const intervalRow = databaseRef.prepare('SELECT value FROM scheduler_state WHERE key = ?')
    .get(STATE_KEY_INTERVAL);
  const intervalMs = intervalRow ? Number(intervalRow.value) : DEFAULT_INTERVAL_MS;

  // 启动时补偿检查
  if (!lastRunAt || Date.now() - new Date(lastRunAt).getTime() >= intervalMs) {
    console.log('[AutoLearningScheduler] 启动补偿执行');
    runCycle().catch((err) => console.error('[AutoLearningScheduler] 补偿执行失败:', err));
  }

  // 启动定时器
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    console.log('[AutoLearningScheduler] 定时执行');
    runCycle().catch((err) => console.error('[AutoLearningScheduler] 定时执行失败:', err));
  }, intervalMs);

  console.log(`[AutoLearningScheduler] 已启动，间隔 ${intervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止定时器
 */
function stop() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  console.log('[AutoLearningScheduler] 已停止');
}

/**
 * 修改执行间隔
 */
function setIntervalMs(ms) {
  if (typeof ms !== 'number' || ms < 60000) return false;
  setState(STATE_KEY_INTERVAL, String(ms));
  // 重启定时器以应用新间隔
  stop();
  start();
  return true;
}

module.exports = {
  init,
  start,
  stop,
  runCycle,
  getStatus,
  setIntervalMs,
};
