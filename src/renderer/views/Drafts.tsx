import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Bell, CheckCircle2, CircleDollarSign, ExternalLink, FileText, Filter, Loader2, PenLine, RefreshCw, RotateCcw, Search, Send, Shield, Sparkles, Trophy, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useEnterprise } from '../context/EnterpriseContext';

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
  const [selectedDraft, setSelectedDraft] = useState<GeoAgentGeoArticleDraft | null>(null);
  const [resourceDraft, setResourceDraft] = useState<GeoAgentGeoArticleDraft | null>(null);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);

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
    if (!window.geoAgent?.managePublishOrder) return;
    const actionLabel: Record<PublishOrderAction, string> = {
      urge: '催稿',
      cancel: '取消订单',
      'apply-refund': '申请退款',
      'apply-republish': '申请补发',
    };
    const reason = action === 'urge'
      ? ''
      : window.prompt(`请输入${actionLabel[action]}原因`);
    if (reason === null) return;
    if (action !== 'urge' && !text(reason)) {
      setError(`${actionLabel[action]}需要填写原因。`);
      return;
    }
    if (!window.confirm(`确认${actionLabel[action]}？`)) return;
    setError(null);
    try {
      await window.geoAgent.managePublishOrder(draft.id, action, { reason: text(reason) });
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
      await window.geoAgent.syncPublishOrders(currentEnterpriseId);
      await loadDrafts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setIsSyncingOrders(false);
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
            当前企业：{currentEnterprise?.name || '未命名企业'}。这里管理阶段四生成的稿件，支持校对、OSS 预览、媒体投递和订单同步。
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
                  onEdit={() => setSelectedDraft(draft)}
                  onMarkReviewed={() => markReviewed(draft)}
                  onPublish={() => setResourceDraft(draft)}
                  onSyncOrder={() => syncOrder(draft)}
                  onManageOrder={(action) => manageOrder(draft, action)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedDraft && (
        <EditDraftModal
          draft={selectedDraft}
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
    <div className="flex w-fit rounded-md border border-outline-variant/40 bg-surface-container p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={cn(
            'rounded px-3 py-1.5 text-[11px] font-bold transition-colors',
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
  onEdit: () => void;
  onMarkReviewed: () => void;
  onPublish: () => void;
  onSyncOrder: () => void;
  onManageOrder: (action: PublishOrderAction) => void;
};

const DraftRow: React.FC<DraftRowProps> = ({ draft, rankingReady, onEdit, onMarkReviewed, onPublish, onSyncOrder, onManageOrder }) => {
  const role = articleRole(draft);
  const status = publishStatus(draft);
  const evidence = publication(draft);
  const publishedUrl = text(evidence.published_url);
  const previewUrl = text(evidence.preview_url);
  const order = draft.publish_order;
  const publishDisabled = role === 'ranking' && !rankingReady;
  return (
    <tr className="border-t border-outline-variant/50 transition-colors hover:bg-surface-container/40">
      <td className="px-5 py-4 align-top">
        <div className="line-clamp-2 text-[14px] font-bold text-primary">{text(draft.draft.title) || '未命名草稿'}</div>
        <div className="mt-1 line-clamp-1 text-[12px] text-on-surface-variant">{text(draft.draft.target_question) || '未绑定目标问题'}</div>
        <div className="mt-1 font-mono text-[10px] text-on-surface-variant">ID: {draft.id}</div>
      </td>
      <td className="px-5 py-4 align-top">
        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
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
        <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', STATUS_STYLES[status] || STATUS_STYLES.draft)}>
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
          <a className="inline-flex max-w-[220px] items-center gap-1 truncate text-secondary hover:underline" href={previewUrl} rel="noreferrer" target="_blank">
            <ExternalLink className="size-3" />
            OSS 预览
          </a>
        ) : (
          <span>{order ? `超级媒介订单：${order.partner_sn}` : '校对后生成 OSS 预览'}</span>
        )}
        {order?.status_code ? <div className="mt-1 text-[11px]">订单状态：{order.status_code}</div> : null}
        {order && !publishedUrl ? <div className="mt-1 text-[11px]">订单：{order.partner_sn}</div> : null}
      </td>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-wrap justify-end gap-2">
          <IconButton title="编辑" onClick={onEdit}><PenLine className="size-4" /></IconButton>
          <IconButton title="标记已校对" onClick={onMarkReviewed} disabled={status === 'published'}>
            <CheckCircle2 className="size-4" />
          </IconButton>
          {order && (
            <IconButton title="同步超级媒介订单" onClick={onSyncOrder} disabled={status === 'published'}>
              <RefreshCw className="size-4" />
            </IconButton>
          )}
          {order && status !== 'published' && (
            <>
              <IconButton title="催稿" onClick={() => onManageOrder('urge')}>
                <Bell className="size-4" />
              </IconButton>
              <IconButton title="取消订单" onClick={() => onManageOrder('cancel')}>
                <Ban className="size-4" />
              </IconButton>
              <IconButton title="申请退款" onClick={() => onManageOrder('apply-refund')}>
                <CircleDollarSign className="size-4" />
              </IconButton>
              {order.resource_type === 'media' && (
                <IconButton title="申请补发" onClick={() => onManageOrder('apply-republish')}>
                  <RotateCcw className="size-4" />
                </IconButton>
              )}
            </>
          )}
          <IconButton title={publishDisabled ? '请先校对 6 篇支撑稿' : '选择媒体并投递'} onClick={onPublish} disabled={publishDisabled || status === 'published'}>
            <Send className="size-4" />
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

function EditDraftModal({ draft, onClose, onSaved }: { draft: GeoAgentGeoArticleDraft; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(text(draft.draft.title));
  const [content, setContent] = useState(text(draft.draft.content));
  const [suggestedChannel, setSuggestedChannel] = useState(text(draft.draft.suggested_channel || draft.draft.publish_target));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          下单前会把稿件上传到 OSS 生成公网预览 URL，再提交给超级媒介。
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-primary">{title}</h3>
          <button className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container" onClick={onClose} type="button">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
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
