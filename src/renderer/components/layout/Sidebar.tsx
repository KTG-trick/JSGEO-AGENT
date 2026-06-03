import React from 'react';
import { ViewState } from '../../types';
import { cn } from '../../lib/utils';
import { 
  LayoutDashboard, 
  Bot, 
  Library, 
  FileText, 
  FolderOpen, 
  GraduationCap,
  HelpCircle,
  Headset,
  ChevronLeft,
  Globe
} from 'lucide-react';

interface SidebarProps {
  currentView: ViewState;
  onViewChange: (view: ViewState) => void;
  isCollapsed: boolean;
  onCollapseToggle: () => void;
}

const navItems = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'agent', label: '智能助手', icon: Bot },
  { id: 'knowledge', label: '知识库', icon: Library },
  { id: 'drafts', label: '稿件管理', icon: FileText },
  { id: 'projects', label: '项目管理', icon: FolderOpen },
  { id: 'learning', label: '自动学习', icon: GraduationCap },
  { id: 'marketplace', label: 'AI网页构建', icon: Globe },
] as const;

export function Sidebar({ currentView, onViewChange, isCollapsed, onCollapseToggle }: SidebarProps) {
  return (
    <nav className={cn(
      "fixed left-0 top-[32px] h-[calc(100%-32px)] w-[240px] z-50 bg-surface-container-low border-r border-outline-variant/60 flex flex-col transition-all duration-300 ease-in-out",
      isCollapsed ? "-translate-x-full md:pointer-events-none" : "translate-x-0"
    )}>
      <div className="px-5 h-[64px] flex items-center justify-between shrink-0 border-b border-outline-variant/10">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-sm bg-primary/10 text-primary flex-shrink-0 flex items-center justify-center">
             <Bot className="w-4 h-4" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-primary leading-none whitespace-nowrap">
            鲸杉 GEO
          </span>
        </div>
        <button
          onClick={onCollapseToggle}
          className="p-1 rounded text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
          title="收起侧边栏"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-3 mt-1">
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = currentView === id;
          return (
            <button
              key={id}
              onClick={() => onViewChange(id as ViewState)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 w-full rounded-sm transition-all text-[13px] font-medium text-left",
                isActive 
                  ? "text-primary bg-surface-container/85 font-semibold"
                  : "text-on-surface-variant hover:text-primary hover:bg-surface-container/40"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      
      <div className="mt-auto flex flex-col gap-0.5 px-3 pb-6">
        <button className="flex items-center gap-2.5 text-on-surface-variant hover:text-primary px-3 py-2 transition-all text-[12px] font-medium rounded-sm hover:bg-surface-container/40 text-left">
          <HelpCircle className="w-4 h-4 shrink-0" />
          <span>帮助</span>
        </button>
        <button className="flex items-center gap-2.5 text-on-surface-variant hover:text-primary px-3 py-2 transition-all text-[12px] font-medium rounded-sm hover:bg-surface-container/40 text-left">
          <Headset className="w-4 h-4 shrink-0" />
          <span>支持</span>
        </button>
      </div>
    </nav>
  );
}
