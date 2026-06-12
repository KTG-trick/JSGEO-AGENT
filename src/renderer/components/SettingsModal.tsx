import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Key, Loader2, Save, X } from 'lucide-react';
import { cn } from '../lib/utils';

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

const SETTINGS_KEYS = [
  { key: 'ARK_API_KEY', label: '豆包 API Key', placeholder: 'ark-...' },
  { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key', placeholder: 'sk-...' },
];

const AUTO_PUBLISH_KEYS = [
  { key: 'AUTO_PUBLISH_MAX_PRICE', label: '单篇价格上限（元）', placeholder: '10', type: 'number' },
];

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    window.geoAgent?.getSettings?.().then((settings) => {
      setValues(settings || {});
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });
  }, [open]);

  const updateValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (!window.geoAgent?.saveSettings) return;
    setIsSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await window.geoAgent.saveSettings(values);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full min-w-[480px] max-w-xl shrink-0 rounded-xl bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[16px] font-bold text-primary">
            <Key className="size-4" />
            应用设置
          </h3>
          <button
            className="rounded-md p-2 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-on-surface-variant">
            <Loader2 className="size-4 animate-spin" />
            正在加载设置
          </div>
        ) : (
          <div className="space-y-5">
            {/* API 配置 */}
            <div>
              <h4 className="mb-3 text-[13px] font-bold text-primary">API 配置</h4>
              <div className="space-y-3">
                {SETTINGS_KEYS.map(({ key, label, placeholder }) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-[12px] font-bold text-on-surface-variant">{label}</span>
                    <div className="relative">
                      <input
                        className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 pr-10 font-mono text-[13px] outline-none focus:border-secondary"
                        placeholder={placeholder}
                        type={visibleKeys[key] ? 'text' : 'password'}
                        value={text(values[key])}
                        onChange={(e) => updateValue(key, e.target.value)}
                      />
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-on-surface-variant transition-colors hover:text-primary"
                        onClick={() => setVisibleKeys((prev) => ({ ...prev, [key]: !prev[key] }))}
                        type="button"
                        tabIndex={-1}
                      >
                        {visibleKeys[key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* 自动发稿 */}
            <div>
              <h4 className="mb-3 text-[13px] font-bold text-primary">自动发稿</h4>
              <div className="space-y-3">
                {AUTO_PUBLISH_KEYS.map(({ key, label, placeholder, type }) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-[12px] font-bold text-on-surface-variant">{label}</span>
                    <input
                      className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-[13px] outline-none focus:border-secondary"
                      placeholder={placeholder}
                      type={type || 'text'}
                      value={text(values[key])}
                      onChange={(e) => updateValue(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                设置已保存
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                className="rounded-md px-4 py-2 text-[12px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container"
                onClick={onClose}
                type="button"
              >
                取消
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-[12px] font-bold text-on-secondary transition-all hover:bg-secondary/90 disabled:opacity-50"
                disabled={isSaving}
                onClick={save}
                type="button"
              >
                {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                {isSaving ? '保存中' : '保存设置'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
