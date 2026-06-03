import React, { useEffect, useState } from 'react';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

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
      className="h-8 flex items-center bg-surface-container-lowest dark:bg-[#232323]"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* 左侧：拖拽区域 */}
      <div className="flex-1" />

      {/* 右侧：窗口控制按钮 */}
      <div style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={handleMinimize}
          className="w-[46px] h-[32px] inline-flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" className="fill-black dark:fill-white">
            <rect width="10" height="1" />
          </svg>
        </button>

        <button
          onClick={handleMaximize}
          className="w-[46px] h-[32px] inline-flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
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
          className="w-[46px] h-[32px] inline-flex items-center justify-center hover:bg-[#e81123] transition-colors group"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="stroke-black dark:stroke-white group-hover:stroke-white">
            <line x1="0" y1="0" x2="10" y2="10" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
