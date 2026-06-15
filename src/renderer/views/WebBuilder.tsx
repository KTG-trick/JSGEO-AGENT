import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Code2, Download, ExternalLink, Globe, Loader2, Plus,
  Sparkles, Trash2, X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useEnterprise } from '../context/EnterpriseContext';
import { showConfirm } from '../components/ConfirmDialog';
import { motion, AnimatePresence } from 'motion/react';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  generating: '生成中',
  ready: '就绪',
  failed: '失败',
  pending: '等待中',
};

const STATUS_STYLES: Record<string, string> = {
  generating: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200',
  ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200',
  pending: 'bg-outline-variant text-on-surface-variant',
};

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function text(v: unknown) {
  return String(v ?? '').trim();
}

function formatDate(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// 生成对话框
// ---------------------------------------------------------------------------

interface GenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (options: { site_name: string; requirements: string; brand_color: string }) => void;
  loading: boolean;
}

function GenerateDialog({ open, onClose, onGenerate, loading }: GenerateDialogProps) {
  const [siteName, setSiteName] = useState('');
  const [requirements, setRequirements] = useState('');
  const [brandColor, setBrandColor] = useState('#1a73e8');
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    if (!open) return;
    const check = () => setDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [open]);

  const handleSubmit = () => {
    if (!siteName.trim()) return;
    console.log('[GenerateDialog] handleSubmit', { siteName, brandColor, requirements });
    onGenerate({
      site_name: siteName.trim(),
      requirements: requirements.trim(),
      brand_color: brandColor,
    });
  };

  if (!open) return null;

  const bg = dark ? '#1e1e1e' : '#ffffff';
  const fg = dark ? '#e0e0e0' : '#202020';
  const muted = dark ? '#999' : '#666';
  const border = dark ? '#444' : '#ddd';
  const inputBg = dark ? '#2a2a2a' : '#f9f9f9';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <style>{`.web-builder-dialog input::placeholder, .web-builder-dialog textarea::placeholder { color: ${dark ? '#666' : '#999'} !important; opacity: 1; }`}</style>
      <div className="web-builder-dialog" style={{ width: 480, maxWidth: '90vw', background: bg, color: fg, borderRadius: 16, padding: 24, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>新建企业网站</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6, color: dark ? '#ccc' : '#333' }}>网站名称 *</label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="例如：成都彩虹音响官网"
              style={{ width: '100%', borderRadius: 12, border: `1px solid ${border}`, background: inputBg, color: fg, padding: '10px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6, color: dark ? '#ccc' : '#333' }}>品牌主色</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                style={{ width: 40, height: 40, borderRadius: 8, border: `1px solid ${border}`, cursor: 'pointer', padding: 2 }}
              />
              <span style={{ fontSize: 14, fontFamily: 'monospace', color: muted }}>{brandColor}</span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6, color: dark ? '#ccc' : '#333' }}>补充说明（可选）</label>
            <textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="描述网站的特殊需求，例如：需要突出产品价格、添加在线预约功能……"
              rows={3}
              style={{ width: '100%', borderRadius: 12, border: `1px solid ${border}`, background: inputBg, color: fg, padding: '10px 12px', fontSize: 14, outline: 'none', resize: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', fontSize: 14, fontWeight: 500, borderRadius: 12, border: `1px solid ${border}`, background: 'none', color: muted, cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!siteName.trim() || loading}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 12,
              border: 'none',
              background: siteName.trim() && !loading ? '#1a73e8' : (dark ? '#333' : '#ddd'),
              color: siteName.trim() && !loading ? '#fff' : (dark ? '#666' : '#999'),
              cursor: siteName.trim() && !loading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? '生成中...' : '开始生成'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

type ViewMode = 'list' | 'preview';

export function WebBuilder() {
  const { currentEnterpriseId, hasEnterprises } = useEnterprise();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [websites, setWebsites] = useState<GeoAgentWebsite[]>([]);
  const [selectedWebsite, setSelectedWebsite] = useState<GeoAgentWebsite | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewBaseUrl, setPreviewBaseUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState<{ current: number; total: number; page: string } | null>(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 加载网站列表
  const loadWebsites = useCallback(async () => {
    if (!currentEnterpriseId) return;
    setLoading(true);
    try {
      const list = await window.geoAgent.listWebsites(currentEnterpriseId);
      setWebsites(list);
    } catch (err) {
      console.error('加载网站列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [currentEnterpriseId]);

  useEffect(() => {
    loadWebsites();
  }, [loadWebsites]);

  // 选择网站进入预览
  const handleSelectWebsite = useCallback(async (website: GeoAgentWebsite) => {
    setSelectedWebsite(website);
    setViewMode('preview');
    setError(null);
    setPreviewHtml('');
    setPreviewBaseUrl('');

    if (website.status === 'ready') {
      try {
        const baseUrl = await window.geoAgent.getWebsitePreviewBaseUrl(website.id);
        if (baseUrl) {
          setPreviewBaseUrl(`${baseUrl}/index.html`);
        }
      } catch (err) {
        console.error('获取预览地址失败:', err);
      }
    }
  }, []);

  // 生成网站
  const handleGenerate = useCallback(async (options: { site_name: string; requirements: string; brand_color: string }) => {
    console.log('[WebBuilder] handleGenerate called', { currentEnterpriseId, options });
    if (!currentEnterpriseId) {
      console.warn('[WebBuilder] currentEnterpriseId is null, aborting');
      setError('未选择企业项目，请先在左侧选择一个企业知识库');
      return;
    }
    setGenerating(true);
    setGeneratingProgress(null);
    setError(null);
    setShowGenerateDialog(false);

    try {
      const { promise: websitePromise } = window.geoAgent.generateWebsiteStream(
        currentEnterpriseId,
        options,
        (event) => {
          console.log('[WebBuilder] stream event:', event.type, event);
          if (event.type === 'page_progress') {
            setGeneratingProgress({
              current: (event.page_index as number) + 1,
              total: event.total as number,
              page: (event.page_title as string) || (event.page_slug as string),
            });
          }
          if (event.type === 'error') {
            setError((event.error as string) || (event.message as string) || '生成失败');
          }
        }
      );
      const website = await websitePromise;
      console.log('[WebBuilder] generate done:', website);
      // 生成完成，刷新列表
      await loadWebsites();
      // 自动进入预览
      if (website) {
        handleSelectWebsite(website);
      }
    } catch (err: unknown) {
      console.error('[WebBuilder] generate failed:', err);
      const msg = err instanceof Error ? err.message : '生成失败';
      setError(msg);
    } finally {
      setGenerating(false);
      setGeneratingProgress(null);
    }
  }, [currentEnterpriseId, loadWebsites, handleSelectWebsite]);

  // 删除网站
  const handleDelete = useCallback(async (websiteId: string) => {
    const confirmed = await showConfirm({
      title: '删除网站',
      message: '确定要删除这个网站吗？此操作不可恢复。',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await window.geoAgent.deleteWebsite(websiteId);
      setWebsites((prev) => prev.filter((w) => w.id !== websiteId));
      if (selectedWebsite?.id === websiteId) {
        setViewMode('list');
        setSelectedWebsite(null);
      }
    } catch (err) {
      console.error('删除失败:', err);
    }
  }, [selectedWebsite]);

  // 导出网站
  const handleExport = useCallback(async (websiteId: string) => {
    try {
      await window.geoAgent.exportWebsite(websiteId);
    } catch (err) {
      console.error('导出失败:', err);
    }
  }, []);

  // 返回列表
  const handleBack = useCallback(() => {
    setViewMode('list');
    setSelectedWebsite(null);
    setPreviewHtml('');
    setPreviewBaseUrl('');
    setError(null);
    // 停止预览服务
    window.geoAgent.getWebsitePreviewBaseUrl('').catch(() => {});
  }, []);

  // ---------------------------------------------------------------------------
  // 渲染：预览视图
  // ---------------------------------------------------------------------------
  if (viewMode === 'preview' && selectedWebsite) {
    return (
      <div className="flex flex-col h-full animate-in fade-in duration-200">
        {/* 工具栏 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/30 bg-background/80 backdrop-blur-sm shrink-0">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-on-surface-variant cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>

          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-primary truncate">{selectedWebsite.name}</h2>
          </div>

          <button
            onClick={() => handleExport(selectedWebsite.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-primary text-on-primary hover:bg-primary/90 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            导出
          </button>
        </div>

        {/* 生成中提示 */}
        {selectedWebsite.status === 'generating' && (
          <div className="flex items-center justify-center gap-3 py-8 text-sm text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>
              正在生成网站
              {generatingProgress
                ? `（${generatingProgress.current}/${generatingProgress.total}：${generatingProgress.page}）`
                : '...'}
            </span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* iframe 预览 */}
        {selectedWebsite.status === 'ready' && (
          <div className="flex-1 relative">
            {previewBaseUrl ? (
              <iframe
                ref={iframeRef}
                src={previewBaseUrl}
                className="w-full h-full border-0"
                title="网站预览"
              />
            ) : previewHtml ? (
              <iframe
                ref={iframeRef}
                srcDoc={previewHtml}
                className="w-full h-full border-0"
                title="网站预览"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-on-surface-variant text-sm">
                加载预览中...
              </div>
            )}
          </div>
        )}

        {/* 失败状态 */}
        {selectedWebsite.status === 'failed' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-on-surface-variant">
            <p className="text-sm">网站生成失败</p>
            <button
              onClick={() => handleDelete(selectedWebsite.id)}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-outline-variant/40 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              删除并重新生成
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 渲染：列表视图
  // ---------------------------------------------------------------------------
  return (
    <div className="p-4 sm:p-6 md:p-8 lg:p-xl max-w-7xl mx-auto space-y-lg animate-in fade-in duration-300 pb-16">

      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-center gap-8 bg-[#1f2937] text-white rounded-[20px] p-8 md:p-12 mb-8 border-transparent">
        <div className="space-y-3 max-w-2xl w-full">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-[#60a5fa]" />
            <span className="text-[14px] font-bold text-[#93c5fd] tracking-wide leading-none">
              AI Web Builder
            </span>
          </div>
          <h1 className="text-[36px] font-bold text-white font-heading tracking-tight leading-tight">
            AI 网页生成与托管
          </h1>
          <p className="text-[16px] text-white/80 leading-relaxed mt-2">
            基于企业知识库数据，一键生成 SEO 优化的多页企业门户网站。支持在线预览和源文件导出。
          </p>
        </div>

        <div className="w-[320px] h-[180px] shrink-0 flex items-center justify-center relative select-none hidden md:flex text-white/80">
          <svg viewBox="0 0 200 120" className="w-full h-full text-current" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="20" y="20" width="160" height="90" rx="8" className="fill-white/5" />
            <path d="M20 40 L180 40" />
            <circle cx="35" cy="30" r="2" fill="currentColor" />
            <circle cx="45" cy="30" r="2" fill="currentColor" />
            <circle cx="55" cy="30" r="2" fill="currentColor" />
            <rect x="40" y="55" width="40" height="40" rx="4" className="fill-white/10" />
            <rect x="90" y="55" width="70" height="8" rx="2" className="fill-white/20" />
            <rect x="90" y="70" width="50" height="4" rx="1" className="fill-white/10" />
            <rect x="90" y="80" width="60" height="4" rx="1" className="fill-white/10" />
            <path d="M140 85 L160 65" strokeWidth="2" strokeDasharray="2 2" className="text-[#60a5fa]" />
            <circle cx="160" cy="65" r="4" fill="#60a5fa" stroke="none" />
            <path d="M160 55 L160 60 M165 65 L170 65 M160 75 L160 70 M150 65 L155 65" className="text-[#93c5fd]" />
          </svg>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">
          {websites.length > 0 ? `共 ${websites.length} 个网站` : '还没有生成过网站'}
        </p>
        <button
          onClick={() => {
            if (!hasEnterprises) {
              alert('请先在知识库中录入企业资料');
              return;
            }
            console.log('[WebBuilder] opening dialog, currentEnterpriseId:', currentEnterpriseId);
            setShowGenerateDialog(true);
          }}
          disabled={generating}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all cursor-pointer',
            generating
              ? 'bg-outline-variant/40 text-on-surface-variant/50 cursor-not-allowed'
              : 'bg-primary text-on-primary hover:bg-primary/90'
          )}
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {generating ? '正在生成...' : '新建网站'}
        </button>
      </div>

      {/* 生成中全局进度 */}
      {generating && generatingProgress && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40">
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-700 dark:text-blue-300">
            正在生成第 {generatingProgress.current}/{generatingProgress.total} 个页面：{generatingProgress.page}
          </span>
        </div>
      )}

      {/* 网站卡片列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : websites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
          <Globe className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm">点击「新建网站」开始生成你的第一个企业门户</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {websites.map((site, idx) => {
              const pageCount = site.site_plan?.pages?.length || 0;
              return (
                <motion.div
                  key={site.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: 10 }}
                  transition={{ duration: 0.15, delay: idx * 0.05 }}
                  className="bg-[#f7f7f5] dark:bg-surface-variant/45 rounded-2xl p-5 flex flex-col justify-between min-h-[170px]"
                >
                  <div>
                    <div className="flex justify-between items-start mb-3">
                      <div className="w-7 h-7 bg-background border border-outline-variant/40 rounded-2xl flex items-center justify-center shrink-0">
                        <Globe className="w-4 h-4 text-primary" />
                      </div>
                      <span className={cn(
                        'text-[12px] font-medium px-2 py-0.5 rounded-full tracking-wide',
                        STATUS_STYLES[site.status] || STATUS_STYLES.pending
                      )}>
                        {site.status === 'generating' && (
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse inline-block mr-1" />
                        )}
                        {STATUS_LABELS[site.status] || site.status}
                      </span>
                    </div>

                    <h3 className="text-[16px] font-bold text-primary line-clamp-1 font-heading">
                      {site.name}
                    </h3>
                    <p className="text-[14px] text-on-surface-variant mt-1.5 leading-relaxed line-clamp-2">
                      {site.site_plan?.tagline || `${pageCount} 个页面 · ${formatDate(site.created_at)}`}
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-outline-variant/20 pt-3 mt-4">
                    <span className="text-[10px] font-mono text-on-surface-variant/60">
                      {pageCount} 页 · {formatDate(site.created_at)}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {site.status === 'ready' && (
                        <button
                          onClick={() => handleSelectWebsite(site)}
                          className="px-3 py-1.5 text-[11px] font-bold rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 bg-primary text-on-primary hover:bg-primary/95"
                        >
                          预览
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                      {site.status === 'generating' && (
                        <button
                          onClick={() => handleSelectWebsite(site)}
                          className="px-3 py-1.5 text-[11px] font-bold rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 bg-blue-500 text-white hover:bg-blue-600"
                        >
                          查看进度
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(site.id)}
                        className="p-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 text-on-surface-variant hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* 生成对话框 */}
      <GenerateDialog
        open={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        onGenerate={handleGenerate}
        loading={generating}
      />
    </div>
  );
}
