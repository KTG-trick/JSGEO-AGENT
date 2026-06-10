import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Globe, Building2, ChevronDown, Check, Trash2 } from 'lucide-react';
import { useEnterprise } from '../../context/EnterpriseContext';
import { cn } from '../../lib/utils';
import { ViewState } from '../../types';
import { showConfirm } from '../ConfirmDialog';

const CURRENT_CONVERSATION_STORAGE_PREFIX = 'geo-agent-current-conversation-id';
const PHASE_TWO_PROMPT_STORAGE_KEY = 'geo-agent-phase-two-prompts-v2';

function conversationStorageKey(projectId?: string | null, conversationId?: string | null) {
  if (conversationId) {
    return `${CURRENT_CONVERSATION_STORAGE_PREFIX}:conv:${conversationId}`;
  }
  return `${CURRENT_CONVERSATION_STORAGE_PREFIX}:${projectId || 'global'}`;
}

function clearConversationStorageById(conversationId: string) {
  if (typeof window === 'undefined') {
    return;
  }
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`${CURRENT_CONVERSATION_STORAGE_PREFIX}:`)) {
      continue;
    }
    if (localStorage.getItem(key) === conversationId) {
      localStorage.removeItem(key);
    }
  }
}

function clearConversationStorage() {
  if (typeof window === 'undefined') {
    return;
  }
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(`${CURRENT_CONVERSATION_STORAGE_PREFIX}:`) || key === PHASE_TWO_PROMPT_STORAGE_KEY) {
      localStorage.removeItem(key);
    }
  }
}

function conversationDisplayTitle(conversation?: GeoAgentConversationSummary | null) {
  return conversation?.display_title || conversation?.summary || conversation?.title || '新对话';
}

function conversationPreview(conversation: GeoAgentConversationSummary) {
  const preview = conversation.display_preview || conversation.last_message_preview || conversation.last_message || null;
  if (!preview) {
    return null;
  }
  return preview === conversationDisplayTitle(conversation) ? null : preview;
}

interface HeaderProps {
  currentView: ViewState;
  isSidebarCollapsed: boolean;
}

export function Header({ currentView, isSidebarCollapsed }: HeaderProps) {
  const { currentEnterprise, hasEnterprises } = useEnterprise();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [publicConversations, setPublicConversations] = useState<GeoAgentConversationSummary[]>([]);
  const [conversations, setConversations] = useState<GeoAgentConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const currentConversationTitle = useMemo(() => {
    if (!currentConversationId) {
      return '新对话';
    }
    const activeConversation = [...publicConversations, ...conversations].find((conversation) => conversation.id === currentConversationId);
    return conversationDisplayTitle(activeConversation) ?? '当前会话';
  }, [currentConversationId, conversations, publicConversations]);

  const groupedConversations = useMemo(() => {
    return groupConversations([...publicConversations, ...conversations]);
  }, [publicConversations, conversations]);
  const currentConversationStorageKey = conversationStorageKey(currentEnterprise?.id);

  const refreshConversations = () => {
    if (currentView !== 'agent') {
      setConversations([]);
      setPublicConversations([]);
      return;
    }
    // 获取公共对话（始终显示）
    if (window.geoAgent?.getPublicConversations) {
      window.geoAgent.getPublicConversations(20)
        .then((response) => setPublicConversations(response.conversations ?? []))
        .catch(() => setPublicConversations([]));
    } else {
      setPublicConversations([]);
    }
    // 获取当前知识库的对话
    if (!hasEnterprises) {
      setConversations([]);
      return;
    }
    if (window.geoAgent?.getConversations) {
      window.geoAgent.getConversations(currentEnterprise.id, 40)
        .then((response) => setConversations(response.conversations ?? []))
        .catch(() => setConversations([]));
    } else {
      setConversations([]);
    }
  };

  useEffect(() => {
    refreshConversations();
  }, [currentView, currentEnterprise.id, hasEnterprises]);

  useEffect(() => {
    setCurrentConversationId(localStorage.getItem(currentConversationStorageKey));
  }, [currentConversationStorageKey]);

  useEffect(() => {
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string | null }>).detail;
      const nextId = detail?.id ?? null;
      setCurrentConversationId(nextId);
      if (nextId) {
        localStorage.setItem(currentConversationStorageKey, nextId);
      } else {
        localStorage.removeItem(currentConversationStorageKey);
      }
      refreshConversations();
    };
    const handleRefresh = () => refreshConversations();
    const handleCleared = () => {
      clearConversationStorage();
      setCurrentConversationId(null);
      setConversations([]);
      refreshConversations();
    };
    window.addEventListener('geo-agent-conversation-changed', handleChanged);
    window.addEventListener('geo-agent-conversations-refresh', handleRefresh);
    window.addEventListener('geo-agent-conversations-cleared', handleCleared);
    return () => {
      window.removeEventListener('geo-agent-conversation-changed', handleChanged);
      window.removeEventListener('geo-agent-conversations-refresh', handleRefresh);
      window.removeEventListener('geo-agent-conversations-cleared', handleCleared);
    };
  }, [currentEnterprise.id, currentView, hasEnterprises]);

  useEffect(() => {
    const closeHistory = (event: PointerEvent | FocusEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) {
        setIsHistoryOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeHistory);
    document.addEventListener('focusin', closeHistory);
    return () => {
      document.removeEventListener('pointerdown', closeHistory);
      document.removeEventListener('focusin', closeHistory);
    };
  }, []);

  const openConversation = (conversationId: string) => {
    window.dispatchEvent(new CustomEvent('geo-agent-open-conversation', { detail: { id: conversationId } }));
    setIsHistoryOpen(false);
  };

  const startNewConversation = () => {
    if (currentConversationId && window.geoAgent?.touchConversationSummary) {
      window.geoAgent.touchConversationSummary(currentConversationId, 'new_conversation')
        .then(() => refreshConversations())
        .catch(() => undefined);
    }
    window.dispatchEvent(new CustomEvent('geo-agent-new-conversation'));
    setCurrentConversationId(null);
    localStorage.removeItem(currentConversationStorageKey);
    setIsHistoryOpen(false);
  };

  const deleteConversation = async (conversationId: string, title: string) => {
    if (!window.geoAgent?.deleteConversation) {
      return;
    }
    const confirmed = await showConfirm({
      title: '确认删除对话',
      message: `确定删除「${title}」这条对话记录吗？`,
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.geoAgent.deleteConversation(conversationId);
      clearConversationStorageById(conversationId);
      setConversations((items) => items.filter((conversation) => conversation.id !== conversationId));
      window.dispatchEvent(new CustomEvent('geo-agent-conversation-deleted', { detail: { id: conversationId } }));
      if (currentConversationId === conversationId) {
        setCurrentConversationId(null);
        localStorage.removeItem(currentConversationStorageKey);
      } else {
        window.dispatchEvent(new CustomEvent('geo-agent-conversations-refresh'));
      }
    } catch (error) {
      clearConversationStorageById(conversationId);
      window.dispatchEvent(new CustomEvent('geo-agent-conversation-deleted', { detail: { id: conversationId } }));
      console.error('Failed to delete conversation', error);
    }
  };

  if (currentView !== 'agent') {
    return null;
  }

  return (
    <header className={cn(
      "fixed top-[40px] w-full h-8 z-40 flex items-center px-6 transition-[padding] duration-300",
      isSidebarCollapsed ? "md:pl-4" : "md:pl-[240px]"
    )}>
      {/* 顶部栏已清空 */}
    </header>
  );
}

