import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: 'text-error',
      button: 'bg-error text-white hover:bg-error/90',
    },
    warning: {
      icon: 'text-amber-500',
      button: 'bg-amber-500 text-white hover:bg-amber-600',
    },
    info: {
      icon: 'text-primary',
      button: 'bg-primary text-white hover:bg-primary/90',
    },
  };

  const styles = variantStyles[variant];

  const dialog = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-[400px] rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-4">
          <div className={`flex-shrink-0 ${styles.icon}`}>
            <AlertTriangle className="size-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-on-surface">{title}</h3>
            <p className="mt-2 text-sm text-on-surface-variant leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl border border-outline-variant bg-white px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${styles.button}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

// 全局 confirm 状态管理
let globalConfirmState: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'danger' | 'warning' | 'info';
  resolve: (value: boolean) => void;
} | null = null;

let globalConfirmListeners: Array<() => void> = [];

function notifyGlobalConfirmListeners() {
  globalConfirmListeners.forEach((listener) => listener());
}

export function showConfirm(options: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}): Promise<boolean> {
  return new Promise((resolve) => {
    globalConfirmState = {
      open: true,
      title: options.title || '确认操作',
      message: options.message,
      confirmLabel: options.confirmLabel || '确定',
      cancelLabel: options.cancelLabel || '取消',
      variant: options.variant || 'danger',
      resolve,
    };
    notifyGlobalConfirmListeners();
  });
}

export function GlobalConfirmDialog() {
  const [, setUpdate] = useState(0);

  useEffect(() => {
    const listener = () => setUpdate((n) => n + 1);
    globalConfirmListeners.push(listener);
    return () => {
      globalConfirmListeners = globalConfirmListeners.filter((l) => l !== listener);
    };
  }, []);

  const handleConfirm = () => {
    globalConfirmState?.resolve(true);
    globalConfirmState = null;
    setUpdate((n) => n + 1);
  };

  const onCancel = () => {
    globalConfirmState?.resolve(false);
    globalConfirmState = null;
    setUpdate((n) => n + 1);
  };

  return (
    <ConfirmDialog
      open={globalConfirmState?.open ?? false}
      title={globalConfirmState?.title || ''}
      message={globalConfirmState?.message || ''}
      confirmLabel={globalConfirmState?.confirmLabel}
      cancelLabel={globalConfirmState?.cancelLabel}
      variant={globalConfirmState?.variant}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    />
  );
}
