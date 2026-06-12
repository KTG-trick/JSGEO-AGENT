import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface PreviewDialogProps {
  articleId: string;
  open: boolean;
  onClose: () => void;
}

function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

const LIGHT = { bg: '#fff', text: '#202020', border: '#e0e0e0', muted: '#666', hover: '#f0f0f0' };
const DARK = { bg: '#1e1e1e', text: '#e0e0e0', border: '#333', muted: '#999', hover: '#2a2a2a' };

export function PreviewDialog({ articleId, open, onClose }: PreviewDialogProps) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(isDarkMode);

  useEffect(() => {
    if (!open || !articleId) return;

    setLoading(true);
    setError(null);

    window.geoAgent.getArticlePreviewHtml(articleId)
      .then((content) => {
        setHtml(content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || '加载预览失败');
        setLoading(false);
      });
  }, [open, articleId]);

  // 监听主题切换
  useEffect(() => {
    if (!open) return;
    setDark(isDarkMode());
    const observer = new MutationObserver(() => setDark(isDarkMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [open]);

  // ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const c = dark ? DARK : LIGHT;

  const dialog = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="relative flex h-[75vh] w-[70vw] max-w-[900px] flex-col rounded-2xl shadow-xl overflow-hidden" style={{ background: c.bg, color: c.text }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: `1px solid ${c.border}` }}>
          <h3 className="flex-1 text-center text-xl font-bold tracking-tight" style={{ color: c.text }}>稿件预览</h3>
          <button
            onClick={onClose}
            className="absolute right-4 rounded-md p-1.5 transition-colors"
            style={{ color: c.muted }}
            onMouseEnter={(e) => { e.currentTarget.style.background = c.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div style={{ color: c.muted }}>加载中...</div>
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center">
              <div style={{ color: '#d32f2f' }}>{error}</div>
            </div>
          )}
          {!loading && !error && html && (
            <iframe
              srcDoc={html}
              className="h-full w-full border-0"
              title="稿件预览"
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