const parseConversationDate = (value: string) => {
  if (!value) {
    return null;
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const groupConversations = (items: GeoAgentConversationSummary[]) => {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfPreviousWeek = new Date(startOfToday);
  startOfPreviousWeek.setDate(startOfPreviousWeek.getDate() - 7);

  // 公共对话分组
  const publicItems = items.filter((c) => !c.project_id);
  const publicGeoItems = publicItems.filter((c) => c.kind === 'geo_workflow');
  const publicChatItems = publicItems.filter((c) => c.kind !== 'geo_workflow');

  // 知识库对话分组
  const kbItems = items.filter((c) => !!c.project_id);
  const kbGeoItems = kbItems.filter((c) => c.kind === 'geo_workflow');
  const kbChatItems = kbItems.filter((c) => c.kind !== 'geo_workflow');

  const groupByDate = (convs: GeoAgentConversationSummary[]) => {
    const labels = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier'];
    const byLabel = new Map(labels.map((label) => [label, [] as GeoAgentConversationSummary[]]));
    convs.forEach((conversation) => {
      const date = parseConversationDate(conversation.updated_at);
      if (!date || date < startOfPreviousWeek) {
        byLabel.get('Earlier')?.push(conversation);
      } else if (date >= startOfToday) {
        byLabel.get('Today')?.push(conversation);
      } else if (date >= startOfYesterday) {
        byLabel.get('Yesterday')?.push(conversation);
      } else {
        byLabel.get('Previous 7 days')?.push(conversation);
      }
    });
    return labels
      .map((label) => ({ label, items: byLabel.get(label) ?? [] }))
      .filter((group) => group.items.length > 0);
  };

  const result: Array<{ label: string; isPublic?: boolean; isGeo?: boolean; items: GeoAgentConversationSummary[] }> = [];

  // 公共对话
  if (publicChatItems.length > 0) {
    const grouped = groupByDate(publicChatItems);
    grouped.forEach((g) => result.push({ label: `公共对话 · ${g.label}`, isPublic: true, isGeo: false, items: g.items }));
  }
  if (publicGeoItems.length > 0) {
    const grouped = groupByDate(publicGeoItems);
    grouped.forEach((g) => result.push({ label: `公共流程 · ${g.label}`, isPublic: true, isGeo: true, items: g.items }));
  }

  // 知识库对话
  if (kbChatItems.length > 0) {
    const grouped = groupByDate(kbChatItems);
    grouped.forEach((g) => result.push({ label: g.label, isGeo: false, items: g.items }));
  }
  if (kbGeoItems.length > 0) {
    const grouped = groupByDate(kbGeoItems);
    grouped.forEach((g) => result.push({ label: g.label, isGeo: true, items: g.items }));
  }

  return result;
};
