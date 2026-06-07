import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface PreviewDialogProps {
  articleId: string;
  open: boolean;
  onClose: () => void;
}

export function PreviewDialog({ articleId, open, onClose }: PreviewDialogProps) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const dialog = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="relative flex h-[75vh] w-[70vw] max-w-[900px] flex-col rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant/50 px-6 py-4">
          <h3 className="flex-1 text-center text-xl font-bold tracking-tight text-on-surface">稿件预览</h3>
          <button
            onClick={onClose}
            className="absolute right-4 rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div className="text-on-surface-variant">加载中...</div>
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center">
              <div className="text-error">{error}</div>
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
