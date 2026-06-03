import React, { useEffect, useState } from 'react';
import { Settings, Sun, Moon, Bell, Globe, Building2, ChevronDown } from 'lucide-react';
import { useEnterprise } from '../../context/EnterpriseContext';
import { cn } from '../../lib/utils';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  });
  const { currentEnterpriseId, currentEnterprise, setEnterpriseId, enterprises, isLoadingEnterprises } = useEnterprise();
  const [isEnterpriseOpen, setIsEnterpriseOpen] = useState(false);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    window.geoAgent?.windowIsMaximized().then(setIsMaximized);
    window.geoAgent?.onWindowMaximizedChanged((maximized: boolean) => {
      setIsMaximized(maximized);
    });
  }, []);

  const handleMinimize = () => window.geoAgent?.windowMinimize();
  const handleMaximize = () => window.geoAgent?.windowMaximize();
  const handleClose = () => window.geoAgent?.windowClose();

  return (
    <div
      className="h-10 flex items-center bg-surface-container-lowest dark:bg-[#232323]"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* 左侧：窗口控制按钮 */}
      <div style={{ WebkitAppRegion: 'no-drag' }} className="flex">
        <button
          onClick={handleMinimize}
          className="w-[46px] h-9 inline-flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" className="fill-black dark:fill-white">
            <rect width="10" height="1" />
          </svg>
        </button>

        <button
          onClick={handleMaximize}
          className="w-[46px] h-9 inline-flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="2" y="0" width="8" height="8" fill="none" className="stroke-black dark:stroke-white" strokeWidth="1" />
              <rect x="0" y="2" width="8" height="8" className="fill-white dark:fill-[#232323] stroke-black dark:stroke-white" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0" y="0" width="10" height="10" fill="none" className="stroke-black dark:stroke-white" strokeWidth="1" />
            </svg>
          )}
        </button>

        <button
          onClick={handleClose}
          className="w-[46px] h-9 inline-flex items-center justify-center hover:bg-[#e81123] transition-colors group"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="stroke-black dark:stroke-white group-hover:stroke-white">
            <line x1="0" y1="0" x2="10" y2="10" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" strokeWidth="1" />
          </svg>
        </button>
      </div>

      {/* 中间：拖拽区域 */}
      <div className="flex-1" />

      {/* 右侧：功能菜单 */}
      <div style={{ WebkitAppRegion: 'no-drag' }} className="flex items-center gap-0.5 px-2">
        {/* 企业选择器 */}
        <div className="relative">
          <button
            onClick={() => setIsEnterpriseOpen(!isEnterpriseOpen)}
            className="h-7 flex items-center gap-1 px-1.5 rounded text-on-surface hover:text-primary hover:bg-surface-container-low transition-colors"
            title={isLoadingEnterprises ? '加载企业中...' : currentEnterprise.name}
          >
            <Building2 className="w-4 h-4" />
            <span className="text-[11px] font-bold max-w-[80px] truncate leading-none">
              {isLoadingEnterprises ? '加载...' : currentEnterprise.name}
            </span>
            <ChevronDown className={cn("w-3 h-3 transition-transform", isEnterpriseOpen && "rotate-180")} />
          </button>
          {isEnterpriseOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsEnterpriseOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-[260px] bg-surface-container-lowest border border-outline-variant/60 rounded-xl shadow-lg z-50 p-2 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2 border-b border-outline-variant/20 mb-1.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest block">
                    切换项目信源与知识库
                  </span>
                </div>
                <div className="space-y-1">
                  {enterprises.length > 0 ? enterprises.map((ent) => {
                    const isSelected = ent.id === currentEnterpriseId;
                    return (
                      <button
                        key={ent.id}
                        onClick={() => {
                          setEnterpriseId(ent.id);
                          setIsEnterpriseOpen(false);
                        }}
                        className={cn(
                          "w-full text-left p-2 rounded-lg transition-all flex items-start gap-3",
                          isSelected
                            ? "bg-secondary/10 border-transparent text-secondary"
                            : "hover:bg-surface-container-low border border-transparent text-primary"
                        )}
                      >
                        <div className={cn(
                          "w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                          isSelected ? "bg-secondary/20 text-secondary" : "bg-surface-container-low text-on-surface-variant/80"
                        )}>
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0 flex items-center justify-between">
                          <div>
                            <span className={cn("text-[13px] font-bold block truncate", isSelected && "font-extrabold")}>
                              {ent.name}
                            </span>
                            <span className="text-[11px] text-on-surface-variant block truncate mt-0.5 leading-none">
                              {ent.industry}
                            </span>
                          </div>
                          {isSelected && (
                            <span className="w-2 h-2 bg-secondary rounded-full shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="px-3 py-8 text-center text-[13px] leading-relaxed text-on-surface-variant">
                      暂无可优化企业。请先在知识库模块建立企业知识库。
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 语言 */}
        <button
          className="h-7 w-7 flex items-center justify-center rounded text-on-surface hover:text-primary hover:bg-surface-container-low transition-colors"
          title="Language"
        >
          <Globe className="w-[18px] h-[18px]" />
        </button>

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          className="h-7 w-7 flex items-center justify-center rounded text-on-surface hover:text-primary hover:bg-surface-container-low transition-colors"
          title={theme === 'light' ? '切换至深色主题' : '切换至浅色主题'}
        >
          {theme === 'light' ? (
            <Moon className="w-[18px] h-[18px]" />
          ) : (
            <Sun className="w-[18px] h-[18px]" />
          )}
        </button>

        {/* 通知 */}
        <button
          className="h-7 w-7 flex items-center justify-center rounded text-on-surface hover:text-primary hover:bg-surface-container-low transition-colors relative"
          title="Notifications"
        >
          <Bell className="w-[18px] h-[18px]" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-secondary rounded-full" />
        </button>

        {/* 设置 */}
        <button
          className="h-7 w-7 flex items-center justify-center rounded text-on-surface hover:text-primary hover:bg-surface-container-low transition-colors mr-1"
          title="Settings"
        >
          <Settings className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
