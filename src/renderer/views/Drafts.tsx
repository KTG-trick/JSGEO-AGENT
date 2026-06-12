import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Ban, Bell, CheckCircle2, CircleDollarSign, ExternalLink, FileText, Filter, Loader2, PenLine, RefreshCw, RotateCcw, Search, Send, Shield, Sparkles, Trash2, Trophy, X, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { useEnterprise } from '../context/EnterpriseContext';
import { PreviewDialog } from '../components/PreviewDialog';
import { showConfirm } from '../components/ConfirmDialog';
import { showInputDialog } from '../components/InputDialog';
import * as orderRules from '../../shared/chaojimeijieOrderRules';

type StatusFilter = 'all' | 'draft' | 'reviewed' | 'publishing' | 'published' | 'failed';
type RoleFilter = 'all' | 'support' | 'ranking';
type ResourceType = 'media' | 'we-media';
type PublishOrderAction = 'urge' | 'cancel' | 'apply-refund' | 'apply-republish';

const STATUS_LABELS: Record<string, string> = {
  confirmed: '已生成',
  draft: '草稿',
  failed: '失败',
  published: '已发布',
  publishing: '发布中',
  reviewed: '已校对',
  scheduled: '已排期',
};

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  draft: 'bg-outline-variant text-on-surface-variant',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  publishing: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-200',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200',
  scheduled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200',
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function publication(draft: GeoAgentGeoArticleDraft) {
  const value = draft.draft.publication_evidence;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function publishStatus(draft: GeoAgentGeoArticleDraft) {
  return text(publication(draft).status || draft.status || 'draft');
}

function articleRole(draft: GeoAgentGeoArticleDraft) {
  const role = text(draft.draft.article_role);
  if (role) return role;
  return draft.article_type.includes('ranking') ? 'ranking' : 'support';
}

function canPublishRanking(drafts: GeoAgentGeoArticleDraft[]) {
  const supportDrafts = drafts.filter((draft) => articleRole(draft) === 'support');
  const ready = supportDrafts.filter((draft) => ['reviewed', 'published'].includes(publishStatus(draft)));
  return supportDrafts.length >= 6 && ready.length >= 6;
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status || '未知';
}

export function Drafts() {
  const { currentEnterprise, currentEnterpriseId, hasEnterprises, isLoadingEnterprises } = useEnterprise();
  const [drafts, setDrafts] = useState<GeoAgentGeoArticleDraft[]>([]);
  const [summary, setSummary] = useState<GeoAgentArticleDraftListResponse['summary'] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<GeoAgentGeoArticleDraft | null>(null);
  const [selectedDraftIntent, setSelectedDraftIntent] = useState<'edit' | 'ai'>('edit');
  const [resourceDraft, setResourceDraft] = useState<GeoAgentGeoArticleDraft | null>(null);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);
  const [isAutoPublishing, setIsAutoPublishing] = useState(false);
  const [autoPublishResult, setAutoPublishResult] = useState<{
    total: number;
    submitted?: number;
    published: number;
    skipped: number;
    failed: number;
    results: Array<{
      draftId: string;
      title?: string;
      status: string;
      resource?: { name: string };
      reason?: string;
      error?: string;
    }>;
  } | null>(null);
  const [previewDraft, setPreviewDraft] = useState<GeoAgentGeoArticleDraft | null>(null);

  const loadDrafts = useCallback(async () => {
    if (!currentEnterpriseId || !window.geoAgent?.listArticleDrafts) {
      setDrafts([]);
      setSummary(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await window.geoAgent.listArticleDrafts(currentEnterpriseId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        article_role: roleFilter === 'all' ? undefined : roleFilter,
      });
      setDrafts(response.drafts ?? []);
      setSummary(response.summary ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [currentEnterpriseId, roleFilter, statusFilter]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const rankingReady = useMemo(() => canPublishRanking(drafts), [drafts]);
  const markReviewed = async (draft: GeoAgentGeoArticleDraft) => {
    if (!window.geoAgent?.markArticleReviewed) return;
    setError(null);
    try {
      await window.geoAgent.markArticleReviewed(draft.id);
      await loadDrafts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const syncOrder = async (draft: GeoAgentGeoArticleDraft) => {
    if (!window.geoAgent?.syncPublishOrder) return;
    setError(null);
    try {
      await window.geoAgent.syncPublishOrder(draft.id);
      await loadDrafts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const manageOrder = async (draft: GeoAgentGeoArticleDraft, action: PublishOrderAction) => {
    if (!window.geoAgent?.managePublishOrder) {
      setError('系统未就绪，请稍后重试。');
      return;
    }
    const actionLabel: Record<PublishOrderAction, string> = {
      urge: '催稿',
      cancel: '取消订单',
      'apply-refund': '申请退款',
      'apply-republish': '申请补发',
    };

    // 催稿不需要原因，直接确认执行
    if (action === 'urge') {
      const confirmed = await showConfirm({
        title: `确认${actionLabel[action]}`,
        message: `确认要${actionLabel[action]}吗？`,
        variant: 'info',
      });
      if (!confirmed) return;

      setError(null);
      setSuccess(null);
      try {
        await window.geoAgent.managePublishOrder(draft.id, action, {});
        await loadDrafts();
        setSuccess(`${actionLabel[action]}操作已提交，请等待系统处理。`);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      }
      return;
    }

    // 取消订单、申请退款、申请补发需要输入原因
    const reason = await showInputDialog({
      title: `请输入${actionLabel[action]}原因`,
      message: `${actionLabel[action]}需要填写原因，超级媒介会根据原因处理您的请求。`,
      placeholder: `请输入${actionLabel[action]}原因...`,
      variant: action === 'cancel' ? 'warning' : 'info',
    });
    if (reason === null) return; // 用户取消
    if (!text(reason)) {
      setError(`${actionLabel[action]}需要填写原因。`);
      return;
    }

    // 确认操作
    const confirmed = await showConfirm({
      title: `确认${actionLabel[action]}`,
      message: `确认要${actionLabel[action]}吗？`,
      variant: action === 'cancel' ? 'warning' : 'info',
    });
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    try {
      await window.geoAgent.managePublishOrder(draft.id, action, { reason: text(reason) });
      await loadDrafts();
      setSuccess(`${actionLabel[action]}操作已提交，请等待系统处理。`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const removeDraft = async (draft: GeoAgentGeoArticleDraft) => {
    if (!window.geoAgent?.updateArticleDraft) return;
    const status = publishStatus(draft);
    if (['publishing', 'published'].includes(status)) {
      setError('发布中或已发布稿件不能移除。');
      return;
    }
    const title = text(draft.draft.title) || '未命名草稿';
    const confirmed = await showConfirm({
      title: '确认移除草稿',
      message: `确认移除草稿「${title}」吗？移除后默认列表将不再展示。`,
      variant: 'danger',
    });
    if (!confirmed) return;
    setError(null);
    try {
      // 同步删除在线预览文件
      if (window.geoAgent?.deleteArticleOssPreview && publication(draft).preview_object_key) {
        await window.geoAgent.deleteArticleOssPreview(draft.id).catch(() => {});
      }
      await window.geoAgent.updateArticleDraft(draft.id, {
        status: 'archived',
        publication_evidence: {
          ...publication(draft),
          status: 'archived',
          archived_at: new Date().toISOString(),
        },
      });
      await loadDrafts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const syncAllOrders = async () => {
    if (!currentEnterpriseId || !window.geoAgent?.syncPublishOrders) return;
    setIsSyncingOrders(true);
    setError(null);
    try {
      const result = await window.geoAgent.syncPublishOrders(currentEnterpriseId);
      await loadDrafts();
      if (result.errors?.length) {
        setError(`部分订单同步失败：${result.errors.slice(0, 3).map((item) => item.message).join('；')}`);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setIsSyncingOrders(false);
    }
  };

  const handleAutoPublish = async (role: 'support' | 'ranking') => {
    if (!currentEnterpriseId || !window.geoAgent?.autoPublishArticles) return;

    const draftCount = drafts.filter((d) => {
      const draftRole = text(d.draft?.article_role);
      return draftRole === role || (!draftRole && d.article_type?.includes(role));
    }).length;

    if (draftCount === 0) {
      setError(`没有待发布的${role === 'ranking' ? '排行榜' : '支撑'}稿件。`);
      return;
    }

    const confirmed = await showConfirm({
      title: `确认自动发稿`,
      message: `将自动提交 ${draftCount} 篇${role === 'ranking' ? '排行榜' : '支撑'}稿件到超级媒介，系统会自动选择最佳媒体资源。确认继续？`,
      variant: 'info',
    });
    if (!confirmed) return;

    setIsAutoPublishing(true);
    setAutoPublishResult(null);
    setError(null);
    try {
      // 从设置中读取价格上限
      let maxPrice = 10;
      try {
        const settings = await window.geoAgent?.getSettings?.();
        if (settings?.AUTO_PUBLISH_MAX_PRICE) {
          maxPrice = Number(settings.AUTO_PUBLISH_MAX_PRICE) || 10;
        }
      } catch { /* 忽略设置读取失败 */ }

      const result = await window.geoAgent.autoPublishArticles(currentEnterpriseId, {
        articleRole: role,
        maxArticles: 50,
        maxPrice,
      });
      setAutoPublishResult(result);
      await loadDrafts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setIsAutoPublishing(false);
    }
  };

  if (isLoadingEnterprises) {
    return (
      <DraftPageShell>
        <EmptyState title="正在读取企业知识库" description="稿件管理会基于当前企业展示文章草稿。" />
      </DraftPageShell>
    );
  }

  if (!hasEnterprises || !currentEnterpriseId) {
    return (
      <DraftPageShell>
        <EmptyState title="请先录入企业知识库" description="完成阶段一到阶段四后，这里会展示生成的支撑稿和排行榜稿。" />
      </DraftPageShell>
    );
  }

  return (
    <DraftPageShell>
      <div className="flex flex-col gap-3 border-b border-outline-variant/60 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-primary">稿件管理与发布</h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-on-surface-variant">
            当前企业：{currentEnterprise?.name || '未命名企业'}。这里管理阶段四生成的稿件，支持校对、在线预览、媒体投递和订单同步。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-bold text-on-surface-variant">
          <Metric label="全部" value={summary?.total ?? drafts.length} />
          <Metric label="支撑稿" value={summary?.by_role?.support ?? drafts.filter((draft) => articleRole(draft) === 'support').length} />
          <Metric label="排行榜稿" value={summary?.by_role?.ranking ?? drafts.filter((draft) => articleRole(draft) === 'ranking').length} />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-b border-outline-variant/60 pb-5 md:flex-row md:items-center md:justify-between">
        <Segmented
          value={statusFilter}
          options={[
            ['all', '全部'],
            ['draft', '草稿'],
            ['reviewed', '已校对'],
            ['publishing', '发布中'],
            ['published', '已发布'],
          ]}
          onChange={(value) => setStatusFilter(value as StatusFilter)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-md border border-outline-variant/50 px-3 py-2 text-[11px] font-bold text-primary hover:bg-surface-container disabled:opacity-50"
            disabled={isSyncingOrders}
            onClick={syncAllOrders}
            type="button"
          >
            <RefreshCw className={cn('size-3.5', isSyncingOrders && 'animate-spin')} />
            同步订单状态
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-primary/20 bg-primary px-3 py-2 text-[11px] font-bold text-on-primary transition-all duration-200 hover:bg-primary/90 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isAutoPublishing}
            onClick={() => handleAutoPublish('support')}
            type="button"
          >
            {isAutoPublishing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Zap className="size-3.5" />
            )}
            {isAutoPublishing ? '自动发稿中...' : '一键自动发稿'}
          </button>
          <Filter className="size-4 text-on-surface-variant" />
          <Segmented
            value={roleFilter}
            options={[
              ['all', '全部类型'],
              ['support', '支撑稿'],
              ['ranking', '排行榜稿'],
            ]}
            onChange={(value) => setRoleFilter(value as RoleFilter)}
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
          <span>{success}</span>
          <button
            className="ml-4 text-emerald-500 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            onClick={() => setSuccess(null)}
            type="button"
          >
            ×
          </button>
        </div>
      )}

      {autoPublishResult && (
        <div className="mt-4 rounded-lg border border-outline-variant/60 bg-surface/80 p-4 text-[13px]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-primary">
              <CheckCircle2 className="size-4 text-emerald-500" />
              自动提交结果
            </div>
            <button
              className="rounded-md px-2 py-1 text-[11px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container"
              onClick={() => setAutoPublishResult(null)}
              type="button"
            >
              关闭
            </button>
          </div>

          <div className="mb-3 grid grid-cols-4 gap-3">
            <div className="rounded-md bg-surface-container p-2 text-center">
              <div className="text-[18px] font-bold text-primary">{autoPublishResult.total}</div>
              <div className="text-[11px] text-on-surface-variant">总计</div>
            </div>
            <div className="rounded-md bg-emerald-50 p-2 text-center dark:bg-emerald-950/20">
              <div className="text-[18px] font-bold text-emerald-600 dark:text-emerald-400">{autoPublishResult.submitted ?? autoPublishResult.published}</div>
              <div className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70">已提交</div>
            </div>
            <div className="rounded-md bg-amber-50 p-2 text-center dark:bg-amber-950/20">
              <div className="text-[18px] font-bold text-amber-600 dark:text-amber-400">{autoPublishResult.skipped}</div>
              <div className="text-[11px] text-amber-600/70 dark:text-amber-400/70">跳过</div>
            </div>
            <div className="rounded-md bg-red-50 p-2 text-center dark:bg-red-950/20">
              <div className="text-[18px] font-bold text-red-600 dark:text-red-400">{autoPublishResult.failed}</div>
              <div className="text-[11px] text-red-600/70 dark:text-red-400/70">失败</div>
            </div>
          </div>

          {autoPublishResult.results.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-outline-variant/40 bg-surface-container/40">
              {autoPublishResult.results.map((result) => (
                <div
                  key={result.draftId}
                  className={cn(
                    'flex items-center justify-between gap-3 px-3 py-2 border-b border-outline-variant/30 last:border-0 text-[12px]',
                    result.status === 'publishing' && 'text-emerald-600 dark:text-emerald-400',
                    result.status === 'published' && 'text-emerald-600 dark:text-emerald-400',
                    result.status === 'skipped' && 'text-amber-600 dark:text-amber-400',
                    result.status === 'failed' && 'text-red-600 dark:text-red-400'
                  )}
                >
                  <span className="flex-1 truncate">{result.title || result.draftId.slice(0, 8)}</span>
                  <span className="whitespace-nowrap text-[11px]">
                    {result.status === 'publishing' && `已提交 → ${result.resource?.name}`}
                    {result.status === 'published' && `已发布 → ${result.resource?.name}`}
                    {result.status === 'skipped' && `跳过: ${result.reason}`}
                    {result.status === 'failed' && `失败: ${result.error}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-[13px] text-on-surface-variant">
          <Loader2 className="size-4 animate-spin" />
          正在加载稿件
        </div>
      ) : drafts.length === 0 ? (
        <EmptyState title="暂无稿件" description="请先在智能助手完成阶段四，生成首轮内容资产。" />
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border border-outline-variant/60 bg-surface/80">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-container/70">
              <tr>
                <TableHead className="w-[38%]">文章</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>发布状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </tr>
            </thead>
            <tbody>
              {drafts.slice().sort((a, b) => {
                const roleA = articleRole(a);
                const roleB = articleRole(b);
                if (roleA === roleB) return 0;
                return roleA === 'support' ? -1 : 1;
              }).map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  rankingReady={rankingReady}
                  onEdit={() => {
                    setSelectedDraftIntent('edit');
                    setSelectedDraft(draft);
                  }}
                  onAiEdit={() => {
                    setSelectedDraftIntent('ai');
                    setSelectedDraft(draft);
                  }}
                  onMarkReviewed={() => markReviewed(draft)}
                  onPublish={() => setResourceDraft(draft)}
                  onRemove={() => removeDraft(draft)}
                  onSyncOrder={() => syncOrder(draft)}
                  onManageOrder={(action) => manageOrder(draft, action)}
                  onPreview={() => {
                    const url = draft.draft?.publication_evidence?.preview_url;
                    if (url) console.log('[在线预览]', url);
                    setPreviewDraft(draft);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedDraft && (
        <EditDraftModal
          draft={selectedDraft}
          initialAiOpen={selectedDraftIntent === 'ai'}
          onClose={() => setSelectedDraft(null)}
          onSaved={async () => {
            setSelectedDraft(null);
            await loadDrafts();
          }}
        />
      )}
      {resourceDraft && (
        <PublishResourceModal
          draft={resourceDraft}
          onClose={() => setResourceDraft(null)}
          onSaved={async () => {
            setResourceDraft(null);
            await loadDrafts();
          }}
        />
      )}
      {previewDraft && (
        <PreviewDialog
          articleId={previewDraft.id}
          open={!!previewDraft}
          onClose={() => setPreviewDraft(null)}
        />
      )}
    </DraftPageShell>
  );
}

function DraftPageShell({ children }: { children: React.ReactNode }) {
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-surface-container px-4 py-3">
      <div className="text-[18px] text-primary">{value}</div>
      <div>{label}</div>
    </div>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <div className="flex w-fit flex-nowrap rounded-md border border-outline-variant/40 bg-surface-container p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={cn(
            'whitespace-nowrap rounded px-3 py-1.5 text-[11px] font-bold transition-colors',
            value === optionValue ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'
          )}
          onClick={() => onChange(optionValue)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TableHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant', className)}>{children}</th>;
}

type DraftRowProps = {
  draft: GeoAgentGeoArticleDraft;
  rankingReady: boolean;
  onAiEdit: () => void;
  onEdit: () => void;
  onMarkReviewed: () => void;
  onPublish: () => void;
  onRemove: () => void;
  onSyncOrder: () => void;
  onManageOrder: (action: PublishOrderAction) => void;
  onPreview: () => void;
};

const DraftRow: React.FC<DraftRowProps> = ({ draft, rankingReady, onAiEdit, onEdit, onMarkReviewed, onPublish, onRemove, onSyncOrder, onManageOrder, onPreview }) => {
  const role = articleRole(draft);
  const status = publishStatus(draft);
  const evidence = publication(draft);
  const publishedUrl = text(evidence.published_url);
  const previewUrl = text(evidence.preview_url);
  const order = draft.publish_order;
  const orderBlocksPublish = order ? orderRules.isOrderBlockingRepublish(order) : false;
  const publishDisabled = (role === 'ranking' && !rankingReady) || orderBlocksPublish;
  const publishTitle = orderBlocksPublish ? '当前稿件已有未完成或已发布订单' : publishDisabled ? '请先校对 6 篇支撑稿' : '选择媒体并投递';
  const lockedByPublish = ['publishing', 'published'].includes(status);
  const canManage = (action: PublishOrderAction) => order ? orderRules.canManageOrder(order, action, order.resource).allowed : false;
  return (
    <tr className="border-t border-outline-variant/50 transition-colors hover:bg-surface-container/40">
      <td className="px-5 py-4 align-top">
        <div className="line-clamp-2 text-[14px] font-bold text-primary">{text(draft.draft.title) || '未命名草稿'}</div>
        <div className="mt-1 line-clamp-1 text-[12px] text-on-surface-variant">{text(draft.draft.target_question) || '未绑定目标问题'}</div>
        <div className="mt-1 font-mono text-[10px] text-on-surface-variant">ID: {draft.id}</div>
      </td>
      <td className="px-5 py-4 align-top">
        <span className={cn(
          'inline-flex whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
          role === 'ranking'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
        )}>
          {role === 'ranking' ? <Trophy className="size-3.5" /> : <Shield className="size-3.5" />}
          {role === 'ranking' ? '排行榜' : '支撑'}
        </span>
        <div className="mt-1 text-[12px] text-on-surface-variant">{text(draft.draft.article_theme) || draft.article_type}</div>
      </td>
      <td className="px-5 py-4 align-top">
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold', STATUS_STYLES[status] || STATUS_STYLES.draft)}>
          {statusLabel(status)}
        </span>
      </td>
      <td className="px-5 py-4 align-top text-[12px] text-on-surface-variant">
        {publishedUrl ? (
          <a className="inline-flex max-w-[220px] items-center gap-1 truncate text-secondary hover:underline" href={publishedUrl} rel="noreferrer" target="_blank">
            <ExternalLink className="size-3" />
            {publishedUrl}
          </a>
        ) : previewUrl ? (
          <button
            className="inline-flex max-w-[220px] items-center gap-1 truncate text-secondary hover:underline"
            onClick={onPreview}
          >
            <ExternalLink className="size-3" />
            在线预览
          </button>
        ) : (
          <span>{order ? `超级媒介订单：${order.partner_sn}` : '校对后生成在线预览页'}</span>
        )}
        {order?.status_code ? <div className="mt-1 text-[11px]">订单状态：{orderRules.statusLabel(order.status_code)}（{order.status_code}）</div> : null}
        {order && !publishedUrl ? <div className="mt-1 text-[11px]">订单：{order.partner_sn}</div> : null}
      </td>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-wrap justify-end gap-2">
          <IconButton title="编辑" onClick={onEdit} disabled={lockedByPublish}><PenLine className="size-4" /></IconButton>
          <IconButton title="AI 改稿" onClick={onAiEdit} disabled={lockedByPublish}>
            <Sparkles className="size-4" />
          </IconButton>
          <IconButton title="标记已校对" onClick={onMarkReviewed} disabled={lockedByPublish || status === 'reviewed'}>
            <CheckCircle2 className="size-4" />
          </IconButton>
          {order && (
            <IconButton title="同步超级媒介订单" onClick={onSyncOrder}>
              <RefreshCw className="size-4" />
            </IconButton>
          )}
          {order && (
            <>
              {canManage('urge') && (
              <IconButton title="催稿" onClick={() => onManageOrder('urge')}>
                <Bell className="size-4" />
              </IconButton>
              )}
              {canManage('cancel') && (
              <IconButton title="取消订单" onClick={() => onManageOrder('cancel')}>
                <Ban className="size-4" />
              </IconButton>
              )}
              {canManage('apply-refund') && (
              <IconButton title="申请退款" onClick={() => onManageOrder('apply-refund')}>
                <CircleDollarSign className="size-4" />
              </IconButton>
              )}
              {canManage('apply-republish') && (
                <IconButton title="申请补发" onClick={() => onManageOrder('apply-republish')}>
                  <RotateCcw className="size-4" />
                </IconButton>
              )}
            </>
          )}
          <IconButton title={publishTitle} onClick={onPublish} disabled={publishDisabled || status === 'published'}>
            <Send className="size-4" />
          </IconButton>
          <IconButton title="移除草稿" onClick={onRemove} disabled={lockedByPublish}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
};

function IconButton({ children, disabled, onClick, title }: { children: React.ReactNode; disabled?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      className="inline-flex size-8 items-center justify-center rounded-md bg-surface-container text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function EditDraftModal({ draft, initialAiOpen = false, onClose, onSaved }: { draft: GeoAgentGeoArticleDraft; initialAiOpen?: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(text(draft.draft.title));
  const [content, setContent] = useState(text(draft.draft.content));
  const [suggestedChannel, setSuggestedChannel] = useState(text(draft.draft.suggested_channel || draft.draft.publish_target));
  const [aiOpen, setAiOpen] = useState(initialAiOpen);
  const [instruction, setInstruction] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [revisionSummary, setRevisionSummary] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lockedByPublish = ['publishing', 'published'].includes(publishStatus(draft));

  const runRevision = async (mode: 'revise' | 'rewrite') => {
    if (!window.geoAgent?.reviseArticleDraft) return;
    if (mode === 'revise' && !text(instruction)) {
      setError('请先输入修改意见。');
      return;
    }
    setIsRevising(true);
    setError(null);
    setRevisionSummary('');
    try {
      const result = await window.geoAgent.reviseArticleDraft(draft.id, {
        mode,
        instruction: text(instruction),
      });
      setTitle(text(result.title) || title);
      setContent(text(result.content) || content);
      setSuggestedChannel(text(result.suggested_channel || result.publish_target) || suggestedChannel);
      setRevisionSummary(text(result.revision_summary) || 'AI 已生成修改版本，请确认后保存。');
    } catch (revisionError) {
      setError(revisionError instanceof Error ? revisionError.message : String(revisionError));
    } finally {
      setIsRevising(false);
    }
  };

  const save = async () => {
    if (!window.geoAgent?.updateArticleDraft) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.geoAgent.updateArticleDraft(draft.id, {
        title,
        content,
        suggested_channel: suggestedChannel,
        publish_target: suggestedChannel,
        ...(!lockedByPublish
          ? {
            status: 'draft',
            publication_evidence: {
              ...publication(draft),
              status: 'draft',
              preview_url: null,
              preview_object_key: null,
              preview_generated_at: null,
            },
          }
          : {}),
      });
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal title="编辑稿件" onClose={onClose}>
      <div className="space-y-4">
        <Field label="标题">
          <input className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px] outline-none focus:border-secondary" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        </Field>
        <Field label="建议发布渠道">
          <input className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px] outline-none focus:border-secondary" value={suggestedChannel} onChange={(event) => setSuggestedChannel(event.currentTarget.value)} />
        </Field>
        <div className="rounded-md border border-outline-variant/60 bg-surface-container/40 p-3">
          <button
            className="flex w-full items-center justify-between gap-3 text-left text-[12px] font-bold text-primary"
            onClick={() => setAiOpen((value) => !value)}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles className="size-4 text-secondary" />
              AI 改稿
            </span>
            <span className="text-[11px] text-on-surface-variant">{aiOpen ? '收起' : '展开'}</span>
          </button>
          {lockedByPublish && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              当前稿件已进入发布流程，建议不要修改正文，避免与订单或已发布链接不一致。
            </div>
          )}
          {aiOpen && (
            <div className="mt-3 space-y-3">
              <textarea
                className="h-24 w-full resize-none rounded-md border border-outline-variant bg-surface px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-secondary"
                placeholder="输入修改意见，例如：语气更专业，减少夸张表述，增加本地服务优势。"
                value={instruction}
                onChange={(event) => setInstruction(event.currentTarget.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-[11px] font-bold text-on-secondary disabled:opacity-50"
                  disabled={isRevising || lockedByPublish}
                  onClick={() => runRevision('revise')}
                  type="button"
                >
                  {isRevising ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  按意见修改
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-outline-variant/60 px-3 py-2 text-[11px] font-bold text-primary hover:bg-surface-container disabled:opacity-50"
                  disabled={isRevising || lockedByPublish}
                  onClick={() => runRevision('rewrite')}
                  type="button"
                >
                  {isRevising ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  基于此文重写
                </button>
                <span className="text-[11px] text-on-surface-variant">结果会先填入编辑框，确认后再保存。</span>
              </div>
              {revisionSummary && (
                <div className="rounded-md bg-secondary/10 px-3 py-2 text-[12px] text-secondary">
                  {revisionSummary}
                </div>
              )}
            </div>
          )}
        </div>
        <Field label="正文 Markdown">
          <textarea className="h-[360px] w-full resize-none rounded-md border border-outline-variant bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-secondary" value={content} onChange={(event) => setContent(event.currentTarget.value)} />
        </Field>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="rounded-md px-4 py-2 text-[12px] font-bold text-on-surface-variant hover:bg-surface-container" onClick={onClose} type="button">取消</button>
          <button className="rounded-md bg-secondary px-4 py-2 text-[12px] font-bold text-on-secondary disabled:opacity-50" disabled={isSaving} onClick={save} type="button">
            {isSaving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PublishResourceModal({ draft, onClose, onSaved }: { draft: GeoAgentGeoArticleDraft; onClose: () => void; onSaved: () => Promise<void> }) {
  const [resourceType, setResourceType] = useState<ResourceType>('media');
  const [query, setQuery] = useState('');
  const [resources, setResources] = useState<GeoAgentPublishResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(null);
  const [recommendations, setRecommendations] = useState<GeoAgentPublishRecommendation[]>([]);
  const [recommendationMeta, setRecommendationMeta] = useState<Record<string, unknown> | null>(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [remark, setRemark] = useState('');
  const [publishForm, setPublishForm] = useState<1 | 2>(1);
  const [publishType, setPublishType] = useState<1 | 2 | 3>(1);
  const [accountRule, setAccountRule] = useState<2 | 3>(3);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResources = useCallback(async () => {
    if (!window.geoAgent?.listPublishResources) return;
    setIsLoadingResources(true);
    setError(null);
    try {
      const response = await window.geoAgent.listPublishResources({
        resourceType,
        query,
        status: 2,
        maxPrice: maxPrice || undefined,
        limit: 100,
      });
      setResources(response.resources ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingResources(false);
    }
  }, [maxPrice, query, resourceType]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const syncResources = async () => {
    if (!window.geoAgent?.syncChaojimeijieResources) return;
    setIsLoadingResources(true);
    setError(null);
    try {
      const response = await window.geoAgent.syncChaojimeijieResources(resourceType, 1, 200);
      setResources(response.items ?? []);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setIsLoadingResources(false);
    }
  };

  const recommendResources = async () => {
    if (!window.geoAgent?.recommendPublishResources) return;
    setIsRecommending(true);
    setError(null);
    try {
      const response = await window.geoAgent.recommendPublishResources(draft.id, {
        resourceType,
        query,
        maxPrice: maxPrice || undefined,
        limit: 5,
      });
      setRecommendations(response.recommendations ?? []);
      setRecommendationMeta(response.meta ?? null);
      const first = response.recommendations?.[0];
      if (first?.resource) {
        setSelectedResourceId(first.resource.resource_id);
        setResourceType(first.resource.resource_type === 'we-media' ? 'we-media' : 'media');
        if (first.suggested_options?.publishForm) setPublishForm(first.suggested_options.publishForm);
        if (first.suggested_options?.publishType) setPublishType(first.suggested_options.publishType);
        if (first.suggested_options?.accountRule) setAccountRule(first.suggested_options.accountRule);
      }
    } catch (recommendError) {
      setError(recommendError instanceof Error ? recommendError.message : String(recommendError));
    } finally {
      setIsRecommending(false);
    }
  };

  const submit = async () => {
    if (!window.geoAgent?.publishArticle || !selectedResourceId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await window.geoAgent.publishArticle(draft.id, 'chaojimeijie', {
        resourceType,
        resourceId: selectedResourceId,
        remark,
        publishForm,
        publishType,
        accountRule,
      });
      await onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal title="选择超级媒介资源并投递" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md bg-surface-container/70 p-3 text-[12px] leading-relaxed text-on-surface-variant">
          超级媒介接口要求提交公网预览 URL，不支持正文直传。下单前会生成并校验在线预览页，确认可读取后再提交。
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={resourceType}
            options={[
              ['media', '新闻媒体'],
              ['we-media', '自媒体'],
            ]}
            onChange={(value) => {
              setResourceType(value as ResourceType);
              setSelectedResourceId(null);
            }}
          />
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-on-surface-variant" />
            <input
              className="w-full rounded-md border border-outline-variant bg-surface py-2 pl-9 pr-3 text-[13px] outline-none focus:border-secondary"
              placeholder="搜索资源名称"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <input
            className="w-28 rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px] outline-none focus:border-secondary"
            min="0"
            placeholder="预算上限"
            type="number"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.currentTarget.value)}
          />
          <button
            className="inline-flex items-center gap-2 rounded-md border border-secondary/40 px-3 py-2 text-[11px] font-bold text-secondary hover:bg-secondary/10 disabled:opacity-50"
            disabled={isRecommending}
            onClick={recommendResources}
            type="button"
          >
            {isRecommending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            AI 推荐渠道
          </button>
          <button className="rounded-md border border-outline-variant/50 px-3 py-2 text-[11px] font-bold text-primary hover:bg-surface-container" onClick={syncResources} type="button">
            同步资源
          </button>
        </div>

        {(recommendations.length > 0 || recommendationMeta?.message || recommendationMeta?.ai_error) && (
          <div className="rounded-md border border-outline-variant/60 bg-surface-container/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[12px] font-bold text-primary">
                <Sparkles className="size-4 text-secondary" />
                AI 推荐渠道
              </div>
              {recommendationMeta?.ai_error ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                  <AlertTriangle className="size-3.5" />
                  已使用规则推荐
                </span>
              ) : null}
            </div>
            {recommendationMeta?.message ? (
              <div className="text-[12px] text-on-surface-variant">{String(recommendationMeta.message)}</div>
            ) : (
              <div className="grid gap-2">
                {recommendations.map((item) => {
                  const selected = selectedResourceId === item.resource.resource_id && resourceType === item.resource.resource_type;
                  return (
                    <button
                      key={`${item.resource.resource_type}:${item.resource.resource_id}`}
                      className={cn(
                        'rounded-md border border-outline-variant/50 bg-surface px-3 py-2 text-left hover:border-secondary/60',
                        selected && 'border-secondary bg-secondary/10'
                      )}
                      onClick={() => {
                        setResourceType(item.resource.resource_type === 'we-media' ? 'we-media' : 'media');
                        setSelectedResourceId(item.resource.resource_id);
                        if (item.suggested_options?.publishForm) setPublishForm(item.suggested_options.publishForm);
                        if (item.suggested_options?.publishType) setPublishType(item.suggested_options.publishType);
                        if (item.suggested_options?.accountRule) setAccountRule(item.suggested_options.accountRule);
                      }}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-bold text-primary">{item.resource.name}</div>
                          <div className="mt-1 text-[11px] text-on-surface-variant">
                            {item.resource.resource_type === 'we-media' ? '自媒体' : '新闻媒体'} · ID {item.resource.resource_id} · ￥{Number(item.resource.price || 0).toFixed(2)}
                          </div>
                        </div>
                        <span className="rounded-full bg-secondary/10 px-2 py-1 text-[11px] font-bold text-secondary">{item.score}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-on-surface-variant">
                        {(item.reasons || []).join('；')}
                      </div>
                      {item.risk_flags?.length ? (
                        <div className="mt-1 text-[11px] text-amber-700">{item.risk_flags.join('；')}</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="max-h-[280px] overflow-y-auto rounded-md border border-outline-variant/60">
          {isLoadingResources ? (
            <div className="flex items-center justify-center gap-2 p-6 text-[13px] text-on-surface-variant">
              <Loader2 className="size-4 animate-spin" />
              正在读取资源
            </div>
          ) : resources.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-on-surface-variant">暂无资源，请先同步。</div>
          ) : (
            resources.map((resource) => {
              const selected = selectedResourceId === resource.resource_id;
              return (
                <button
                  key={resource.id}
                  className={cn(
                    'grid w-full grid-cols-[1fr_auto] gap-3 border-b border-outline-variant/40 px-4 py-3 text-left last:border-b-0 hover:bg-surface-container/60',
                    selected && 'bg-secondary/10'
                  )}
                  onClick={() => setSelectedResourceId(resource.resource_id)}
                  type="button"
                >
                  <span>
                    <span className="block text-[13px] font-bold text-primary">{resource.name}</span>
                    <span className="mt-1 block text-[11px] text-on-surface-variant">
                      ID {resource.resource_id} · 发稿率 {text(resource.raw?.published_rate) || '-'}% · 平均 {text(resource.raw?.published_avg) || '-'} 分钟
                    </span>
                  </span>
                  <span className="text-right text-[12px] font-bold text-primary">¥{Number(resource.price || 0).toFixed(2)}</span>
                </button>
              );
            })
          )}
        </div>

        <Field label="备注">
          <input className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px] outline-none focus:border-secondary" value={remark} onChange={(event) => setRemark(event.currentTarget.value)} />
        </Field>

        {resourceType === 'we-media' && (
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="发布形式">
              <select className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px]" value={publishForm} onChange={(event) => setPublishForm(Number(event.currentTarget.value) as 1 | 2)}>
                <option value={1}>图文发布</option>
                <option value={2}>优先图文，未通过则截图</option>
              </select>
            </Field>
            <Field label="发布类型">
              <select className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px]" value={publishType} onChange={(event) => setPublishType(Number(event.currentTarget.value) as 1 | 2 | 3)}>
                <option value={1}>图文</option>
                <option value={2}>视频</option>
                <option value={3}>动态</option>
              </select>
            </Field>
            <Field label="发布规则">
              <select className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px]" value={accountRule} onChange={(event) => setAccountRule(Number(event.currentTarget.value) as 2 | 3)}>
                <option value={3}>不允许换号发布</option>
                <option value={2}>只允许同类型账号</option>
              </select>
            </Field>
          </div>
        )}

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="rounded-md px-4 py-2 text-[12px] font-bold text-on-surface-variant hover:bg-surface-container" onClick={onClose} type="button">取消</button>
          <button className="rounded-md bg-secondary px-4 py-2 text-[12px] font-bold text-on-secondary disabled:opacity-50" disabled={isSubmitting || !selectedResourceId} onClick={submit} type="button">
            {isSubmitting ? '投递中' : '确认投递'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-primary">{title}</h3>
          <button className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container" onClick={onClose} type="button">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-bold text-primary">{label}</span>
      {children}
    </label>
  );
}
