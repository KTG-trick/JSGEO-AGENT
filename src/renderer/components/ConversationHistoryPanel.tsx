/**
 * 对话历史面板组件
 *
 * 功能：
 * - 按时间分组显示（今天、昨天、本周、更早）
 * - 支持搜索过滤
 * - 支持按企业/项目筛选
 * - 显示对话标题/摘要、最后消息预览、时间、消息计数
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Search, MessageSquare, Clock, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';

type ConversationSummary = {
  id: string;
  project_id?: string | null;
  kind: string;
  title: string;
  summary?: string | null;
  message_count: number;
  last_message_preview?: string | null;
  created_at: string;
  updated_at: string;
};

type ConversationHistoryPanelProps = {
  conversations: ConversationSummary[];
  draftConversations?: ConversationSummary[];
  currentConversationId?: string | null;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onNewConversation?: () => void;
  onClose?: () => void;
  className?: string;
};

// 按时间分组
function groupByTime(conversations: ConversationSummary[]): Record<string, ConversationSummary[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<string, ConversationSummary[]> = {
    '今天': [],
    '昨天': [],
    '本周': [],
    '更早': [],
  };

  for (const conv of conversations) {
    const updatedAt = new Date(conv.updated_at);

    if (updatedAt >= today) {
      groups['今天'].push(conv);
    } else if (updatedAt >= yesterday) {
      groups['昨天'].push(conv);
    } else if (updatedAt >= weekAgo) {
      groups['本周'].push(conv);
    } else {
      groups['更早'].push(conv);
    }
  }

  return groups;
}

// 格式化时间
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

export function ConversationHistoryPanel({
  conversations,
  draftConversations = [],
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  onClose,
  className,
}: ConversationHistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 过滤对话
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) ||
        conv.summary?.toLowerCase().includes(query) ||
        conv.last_message_preview?.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  const filteredDraftConversations = useMemo(() => {
    if (!searchQuery.trim()) return draftConversations;

    const query = searchQuery.toLowerCase();
    return draftConversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) ||
        conv.summary?.toLowerCase().includes(query) ||
        conv.last_message_preview?.toLowerCase().includes(query)
    );
  }, [draftConversations, searchQuery]);

  // 按时间分组
  const groupedConversations = useMemo(() => {
    return groupByTime(filteredConversations);
  }, [filteredConversations]);

  // 渲染对话项
  const renderConversationItem = (conv: ConversationSummary) => {
    const isActive = conv.id === currentConversationId;
    const isHovered = conv.id === hoveredId;

    return (
      <div
        key={conv.id}
        className={cn(
          'group relative flex flex-col gap-1 rounded-lg px-3 py-2.5 cursor-pointer transition-colors',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-surface-container/50 text-on-surface'
        )}
        onClick={() => onSelectConversation(conv.id)}
        onMouseEnter={() => setHoveredId(conv.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium truncate">{conv.title}</span>
          <span className="text-[11px] text-on-surface-variant whitespace-nowrap">
            {formatTime(conv.updated_at)}
          </span>
        </div>

        {conv.last_message_preview && (
          <p className="text-[12px] text-on-surface-variant line-clamp-2 leading-relaxed">
            {conv.last_message_preview}
          </p>
        )}

        <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
          <MessageSquare className="w-3 h-3" />
          <span>{conv.message_count} 条消息</span>
        </div>

        {/* 删除按钮 */}
        {isHovered && onDeleteConversation && (
          <button
            className="absolute right-2 bottom-2 p-1 rounded-md hover:bg-destructive/10 text-on-surface-variant hover:text-destructive transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteConversation(conv.id);
            }}
            title="删除对话"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

  // 清空搜索
  const clearSearch = () => setSearchQuery('');

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 头部 */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <h3 className="text-[15px] font-semibold text-on-surface">对话历史</h3>
        <div className="flex items-center gap-1">
          {onNewConversation && (
            <button
              className="p-2 rounded-md hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onNewConversation();
              }}
              title="新建对话"
              type="button"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              className="p-2 rounded-md hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              type="button"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
          <input
            type="text"
            placeholder="搜索对话..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-[13px] rounded-lg border border-outline-variant/50 bg-transparent text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-surface-container text-on-surface-variant"
              onClick={clearSearch}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filteredConversations.length === 0 && filteredDraftConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
            <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-[13px]">
              {searchQuery ? '没有找到匹配的对话' : '暂无对话历史'}
            </p>
          </div>
        ) : (
          <>
            {filteredDraftConversations.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-on-surface-variant" />
                  <span className="text-[12px] font-medium text-on-surface-variant">未归档建库任务</span>
                </div>
                <div className="flex flex-col gap-1">
                  {filteredDraftConversations.map(renderConversationItem)}
                </div>
              </div>
            )}
            {(Object.entries(groupedConversations) as [string, ConversationSummary[]][]).map(([group, convs]) => {
              if (convs.length === 0) return null;

              return (
                <div key={group} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-3.5 h-3.5 text-on-surface-variant" />
                    <span className="text-[12px] font-medium text-on-surface-variant">{group}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {convs.map(renderConversationItem)}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
