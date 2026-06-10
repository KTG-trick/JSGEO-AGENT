import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { LayoutProps } from '../../types';
import { cn } from '../../lib/utils';
import { Menu } from 'lucide-react';

export function Layout({ currentView, onViewChange, children }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-collapse sidebar on smaller screens or high zoom levels
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsCollapsed(true);
      } else {
        setIsCollapsed(false);
      }
    };

    // Run on mount
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="flex-1 bg-background text-on-surface font-sans flex antialiased relative overflow-hidden">
      {/* Dim overlay/backdrop for mobile and tight screens when sidebar is expanded */}
      {!isCollapsed && (
        <div
          className="fixed inset-0 bg-black/35 z-[45] lg:hidden cursor-pointer animate-in fade-in duration-200"
          onClick={() => setIsCollapsed(true)}
          title="点击关闭菜单"
        />
      )}

      <Sidebar
        currentView={currentView}
        onViewChange={onViewChange}
        isCollapsed={isCollapsed}
        onCollapseToggle={() => setIsCollapsed(!isCollapsed)}
      />

      {isCollapsed && (
        <button
          aria-label="展开侧边栏"
          className="fixed left-4 top-[48px] z-[60] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          onClick={() => setIsCollapsed(false)}
          title="展开侧边栏"
          type="button"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      <div className="flex-1 flex flex-col relative w-full overflow-hidden">
        <Header
          currentView={currentView}
          isSidebarCollapsed={isCollapsed}
        />

        <main className={cn(
          "flex-1 overflow-y-auto pb-xl w-full transition-[padding] duration-300 relative",
          isCollapsed ? "md:pl-0" : "md:pl-[240px]"
        )}>
          <div className="relative w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
