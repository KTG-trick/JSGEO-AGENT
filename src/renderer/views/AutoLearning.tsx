import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, BarChart2, CheckCircle2, XCircle, Loader2, RefreshCw, FileText, Radar } from 'lucide-react';
import { cn } from '../lib/utils';
import { useEnterprise } from '../context/EnterpriseContext';

type RuleStatusTab = 'pending' | 'confirmed' | 'rejected';

const VISIBILITY_CHECK_INTERVAL_MS = 10 * 60 * 1000;

const RULE_TYPE_LABELS: Record<string, string> = {
  title: '标题优化',
  structure: '结构调整',
  evidence: '证据强化',
  keyword: '关键词策略',
  source: '信源优化',
  avoid: '避坑策略',
  content_gap: '内容缺口',
  content: '内容优化',
};

const RULE_TYPE_COLORS: Record<string, string> = {
  title: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200',
  structure: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-200',
  evidence: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  keyword: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  source: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200',
  avoid: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200',
  content_gap: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200',
  content: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200',
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function ruleTypeLabel(type: string) {
  return RULE_TYPE_LABELS[type] || type || '未分类';
}

function ruleTypeColor(type: string) {
  return RULE_TYPE_COLORS[type] || 'bg-surface-container text-on-surface-variant';
}

function publicationEvidence(draft: GeoAgentGeoArticleDraft) {
  const value = draft.draft.publication_evidence;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function checkTime(check: GeoAgentVisibilityCheck | null) {
  const value = Date.parse(check?.created_at || check?.updated_at || '');
  return Number.isFinite(value) ? value : 0;
}

function visibilityLearningDecision(current: GeoAgentVisibilityCheck | null, previous: GeoAgentVisibilityCheck | null) {
  const currentResults = current?.result.question_results ?? [];
  if (currentResults.some((item) => (item.matched_published_urls?.length ?? 0) > 0)) {
    return { ok: true, reason: '阶段六已命中已发布文章 URL。' };
  }
  const previousRanks = new Map(
    (previous?.result.question_results ?? [])
      .filter((item) => typeof item.ranking_position === 'number')
      .map((item) => [item.question_id, item.ranking_position as number])
  );
  const rankingUp = currentResults.some((item) => {
    const previousRank = previousRanks.get(item.question_id);
    return typeof item.ranking_position === 'number' && typeof previousRank === 'number' && item.ranking_position < previousRank;
  });
  return rankingUp
    ? { ok: true, reason: '阶段六检测到目标企业排名较上次上升。' }
    : { ok: false, reason: '暂未命中文章 URL，也未检测到排名上升，本轮不生成学习规则。' };
}

export function AutoLearning() {
  const { currentEnterprise, currentEnterpriseId, hasEnterprises, isLoadingEnterprises } = useEnterprise();
  const [rules, setRules] = useState<GeoAgentReflectionResult['rules'][number][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RuleStatusTab>('pending');
  const [isReflecting, setIsReflecting] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [visibilityCheck, setVisibilityCheck] = useState<GeoAgentVisibilityCheck | null>(null);
  const [visibilityProgress, setVisibilityProgress] = useState<string | null>(null);
  const [reflectionProgress, setReflectionProgress] = useState<string | null>(null);
  const [isCheckingVisibility, setIsCheckingVisibility] = useState(false);
  const [publishedCount, setPublishedCount] = useState(0);
  const autoReflectionRef = useRef<string | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<GeoAgentAutoLearningStatus | null>(null);
  const [isTriggeringManual, setIsTriggeringManual] = useState(false);
  const [manualProgress, setManualProgress] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    if (!currentEnterpriseId || !window.geoAgent?.listEvolutionRules) {
      setRules([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.geoAgent.listEvolutionRules(currentEnterpriseId);
      setRules(result ?? []);
      if (window.geoAgent.listArticleDrafts) {
        const drafts = await window.geoAgent.listArticleDrafts(currentEnterpriseId);
        setPublishedCount((drafts.drafts ?? []).filter((draft) => {
          const evidence = publicationEvidence(draft);
          return evidence.status === 'published' && Boolean(evidence.published_url);
        }).length);
      }
      if (window.geoAgent.getLatestVisibilityCheck) {
        const latest = await window.geoAgent.getLatestVisibilityCheck(`geo-${currentEnterpriseId}`, 'doubao');
        setVisibilityCheck(latest);
      }
      if (window.geoAgent?.getAutoLearningStatus) {
        try {
          const status = await window.geoAgent.getAutoLearningStatus();
          setSchedulerStatus(status);
        } catch {
          // 静默失败，不影响主流程
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [currentEnterpriseId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const pendingRules = useMemo(() => rules.filter((r) => r.status === 'pending'), [rules]);
  const confirmedRules = useMemo(() => rules.filter((r) => r.status === 'confirmed'), [rules]);
  const rejectedRules = useMemo(() => rules.filter((r) => r.status === 'rejected'), [rules]);
  const learnedCheckIds = useMemo(() => new Set(rules
    .map((rule) => text(rule.metadata?.visibility_check_id))
    .filter(Boolean)), [rules]);

  const displayRules = activeTab === 'pending' ? pendingRules : activeTab === 'confirmed' ? confirmedRules : rejectedRules;

  const confirmRule = async (ruleId: string) => {
    if (!window.geoAgent?.confirmEvolutionRule) return;
    setError(null);
    try {
      await window.geoAgent.confirmEvolutionRule(ruleId);
      await loadRules();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const rejectRule = async (ruleId: string) => {
    if (!window.geoAgent?.rejectEvolutionRule) return;
    setError(null);
    try {
      await window.geoAgent.rejectEvolutionRule(ruleId);
      await loadRules();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const runReflection = useCallback(async (checkId = visibilityCheck?.id ?? null, reason = '已满足自动学习条件。') => {
    if (!currentEnterpriseId || !window.geoAgent?.generateReflection || !checkId) return;
    setIsReflecting(true);
    setReflectionProgress(`正在自动生成阶段七学习规则：${reason}`);
    setError(null);
    try {
      const result = await window.geoAgent.generateReflection(`geo-${currentEnterpriseId}`, 'doubao', checkId);
      setLastSummary(result.summary || null);
      setReflectionProgress('阶段七已生成待确认学习规则。');
      await loadRules();
    } catch (reflectError) {
      setReflectionProgress('阶段七自动学习失败，请稍后重试。');
      setError(reflectError instanceof Error ? reflectError.message : String(reflectError));
    } finally {
      setIsReflecting(false);
    }
  }, [currentEnterpriseId, loadRules, visibilityCheck?.id]);

  const maybeRunReflection = useCallback(async (current: GeoAgentVisibilityCheck, previous: GeoAgentVisibilityCheck | null) => {
    if (autoReflectionRef.current === current.id) return;
    if (learnedCheckIds.has(current.id)) {
      setReflectionProgress('本轮阶段六结果已生成过学习规则。');
      return;
    }
    const decision = visibilityLearningDecision(current, previous);
    setReflectionProgress(decision.reason);
    if (!decision.ok) return;
    autoReflectionRef.current = current.id;
    await runReflection(current.id, decision.reason);
  }, [learnedCheckIds, runReflection]);

  const runVisibilityCheck = useCallback(async (trigger: 'auto' | 'manual' = 'manual') => {
    if (!currentEnterpriseId || !window.geoAgent?.runVisibilityCheckStream) return;
    const previous = visibilityCheck;
    setIsCheckingVisibility(true);
    setVisibilityProgress(trigger === 'auto' ? '阶段六已自动启动推荐可见性检测。' : '正在立即复查阶段六推荐可见性。');
    setError(null);
    try {
      const response = await window.geoAgent.runVisibilityCheckStream(`geo-${currentEnterpriseId}`, 'doubao', (event) => {
        if (event.type === 'status' && event.message) setVisibilityProgress(event.message);
        if (event.type === 'result' && event.visibility_check) setVisibilityCheck(event.visibility_check);
      });
      if (response.visibility_check) {
        setVisibilityCheck(response.visibility_check);
        await maybeRunReflection(response.visibility_check, previous);
      }
      setVisibilityProgress('阶段六检测完成。');
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setIsCheckingVisibility(false);
    }
  }, [currentEnterpriseId, maybeRunReflection, visibilityCheck]);

  const triggerManualCycle = async () => {
    if (!window.geoAgent?.triggerAutoLearningNow || isTriggeringManual) return;
    setIsTriggeringManual(true);
    setManualProgress('正在执行自动学习周期...');
    setError(null);
    try {
      await window.geoAgent.triggerAutoLearningNow();
      setManualProgress('自动学习周期已启动，请等待完成。');
      // 刷新数据
      await loadRules();
      setManualProgress('自动学习周期已完成');
    } catch (err) {
      setManualProgress('执行失败');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTriggeringManual(false);
    }
  };

  if (isLoadingEnterprises) {
    return (
      <PageShell>
        <EmptyState title="正在读取企业知识库" description="自动学习页面会基于当前企业展示进化规则。" />
      </PageShell>
    );
  }

  if (!hasEnterprises || !currentEnterpriseId) {
    return (
      <PageShell>
        <EmptyState title="请先录入企业知识库" description="完成推荐检测和反思后，这里会展示进化规则。" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* 左栏: 规则管理 */}
        <div className="xl:col-span-7 flex flex-col gap-5">
          <div>
            <h2 className="text-[28px] font-bold text-primary font-heading tracking-tight">阶段六/阶段七自动学习中心</h2>
            <p className="text-[13px] text-on-surface-variant mt-1">
              当前企业：{text(currentEnterprise?.profile?.company_name) || '未命名'}。阶段六自动检测推荐可见性，阶段七只在命中文章或排名上升时生成待确认规则。
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</div>
          )}

          {/* Tab 切换 */}
          <div className="flex items-center gap-1 rounded-md border border-outline-variant/40 bg-surface-container p-1 w-fit">
            {([['pending', '待确认'], ['confirmed', '已确认'], ['rejected', '已拒绝']] as Array<[RuleStatusTab, string]>).map(([value, label]) => (
              <button
                key={value}
                className={cn(
                  'rounded px-3 py-1.5 text-[11px] font-bold transition-colors',
                  activeTab === value ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'
                )}
                onClick={() => setActiveTab(value)}
                type="button"
              >
                {label}
                <span className="ml-1.5 text-[10px] opacity-70">
                  {value === 'pending' ? pendingRules.length : value === 'confirmed' ? confirmedRules.length : rejectedRules.length}
                </span>
              </button>
            ))}
          </div>

          {/* 规则列表 */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-on-surface-variant">
              <Loader2 className="size-5 animate-spin mr-2" />
              <span className="text-[13px]">加载中...</span>
            </div>
          ) : displayRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-outline-variant/70 bg-surface/70 p-8 text-center">
              <FileText className="mx-auto size-8 text-on-surface-variant" />
              <h3 className="mt-3 text-[14px] font-bold text-primary">
                {activeTab === 'pending' ? '暂无待确认规则' : activeTab === 'confirmed' ? '暂无已确认规则' : '暂无已拒绝规则'}
              </h3>
              <p className="mt-1 text-[12px] text-on-surface-variant">
                {activeTab === 'pending' ? '阶段六命中文章或排名上升后，阶段七会自动生成待确认规则。' : ''}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayRules.map((rule) => {
                const metadata = rule.metadata || {};
                const ruleContent = text(metadata.content || rule.content);
                const ruleReason = text(metadata.reason);
                return (
                  <div key={rule.id} className="rounded-lg border border-outline-variant/40 bg-surface p-4 transition-colors hover:border-outline-variant/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold', ruleTypeColor(rule.rule_type))}>
                          {ruleTypeLabel(rule.rule_type)}
                        </span>
                        {rule.platform && (
                          <span className="inline-flex rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
                            {rule.platform}
                          </span>
                        )}
                        {rule.scope === 'global' && (
                          <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                            全局
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-on-surface-variant whitespace-nowrap">
                        {rule.created_at ? new Date(rule.created_at).toLocaleDateString('zh-CN') : ''}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] text-on-surface leading-relaxed">{ruleContent}</p>
                    {ruleReason && (
                      <p className="mt-1 text-[11px] text-on-surface-variant">依据：{ruleReason}</p>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-4 text-[11px] text-on-surface-variant">
                        <span>置信度 {Math.round(rule.confidence * 100)}%</span>
                        <span>证据 {rule.evidence_count} 条</span>
                        {rule.target_stages && (() => {
                          try {
                            const stages = JSON.parse(rule.target_stages);
                            if (stages.length > 0) {
                              return (
                                <span className="text-[11px] text-on-surface-variant">
                                  作用阶段：{stages.map((s: number) => `阶段${s}`).join('、')}
                                </span>
                              );
                            }
                          } catch { /* ignore parse errors */ }
                          return null;
                        })()}
                      </div>
                      {rule.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 transition-colors"
                            onClick={() => confirmRule(rule.id)}
                            type="button"
                          >
                            <CheckCircle2 className="size-3.5" />
                            确认
                          </button>
                          <button
                            className="inline-flex items-center gap-1 rounded-md bg-surface-container px-3 py-1.5 text-[11px] font-bold text-on-surface-variant hover:text-red-600 transition-colors"
                            onClick={() => rejectRule(rule.id)}
                            type="button"
                          >
                            <XCircle className="size-3.5" />
                            拒绝
                          </button>
                        </div>
                      )}
                      {rule.status === 'confirmed' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                          <CheckCircle2 className="size-3.5" />
                          已确认
                        </span>
                      )}
                      {rule.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-on-surface-variant">
                          <XCircle className="size-3.5" />
                          已拒绝
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 右栏: 反思面板 */}
        <div className="xl:col-span-5 flex flex-col gap-5">
          {/* 调度状态卡片 */}
          <div className="rounded-xl border border-outline-variant/40 bg-surface p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-on-surface">自动学习调度</h3>
              <span className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
                schedulerStatus?.isRunning
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "bg-surface-container text-on-surface-variant"
              )}>
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  schedulerStatus?.isRunning ? "bg-emerald-500 animate-pulse" : "bg-on-surface-variant/40"
                )} />
                {schedulerStatus?.isRunning ? '执行中' : '等待中'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-on-surface-variant">
              <div>
                <span className="block text-on-surface-variant/60 mb-0.5">上次执行</span>
                <span className="text-on-surface font-medium">
                  {schedulerStatus?.lastRunAt
                    ? new Date(schedulerStatus.lastRunAt).toLocaleString('zh-CN')
                    : '尚未执行'}
                </span>
              </div>
              <div>
                <span className="block text-on-surface-variant/60 mb-0.5">下次执行</span>
                <span className="text-on-surface font-medium">
                  {schedulerStatus?.nextRunAt
                    ? new Date(schedulerStatus.nextRunAt).toLocaleString('zh-CN')
                    : '--'}
                </span>
              </div>
              <div>
                <span className="block text-on-surface-variant/60 mb-0.5">执行间隔</span>
                <span className="text-on-surface font-medium">
                  {schedulerStatus?.intervalMs
                    ? `${Math.round(schedulerStatus.intervalMs / 1000 / 60)} 分钟`
                    : '12 小时'}
                </span>
              </div>
              <div className="flex items-end">
                <button
                  onClick={triggerManualCycle}
                  disabled={isTriggeringManual}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    "bg-primary text-on-primary hover:bg-primary/90",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {isTriggeringManual ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {isTriggeringManual ? '执行中...' : '立即执行'}
                </button>
              </div>
            </div>

            {manualProgress && (
              <p className="mt-3 text-xs text-on-surface-variant bg-surface-container rounded-lg p-2">
                {manualProgress}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-outline-variant/40 bg-surface p-5 flex flex-col gap-5">
            <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
              <Sparkles className="size-5 text-secondary" />
              <h3 className="text-[16px] font-bold text-on-surface">阶段七规则概览</h3>
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="总规则" value={rules.length} />
              <StatCard label="待确认" value={pendingRules.length} highlight />
              <StatCard label="已确认" value={confirmedRules.length} />
            </div>

            <div className="rounded-md bg-surface-container/70 px-3 py-2 text-[12px] leading-relaxed text-on-surface-variant">
              {isReflecting ? reflectionProgress || '阶段七正在自动生成学习规则。' : reflectionProgress || '等待阶段六结果，命中文章或排名上升后自动学习。'}
            </div>
          </div>

          <VisibilityStagePanel
            check={visibilityCheck}
            isChecking={isCheckingVisibility}
            onRunNow={() => runVisibilityCheck('manual')}
            progress={visibilityProgress}
            publishedCount={publishedCount}
          />

          {/* 最新反思摘要 */}
          {lastSummary && (
            <div className="rounded-xl border border-outline-variant/40 bg-surface p-5">
              <div className="flex items-center gap-3 mb-3">
                <BarChart2 className="size-4 text-secondary" />
                <h4 className="text-[14px] font-bold text-on-surface">最新反思摘要</h4>
              </div>
              <p className="text-[12px] text-on-surface-variant leading-relaxed">{lastSummary}</p>
            </div>
          )}

          {/* 规则说明 */}
          <div className="rounded-xl border border-outline-variant/40 bg-[#f7f7f5] dark:bg-surface-variant/45 p-5">
            <h4 className="text-[14px] font-bold text-on-surface mb-3">规则类型说明</h4>
            <div className="space-y-2">
              {Object.entries(RULE_TYPE_LABELS).map(([type, label]) => (
                <div key={type} className="flex items-center gap-2">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold', ruleTypeColor(type))}>
                    {label}
                  </span>
                  <span className="text-[11px] text-on-surface-variant">
                    {type === 'title' && '优化标题结构以提高 AI 引用率'}
                    {type === 'structure' && '调整内容结构便于 AI 摘取'}
                    {type === 'evidence' && '补充企业事实和案例证据'}
                    {type === 'keyword' && '强化目标关键词覆盖'}
                    {type === 'source' && '优化发布渠道和信源策略'}
                    {type === 'avoid' && '规避降低推荐概率的做法'}
                    {type === 'content_gap' && '补充缺失的内容主题'}
                    {type === 'content' && '内容整体优化建议'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl animate-in fade-in p-4 duration-500 sm:p-6 md:p-8 lg:p-xl">
      {children}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-10 rounded-lg border border-dashed border-outline-variant/70 bg-surface/70 p-8 text-center">
      <FileText className="mx-auto size-8 text-on-surface-variant" />
      <h3 className="mt-3 text-[16px] font-bold text-primary">{title}</h3>
      <p className="mt-2 text-[13px] text-on-surface-variant">{description}</p>
    </div>
  );
}

function VisibilityStagePanel({
  check,
  isChecking,
  onRunNow,
  progress,
  publishedCount,
}: {
  check: GeoAgentVisibilityCheck | null;
  isChecking: boolean;
  onRunNow: () => void;
  progress: string | null;
  publishedCount: number;
}) {
  const rate = typeof check?.result.visibility_rate === 'number' ? Math.round(check.result.visibility_rate * 100) : null;
  const questionResults = check?.result.question_results ?? [];
  const matchedUrlCount = questionResults.reduce((count, item) => count + (item.matched_published_urls?.length ?? 0), 0);
  const lastCheckAt = checkTime(check);
  const nextCheckAt = lastCheckAt
    ? new Date(lastCheckAt + VISIBILITY_CHECK_INTERVAL_MS).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radar className="size-5 text-secondary" />
          <div>
            <h3 className="text-[16px] font-bold text-on-surface">阶段六推荐检测</h3>
            <p className="mt-1 text-[11px] text-on-surface-variant">有发布 URL 后自动运行，每 10 分钟复查一次。</p>
          </div>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant/60 px-3 py-2 text-[11px] font-bold text-primary hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isChecking || publishedCount === 0}
          onClick={onRunNow}
          type="button"
        >
          <RefreshCw className={cn('size-3.5', isChecking && 'animate-spin')} />
          {isChecking ? '检测中' : '立即复查'}
        </button>
      </div>
      {publishedCount === 0 ? (
        <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          暂无已发布文章 URL，阶段六会等待发稿平台回填发布链接。
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatCard label="可见率" value={rate ?? 0} />
          <StatCard label="命中 URL" value={matchedUrlCount} highlight />
          <StatCard label="已发布" value={publishedCount} />
        </div>
      )}
      {progress && <div className="mt-3 text-[12px] text-on-surface-variant">{progress}</div>}
      {check && (
        <div className="mt-4 space-y-3">
          <div className="text-[11px] text-on-surface-variant">
            最新检测：{new Date(check.created_at).toLocaleString('zh-CN')}，下次自动复查约 {nextCheckAt || '待定'}。
          </div>
          <div className="max-h-[220px] overflow-y-auto rounded-md bg-surface-container/60 p-3">
            {questionResults.slice(0, 10).map((item) => (
              <div key={item.question_id} className="border-b border-outline-variant/40 py-2 last:border-0">
                <div className="text-[12px] font-bold text-primary">{item.question}</div>
                <div className="mt-1 text-[11px] text-on-surface-variant">
                  {item.effective_mention ? '已有有效提及' : '未有效提及'}
                  {typeof item.ranking_position === 'number' ? ` · 约第 ${item.ranking_position} 位` : ''}
                  {item.matched_published_urls?.length ? ` · 命中发布 URL ${item.matched_published_urls.length} 个` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-md bg-surface-container px-3 py-2.5 text-center">
      <div className={cn('text-[20px] font-bold', highlight ? 'text-secondary' : 'text-primary')}>{value}</div>
      <div className="text-[10px] text-on-surface-variant">{label}</div>
    </div>
  );
}
