import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Compass,
  Database,
  FileText,
  Globe,
  GraduationCap,
  Info,
  Library,
  Mic,
  Plus,
  Search,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '../components/ai-elements/confirmation';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from '../components/ai-elements/chain-of-thought';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../components/ai-elements/conversation';
import {
  Message,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '../components/ai-elements/message';
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  usePromptInputAttachments,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../components/ai-elements/prompt-input';
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '../components/ai-elements/queue';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '../components/ai-elements/reasoning';
import { Shimmer } from '../components/ai-elements/shimmer';
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from '../components/ai-elements/task';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '../components/ai-elements/sources';
import { Suggestion, Suggestions } from '../components/ai-elements/suggestion';
import { cn } from '../lib/utils';
import { profileFieldText, toProfileEvidenceField } from '../lib/profileFields';
import { PROFILE_FIELD_DEFINITIONS } from '../lib/profileSchema';
import { TooltipProvider } from '../components/ui/tooltip';
import { useEnterprise } from '../context/EnterpriseContext';

type SourceCitation = GeoAgentSourceCitation;
type SearchAction = GeoAgentSearchAction;
type SearchUsage = GeoAgentSearchUsage;
type PromptAttachment = {
  filename?: string;
  mediaType?: string;
  url?: string;
  type?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  reasoningContent?: string;
  reasoningSteps?: Array<{ label: string; detail?: string; status: 'active' | 'complete' | 'pending' }>;
  modelDebugLines?: string[];
  draftStreamSections?: Partial<Record<string, number>>;
  sources?: SourceCitation[];
  searchQueries?: string[];
  searchActions?: SearchAction[];
  searchUsage?: SearchUsage;
  liveSearchSteps?: Array<{ query: string; status: 'in_progress' | 'completed' }>;
  knowledgeDraft?: GeoAgentKnowledgeDraft;
  phaseTwoPrompt?: GeoAgentGeoProject;
  phaseTwoPlatform?: 'doubao' | 'deepseek';
  phaseTwoExecution?: {
    platform: 'doubao' | 'deepseek';
    companyName: string;
    activeStep: number;
  };
  geoReport?: GeoAgentGeoReport;
  sourceDiscoveryExecution?: {
    platform: 'doubao' | 'deepseek';
    activeStep: number;
  };
  sourceDiscovery?: GeoAgentGeoSourceDiscovery;
  sourceDiscoveryAttempted?: boolean;
  articleDraftExecution?: {
    platform: 'doubao' | 'deepseek';
    articleType?: 'consulting' | 'review';
    activeStep: number;
  };
  articleDraft?: GeoAgentGeoArticleDraft;
  supportArticles?: GeoAgentGeoSupportArticleRunResponse;
  supportArticlesPrompt?: GeoAgentGeoSourceDiscovery;
  articleDraftAttempts?: Partial<Record<'consulting' | 'review', boolean>>;
  confirmationState?: 'approval-requested' | 'approval-responded' | 'output-available';
  confirmationApproved?: boolean;
  status?: 'streaming' | 'complete' | 'error';
  provider?: string;
  model?: string;
  error?: string | null;
  actionBusy?: boolean;
  progressiveDraftGroups?: number;
  geoProjectId?: string;
};

type ConfigStatus = Awaited<ReturnType<NonNullable<Window['geoAgent']>['getConfigStatus']>>;
const AUTO_PLATFORM: 'doubao' = 'doubao';

const DEFAULT_INPUT_PLACEHOLDER = '输入 GEO 任务，例如：为成都行乐音改建立企业知识库...';
const CURRENT_CONVERSATION_STORAGE_PREFIX = 'geo-agent-current-conversation-id';
const PHASE_TWO_PROMPT_STORAGE_KEY = 'geo-agent-phase-two-prompts-v2';
const CONVERSATION_HISTORY_RESET_KEY = 'geo-agent-conversation-history-reset-v2';
const KNOWLEDGE_DRAFT_MESSAGE_MARKER = '__GEO_KNOWLEDGE_DRAFT__';
const KNOWLEDGE_ATTACHMENT_ACCEPT = [
  '.md',
  '.markdown',
  '.txt',
  '.pdf',
  '.doc',
  '.docx',
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');
const DRAFT_PROFILE_NAME = '企业知识库草稿';
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const TYPEWRITER_CHUNK_SIZE = 3;
const TYPEWRITER_DELAY = 14;

async function typeMessageText(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  id: string,
  text: string,
  field: 'content' | 'reasoningContent' = 'content'
) {
  if (!text) {
    return;
  }

  for (let index = 0; index < text.length; index += TYPEWRITER_CHUNK_SIZE) {
    const chunk = text.slice(index, index + TYPEWRITER_CHUNK_SIZE);
    setMessages((current) => appendMessageText(current, id, chunk, field));
    await wait(TYPEWRITER_DELAY);
  }
}

function enqueueTypewriterTask(
  queues: React.MutableRefObject<Record<string, Promise<void>>>,
  id: string,
  task: () => Promise<void> | void
) {
  const previous = queues.current[id] ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.current[id] = next.catch(() => undefined);
  return next;
}

type ProfileFieldDefinition = {
  key: keyof GeoAgentEnterpriseProfileInput;
  label: string;
  group: string;
};

const profileFieldDefinitions = PROFILE_FIELD_DEFINITIONS as ProfileFieldDefinition[];
const PROFILE_SUMMARY_FIELDS = profileFieldDefinitions.map((field) => [field.key, field.label] as [keyof GeoAgentEnterpriseProfile, string]);
const PLACEHOLDER_PROFILE_VALUES = new Set(['', '待补充', '未填', '未填写', DRAFT_PROFILE_NAME, '待确认企业名称', '待确认企业知识库', '企业知识库草稿', '待录入企业']);

function phaseTwoPromptKey(projectId: string, conversationId: string | null, platform: 'doubao' | 'deepseek') {
  return `${projectId}:${platform}`;
}

function stageRunKey(geoProjectId: string | null | undefined, platform: 'doubao' | 'deepseek', phase: 2 | 3 | 4) {
  return `${geoProjectId || 'unknown'}:${platform}:phase-${phase}`;
}

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

function migrateGlobalConversationStorage(projectId: string, conversationId: string) {
  if (typeof window === 'undefined' || !projectId || !conversationId) {
    return;
  }
  const globalKey = conversationStorageKey(null);
  if (localStorage.getItem(globalKey) === conversationId) {
    localStorage.removeItem(globalKey);
  }
  localStorage.setItem(conversationStorageKey(projectId), conversationId);
  localStorage.setItem(conversationStorageKey(projectId, conversationId), conversationId);
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

function readPhaseTwoPromptKeys(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PHASE_TWO_PROMPT_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function rememberPhaseTwoPromptKey(key: string) {
  const keys = new Set(readPhaseTwoPromptKeys());
  keys.add(key);
  localStorage.setItem(PHASE_TWO_PROMPT_STORAGE_KEY, JSON.stringify(Array.from(keys).slice(-100)));
}

const DRAFT_PREVIEW_GROUPS: Array<{
  title: string;
  fields: Array<[keyof GeoAgentEnterpriseProfileInput, string]>;
}> = ['基础身份', '服务与品牌', '信任与案例', '补充资料'].map((title) => ({
  title,
  fields: profileFieldDefinitions
    .filter((field) => field.group === title)
    .map((field) => [field.key, field.label]),
}));

function getSkillPlaceholder(skill: GeoAgentSkill | null) {
  if (!skill) {
    return DEFAULT_INPUT_PLACEHOLDER;
  }
  if (skill.id === 'knowledge-base-ingest' || skill.name.includes('知识库')) {
    return '请上传或粘贴企业资料：公司介绍、产品服务、用户痛点、信任背书、案例、业务区域、目标关键词...';
  }
  return `描述你想让「${skill.name}」帮你完成的任务，或直接发送开始。`;
}

function updateMessage(
  messages: ChatMessage[],
  id: string,
  patch: Partial<ChatMessage> | ((message: ChatMessage) => ChatMessage)
) {
  return messages.map((message) => {
    if (message.id !== id) {
      return message;
    }
    return typeof patch === 'function' ? patch(message) : { ...message, ...patch };
  });
}

function upsertMessage(messages: ChatMessage[], message: ChatMessage) {
  const existing = messages.some((item) => item.id === message.id);
  return existing ? updateMessage(messages, message.id, message) : [...messages, message];
}

function replaceMessageId(messages: ChatMessage[], previousId: string, nextMessage: ChatMessage) {
  const withoutNext = messages.filter((item) => item.id !== nextMessage.id);
  const replaced = withoutNext.map((item) => item.id === previousId ? nextMessage : item);
  return replaced.some((item) => item.id === nextMessage.id) ? replaced : [...replaced, nextMessage];
}

function appendMessageIfMissing(messages: ChatMessage[], message: ChatMessage) {
  return messages.some((item) => item.id === message.id) ? messages : [...messages, message];
}

function mergeReasoningStep(messages: ChatMessage[], id: string, step: { label: string; detail?: string; status: 'active' | 'complete' | 'pending' }) {
  return updateMessage(messages, id, (message) => {
    const steps = message.reasoningSteps ?? [];
    const existingIndex = steps.findIndex((item) => item.label === step.label && item.detail === step.detail);
    const nextSteps = existingIndex >= 0
      ? steps.map((item, index) => index === existingIndex ? { ...item, ...step } : item)
      : [...steps.map((item) => item.status === 'active' ? { ...item, status: 'complete' as const } : item), step];
    return {
      ...message,
      reasoningSteps: nextSteps,
    };
  });
}

function appendMessageText(
  messages: ChatMessage[],
  id: string,
  text: string,
  field: 'content' | 'reasoningContent' = 'content'
) {
  return updateMessage(messages, id, (message) => ({
    ...message,
    [field]: `${message[field] ?? ''}${text}`,
    status: 'streaming',
  }));
}

function buildAssistantReasoning(
  provider?: string,
  model?: string,
  options?: { deepThinking?: boolean; webSearch?: boolean; dispatcher?: boolean; error?: boolean }
) {
  if (options?.error) {
    return `${provider || '模型'} / ${model || 'unknown'} 请求返回错误。请检查 .env、模型名称、base_url 或重启桌面端。`;
  }
  if (options?.dispatcher) {
    return `${provider || 'local'} / ${model || 'dispatcher'} 已完成本地请求。本次由调度模型负责解析与归档。`;
  }
  return `${provider || 'local'} / ${model || 'unknown'} 已完成本地请求。深度思考：${options?.deepThinking ? '开启' : '关闭'}；联网搜索：${options?.webSearch ? '开启' : '不可用或关闭'}。`;
}

function getNextWorkflowAction(
  workflowState: GeoAgentWorkflowState | null,
  message: ChatMessage,
  runningStageKeys: Set<string>
): { type: 'source_discovery' | 'support_articles' | 'stage_five_waiting'; label: string; primaryLabel: string } | null {
  const platform = getMessagePlatform(message);
  const platformWorkflow = platform ? workflowState?.platforms[platform] : undefined;
  const stageThreeStatus = platformWorkflow?.stages.stage_3?.status;
  const stageFourStatus = platformWorkflow?.stages.stage_4?.status;
  const stageFiveStatus = platformWorkflow?.stages.stage_5?.status;
  const phaseThreeBlocked = platform && runningStageKeys.has(stageRunKey(message.geoReport?.geo_project_id, platform, 3));
  const phaseFourBlocked = platform && runningStageKeys.has(stageRunKey(message.sourceDiscovery?.geo_project_id, platform, 4));

  if (
    message.geoReport?.status === 'completed'
    && !message.sourceDiscovery
    && !message.sourceDiscoveryExecution
    && !message.sourceDiscoveryAttempted
    && !phaseThreeBlocked
    && (!stageThreeStatus || stageThreeStatus === 'ready')
  ) {
    return {
      type: 'source_discovery',
      label: '建议继续执行：阶段三高权重信源发现',
      primaryLabel: '发现高权重信源',
    };
  }

  if (
    message.sourceDiscovery
    && message.sourceDiscovery.discovery.status !== 'failed'
    && !message.articleDraftExecution
    && !message.supportArticles
    && !message.supportArticlesPrompt
    && !phaseFourBlocked
    && (!stageFourStatus || stageFourStatus === 'ready')
  ) {
    return {
      type: 'support_articles',
      label: '建议继续执行：阶段四首轮 9 篇内容资产',
      primaryLabel: '生成 9 篇内容资产',
    };
  }

  const consultingConfirmed = message.supportArticles?.consulting_draft?.status === 'confirmed';
  const reviewConfirmed = message.supportArticles?.review_draft?.status === 'confirmed';
  if (message.supportArticles && (stageFiveStatus ? stageFiveStatus === 'ready' : consultingConfirmed && reviewConfirmed)) {
    return {
      type: 'stage_five_waiting',
      label: '阶段四内容资产已生成，可前往稿件管理页校对、生成 OSS 预览并投递。',
      primaryLabel: '前往稿件管理',
    };
  }

  return null;
}

function getMessagePlatform(message: ChatMessage): 'doubao' | 'deepseek' | null {
  const platform = message.phaseTwoPlatform
    ?? (message.geoReport?.platform === 'deepseek' ? 'deepseek' : message.geoReport?.platform === 'doubao' ? 'doubao' : undefined)
    ?? (message.sourceDiscovery?.platform === 'deepseek' ? 'deepseek' : message.sourceDiscovery?.platform === 'doubao' ? 'doubao' : undefined)
    ?? (message.supportArticles?.platform === 'deepseek' ? 'deepseek' : message.supportArticles?.platform === 'doubao' ? 'doubao' : undefined);
  return platform ?? null;
}

function hasPhaseTwoMessageFor(
  messages: ChatMessage[],
  project: GeoAgentGeoProject,
  platform: 'doubao' | 'deepseek'
) {
  return messages.some((message) => {
    if (getMessagePlatform(message) !== platform) {
      return false;
    }
    return message.phaseTwoPrompt?.id === project.id || message.geoReport?.geo_project_id === project.id;
  });
}

function normalizeRestoredWorkflowMessages(messages: ChatMessage[]) {
  const completedPlatforms = new Set(
    messages
      .filter((message) => message.geoReport || message.sourceDiscovery || message.supportArticles)
      .map((message) => getMessagePlatform(message))
      .filter((platform): platform is 'doubao' | 'deepseek' => Boolean(platform))
  );

  if (completedPlatforms.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    const platform = getMessagePlatform(message);
    if (!message.phaseTwoPrompt || !platform || !completedPlatforms.has(platform)) {
      return message;
    }
    return {
      ...message,
      phaseTwoPrompt: undefined,
      confirmationState: 'output-available' as const,
      confirmationApproved: true,
    };
  });
}

function collectRunningStageKeys(messages: ChatMessage[]) {
  const keys = new Set<string>();
  messages.forEach((message) => {
    const platform = getMessagePlatform(message);
    if (!platform) {
      return;
    }
    if (message.phaseTwoExecution || message.geoReport) {
      keys.add(stageRunKey(message.geoReport?.geo_project_id ?? message.geoProjectId, platform, 2));
    }
    if (message.sourceDiscoveryExecution || message.sourceDiscovery) {
      keys.add(stageRunKey(message.sourceDiscovery?.geo_project_id ?? message.geoReport?.geo_project_id ?? message.geoProjectId, platform, 3));
    }
    if (message.articleDraftExecution || message.supportArticles) {
      const supportGeoProjectId = (message.supportArticles as { geo_project_id?: string } | undefined)?.geo_project_id;
      keys.add(stageRunKey(supportGeoProjectId ?? message.sourceDiscovery?.geo_project_id ?? message.geoProjectId, platform, 4));
    }
  });
  return keys;
}

function isValidGeoProject(value: unknown): value is GeoAgentGeoProject {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const project = value as Partial<GeoAgentGeoProject>;
  return typeof project.id === 'string' && typeof project.project_id === 'string';
}

function dataUrlToBase64(url: string) {
  return url.includes(',') ? url.split(',', 2)[1] : url;
}

async function filePartToKnowledgeAsset(file: PromptAttachment) {
  if (!file.url) {
    throw new Error(`${file.filename ?? '附件'} 读取失败，请重新选择文件。`);
  }
  const url = file.url.startsWith('blob:')
    ? await fetch(file.url)
      .then((response) => response.blob())
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('文件读取失败。'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(blob);
      }))
    : file.url;
  return {
    filename: file.filename || '未命名附件',
    content_type: file.mediaType || null,
    content_base64: dataUrlToBase64(url),
  };
}

function normalizeChatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('No handler registered') && message.includes('create-knowledge-asset')) {
    return '知识库附件上传接口已更新，请完全关闭并重新启动 Electron 桌面端后再上传附件。';
  }
  if (message.includes('No handler registered')) {
    return '桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再试。';
  }
  return error instanceof Error ? error.message : '本地后端连接失败，请稍后重试。';
}

function slugifyProjectId(value: string) {
  const normalized = value
    .trim()
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'enterprise';
}

function inferKnowledgeIntent(text: string, hasFiles: boolean, isKnowledgeSkill: boolean) {
  const normalized = text.toLowerCase();
  const wantsNew = isKnowledgeSkill
    || /新建|创建|建立|录入|新增|另建|从零/.test(text)
    || (hasFiles && /知识库|企业资料|公司资料|企业介绍/.test(text));
  const wantsUpdate = /补充|更新|编辑|修改|追加|完善|修正|加入|写入|保存到/.test(text);
  if (wantsNew && !wantsUpdate) {
    return 'create' as const;
  }
  if (wantsUpdate) {
    return 'update' as const;
  }
  return hasFiles ? ('create' as const) : ('chat' as const);
}

function extractCompanyHint(text: string) {
  const match = text.match(/(?:公司名称|企业名称|品牌名称|公司简称|简称)\s*[：:]\s*([^\n，,。；;]+)/);
  if (match) {
    return match[1].trim();
  }
  const legalName = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·-]{4,40}(?:有限公司|有限责任公司|股份有限公司))/);
  if (legalName) {
    return legalName[1].trim();
  }
  return '';
}

function hasProfileValue(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }
  const text = profileValueText(value);
  return Boolean(text)
    && !PLACEHOLDER_PROFILE_VALUES.has(text)
    && !text.startsWith('这是通过智能助手知识库录入技能自动创建的草稿');
}

function profileValueText(value: unknown): string {
  return profileFieldText({ value }, 'value');
}

function upsertReasoningStep(
  messages: ChatMessage[],
  id: string,
  step: { label: string; detail?: string; status: 'active' | 'complete' | 'pending' }
) {
  return updateMessage(messages, id, (message) => {
    const existingSteps = message.reasoningSteps ?? [];
    const nextSteps = existingSteps.some((item) => item.label === step.label)
      ? existingSteps.map((item) => item.label === step.label ? { ...item, ...step } : item)
      : [...existingSteps.map((item) => item.status === 'active' ? { ...item, status: 'complete' as const } : item), step];
    return {
      ...message,
      reasoningSteps: nextSteps,
      status: message.status === 'error' ? 'error' : 'streaming',
    };
  });
}

function isConfirmableKnowledgeDraft(draft?: GeoAgentKnowledgeDraft | null) {
  if (!draft || draft.extraction_status === 'failed' || draft.status === 'failed' || draft.error_message) {
    return false;
  }
  const hasFacts = Array.isArray(draft.facts) && draft.facts.length > 0;
  const hasProfile = [
    draft.profile.company_name,
    draft.profile.industry_category,
    draft.profile.offerings,
    draft.profile.core_advantages,
    draft.profile.target_keywords,
  ].some(hasProfileValue);
  return hasFacts || hasProfile;
}

function buildLongTailPreview(profile: GeoAgentEnterpriseProfileInput) {
  const rawKeywords = profileFieldText(profile as Record<string, unknown>, 'target_keywords');
  const keywords = rawKeywords
    .split(/[\n,，、;；|]+/)
    .map((item) => item.trim().replace(/\s+/g, ''))
    .filter((item) => item && !/(怎么|如何|哪家|为什么|推荐|排行榜|口碑|靠谱|支持|选择)/.test(item))
    .slice(0, 6);
  const region = extractPreviewRegion(profileFieldText(profile as Record<string, unknown>, 'business_regions'));
  const rows: string[] = [];
  keywords.forEach((keyword) => {
    rows.push(`${keyword}哪家好`, `${keyword}公司推荐`, `${keyword}怎么选`);
    if (region && !keyword.includes(region)) {
      rows.push(`${region}${keyword}哪家好`);
    }
  });
  return Array.from(new Set(rows)).slice(0, 12);
}

function extractPreviewRegion(value: string) {
  const text = value.replace(/\s+/g, '');
  return text.match(/[\u4e00-\u9fa5]{2,8}(?:市|区|县|省|自治区)|(?:华东|华南|华中|华北|西南|西北|东北)地区?/)?.[0] ?? '';
}

function buildKnowledgeSavedSummary(profile: GeoAgentEnterpriseProfile, fileCount: number) {
  const savedFields = PROFILE_SUMMARY_FIELDS
    .filter(([field]) => hasProfileValue(profile[field]))
    .map(([, label]) => label);
  const missingFields = PROFILE_SUMMARY_FIELDS
    .filter(([field]) => !hasProfileValue(profile[field]))
    .map(([, label]) => label);
  const companyName = profileFieldText(profile as Record<string, unknown>, 'company_name');
  const name = hasProfileValue(profile.company_name) ? companyName : '新的企业知识库';
  const savedPreview = savedFields.slice(0, 12).join('、') || '附件原文片段';
  const missingPreview = missingFields.slice(0, 8).join('、');

  return [
    `已解析 ${fileCount} 个附件，并写入「${name}」企业知识库。`,
    '',
    `已录入字段：${savedPreview}${savedFields.length > 12 ? `等 ${savedFields.length} 项` : ''}。`,
    `当前知识条目：${profile.entry_count} 条，后续 ChatBox、文章生成、网页生成会优先检索这些资料。`,
    missingFields.length > 0 ? `待补充字段：${missingPreview}${missingFields.length > 8 ? `等 ${missingFields.length} 项` : ''}。` : '这份资料的核心字段已经比较完整，可以继续生成长尾词和内容方案。',
  ].filter(Boolean).join('\n');
}

async function ensureDraftEnterpriseProfile(seedText: string) {
  if (!window.geoAgent?.saveEnterpriseProfile) {
    throw new Error('当前桌面端尚未暴露企业知识库创建接口，请重启 Electron 后再试。');
  }
  const companyHint = extractCompanyHint(seedText);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const projectId = `kb-${slugifyProjectId(companyHint || 'draft')}-${timestamp}`;
  const displayName = companyHint || DRAFT_PROFILE_NAME;
  await window.geoAgent.saveEnterpriseProfile({
    project_id: projectId,
    company_name: toProfileEvidenceField(displayName),
    short_name: toProfileEvidenceField(displayName),
    industry_category: toProfileEvidenceField('待补充'),
    detailed_intro: toProfileEvidenceField('这是通过智能助手知识库录入技能自动创建的草稿。请继续补充公司名称、详细地址、产品与服务、用户痛点、信任背书、案例、业务区域和目标关键词。'),
  });
  window.dispatchEvent(new CustomEvent('geo-agent-enterprises-refresh'));
  return projectId;
}

export function AgentStudio() {
  const { currentEnterprise, hasEnterprises, isLoadingEnterprises, refreshEnterprises, setEnterpriseId } = useEnterprise();
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [skills, setSkills] = useState<GeoAgentSkill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<GeoAgentSkill | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [geoProject, setGeoProject] = useState<GeoAgentGeoProject | null>(null);
  const [workflowState, setWorkflowState] = useState<GeoAgentWorkflowState | null>(null);
  const inputShellRef = useRef<HTMLDivElement | null>(null);
  const openConversationRequestRef = useRef(0);
  const phaseTwoPromptInFlightRef = useRef<Set<string>>(new Set());
  const stageInFlightRef = useRef<Set<string>>(new Set());
  const typewriterQueuesRef = useRef<Record<string, Promise<void>>>({});
  const skipNextConversationAutoRestoreRef = useRef(false);
  const pendingKnowledgeIngestRef = useRef<{
    intent?: 'create' | 'update';
    projectId?: string;
    message?: string;
  } | null>(null);
  const [isConversationHistoryResetting, setIsConversationHistoryResetting] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(CONVERSATION_HISTORY_RESET_KEY) !== 'done'
  );

  const currentConversationStorageKey = conversationStorageKey(currentEnterprise?.id);
  const runningStageKeys = useMemo(() => collectRunningStageKeys(messages), [messages]);

  useEffect(() => {
    localStorage.setItem(CONVERSATION_HISTORY_RESET_KEY, 'done');
    setIsConversationHistoryResetting(false);
  }, []);

  const refreshWorkflowState = async (geoProjectId = geoProject?.id) => {
    if (!geoProjectId || !window.geoAgent?.getGeoWorkflowState) {
      setWorkflowState(null);
      return null;
    }
    try {
      const state = await window.geoAgent.getGeoWorkflowState(geoProjectId);
      setWorkflowState(state);
      return state;
    } catch {
      setWorkflowState(null);
      return null;
    }
  };

  useEffect(() => {
    if (!window.geoAgent?.getConfigStatus) {
      return;
    }

    window.geoAgent.getConfigStatus()
      .then(setConfigStatus)
      .catch(() => setConfigStatus(null));
  }, []);

  useEffect(() => {
    if (!window.geoAgent?.getSkills) {
      return;
    }

    window.geoAgent.getSkills()
      .then((response) => setSkills(response.skills ?? []))
      .catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    if (hasEnterprises || selectedSkill || conversationId || messages.length > 0) {
      return;
    }
    const knowledgeSkill = skills.find((skill) => skill.id === 'knowledge-base-ingest' || skill.name.includes('知识库'));
    if (knowledgeSkill) {
      setSelectedSkill(knowledgeSkill);
    }
  }, [conversationId, hasEnterprises, messages.length, selectedSkill, skills]);

  useEffect(() => {
    if (!pendingKnowledgeIngestRef.current || selectedSkill) {
      return;
    }
    const knowledgeSkill = skills.find((skill) => skill.id === 'knowledge-base-ingest' || skill.name.includes('知识库'));
    if (knowledgeSkill) {
      setSelectedSkill(knowledgeSkill);
      pendingKnowledgeIngestRef.current = null;
    }
  }, [selectedSkill, skills]);

  useEffect(() => {
    if (!hasEnterprises || !currentEnterprise?.id || !window.geoAgent?.ensureGeoProject) {
      setGeoProject(null);
      setWorkflowState(null);
      return;
    }
    window.geoAgent.ensureGeoProject(currentEnterprise.id)
      .then((project) => {
        setGeoProject(project);
        refreshWorkflowState(project.id).catch(() => undefined);
      })
      .catch(() => {
        setGeoProject(null);
        setWorkflowState(null);
      });
  }, [currentEnterprise?.id, hasEnterprises]);

  useEffect(() => {
    if (isConversationHistoryResetting) {
      return;
    }
    if (skipNextConversationAutoRestoreRef.current) {
      skipNextConversationAutoRestoreRef.current = false;
      return;
    }
    const storedConversationId = localStorage.getItem(currentConversationStorageKey);
    if (storedConversationId && window.geoAgent?.getConversation) {
      openConversation(storedConversationId, { silent: true, storageKey: currentConversationStorageKey }).catch(() => {
        clearConversationStorageById(storedConversationId);
        localStorage.removeItem(currentConversationStorageKey);
        startNewConversation({ silent: true });
      });
      return;
    }
    setConversationId(null);
    setMessages([]);
  }, [currentConversationStorageKey, isConversationHistoryResetting]);

  useEffect(() => {
    const handleOpenConversation = (event: Event) => {
      const nextId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (nextId) {
        openConversation(nextId);
      }
    };
    const handleNewConversation = () => startNewConversation();
    const handleDeletedConversation = (event: Event) => {
      const deletedId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!deletedId) {
        return;
      }
      clearConversationStorageById(deletedId);
      if (deletedId === conversationId || localStorage.getItem(currentConversationStorageKey) === deletedId) {
        startNewConversation({ silent: true });
      }
    };
    const handleStartPhaseTwo = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || !window.geoAgent?.ensureGeoProject) {
        return;
      }
      window.geoAgent.ensureGeoProject(detail.projectId)
        .then((project) => {
          setGeoProject(project);
          refreshWorkflowState(project.id).catch(() => undefined);
          appendPhaseTwoPrompt(project, { force: true }).catch(() => undefined);
        })
        .catch(() => undefined);
    };
    const handleStartKnowledgeIngest = (event: Event) => {
      const detail = (event as CustomEvent<{
        intent?: 'create' | 'update';
        projectId?: string;
        message?: string;
      }>).detail ?? {};
      const knowledgeSkill = skills.find((skill) => skill.id === 'knowledge-base-ingest' || skill.name.includes('知识库'));
      pendingKnowledgeIngestRef.current = detail;
      startNewConversation();
      setSelectedSkill(knowledgeSkill ?? null);
      if (knowledgeSkill) {
        pendingKnowledgeIngestRef.current = null;
      }
      setIsSkillsOpen(false);
      setInputValue(detail.message || (detail.intent === 'update'
        ? '请基于上传资料补充当前企业知识库，并生成待确认的更新草稿。'
        : '请引导我上传企业资料，并生成待确认的企业知识库草稿。'));
    };
    window.addEventListener('geo-agent-open-conversation', handleOpenConversation);
    window.addEventListener('geo-agent-new-conversation', handleNewConversation);
    window.addEventListener('geo-agent-conversation-deleted', handleDeletedConversation);
    window.addEventListener('geo-agent-start-phase-two', handleStartPhaseTwo);
    window.addEventListener('geo-agent-start-knowledge-ingest', handleStartKnowledgeIngest);
    return () => {
      window.removeEventListener('geo-agent-open-conversation', handleOpenConversation);
      window.removeEventListener('geo-agent-new-conversation', handleNewConversation);
      window.removeEventListener('geo-agent-conversation-deleted', handleDeletedConversation);
      window.removeEventListener('geo-agent-start-phase-two', handleStartPhaseTwo);
      window.removeEventListener('geo-agent-start-knowledge-ingest', handleStartKnowledgeIngest);
    };
  }, [conversationId, currentConversationStorageKey, skills]);

  useEffect(() => {
    const closeMenusWhenOutsideInput = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node;
      if (!inputShellRef.current?.contains(target)) {
        setIsSkillsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeMenusWhenOutsideInput);
    document.addEventListener('focusin', closeMenusWhenOutsideInput);
    return () => {
      document.removeEventListener('pointerdown', closeMenusWhenOutsideInput);
      document.removeEventListener('focusin', closeMenusWhenOutsideInput);
    };
  }, []);

  const sendMessage = async (text?: string, files: PromptAttachment[] = []) => {
    const knowledgeSkill = skills.find((skill) => skill.id === 'knowledge-base-ingest' || skill.name.includes('知识库'));
    const activeSkill = selectedSkill ?? (!hasEnterprises ? knowledgeSkill ?? null : null);
    const isKnowledgeIngestSkill = !!activeSkill && (activeSkill.id === 'knowledge-base-ingest' || activeSkill.name.includes('知识库'));
    const hasFiles = files.length > 0;
    const rawContent = (text ?? inputValue).trim();
    const knowledgeIntent = inferKnowledgeIntent(rawContent, hasFiles, isKnowledgeIngestSkill);
    const shouldUseDispatcher = hasFiles || isKnowledgeIngestSkill;
    const content = rawContent
      || (hasFiles ? `已上传 ${files.length} 个附件，请解析并写入企业知识库。` : '')
      || (activeSkill ? `请开始使用${activeSkill.name}技能，引导我完成任务。` : '');
    if ((!content && !hasFiles) || isSending) {
      return;
    }

    const shouldShowReasoning = shouldUseDispatcher;
    const timestamp = Date.now();
    const userMessage: ChatMessage = { id: `user-${timestamp}`, role: 'user', content };
    const assistantId = `assistant-${timestamp}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      reasoning: shouldShowReasoning ? '正在理解 GEO 任务' : undefined,
      status: 'streaming',
    };
    setInputValue('');
    setSelectedSkill(null);
    setIsSending(true);
    setMessages((current) => [
      ...current,
      userMessage,
      assistantMessage,
    ]);

    try {
      if (!window.geoAgent) {
        throw new Error('请在 Electron 桌面模式中使用本地 GEO-Agent 后端。');
      }

      let activeProjectId = knowledgeIntent === 'create'
        ? undefined
        : hasEnterprises ? currentEnterprise.id : undefined;
      if ((hasFiles || isKnowledgeIngestSkill) && knowledgeIntent !== 'chat') {
        if (!window.geoAgent.createKnowledgeDraft && !window.geoAgent.createKnowledgeDraftStream) {
          throw new Error('Knowledge draft API is not available. Please restart Electron and try again.');
        }
        const assets = await Promise.all(files.map(filePartToKnowledgeAsset));
        const draftPayload = {
          message: content,
          conversation_id: knowledgeIntent === 'create' ? null : conversationId,
          intent: knowledgeIntent,
          project_id: activeProjectId,
          skill_id: activeSkill?.id,
          assets,
        };
        let draft: GeoAgentKnowledgeDraft;
        let draftFinalEvent: Awaited<ReturnType<NonNullable<Window['geoAgent']>['createKnowledgeDraftStream']>> | null = null;
        if (window.geoAgent.createKnowledgeDraftStream) {
          const enqueueKnowledgeTask = (task: () => Promise<void> | void) => enqueueTypewriterTask(typewriterQueuesRef, assistantId, task);
          const finalEvent = await window.geoAgent.createKnowledgeDraftStream(draftPayload, (event) => {
            if (event.type === 'meta' && event.conversation_id) {
              setConversationId(event.conversation_id);
              localStorage.setItem(conversationStorageKey(event.project_id || draftPayload.project_id || null, event.conversation_id), event.conversation_id);
              window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: event.conversation_id } }));
              if (knowledgeIntent === 'create' && event.project_id) {
                skipNextConversationAutoRestoreRef.current = true;
                setEnterpriseId(event.project_id);
                refreshEnterprises().catch(() => undefined);
              }
              if (knowledgeIntent === 'create') {
                setMessages((current) => {
                  const currentAssistant = current.find((message) => message.id === assistantId) || assistantMessage;
                  return [userMessage, currentAssistant];
                });
              }
            }
            if (event.type === 'status' && event.message) {
              enqueueKnowledgeTask(async () => {
                setMessages((current) => mergeReasoningStep(current, assistantId, {
                  label: event.message ?? '正在处理知识库资料',
                  status: 'active',
                }));
                await wait(180);
              });
            }
            if ((event.type === 'model_start' || event.type === 'model_status') && (event.message || event.provider || event.model)) {
              const debugLine = [
                event.message,
                event.provider && event.model ? `${event.provider}/${event.model}` : null,
                event.api_family,
                event.request_id ? `request: ${event.request_id}` : null,
                event.http_status ? `HTTP ${event.http_status}` : null,
                event.latency_ms ? `${event.latency_ms}ms` : null,
              ].filter(Boolean).join(' · ');
              enqueueKnowledgeTask(async () => {
                setMessages((current) => {
                  const withStep = event.message
                    ? mergeReasoningStep(current, assistantId, {
                      label: event.message,
                      detail: event.provider && event.model ? `${event.provider}/${event.model} · ${event.api_family ?? 'auto'}` : undefined,
                      status: 'active',
                    })
                    : current;
                  return updateMessage(withStep, assistantId, (message) => ({
                    ...message,
                    modelDebugLines: debugLine
                      ? [...(message.modelDebugLines ?? []), debugLine].slice(-8)
                      : message.modelDebugLines,
                    provider: event.provider || message.provider,
                    model: event.model || message.model,
                    status: 'streaming',
                  }));
                });
                await wait(180);
              });
            }
            if (event.type === 'reasoning_delta' && event.text) {
              enqueueKnowledgeTask(() => typeMessageText(setMessages, assistantId, event.text ?? '', 'reasoningContent'));
            }
            if (event.type === 'draft_section' && event.section) {
              enqueueKnowledgeTask(async () => {
                setMessages((current) => {
                  const withStep = mergeReasoningStep(current, assistantId, {
                    label: event.message || `已生成 ${event.section}`,
                    detail: Array.isArray(event.items) ? `${event.items.length} 项` : undefined,
                    status: 'active',
                  });
                  return updateMessage(withStep, assistantId, (message) => ({
                    ...message,
                    draftStreamSections: {
                      ...(message.draftStreamSections ?? {}),
                      [event.section ?? 'unknown']: Array.isArray(event.items) ? event.items.length : 0,
                    },
                    status: 'streaming',
                  }));
                });
                await wait(220);
              });
            }
            if (event.type === 'result' && event.draft) {
              enqueueKnowledgeTask(async () => {
                const visibleGroupCount = DRAFT_PREVIEW_GROUPS
                  .filter((group) => group.fields.some(([field]) => hasProfileValue(event.draft!.profile[field])))
                  .length;
                setMessages((current) => updateMessage(current, assistantId, {
                  knowledgeDraft: event.draft,
                  progressiveDraftGroups: 0,
                  reasoningSteps: [
                    ...((current.find((item) => item.id === assistantId)?.reasoningSteps ?? []).map((step) => ({ ...step, status: 'complete' as const }))),
                    { label: '知识库草稿已生成', status: 'complete' },
                  ],
                  status: 'streaming',
                }));
                for (let groupIndex = 1; groupIndex <= visibleGroupCount; groupIndex += 1) {
                  await wait(240);
                  setMessages((current) => updateMessage(current, assistantId, { progressiveDraftGroups: groupIndex }));
                }
              });
            }
            if (event.type === 'error' && event.error) {
              setMessages((current) => updateMessage(current, assistantId, {
                content: event.error ?? 'Knowledge draft creation failed.',
                knowledgeDraft: event.draft,
                confirmationState: 'output-available',
                reasoningSteps: [
                  ...((current.find((item) => item.id === assistantId)?.reasoningSteps ?? []).map((step) => step.status === 'active' ? { ...step, status: 'complete' as const } : step)),
                  { label: '知识库抽取失败', detail: event.error, status: 'complete' },
                ],
                status: 'error',
                error: event.error,
              }));
            }
          });
          if (finalEvent.type === 'error' || !finalEvent.draft) {
            throw new Error(finalEvent.error || 'Knowledge draft creation failed.');
          }
          await typewriterQueuesRef.current[assistantId]?.catch(() => undefined);
          draftFinalEvent = finalEvent;
          draft = finalEvent.draft;
          if (finalEvent.conversation_id) {
            setConversationId(finalEvent.conversation_id);
            localStorage.setItem(conversationStorageKey(draft.project_id || null, finalEvent.conversation_id), finalEvent.conversation_id);
            window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: finalEvent.conversation_id } }));
            if (knowledgeIntent === 'create' && draft.project_id) {
              skipNextConversationAutoRestoreRef.current = true;
              setEnterpriseId(draft.project_id);
              refreshEnterprises().catch(() => undefined);
            }
          }
          if (finalEvent.message) {
            setMessages((current) => {
              const restored = restoreConversationMessage(finalEvent.message!);
              const previous = current.find((item) => item.id === assistantId);
              return replaceMessageId(current, assistantId, {
                ...restored,
                content: previous?.content || restored.content,
                reasoning: previous?.reasoning || restored.reasoning,
                reasoningContent: previous?.reasoningContent,
                reasoningSteps: previous?.reasoningSteps,
                modelDebugLines: previous?.modelDebugLines,
                draftStreamSections: previous?.draftStreamSections,
                progressiveDraftGroups: previous?.progressiveDraftGroups,
                knowledgeDraft: draft,
                confirmationState: 'approval-requested',
                status: 'streaming',
              });
            });
          }
        } else {
          draft = await window.geoAgent.createKnowledgeDraft(draftPayload);
        }
        const canConfirmDraft = isConfirmableKnowledgeDraft(draft);
        if (!canConfirmDraft) {
          const errorText = draft.error_message || draft.warnings?.[0] || 'The model did not extract traceable enterprise facts. Please provide more complete materials and try again.';
          setMessages((current) => updateMessage(current, assistantId, {
            content: errorText,
            reasoning: 'Knowledge draft creation failed, so confirmation has been blocked.',
            knowledgeDraft: draft,
            confirmationState: 'output-available',
            status: 'error',
            error: errorText,
          }));
          return;
        }
        if (draft.conversation_id) {
          setConversationId(draft.conversation_id);
          localStorage.setItem(conversationStorageKey(draft.project_id, draft.conversation_id), draft.conversation_id);
          window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: draft.conversation_id } }));
          if (knowledgeIntent === 'create' && draft.project_id) {
            skipNextConversationAutoRestoreRef.current = true;
            setEnterpriseId(draft.project_id);
            refreshEnterprises().catch(() => undefined);
          }
        }
        const draftMessageId = draftFinalEvent?.message?.id || assistantId;
        setMessages((current) => updateMessage(current, draftMessageId, (message) => ({
          ...message,
          content: message.knowledgeDraft || draft ? '' : '已根据资料生成企业知识库草稿。请先核对下方模板内容，确认前不会写入正式知识库。',
          reasoning: `已解析 ${files.length} 个附件并生成结构化知识库草稿。确认前不会写入正式知识库。`,
          knowledgeDraft: draft,
          progressiveDraftGroups: message.progressiveDraftGroups ?? DRAFT_PREVIEW_GROUPS.length,
          confirmationState: 'approval-requested',
          status: 'complete',
        })));
        window.setTimeout(() => inputShellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
        return;
      }

      const selectedProvider = shouldUseDispatcher
        ? configStatus?.providers.dispatcher
        : configStatus?.providers[AUTO_PLATFORM];
      if (selectedProvider && !selectedProvider.configured) {
        throw new Error(
          `${shouldUseDispatcher ? '鲸杉GEO-Agent 调度模型' : 'Auto'} 尚未读取到 API Key。请确认项目根目录 .env 已配置对应 key；如果刚修改过 .env，请重启桌面端后再试。`
        );
      }

      const options = {
        projectId: activeProjectId,
        skillId: activeSkill?.id,
      };
      if (window.geoAgent.sendChatStream) {
        const finalEvent = await window.geoAgent.sendChatStream(
          content,
          conversationId,
          options,
          (event) => {
            if (event.type === 'meta' && event.conversation_id) {
              setConversationId(event.conversation_id);
              localStorage.setItem(conversationStorageKey(activeProjectId, event.conversation_id), event.conversation_id);
            }
            if (event.type === 'status' && event.message) {
              setMessages((current) => updateMessage(current, assistantId, {
                reasoning: shouldShowReasoning
                  ? (hasFiles ? `已接收 ${files.length} 个附件，正在解析并写入知识库。${event.message}` : event.message)
                  : undefined,
                status: 'streaming',
              }));
            }
            if (event.type === 'delta' && event.text) {
              setMessages((current) => appendMessageText(current, assistantId, event.text ?? ''));
            }
            if (event.type === 'reasoning_delta' && event.text) {
              setMessages((current) => appendMessageText(current, assistantId, event.text ?? '', 'reasoningContent'));
            }
            if (event.type === 'search' && event.search_query) {
              setMessages((current) => updateMessage(current, assistantId, (message) => {
                const existingSteps = message.liveSearchSteps ?? [];
                const existingStep = existingSteps.find((step) => step.query === event.search_query);
                const nextSteps = existingStep
                  ? existingSteps.map((step) => step.query === event.search_query
                    ? { ...step, status: event.search_status ?? step.status }
                    : step)
                  : [...existingSteps, { query: event.search_query ?? '', status: event.search_status ?? 'in_progress' }];
                return {
                  ...message,
                  liveSearchSteps: nextSteps,
                  searchQueries: Array.from(new Set([...(message.searchQueries ?? []), event.search_query ?? ''])).filter(Boolean),
                  searchActions: event.search_action
                    ? [...(message.searchActions ?? []), event.search_action]
                    : message.searchActions,
                  status: 'streaming',
                };
              }));
            }
            if (event.type === 'done') {
              setMessages((current) => updateMessage(current, assistantId, (message) => ({
                ...message,
                status: event.error ? 'error' : 'complete',
                content: message.content || event.content || '',
                sources: event.sources ?? [],
                searchQueries: event.search_queries ?? [],
                searchActions: event.search_actions ?? [],
                searchUsage: event.search_usage ?? {},
                reasoningContent: shouldShowReasoning
                  ? message.reasoningContent || event.reasoning_content || undefined
                  : undefined,
                provider: event.provider,
                model: event.model,
                error: event.error,
                reasoning: shouldShowReasoning ? `${hasFiles ? `已解析 ${files.length} 个附件并写入企业知识库。` : ''}${buildAssistantReasoning(event.provider, event.model, {
                  deepThinking: shouldShowReasoning,
                  webSearch: false,
                  dispatcher: shouldUseDispatcher,
                  error: Boolean(event.error),
                })}` : undefined,
              })));
            }
          }
        );
        setConversationId(finalEvent.conversation_id);
        localStorage.setItem(conversationStorageKey(activeProjectId, finalEvent.conversation_id), finalEvent.conversation_id);
        window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: finalEvent.conversation_id } }));
      } else {
        const response = await window.geoAgent.sendChat(content, conversationId, options);
        setConversationId(response.conversation_id);
        localStorage.setItem(conversationStorageKey(activeProjectId, response.conversation_id), response.conversation_id);
        const finalReasoning = shouldShowReasoning ? `${hasFiles ? `已解析 ${files.length} 个附件并写入企业知识库。` : ''}${buildAssistantReasoning(response.provider, response.model, {
          deepThinking: shouldShowReasoning,
          webSearch: false,
          dispatcher: shouldUseDispatcher,
          error: Boolean(response.error),
        })}` : undefined;
        setMessages((current) => updateMessage(current, assistantId, {
          reasoning: finalReasoning,
          content: '',
          sources: response.sources ?? [],
          searchQueries: response.search_queries ?? [],
          searchActions: response.search_actions ?? [],
          searchUsage: response.search_usage ?? {},
          reasoningContent: undefined,
          provider: response.provider,
          model: response.model,
          error: response.error,
          status: 'streaming',
        }));
        if (shouldShowReasoning && response.reasoning_content) {
          await typeMessageText(setMessages, assistantId, response.reasoning_content, 'reasoningContent');
        }
        await typeMessageText(setMessages, assistantId, response.content);
        setMessages((current) => updateMessage(current, assistantId, {
          status: response.error ? 'error' : 'complete',
        }));
        window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: response.conversation_id } }));
      }
    } catch (error) {
      const errorMessage = normalizeChatError(error);
      setMessages((current) => updateMessage(current, assistantId, {
        content: '',
        status: 'streaming',
      }));
      await typeMessageText(setMessages, assistantId, errorMessage);
      setMessages((current) => updateMessage(current, assistantId, {
        status: 'error',
      }));
    } finally {
      setIsSending(false);
    }
  };

  const setSuggestedPrompt = (suggestion: string) => {
    setInputValue(suggestion);
  };

  const appendPhaseTwoPrompt = async (project: GeoAgentGeoProject, options?: { force?: boolean; platform?: 'doubao' | 'deepseek'; conversationId?: string | null }) => {
    if (project.current_phase !== 'ready_for_check' && !options?.force) {
      return;
    }
    const platform = options?.platform ?? AUTO_PLATFORM;
    const targetConversationId = options?.conversationId ?? conversationId;
    const key = phaseTwoPromptKey(project.project_id, targetConversationId, platform);
    if (!options?.force && readPhaseTwoPromptKeys().includes(key)) {
      return;
    }
    if (phaseTwoPromptInFlightRef.current.has(key)) {
      return;
    }
    if (!window.geoAgent?.createGeoPhaseTwoPrompt) {
      return;
    }
    if (!options?.force && hasPhaseTwoMessageFor(messages, project, platform)) {
      return;
    }
    phaseTwoPromptInFlightRef.current.add(key);
    try {
      const response = await window.geoAgent.createGeoPhaseTwoPrompt(project.id, platform, targetConversationId);
      setConversationId(response.conversation_id);
      localStorage.setItem(conversationStorageKey(project.project_id, response.conversation_id), response.conversation_id);
      setMessages((current) => {
        if (!options?.force && current.some((message) => message.id === response.message.id)) {
          return current;
        }
        if (!options?.force && hasPhaseTwoMessageFor(current, project, platform)) {
          return current;
        }
        return [...current, restoreConversationMessage(response.message)];
      });
      window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: response.conversation_id } }));
    } finally {
      phaseTwoPromptInFlightRef.current.delete(key);
    }
  };

  const confirmPhaseTwo = async (messageId: string, project: GeoAgentGeoProject, platform: 'doubao' | 'deepseek' = AUTO_PLATFORM) => {
    const lockKey = stageRunKey(project.id, platform, 2);
    if (stageInFlightRef.current.has(lockKey) || runningStageKeys.has(lockKey)) {
      return;
    }
    if (!window.geoAgent?.runGeoPhaseTwoReportStream && !window.geoAgent?.runGeoPhaseTwoReport) {
      setMessages((current) => updateMessage(current, messageId, {
        content: '桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再启动阶段二。',
        status: 'error',
      }));
      return;
    }
    stageInFlightRef.current.add(lockKey);
    const phaseTwoTargetId = `phase-two-result-${Date.now()}`;
    setMessages((current) => updateMessage(current, messageId, {
      confirmationState: 'approval-responded',
      confirmationApproved: true,
      actionBusy: true,
    }));
    setMessages((current) => appendMessageIfMissing(current, {
      id: phaseTwoTargetId,
      role: 'assistant',
      content: '',
      reasoning: `正在生成${platformLabelFor(platform)}平台排行榜问题池。`,
      phaseTwoPlatform: platform,
      geoProjectId: project.id,
      phaseTwoExecution: {
        platform,
        companyName: project.company_name,
        activeStep: 0,
      },
      status: 'streaming',
    }));
    setMessages((current) => updateMessage(current, messageId, {
      phaseTwoExecution: undefined,
      actionBusy: false,
      status: 'complete',
    }));
    try {
      const platformLabel = platformLabelFor(platform);
      let report: GeoAgentGeoReport | null = null;
      let backendResultMessage: ChatMessage | null = null;

      // 步骤 1：生成问题池
      if (window.geoAgent.runGeoPhaseTwoReportStream) {
        await window.geoAgent.runGeoPhaseTwoReportStream(project.id, platform, messageId, conversationId, (event) => {
          if (event.type === 'status') {
            setMessages((current) => updateMessage(current, phaseTwoTargetId, {
              reasoning: event.message ?? event.step_label ?? `正在生成${platformLabelFor(platform)}阶段二排行榜问题池。`,
              phaseTwoExecution: {
                platform,
                companyName: project.company_name,
                activeStep: typeof event.step_index === 'number' ? event.step_index : 0,
              },
              status: 'streaming',
            }));
          }
          // 思考过程 → reasoningContent（折叠展示）
          if (event.type === 'reasoning_delta' && event.text) {
            setMessages((current) => appendMessageText(current, phaseTwoTargetId, event.text ?? '', 'reasoningContent'));
          }
          if (event.type === 'result' && event.question_set) {
            // 保存问题集作为 report
            const qs = event.question_set;
            const pool = (qs.questions.confirmed_questions as unknown[]) || (qs.questions.question_pool as unknown[]) || [];
            const ranking = (qs.questions.ranking_questions as unknown[]) || [];
            report = {
              id: qs.id,
              geo_project_id: project.id,
              enterprise_project_id: project.project_id,
              platform,
              status: 'completed',
              report: qs.questions,
              markdown: qs.questions.summary || '',
              created_at: qs.created_at,
              updated_at: qs.updated_at,
            };
            // 写入简洁的描述到 content（替代之前累加的原始 JSON）
            setMessages((current) => updateMessage(current, phaseTwoTargetId, {
              content: `已基于企业知识库和目标词生成 ${pool.length} 条核心问题，其中 ${ranking.length} 条偏向排行榜/推荐。`,
            }));
          }
          if (event.type === 'done' && event.content) {
            setMessages((current) => updateMessage(current, phaseTwoTargetId, (message) => ({ ...message, content: message.content || event.content || '' })));
          }
          if (event.type === 'done' && event.message && typeof event.message === 'object') {
            const restored = restoreConversationMessage(event.message as GeoAgentConversationMessage);
            backendResultMessage = {
              ...restored,
              geoReport: report ?? restored.geoReport,
              phaseTwoExecution: undefined,
              status: report?.status === 'failed' ? 'error' : 'complete',
            };
          }
        });
      } else {
        const geoReport = await window.geoAgent.runGeoPhaseTwoReport(project.id, platform, messageId);
        if (geoReport) {
          report = geoReport;
        }
      }

      if (!report) {
        throw new Error('阶段二没有返回可用结果，请重试。');
      }

      await refreshWorkflowState(project.id);
      setMessages((current) => updateMessage(current, phaseTwoTargetId, {
        content: report!.status === 'failed'
          ? `${platformLabel} 排行榜问题池生成失败：${report!.error_message || '未知错误'}`
          : `已完成${platformLabel}阶段二：${project.company_name}\n\n已基于企业知识库和目标词生成 10 条核心问题，并自动确认为本轮 GEO 北极星问题。下一步是发现高权重信源。`,
        geoReport: report!,
        phaseTwoPrompt: undefined,
        phaseTwoPlatform: undefined,
        phaseTwoExecution: undefined,
        confirmationState: 'output-available',
        confirmationApproved: true,
        actionBusy: false,
        status: report!.status === 'failed' ? 'error' : 'complete',
      }));
      if (backendResultMessage) {
        setMessages((current) => replaceMessageId(current, phaseTwoTargetId, {
          ...backendResultMessage!,
          content: report!.status === 'failed'
            ? `${platformLabel} 排行榜问题池生成失败：${report!.error_message || '未知错误'}`
            : `已完成${platformLabel}阶段二：${project.company_name}\n\n已基于企业知识库和目标词生成 10 条核心问题，并自动确认为本轮 GEO 北极星问题。下一步是发现高权重信源。`,
          geoReport: report!,
          phaseTwoPrompt: undefined,
          phaseTwoPlatform: undefined,
          phaseTwoExecution: undefined,
          confirmationState: 'output-available',
          confirmationApproved: true,
          actionBusy: false,
          status: report!.status === 'failed' ? 'error' : 'complete',
        }));
      }
      window.dispatchEvent(new CustomEvent('geo-agent-geo-project-changed', { detail: { projectId: project.project_id, geoProjectId: project.id } }));
    } catch (error) {
      setMessages((current) => updateMessage(current, messageId, {
        content: normalizeChatError(error),
        phaseTwoExecution: undefined,
        confirmationState: 'approval-requested',
        confirmationApproved: undefined,
        actionBusy: false,
        status: 'error',
      }));
    } finally {
      stageInFlightRef.current.delete(lockKey);
    }
  };

  const runSourceDiscoveryFromReport = async (messageId: string, report: GeoAgentGeoReport) => {
    const platform = report.platform === 'deepseek' ? 'deepseek' : 'doubao';
    const lockKey = stageRunKey(report.geo_project_id, platform, 3);
    if (stageInFlightRef.current.has(lockKey) || runningStageKeys.has(lockKey)) {
      return;
    }
    if (!window.geoAgent?.runGeoSourceDiscovery) {
      setMessages((current) => updateMessage(current, messageId, {
        content: '桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再执行高权重信源发现。',
        status: 'error',
      }));
      return;
    }
    stageInFlightRef.current.add(lockKey);
    setMessages((current) => updateMessage(current, messageId, {
      sourceDiscoveryAttempted: true,
      actionBusy: true,
      status: 'complete',
    }));
    let stageMessageId = '';
    const ensureStageMessage = () => {
      if (stageMessageId) {
        return stageMessageId;
      }
      stageMessageId = `stage-three-${Date.now()}`;
      setMessages((current) => upsertMessage(current, {
        id: stageMessageId,
        role: 'assistant',
        content: '',
        reasoning: `正在发现${platformLabelFor(platform)}高权重信源。`,
        geoProjectId: report.geo_project_id,
        phaseTwoPlatform: platform,
        sourceDiscoveryExecution: { platform, activeStep: 0 },
        status: 'streaming',
      }));
      return stageMessageId;
    };
    try {
      let discovery: GeoAgentGeoSourceDiscovery | null = null;
      if (window.geoAgent.runGeoSourceDiscoveryStream) {
        const streamResult = await window.geoAgent.runGeoSourceDiscoveryStream(report.geo_project_id, platform, report, null, conversationId, messageId, (event) => {
          if (event.type === 'meta' && event.message && typeof event.message === 'object') {
            const restored = restoreConversationMessage(event.message as GeoAgentConversationMessage);
            const previousId = stageMessageId || '';
            stageMessageId = restored.id;
            if (event.conversation_id) {
              setConversationId(event.conversation_id);
            }
            const nextMessage: ChatMessage = {
              ...restored,
              reasoning: `正在发现${platformLabelFor(platform)}高权重信源。`,
              geoProjectId: report.geo_project_id,
              sourceDiscoveryExecution: { platform, activeStep: 0 },
              status: 'streaming',
            };
            setMessages((current) => previousId
              ? replaceMessageId(current, previousId, nextMessage)
              : upsertMessage(current, nextMessage));
          }
          if (event.type === 'status') {
            const targetId = ensureStageMessage();
            const statusMessage = typeof event.message === 'string' ? event.message : undefined;
            setMessages((current) => updateMessage(current, targetId, {
              reasoning: statusMessage ?? event.step_label ?? `正在发现${platformLabelFor(platform)}高权重信源。`,
              sourceDiscoveryExecution: {
                platform,
                activeStep: typeof event.step_index === 'number' ? event.step_index : 0,
              },
              status: 'streaming',
            }));
          }
          if (event.type === 'summary_delta' && event.text) {
            const targetId = ensureStageMessage();
            setMessages((current) => appendMessageText(current, targetId, event.text ?? ''));
          }
          if (event.type === 'result' && event.source_discovery) {
            discovery = event.source_discovery;
          }
          if (event.type === 'done' && event.content) {
            const targetId = ensureStageMessage();
            setMessages((current) => updateMessage(current, targetId, { content: event.content }));
          }
        });
        if (streamResult.already_running) {
          setMessages((current) => updateMessage(current, messageId, {
            actionBusy: false,
            status: 'complete',
          }));
          return;
        }
      } else {
        const targetId = ensureStageMessage();
        await wait(450);
        setMessages((current) => updateMessage(current, targetId, {
          sourceDiscoveryExecution: { platform, activeStep: 1 },
        }));
        discovery = await window.geoAgent.runGeoSourceDiscovery(report.geo_project_id, platform, report, null);
      }
      if (!discovery) {
        throw new Error('阶段三没有返回可用结果，请重试。');
      }
      await refreshWorkflowState(report.geo_project_id);
      const targetId = ensureStageMessage();
      setMessages((current) => updateMessage(current, targetId, {
        content: `已完成${platformLabelFor(platform)}阶段三：高权重信源发现。`,
        sourceDiscovery: discovery!,
        sourceDiscoveryExecution: undefined,
        actionBusy: false,
        status: discovery!.discovery.status === 'failed' ? 'error' : 'complete',
      }));
      window.dispatchEvent(new CustomEvent('geo-agent-geo-project-changed', { detail: { projectId: report.enterprise_project_id, geoProjectId: report.geo_project_id } }));
    } catch (error) {
      const targetId = ensureStageMessage();
      setMessages((current) => updateMessage(current, targetId, {
        content: `${normalizeChatError(error)}\n\n我已经尝试从当前阶段二结果回填问题池。若仍失败，说明当前消息里没有可用的排行榜问题池结构，需要重新执行阶段二问题池构建。`,
        sourceDiscoveryExecution: undefined,
        sourceDiscoveryAttempted: true,
        status: 'error',
      }));
    } finally {
      stageInFlightRef.current.delete(lockKey);
    }
  };

  const requestSupportArticles = (messageId: string, discovery: GeoAgentGeoSourceDiscovery) => {
    const platform = discovery.platform === 'deepseek' ? 'deepseek' : 'doubao';
    const promptMessageId = `stage-four-prompt-${Date.now()}`;
    setMessages((current) => [
      ...updateMessage(current, messageId, { actionBusy: true, status: 'complete' }),
      {
        id: promptMessageId,
        role: 'assistant',
        content: `已准备进入${platformLabelFor(platform)}阶段四：咨询/测评支撑内容生成。`,
        phaseTwoPlatform: platform,
        supportArticlesPrompt: discovery,
        confirmationState: 'approval-requested',
        confirmationApproved: undefined,
        status: 'complete',
      },
    ]);
  };

  const runSupportArticlesFromDiscovery = async (
    messageId: string,
    discovery: GeoAgentGeoSourceDiscovery
  ) => {
    const platform = discovery.platform === 'deepseek' ? 'deepseek' : 'doubao';
    const lockKey = stageRunKey(discovery.geo_project_id, platform, 4);
    if (stageInFlightRef.current.has(lockKey) || runningStageKeys.has(lockKey)) {
      return;
    }
    if (!window.geoAgent?.runGeoSupportArticles) {
      setMessages((current) => updateMessage(current, messageId, {
        content: '桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再生成阶段四支撑内容。',
        status: 'error',
      }));
      return;
    }
    stageInFlightRef.current.add(lockKey);
    let stageMessageId = messageId;
    const shouldCreateBackendMessage = messageId.startsWith('stage-four-prompt-');
    setMessages((current) => updateMessage(current, messageId, {
      content: '',
      reasoning: `正在生成${platformLabelFor(platform)}阶段四 9 篇内容资产。`,
      supportArticlesPrompt: undefined,
      confirmationState: 'approval-responded',
      confirmationApproved: true,
      actionBusy: true,
      articleDraftExecution: {
        platform,
        activeStep: 0,
      },
      geoProjectId: discovery.geo_project_id,
      articleDraftAttempts: {
        consulting: true,
        review: true,
      },
      status: 'streaming',
    }));
    try {
      let result: GeoAgentGeoSupportArticleRunResponse | null = null;
      if (window.geoAgent.runGeoSupportArticlesStream) {
        const streamResult = await window.geoAgent.runGeoSupportArticlesStream(discovery.geo_project_id, platform, {
          messageId: shouldCreateBackendMessage ? null : messageId,
          conversationId: shouldCreateBackendMessage ? conversationId : null,
          parentMessageId: shouldCreateBackendMessage ? messageId : null,
        }, (event) => {
          if (event.type === 'meta' && event.message && typeof event.message === 'object') {
            const restored = restoreConversationMessage(event.message as GeoAgentConversationMessage);
            const previousId = stageMessageId;
            stageMessageId = restored.id;
            if (event.conversation_id) {
              setConversationId(event.conversation_id);
            }
            const nextMessage: ChatMessage = {
              ...restored,
              reasoning: `正在生成${platformLabelFor(platform)}阶段四 9 篇内容资产。`,
              geoProjectId: discovery.geo_project_id,
              articleDraftExecution: { platform, activeStep: 0 },
              articleDraftAttempts: { consulting: true, review: true },
              status: 'streaming',
            };
            setMessages((current) => replaceMessageId(current, previousId, nextMessage));
          }
          if (event.type === 'status') {
            const statusMessage = typeof event.message === 'string' ? event.message : undefined;
            setMessages((current) => updateMessage(current, stageMessageId, {
              reasoning: statusMessage ?? event.step_label ?? `正在生成${platformLabelFor(platform)}阶段四 9 篇内容资产。`,
              articleDraftExecution: {
                platform,
                activeStep: typeof event.step_index === 'number' ? event.step_index : 0,
              },
              status: 'streaming',
            }));
          }
          if (event.type === 'summary_delta' && event.text) {
            setMessages((current) => appendMessageText(current, stageMessageId, event.text ?? ''));
          }
          if (event.type === 'result' && event.support_articles) {
            result = event.support_articles;
          }
          if (event.type === 'done' && event.content) {
            setMessages((current) => updateMessage(current, stageMessageId, { content: event.content }));
          }
        });
        if (streamResult.already_running) {
          return;
        }
      } else {
        await wait(450);
        setMessages((current) => updateMessage(current, stageMessageId, {
          articleDraftExecution: { platform, activeStep: 1 },
        }));
        result = await window.geoAgent.runGeoSupportArticles(discovery.geo_project_id, platform, { messageId: shouldCreateBackendMessage ? null : messageId });
      }
      if (!result) {
        throw new Error('阶段四没有返回可用结果，请重试。');
      }
      await refreshWorkflowState(discovery.geo_project_id);
      setMessages((current) => updateMessage(current, stageMessageId, {
        content: result!.status === 'completed'
          ? `已完成${platformLabelFor(platform)}阶段四内容资产。\n\n已生成支撑文章和排行榜文章草稿，可在稿件管理页继续校对、发布和检测。`
          : `阶段四内容资产部分生成失败：${result!.error_message || '请查看失败项并重试。'}`,
        supportArticles: result!,
        articleDraftExecution: undefined,
        actionBusy: false,
        status: result!.status === 'completed' ? 'complete' : 'error',
      }));
      window.dispatchEvent(new CustomEvent('geo-agent-geo-project-changed', { detail: { projectId: discovery.enterprise_project_id, geoProjectId: discovery.geo_project_id } }));
    } catch (error) {
      setMessages((current) => updateMessage(current, stageMessageId, {
        content: normalizeChatError(error),
        articleDraftExecution: undefined,
        confirmationState: 'approval-requested',
        confirmationApproved: undefined,
        actionBusy: false,
        supportArticlesPrompt: discovery,
        status: 'error',
      }));
    } finally {
      stageInFlightRef.current.delete(lockKey);
    }
  };

  const runArticleDraftFromDiscovery = async (
    messageId: string,
    discovery: GeoAgentGeoSourceDiscovery,
    articleType: 'consulting' | 'review'
  ) => {
    const platform = discovery.platform === 'deepseek' ? 'deepseek' : 'doubao';
    if (!window.geoAgent?.runGeoArticleDraft) {
      setMessages((current) => updateMessage(current, messageId, {
        content: '桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再生成支撑文章。',
        status: 'error',
      }));
      return;
    }
    setMessages((current) => updateMessage(current, messageId, {
      content: '',
      reasoning: `正在生成${platformLabelFor(platform)}${articleTypeLabelFor(articleType)}支撑文章。`,
      actionBusy: true,
      articleDraftExecution: {
        platform,
        articleType,
        activeStep: 0,
      },
      articleDraftAttempts: {
        ...(current.find((item) => item.id === messageId)?.articleDraftAttempts ?? {}),
        [articleType]: true,
      },
      status: 'streaming',
    }));
    try {
      await wait(450);
      setMessages((current) => updateMessage(current, messageId, {
        articleDraftExecution: { platform, articleType, activeStep: 1 },
      }));
      const draft = await window.geoAgent.runGeoArticleDraft(discovery.geo_project_id, platform, articleType, { messageId });
      setMessages((current) => updateMessage(current, messageId, {
        content: draft.status === 'failed'
          ? `${articleTypeLabelFor(articleType)}支撑文章生成失败：${draft.draft.error_message || '未知错误'}`
          : `已生成${platformLabelFor(platform)}${articleTypeLabelFor(articleType)}文章草稿。\n\n下一步可继续补齐内容资产，或前往稿件管理页校对发布。`,
        articleDraft: draft,
        articleDraftExecution: undefined,
        actionBusy: false,
        status: draft.status === 'failed' ? 'error' : 'complete',
      }));
      window.dispatchEvent(new CustomEvent('geo-agent-geo-project-changed', { detail: { geoProjectId: discovery.geo_project_id } }));
    } catch (error) {
      setMessages((current) => updateMessage(current, messageId, {
        content: normalizeChatError(error),
        articleDraftExecution: undefined,
        actionBusy: false,
        status: 'error',
      }));
    }
  };

  const confirmKnowledgeDraft = async (messageId: string, draft: GeoAgentKnowledgeDraft) => {
    if (!window.geoAgent?.confirmKnowledgeDraft) {
      setMessages((current) => updateMessage(current, messageId, {
        content: '桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再确认知识库草稿。',
        status: 'error',
      }));
      return;
    }
    setIsSending(true);
    setMessages((current) => updateMessage(current, messageId, {
      confirmationState: 'approval-responded',
      confirmationApproved: true,
      actionBusy: true,
      reasoning: '用户已确认知识库草稿，正在正式写入本地知识库并建立索引。',
    }));
    try {
      const response = await window.geoAgent.confirmKnowledgeDraft(draft.id, draft.profile, draft.conversation_id || conversationId, draft);
      if (response.conversation_id) {
        migrateGlobalConversationStorage(response.project_id, response.conversation_id);
        skipNextConversationAutoRestoreRef.current = true;
        setConversationId(response.conversation_id);
      }
      await refreshEnterprises();
      setEnterpriseId(response.project_id);
      window.dispatchEvent(new CustomEvent('geo-agent-enterprises-refresh'));
      window.dispatchEvent(new CustomEvent('geo-agent-knowledge-changed', { detail: { projectId: response.project_id } }));
      const nextGeoProject = window.geoAgent?.ensureGeoProject
        ? await window.geoAgent.ensureGeoProject(response.project_id)
        : null;
      if (nextGeoProject) {
        setGeoProject(nextGeoProject);
        await refreshWorkflowState(nextGeoProject.id);
      }
      setMessages((current) => updateMessage(current, messageId, {
        confirmationState: 'output-available',
        confirmationApproved: true,
        actionBusy: false,
        knowledgeDraft: {
          ...draft,
          status: 'confirmed',
          project_id: response.project_id,
        },
        status: 'complete',
      }));
      if (response.conversation_id) {
        window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: response.conversation_id } }));
      }
      setMessages((current) => appendMessageIfMissing(current, {
        id: `knowledge-confirmed-${response.conversation_id || response.project_id}-${Date.now()}`,
        role: 'assistant',
        content: `已建立「${profileFieldText(response.profile as Record<string, unknown>, 'company_name') || '企业'}」企业知识库，并完成本地索引。\n\n已生成 ${response.total} 条知识条目。`,
        confirmationState: 'output-available',
        confirmationApproved: true,
        status: 'complete',
      }));
      window.dispatchEvent(new CustomEvent('geo-agent-conversations-refresh'));
      if (nextGeoProject?.current_phase === 'ready_for_check') {
        appendPhaseTwoPrompt(nextGeoProject, {
          force: true,
          platform: AUTO_PLATFORM,
          conversationId: response.conversation_id || draft.conversation_id || conversationId,
        }).catch(() => undefined);
      }
    } catch (error) {
      setMessages((current) => updateMessage(current, messageId, {
        content: normalizeChatError(error),
        confirmationState: 'approval-requested',
        confirmationApproved: undefined,
        actionBusy: false,
        status: 'error',
      }));
    } finally {
      setIsSending(false);
    }
  };

  const continueKnowledgeDraftInput = (messageId: string) => {
    setMessages((current) => updateMessage(current, messageId, {
      content: '可以继续上传资料或补充说明，我会基于新增内容重新生成知识库草稿。当前草稿先保留，避免流程中断。',
      confirmationState: 'approval-requested',
      confirmationApproved: undefined,
      actionBusy: false,
      status: 'complete',
    }));
  };

  const selectSkill = (skill: GeoAgentSkill) => {
    setSelectedSkill(skill);
    setIsSkillsOpen(false);
  };

  const startNewConversation = (options?: { silent?: boolean }) => {
    if (conversationId && window.geoAgent?.touchConversationSummary) {
      window.geoAgent.touchConversationSummary(conversationId, 'new_conversation')
        .then(() => window.dispatchEvent(new CustomEvent('geo-agent-conversations-refresh')))
        .catch(() => undefined);
    }
    openConversationRequestRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setInputValue('');
    setSelectedSkill(null);
    localStorage.removeItem(currentConversationStorageKey);
    if (!options?.silent) {
      window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: null } }));
    }
  };

  const openConversation = async (nextConversationId: string, options?: { silent?: boolean; storageKey?: string }) => {
    if (!window.geoAgent?.getConversation) {
      return;
    }
    const requestId = openConversationRequestRef.current + 1;
    openConversationRequestRef.current = requestId;
    const response = await window.geoAgent.getConversation(nextConversationId);
    if (requestId !== openConversationRequestRef.current) {
      return;
    }
    if (response.conversation.project_id && currentEnterprise?.id && response.conversation.project_id !== currentEnterprise.id) {
      skipNextConversationAutoRestoreRef.current = true;
      await refreshEnterprises();
      setEnterpriseId(response.conversation.project_id);
    }
    const restoredMessages = response.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => restoreConversationMessage(message));
    setConversationId(response.conversation.id);
    setMessages(normalizeRestoredWorkflowMessages(restoredMessages));
    setInputValue('');
    setSelectedSkill(null);
    localStorage.setItem(options?.storageKey ?? conversationStorageKey(response.conversation.project_id ?? currentEnterprise?.id, response.conversation.id), response.conversation.id);
    if (!options?.silent) {
      window.dispatchEvent(new CustomEvent('geo-agent-conversation-changed', { detail: { id: response.conversation.id } }));
    }
    window.dispatchEvent(new CustomEvent('geo-agent-conversations-refresh'));
  };

  const showEmptyState = messages.length === 0;
  const selectedPlatformWorkflow = workflowState?.platforms[AUTO_PLATFORM];
  const selectedStageTwoStatus = selectedPlatformWorkflow?.stages.stage_2?.status;
  const selectedStageThreeStatus = selectedPlatformWorkflow?.stages.stage_3?.status;
  const selectedStageFourStatus = selectedPlatformWorkflow?.stages.stage_4?.status;

  const emptySuggestions = hasEnterprises
    ? workflowState?.knowledge_base_ready || geoProject?.current_phase === 'ready_for_check'
      ? [
        {
          icon: GraduationCap,
          text: selectedStageFourStatus === 'completed'
            ? '发布分发已就绪'
            : selectedStageThreeStatus === 'completed'
              ? '生成支撑内容'
              : selectedStageTwoStatus === 'completed'
                ? '发现高权重信源'
                : '生成排行榜问题池',
          value: selectedStageFourStatus === 'completed'
            ? `${currentEnterprise.name}的阶段四内容资产已生成，可前往稿件管理页发布并运行推荐检测。`
            : selectedStageThreeStatus === 'completed'
              ? `基于${currentEnterprise.name}已完成的信源发现结果，生成阶段四 9 篇内容资产。`
              : selectedStageTwoStatus === 'completed'
                ? `基于${currentEnterprise.name}的排行榜问题池，继续发现当前所选平台的高权重信源。`
                : `基于${currentEnterprise.name}的企业知识库，生成当前所选平台的排行榜问题池。`,
        },
        {
          icon: Search,
          text: '查看初始关键词',
          value: `请列出${currentEnterprise.name}阶段一生成的初始关键词，并说明这些关键词适合扩展成哪些排行榜问题。`,
        },
        {
          icon: FileText,
          text: '补充知识库缺口',
          value: `检查${currentEnterprise.name}企业知识库还有哪些缺失项，优先告诉我进入阶段二前要补什么。`,
        },
      ]
      : [
        {
          icon: GraduationCap,
          text: '分析 GEO 缺口',
          value: `基于当前企业知识库，分析${currentEnterprise.name}在豆包和 DeepSeek 的 GEO 缺口。`,
        },
        {
          icon: Search,
          text: '生成长尾关键词',
          value: `根据${currentEnterprise.name}的企业知识库，生成目标关键词和长尾用户问题。`,
        },
        {
          icon: FileText,
          text: '规划内容矩阵',
          value: `基于${currentEnterprise.name}的知识库规划科普、测评、排行榜内容矩阵。`,
        },
        {
          icon: Globe,
          text: '生成官网方案',
          value: `为${currentEnterprise.name}生成一个智能托管官网规划。`,
        },
      ]
    : [
        {
          icon: Database,
          text: '建立企业知识库',
          value: '我想建立企业知识库，请引导我上传资料并生成草稿。',
        },
        {
          icon: Plus,
          text: '上传企业资料',
          value: '我准备上传 Word、PDF 或 Markdown 资料，请帮我解析并生成企业知识库草稿。',
        },
        {
          icon: Search,
          text: '准备目标关键词',
          value: '请先告诉我建立企业知识库需要哪些目标关键词和长尾用户问题。',
        },
        {
          icon: Info,
          text: '查看录入要求',
          value: '请说明建立企业知识库需要准备哪些公司资料、案例、图片和关键词。',
        },
      ];

  return (
    <TooltipProvider>
    <div className="flex h-[calc(100vh-64px)] min-h-0 w-full flex-col overflow-hidden pt-8">
      <Conversation className="min-h-0 w-full">
        <ConversationContent className="mx-auto w-full max-w-4xl gap-8 px-4 pb-8 sm:px-6 md:px-8 lg:px-xl">
          {showEmptyState && (
            <div className="mt-10 mb-6 flex w-full flex-col items-center justify-center">
              <h1 className="font-heading text-[32px] font-bold leading-tight tracking-tight text-primary">
                鲸杉GEO-Agent
              </h1>

              {!isLoadingEnterprises && !hasEnterprises ? (
                <div className="mt-6 flex w-full max-w-2xl items-start gap-3 rounded-2xl border border-secondary/20 bg-secondary/10 px-4 py-3 text-left text-[13px] leading-relaxed text-on-surface-variant">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <div>
                    <span className="font-bold text-primary">开始优化前需要先建立企业知识库。</span>
                    <span className="ml-1">你可以上传 Word、PDF、Markdown 或直接粘贴企业资料，我会先生成草稿，确认后再正式入库。</span>
                  </div>
                </div>
              ) : (
                <p className="mt-5 w-full max-w-2xl whitespace-normal px-4 text-center text-[14px] leading-relaxed text-on-surface-variant">
                  当前企业：<span className="font-semibold text-primary">{currentEnterprise.name}</span>。可以直接分析 GEO 缺口、生成长尾关键词、规划内容矩阵，或查询企业知识库。
                </p>
              )}

              <Suggestions className="mt-10 flex-wrap justify-center gap-3 whitespace-normal">
                {emptySuggestions.map((suggestion) => (
                  <QuickSuggestion
                    icon={suggestion.icon}
                    key={suggestion.text}
                    text={suggestion.text}
                    value={suggestion.value}
                    onSelect={setSuggestedPrompt}
                  />
                ))}
              </Suggestions>
            </div>
          )}

          {messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              onConfirmDraft={confirmKnowledgeDraft}
              onConfirmPhaseTwo={confirmPhaseTwo}
              onContinueKnowledgeDraft={continueKnowledgeDraftInput}
              onConfirmSupportArticles={runSupportArticlesFromDiscovery}
              onRequestSupportArticles={requestSupportArticles}
              onRunArticleDraft={runArticleDraftFromDiscovery}
              onRunSourceDiscovery={runSourceDiscoveryFromReport}
              runningStageKeys={runningStageKeys}
              workflowState={workflowState}
            />
          ))}

        </ConversationContent>
        <ConversationScrollButton className="bottom-6 border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container" />
      </Conversation>

      <div ref={inputShellRef} className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-lg pb-8 pt-4">
        <PromptInput
        className={cn(
          'relative mx-auto max-w-4xl',
          '[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch',
            '[&_[data-slot=input-group]]:!overflow-visible',
            '[&_[data-slot=input-group]]:rounded-[28px] [&_[data-slot=input-group]]:border-[#b9b6af]',
            '[&_[data-slot=input-group]]:bg-[#fffefa] [&_[data-slot=input-group]]:p-4 [&_[data-slot=input-group]]:pb-3',
            '[&_[data-slot=input-group]]:shadow-[0_12px_38px_rgba(0,0,0,0.09)]',
            '[&_[data-slot=input-group]]:focus-within:border-[#9fcaf6] [&_[data-slot=input-group]]:focus-within:ring-2 [&_[data-slot=input-group]]:focus-within:ring-[#8fc6ff]/20',
            isSending && '[&_[data-slot=input-group]]:bg-[#f3f2ee] [&_[data-slot=input-group]]:border-[#d7d4ce]',
            'dark:[&_[data-slot=input-group]]:border-[#444444] dark:[&_[data-slot=input-group]]:bg-[#1b1b1b] dark:[&_[data-slot=input-group]]:shadow-none',
            'dark:[&_[data-slot=input-group]]:focus-within:border-[#4d4d4d] dark:[&_[data-slot=input-group]]:focus-within:ring-white/10',
            isSending && 'dark:[&_[data-slot=input-group]]:bg-[#232323] dark:[&_[data-slot=input-group]]:border-[#373737]'
          )}
          accept={KNOWLEDGE_ATTACHMENT_ACCEPT}
          multiple
          onError={(error) => {
            setMessages((current) => [
              ...current,
              {
                id: `assistant-upload-error-${Date.now()}`,
                role: 'assistant',
                content: error.code === 'accept'
                  ? '当前仅支持上传 Markdown、TXT、PDF、Word 文档。'
                  : error.message,
                status: 'error',
              },
            ]);
          }}
          onSubmit={(message) => sendMessage(message.text, message.files)}
        >
          {selectedSkill && (
            <div className="mb-3 flex items-center px-1">
              <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#e9f6f3] px-3 py-1.5 text-[#0b8f84] ring-1 ring-[#b7ded7] dark:bg-[#123733] dark:text-[#67d6ca] dark:ring-[#245c56]">
                <Library className="size-3.5 shrink-0 stroke-[2.2]" />
                <span className="truncate text-[14px] font-semibold">{selectedSkill.name}</span>
                <button
                  className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[#0b8f84]/70 transition-colors hover:bg-[#cfece6] hover:text-[#08766d] dark:text-[#67d6ca]/75 dark:hover:bg-[#1e4b45] dark:hover:text-[#8af0e4]"
                  onClick={() => setSelectedSkill(null)}
                  title="移除技能"
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          )}
          <AttachmentList />
          <PromptInputTextarea
            value={inputValue}
            onChange={(event) => setInputValue(event.currentTarget.value)}
            onFocus={() => {
              setIsSkillsOpen(false);
            }}
            className="min-h-[50px] max-h-[160px] w-full resize-none border-none bg-transparent px-2 py-1 text-[15px] leading-relaxed text-[#252525] shadow-none outline-none placeholder:text-[#85817b] focus-visible:ring-0 dark:text-[#f1f1f1] dark:placeholder:text-[#9d9d9d]"
            placeholder={getSkillPlaceholder(selectedSkill)}
          />

          <PromptInputFooter className="mt-3 flex items-center justify-between border-t border-outline-variant/5 pt-1">
            <PromptInputTools className="relative flex items-center gap-1">
              <AttachmentButton />
              <PromptInputButton
                className="size-7 rounded-full text-[#6f6b64] hover:bg-[#eeeeeb] hover:text-[#34322e] dark:text-[#b6b6b6] dark:hover:bg-[#2d2d2d] dark:hover:text-[#f1f1f1]"
                onClick={() => {
                  setIsSkillsOpen((current) => !current);
                }}
                tooltip="选择技能"
              >
                <Library className="size-3.5 stroke-[2.2]" />
              </PromptInputButton>
              <AnimatePresence>
                {isSkillsOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 8 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-full left-0 z-50 mb-2 max-h-[320px] w-[280px] max-w-[calc(100vw-48px)] overflow-y-auto overscroll-contain rounded-xl border border-[#c9c3b8] !bg-[#f7f4ee] p-1.5 text-[#26231f] opacity-100 shadow-[0_18px_44px_rgba(40,34,26,0.22)] backdrop-blur-none dark:border-[#5a5a5a] dark:!bg-[#2a2a2a] dark:text-[#f4f4f4]"
                  >
                    <div className="px-2.5 pb-1 pt-1 text-[12px] font-semibold text-[#6c6258] dark:text-[#bdbdbd]">
                      Skills
                    </div>
                    {skills.length > 0 ? (
                      skills.map((skill) => (
                        <button
                          className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[#ebe5dc] dark:hover:bg-[#3a3a3a]"
                          key={skill.id}
                          onClick={() => selectSkill(skill)}
                          type="button"
                        >
                          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-secondary" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-[#26231f] dark:text-[#f8f8f8]">
                              {skill.name}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-[#756b60] dark:text-[#d0d0d0]">
                              {skill.description || '本地技能'}
                            </span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-2.5 py-3 text-[12px] leading-relaxed text-[#756b60] dark:text-[#d0d0d0]">
                        未发现本地技能。请检查项目 `.skills/` 目录。
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </PromptInputTools>

            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1 rounded-2xl bg-transparent px-2.5 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f6b64] dark:text-[#b6b6b6]" title="Task policy chooses model and network mode automatically">
                Auto
              </div>

              <PromptInputButton
                className="size-7 rounded-full text-[#6f6b64] hover:bg-[#eeeeeb] hover:text-[#34322e] dark:text-[#b6b6b6] dark:hover:bg-[#2d2d2d] dark:hover:text-[#f1f1f1]"
                tooltip="语音输入"
              >
                <Mic className="size-3.5 stroke-[2.2]" />
              </PromptInputButton>

              <AttachmentAwareSubmit
                inputValue={inputValue}
                isSending={isSending}
                selectedSkill={selectedSkill}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>

        <div className="mt-4 text-center">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">
            鲸杉GEO-Agent Studio • 安全处理空间数据
          </span>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

const AttachmentButton: React.FC = () => {
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputButton
      className="size-7 rounded-full text-[#6f6b64] hover:bg-[#eeeeeb] hover:text-[#34322e] dark:text-[#b6b6b6] dark:hover:bg-[#2d2d2d] dark:hover:text-[#f1f1f1]"
      onClick={attachments.openFileDialog}
      tooltip="上传知识库附件"
    >
      <Plus className="size-4 stroke-[2.2]" />
    </PromptInputButton>
  );
};

const AttachmentList: React.FC = () => {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-wrap gap-2 px-1">
      {attachments.files.map((file) => (
        <div
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#f0eee9] px-3 py-1.5 text-[12px] font-semibold text-[#504a43] ring-1 ring-[#d8d2c8] dark:bg-[#252525] dark:text-[#d8d8d8] dark:ring-[#3a3a3a]"
          key={file.id}
        >
          <FileText className="size-3.5 shrink-0 text-secondary" />
          <span className="max-w-[220px] truncate">{file.filename || '未命名附件'}</span>
          <button
            className="grid size-5 shrink-0 place-items-center rounded-full text-[#6f6b64] transition-colors hover:bg-[#ded8cf] hover:text-[#2f2f2f] dark:text-[#aaa] dark:hover:bg-[#383838] dark:hover:text-white"
            onClick={() => attachments.remove(file.id)}
            title="移除附件"
            type="button"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
};

const AttachmentAwareSubmit: React.FC<{
  inputValue: string;
  isSending: boolean;
  selectedSkill: GeoAgentSkill | null;
}> = ({ inputValue, isSending, selectedSkill }) => {
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputSubmit
      className="size-7 rounded-full bg-[#2f2f2f] text-white transition-all hover:bg-[#1f1f1f] disabled:bg-[#f3f3f1] disabled:text-[#b5b2ac] disabled:opacity-100 dark:bg-[#f1f1f1] dark:text-[#1b1b1b] dark:hover:bg-white dark:disabled:bg-[#252525] dark:disabled:text-[#666]"
      disabled={(!inputValue.trim() && !selectedSkill && attachments.files.length === 0) || isSending}
      status={isSending ? 'submitted' : 'ready'}
    >
      <ArrowUp className="size-3.5" />
    </PromptInputSubmit>
  );
};

const ChatBubble: React.FC<{
  message: ChatMessage;
  onContinueKnowledgeDraft: (messageId: string) => void;
  onConfirmDraft: (messageId: string, draft: GeoAgentKnowledgeDraft) => void;
  onConfirmPhaseTwo: (messageId: string, project: GeoAgentGeoProject, platform?: 'doubao' | 'deepseek') => void;
  onConfirmSupportArticles: (messageId: string, discovery: GeoAgentGeoSourceDiscovery) => void;
  onRequestSupportArticles: (messageId: string, discovery: GeoAgentGeoSourceDiscovery) => void;
  onRunArticleDraft: (messageId: string, discovery: GeoAgentGeoSourceDiscovery, articleType: 'consulting' | 'review') => void;
  onRunSourceDiscovery: (messageId: string, report: GeoAgentGeoReport) => void;
  runningStageKeys: Set<string>;
  workflowState: GeoAgentWorkflowState | null;
}> = ({ message, onContinueKnowledgeDraft, onConfirmDraft, onConfirmPhaseTwo, onConfirmSupportArticles, onRequestSupportArticles, onRunArticleDraft, onRunSourceDiscovery, runningStageKeys, workflowState }) => {
  const nextAction = getNextWorkflowAction(workflowState, message, runningStageKeys);
  if (message.role === 'user') {
    return (
      <Message from="user" className="max-w-[78%] items-end">
        <MessageContent className="!rounded-[999px] !bg-[#eeeeec] !px-5 !py-2.5 text-[15px] leading-relaxed !text-[#2f2f2f] shadow-none dark:!bg-[#2d2d2d] dark:!text-[#f1f1f1]">
          {message.content}
        </MessageContent>
      </Message>
    );
  }

  const hasProcessSteps = Boolean(
    message.reasoningSteps?.length
    || message.liveSearchSteps?.length
    || message.searchQueries?.length
    || message.draftStreamSections
  );
  const showReasoning = Boolean(message.reasoning && !hasProcessSteps);

  return (
    <Message from="assistant" className="max-w-[88%]">
      {showReasoning && (
        <Reasoning className="mb-3" defaultOpen={message.status === 'streaming'} isStreaming={message.status === 'streaming'}>
          <ReasoningTrigger className="w-fit rounded-full px-0 py-1 text-[#68707a] transition-colors hover:text-[#2f2f2f] dark:text-[#a8adb4] dark:hover:text-[#f1f1f1]">
            <Brain className="size-4" />
            <span className="text-[12px] font-semibold">{message.status === 'streaming' ? '正在思考' : '思考过程'}</span>
            <ChevronDown className="size-4 text-on-surface-variant" />
          </ReasoningTrigger>
          <ReasoningContent className="pl-6 pr-2 pt-1 text-[13px] leading-relaxed text-[#707780] dark:text-[#aeb4bc]">
            {message.reasoning}
          </ReasoningContent>
        </Reasoning>
      )}
      <MessageContent className="!w-full !max-w-full !overflow-visible !rounded-none !bg-transparent !p-0 text-[15px] leading-relaxed text-[#2f2f2f] shadow-none dark:!bg-transparent dark:text-[#f1f1f1]">
        {hasProcessSteps && (
          <AssistantChainOfThought
            content={message.reasoningContent}
            isStreaming={message.status === 'streaming'}
            liveSearchSteps={message.liveSearchSteps ?? []}
            steps={message.reasoningSteps ?? []}
            searchQueries={message.searchQueries ?? []}
          />
        )}
        {((message.sources && message.sources.length > 0) || (message.searchQueries && message.searchQueries.length > 0) || (message.searchActions && message.searchActions.length > 0)) && (
          <CitationSources
            searchActions={message.searchActions ?? []}
            searchQueries={message.searchQueries ?? []}
            searchUsage={message.searchUsage ?? {}}
            sources={message.sources ?? []}
          />
        )}
        {((message.modelDebugLines && message.modelDebugLines.length > 0) || message.draftStreamSections) && (
          <div className="mb-4 space-y-2 border-l border-[#ded8cf] pl-3 text-[12px] leading-relaxed text-[#77716a] dark:border-[#3a3a3a] dark:text-[#a8adb4]">
            {message.modelDebugLines?.map((line, index) => (
              <div key={`${line}-${index}`} className="font-mono">
                {line}
              </div>
            ))}
            {message.draftStreamSections && (
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(message.draftStreamSections).map(([section, count]) => (
                  <span
                    className="rounded-full border border-[#ded8cf] px-2 py-0.5 dark:border-[#3a3a3a]"
                    key={section}
                  >
                    {section}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {message.knowledgeDraft && (
          <KnowledgeDraftPreview
            draft={message.knowledgeDraft}
            visibleGroupCount={message.progressiveDraftGroups}
          />
        )}
        {message.phaseTwoPrompt && (
          <PhaseTwoPromptPreview
            project={message.phaseTwoPrompt}
            platform={message.phaseTwoPlatform ?? 'doubao'}
          />
        )}
        {message.phaseTwoExecution && (
          <PhaseTwoReportRunning execution={message.phaseTwoExecution} />
        )}
        {message.geoReport && (
          <GeoCheckReportCard report={message.geoReport} />
        )}
        {message.sourceDiscoveryExecution && (
          <SourceDiscoveryRunning execution={message.sourceDiscoveryExecution} />
        )}
        {message.sourceDiscovery && (
          <SourceDiscoveryCard discovery={message.sourceDiscovery} />
        )}
        {message.articleDraftExecution && (
          <ArticleDraftRunning execution={message.articleDraftExecution} />
        )}
        {message.articleDraft && (
          <ArticleDraftCard draft={message.articleDraft} />
        )}
        {message.supportArticles && (
          <SupportArticlesCard
            result={message.supportArticles}
          />
        )}
        {message.content && (
          <MessageResponse className="max-w-none">{message.content}</MessageResponse>
        )}
        {message.status === 'streaming' && (
          message.content || message.phaseTwoExecution || message.sourceDiscoveryExecution || message.articleDraftExecution
            ? <StreamingTailIndicator label={message.reasoning ?? '正在等待模型继续输出'} />
            : <ThinkingIndicator label={message.reasoning ?? '正在思考'} />
        )}
      </MessageContent>
      {message.knowledgeDraft && message.confirmationState === 'approval-requested' && isConfirmableKnowledgeDraft(message.knowledgeDraft) && (
        <AssistantConfirmationBar
          approved={message.confirmationApproved}
          id={message.knowledgeDraft.id}
          onCancel={() => onContinueKnowledgeDraft(message.id)}
          onConfirm={() => onConfirmDraft(message.id, message.knowledgeDraft!)}
          state={message.confirmationState ?? 'approval-requested'}
          title="确认后将建立企业知识库，并生成本地知识条目与向量索引。"
          confirmLabel="确认建立知识库"
          cancelLabel="继续补充资料"
          busy={message.actionBusy}
        />
      )}
      {message.phaseTwoPrompt && message.confirmationState === 'approval-requested' && (
        <AssistantConfirmationBar
          approved={message.confirmationApproved}
          id={message.phaseTwoPrompt.id}
          onCancel={() => onConfirmPhaseTwo(message.id, message.phaseTwoPrompt!, message.phaseTwoPlatform)}
          onConfirm={() => onConfirmPhaseTwo(message.id, message.phaseTwoPrompt!, message.phaseTwoPlatform)}
          state={message.confirmationState ?? 'approval-requested'}
          title={`进入阶段二，生成${platformLabelFor(message.phaseTwoPlatform ?? 'doubao')}排行榜问题池。`}
          confirmLabel={`生成${platformLabelFor(message.phaseTwoPlatform ?? 'doubao')}排行榜问题池`}
          cancelLabel="重新生成问题池"
          busy={message.actionBusy}
        />
      )}
      {message.supportArticlesPrompt && message.confirmationState === 'approval-requested' && (
        <AssistantConfirmationBar
          approved={message.confirmationApproved}
          id={message.supportArticlesPrompt.id}
          onCancel={() => onConfirmSupportArticles(message.id, message.supportArticlesPrompt!)}
          onConfirm={() => onConfirmSupportArticles(message.id, message.supportArticlesPrompt!)}
          state={message.confirmationState ?? 'approval-requested'}
          title={`生成${platformLabelFor(message.supportArticlesPrompt.platform === 'deepseek' ? 'deepseek' : 'doubao')}阶段四内容资产，会生成首轮支撑文章和排行榜文章草稿。`}
          confirmLabel="生成内容资产"
          cancelLabel="重新生成内容资产"
          busy={message.actionBusy}
        />
      )}
      {nextAction?.type === 'source_discovery' && message.geoReport && (
        <AssistantActionBar
          label={nextAction.label}
          onClick={() => onRunSourceDiscovery(message.id, message.geoReport!)}
          primaryLabel={nextAction.primaryLabel}
          busy={message.actionBusy}
        />
      )}
      {nextAction?.type === 'support_articles' && message.sourceDiscovery && (
        <AssistantActionBar
          label={nextAction.label}
          onClick={() => onRequestSupportArticles(message.id, message.sourceDiscovery!)}
          primaryLabel={nextAction.primaryLabel}
          busy={message.actionBusy}
        />
      )}
      {nextAction?.type === 'stage_five_waiting' && (
        <AssistantActionBar
          label={nextAction.label}
          onClick={() => window.dispatchEvent(new CustomEvent('geo-agent-open-view', { detail: { view: 'drafts' } }))}
          primaryLabel={nextAction.primaryLabel}
        />
      )}
    </Message>
  );
};

const AssistantChainOfThought: React.FC<{
  content?: string;
  isStreaming: boolean;
  liveSearchSteps: Array<{ query: string; status: 'in_progress' | 'completed' }>;
  steps: Array<{ label: string; detail?: string; status: 'active' | 'complete' | 'pending' }>;
  searchQueries: string[];
}> = ({ content, isStreaming, liveSearchSteps, steps, searchQueries }) => (
  <ChainOfThought className="mb-4 border-0 bg-transparent px-0 py-1 shadow-none" defaultOpen={isStreaming}>
    <ChainOfThoughtHeader className="w-fit text-[12px] font-semibold text-[#68707a] hover:text-[#2f2f2f] dark:text-[#a8adb4] dark:hover:text-[#f1f1f1]">
      {isStreaming ? (
        <Shimmer as="span" className="[--color-muted-foreground:var(--color-on-surface-variant)]" duration={1.5} spread={1.2}>
          正在处理
        </Shimmer>
      ) : '处理过程'}
    </ChainOfThoughtHeader>
    <ChainOfThoughtContent className="mt-3 space-y-2">
      {(liveSearchSteps.length > 0 || searchQueries.length > 0) && (
        <ChainOfThoughtSearchResults>
          {(liveSearchSteps.length > 0 ? liveSearchSteps.map((step) => step.query) : searchQueries).map((query) => (
            <ChainOfThoughtSearchResult
              className="border border-[#dedbd5] bg-transparent text-[#6b6761] dark:border-[#444] dark:bg-transparent dark:text-[#cfcfcf]"
              key={query}
            >
              {query}
            </ChainOfThoughtSearchResult>
          ))}
        </ChainOfThoughtSearchResults>
      )}
      {liveSearchSteps.map((step) => (
        <ChainOfThoughtStep
          className="text-[#6b6761] dark:text-[#cfcfcf]"
          key={step.query}
          label={step.status === 'completed' ? '已完成搜索' : '正在搜索'}
          status={step.status === 'completed' ? 'complete' : 'active'}
        >
          <div className="text-[12px] text-[#86817a] dark:text-[#9a9a9a]">{step.query}</div>
        </ChainOfThoughtStep>
      ))}
      {steps.map((step, index) => (
        <ChainOfThoughtStep
          className="text-[#6b6761] dark:text-[#cfcfcf]"
          key={`${step.label}-${index}`}
          label={step.label}
          status={step.status}
        >
          {step.detail && <div className="text-[12px] text-[#86817a] dark:text-[#9a9a9a]">{step.detail}</div>}
        </ChainOfThoughtStep>
      ))}
      {content && (
        <ChainOfThoughtStep
          className="text-[#6b6761] dark:text-[#cfcfcf]"
          icon={Brain}
          label={isStreaming ? '模型正在组织推理' : '模型推理摘要'}
          status={isStreaming ? 'active' : 'complete'}
        >
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#4b4742] dark:text-[#d8d8d8]">
            {content}
          </div>
        </ChainOfThoughtStep>
      )}
    </ChainOfThoughtContent>
  </ChainOfThought>
);

const KnowledgeDraftPreview: React.FC<{
  draft: GeoAgentKnowledgeDraft;
  visibleGroupCount?: number;
}> = ({ draft, visibleGroupCount }) => {
  const profile = draft.profile;
  const fileNames = draft.assets.map((asset) => asset.filename);
  const previewLongTail = buildLongTailPreview(profile);
  const isFailed = !isConfirmableKnowledgeDraft(draft);
  const visibleGroups = DRAFT_PREVIEW_GROUPS
    .map((group) => ({
      ...group,
      visibleFields: group.fields.filter(([field]) => hasProfileValue(profile[field])),
    }))
    .filter((group) => group.visibleFields.length > 0);
  const normalizedVisibleGroupCount = typeof visibleGroupCount === 'number'
    ? Math.max(0, Math.min(visibleGroupCount, visibleGroups.length))
    : visibleGroups.length;
  const shouldShowSupplement = normalizedVisibleGroupCount >= visibleGroups.length;

  return (
    <div className="mb-5 text-[#2f2f2f] dark:text-[#f1f1f1]">
      {isFailed && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
          {draft.error_message || draft.warnings?.[0] || 'Knowledge draft creation failed. Please upload valid enterprise materials and try again.'}
        </div>
      )}
      <div className="mb-4 flex flex-col gap-1 border-b border-outline-variant/20 pb-3">
        <div className="flex items-center gap-2 text-[14px] font-bold text-primary">
          <Database className="size-4 text-secondary" />
          企业知识库草稿预览
        </div>
        <p className="text-[12px] leading-relaxed text-on-surface-variant">
          这是调度模型按知识库录入技能从资料中抽取的模板。确认前不会写入正式知识库。
        </p>
      </div>

      <div className="grid gap-4">
        {visibleGroups.slice(0, normalizedVisibleGroupCount).map((group) => {
          return (
            <section className="border-b border-outline-variant/15 pb-3 last:border-b-0" key={group.title}>
              <h4 className="mb-2 text-[12px] font-bold text-[#5d574f] dark:text-[#cfcfcf]">
                {group.title}
              </h4>
              <div className="grid gap-2">
                {group.visibleFields.map(([field, label]) => (
                  <div className="grid gap-1" key={field}>
                    <span className="text-[11px] font-semibold text-[#8a837a] dark:text-[#969696]">{label}</span>
                    <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#34312d] dark:text-[#eeeeee]">
                      {profileFieldText(profile as Record<string, unknown>, field)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {shouldShowSupplement && previewLongTail.length > 0 && (
        <section className="mt-3 border-b border-outline-variant/15 pb-3">
          <h4 className="mb-2 text-[12px] font-bold text-[#5d574f] dark:text-[#cfcfcf]">
            预计生成长尾语义词
          </h4>
          <div className="flex flex-wrap gap-2">
            {previewLongTail.slice(0, 8).map((keyword) => (
              <span className="rounded-full bg-[#f0eee9] px-2.5 py-1 text-[11px] font-semibold text-[#6b6258] dark:bg-[#2d2d2d] dark:text-[#d4d4d4]" key={keyword}>
                {keyword}
              </span>
            ))}
          </div>
        </section>
      )}

      {shouldShowSupplement && (draft.missing_fields.length > 0 || fileNames.length > 0) && (
        <div className="mt-3 grid gap-2 text-[12px] text-[#6b6258] dark:text-[#cfcfcf]">
          {fileNames.length > 0 && (
            <div className="truncate">
              <span className="font-bold">来源附件：</span>
              {fileNames.join('、')}
            </div>
          )}
          {draft.missing_fields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">待补充字段：</span>
              {draft.missing_fields.map((field) => (
                <span className="rounded-full bg-[#f0eee9] px-2.5 py-1 text-[11px] font-semibold text-[#6b6258] dark:bg-[#2d2d2d] dark:text-[#d4d4d4]" key={field}>
                  {field}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PhaseTwoPromptPreview: React.FC<{
  project: GeoAgentGeoProject;
  platform: 'doubao' | 'deepseek';
}> = ({ project, platform }) => (
  <div className="mb-5 border-b border-outline-variant/20 pb-4 text-[#2f2f2f] dark:text-[#f1f1f1]">
    <div className="mb-3 flex items-center gap-2 text-[14px] font-bold text-primary">
      <GraduationCap className="size-4 text-secondary" />
      {platformLabelFor(platform)}阶段二排行榜问题池
    </div>
    <div className="grid gap-3 text-[13px] leading-relaxed text-on-surface-variant">
      <div>
        <span className="font-bold text-primary">企业：</span>
        {project.company_name || '企业'}
      </div>
      <div>
        <span className="font-bold text-primary">初始关键词：</span>
        {Array.isArray(project.initial_keywords) && project.initial_keywords.length > 0 ? project.initial_keywords.join('、') : '暂无'}
      </div>
      <div>
        <span className="font-bold text-primary">目标平台：</span>
        {platformLabelFor(platform)}
      </div>
      <p>
        确认后会基于企业知识库生成 {platformLabelFor(platform)} 平台的用户真实问题池和高优先级排行榜问题，并保存到独立平台状态，不写入企业知识库事实条目。
      </p>
    </div>
  </div>
);

const PHASE_TWO_REPORT_STEPS = [
  '读取企业知识库',
  '提取初始关键词',
  '生成用户真实问题池',
  '筛选高优先级排行榜问题',
  '保存平台问题池结果',
];

const SOURCE_DISCOVERY_STEPS = [
  '读取排行榜问题池',
  '筛选 3 条实测问题',
  '询问目标 AI 推荐信源',
  '观察排行榜问题引用线索',
  '清洗可核验引用证据',
  '保存平台信源结果',
];

const ARTICLE_DRAFT_STEPS = [
  '读取企业事实知识库',
  '匹配排行榜问题和信源',
  '生成咨询类支撑文章',
  '生成测评类支撑文章',
  '保存阶段四草稿',
];

const ARTICLE_DRAFT_QUEUE_ITEMS = [
  { title: '企业/品牌支撑文章', description: '建立企业事实、品牌形象和基础信任' },
  { title: '企业优势/信任背书稿', description: '沉淀优势、资质、服务承诺和背书证据' },
  { title: '本地服务/售后承诺稿', description: '覆盖区域服务、交付能力和售后承诺' },
  { title: '业务/服务测评文章', description: '面向用户选型场景输出测评型内容' },
  { title: '真实案例/口碑展示稿', description: '沉淀案例、客户反馈和可引用证据' },
  { title: '工艺流程/选择标准稿', description: '解释服务流程、选择标准和避坑要点' },
  { title: '综合推荐/行业排行稿', description: '承接核心推荐类问题的榜单内容' },
  { title: '区域推荐/本地榜单稿', description: '承接区域服务商、本地推荐问题' },
  { title: '细分场景/人群推荐稿', description: '承接场景化、长尾和人群细分问题' },
];

const StageExecutionTask: React.FC<{
  activeStep: number;
  icon: React.ElementType;
  steps: string[];
  subtitle?: string;
  title: string;
  children?: React.ReactNode;
}> = ({ activeStep, children, icon: Icon, steps, subtitle, title }) => {
  const displayActiveStep = Math.min(Math.max(activeStep, 0), Math.max(steps.length - 1, 0));
  return (
    <Task className="mb-5 rounded-2xl bg-white/60 p-4 dark:bg-[#1f1f1f]/70" defaultOpen>
      <TaskTrigger title={title}>
        <div className="flex w-full cursor-pointer items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-bold text-primary">
              <Icon className="size-4 text-secondary" />
              <span>{title}</span>
            </div>
            {subtitle && <p className="mt-1 text-[12px] text-on-surface-variant">{subtitle}</p>}
          </div>
          <span className="flex shrink-0 gap-1">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                className="size-1.5 rounded-full bg-secondary/80"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.16 }}
              />
            ))}
          </span>
        </div>
      </TaskTrigger>
      <TaskContent className="mt-3">
        {steps.map((step, index) => {
          const isActive = index === displayActiveStep;
          const isDone = index < displayActiveStep;
          return (
            <TaskItem
              className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] transition-colors',
                isActive && 'bg-[#eef6ff] text-[#1167d8] dark:bg-[#17324d] dark:text-[#9fcfff]',
                isDone && 'text-[#0b8f84]',
                !isActive && !isDone && 'text-on-surface-variant/70'
              )}
              key={step}
            >
              {isDone ? <Check className="size-3.5" /> : <span className={cn('size-2 rounded-full', isActive ? 'bg-secondary' : 'bg-outline-variant')} />}
              <span className="font-semibold">{step}</span>
              {isActive && <span className="ml-auto text-[11px]">进行中</span>}
            </TaskItem>
          );
        })}
        {children}
      </TaskContent>
    </Task>
  );
};

const PhaseTwoReportRunning: React.FC<{
  execution: NonNullable<ChatMessage['phaseTwoExecution']>;
}> = ({ execution }) => (
  <StageExecutionTask
    activeStep={execution.activeStep}
    icon={Target}
    steps={PHASE_TWO_REPORT_STEPS}
    subtitle={execution.companyName}
    title={`正在生成${platformLabelFor(execution.platform)}排行榜问题池`}
  />
);

const SourceDiscoveryRunning: React.FC<{
  execution: NonNullable<ChatMessage['sourceDiscoveryExecution']>;
}> = ({ execution }) => (
  <StageExecutionTask
    activeStep={execution.activeStep}
    icon={Globe}
    steps={SOURCE_DISCOVERY_STEPS}
    subtitle="这一步只盘点可核验证据和待验证候选，不生成发布计划。"
    title={`正在盘点${platformLabelFor(execution.platform)}信源证据`}
  />
);

const ArticleDraftQueue: React.FC<{
  activeStep: number;
}> = ({ activeStep }) => {
  const completedCount = Math.min(Math.max(activeStep, 0), ARTICLE_DRAFT_QUEUE_ITEMS.length);
  const activeIndex = activeStep >= 0 && activeStep < ARTICLE_DRAFT_QUEUE_ITEMS.length ? activeStep : -1;
  return (
    <Queue className="mt-3 border-0 bg-transparent px-0 pb-0 pt-0 shadow-none">
      <QueueSection defaultOpen>
        <QueueSectionTrigger className="bg-surface-container-low/85 px-3 py-2 text-on-surface hover:bg-surface-container dark:bg-[#202020]">
          <QueueSectionLabel
            count={ARTICLE_DRAFT_QUEUE_ITEMS.length}
            icon={<FileText className="size-3.5 text-secondary" />}
            label="篇内容资产队列"
          />
          <span className="text-[11px] font-medium text-on-surface-variant">
            {completedCount}/{ARTICLE_DRAFT_QUEUE_ITEMS.length} 已完成
          </span>
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList className="mt-2">
            {ARTICLE_DRAFT_QUEUE_ITEMS.map((item, index) => {
              const isActive = index === activeIndex;
              const isCompleted = index < completedCount;
              return (
                <QueueItem
                  className={cn(
                    'px-3 py-2 hover:bg-surface-container-low',
                    isActive && 'bg-[#eef6ff] dark:bg-[#17324d]'
                  )}
                  key={item.title}
                >
                  <div className="flex items-start gap-2">
                    <QueueItemIndicator
                      className={cn(isActive && 'border-secondary bg-secondary')}
                      completed={isCompleted}
                    />
                    <div className="min-w-0 flex-1">
                      <QueueItemContent
                        className={cn(
                          'text-[12px] font-semibold',
                          isActive && 'text-[#1167d8] dark:text-[#9fcfff]',
                          isCompleted ? 'text-[#0b8f84]' : !isActive && 'text-on-surface-variant'
                        )}
                      >
                        {item.title}
                      </QueueItemContent>
                      <QueueItemDescription
                        className={cn('ml-0 mt-0.5', isCompleted && 'text-[#0b8f84]/70')}
                      >
                        {item.description}
                      </QueueItemDescription>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[11px] font-medium',
                        isActive ? 'text-[#1167d8] dark:text-[#9fcfff]' : 'text-on-surface-variant/70',
                        isCompleted && 'text-[#0b8f84]'
                      )}
                    >
                      {isCompleted ? '已完成' : isActive ? '生成中' : '待生成'}
                    </span>
                  </div>
                </QueueItem>
              );
            })}
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
};

const ArticleDraftRunning: React.FC<{
  execution: NonNullable<ChatMessage['articleDraftExecution']>;
}> = ({ execution }) => (
  <StageExecutionTask
    activeStep={execution.activeStep}
    icon={FileText}
    steps={ARTICLE_DRAFT_STEPS}
    subtitle="这一步只生成排行榜前置支撑内容，不生成排行榜文章。"
    title={`正在生成${platformLabelFor(execution.platform)}阶段四内容资产`}
  >
    <ArticleDraftQueue activeStep={execution.activeStep} />
  </StageExecutionTask>
);

const GeoCheckReportCard: React.FC<{ report: GeoAgentGeoReport }> = ({ report }) => {
  if (report.status === 'failed') {
    return (
      <div className="mb-5 rounded-2xl bg-red-50 p-4 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-200">
        {report.error_message || '阶段二报告生成失败'}
      </div>
    );
  }
  const platformLabel = platformLabelFor(report.platform === 'deepseek' ? 'deepseek' : 'doubao');
  const coreQuestions = (report.report.confirmed_questions ?? report.report.question_pool ?? []) as unknown[];
  const rankingQuestions = (report.report.ranking_questions ?? coreQuestions) as unknown[];
  return (
    <div className="mb-5 space-y-4 border-b border-outline-variant/20 pb-5">
      <div>
        <div className="flex items-center gap-2 text-[14px] font-bold text-primary">
          <Target className="size-4 text-secondary" />
          {platformLabel} 阶段二结果：10 条核心问题
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">{report.report.summary || '已基于企业知识库和目标词生成 10 条核心问题。'}</p>
      </div>
      <div className="rounded-2xl bg-[#eef6ff] p-4 text-[13px] leading-relaxed text-[#174d88] dark:bg-[#17324d] dark:text-[#c9e4ff]">
        <div className="font-bold">第二步主要做什么？</div>
        <p className="mt-1">
          它不是写文章，也不是发稿；它是基于企业知识库和 target_keywords 直接生成 10 条核心用户问题，作为阶段三信源发现、首轮 9 篇稿件和 Visibility Rate 检测的输入。
        </p>
      </div>
      <ReportSection
        title="本阶段核心问题"
        items={coreQuestions}
        limit={10}
        variant="strong"
      />
      <ReportSection
        title="排行榜/推荐倾向问题"
        items={rankingQuestions}
        limit={7}
        compact
      />
      <details className="rounded-2xl bg-white/50 p-3 text-[12px] dark:bg-[#1f1f1f]/70">
        <summary className="cursor-pointer font-bold text-primary">查看问题池结构</summary>
        <div className="mt-3">
          <ReportSection title="候选兼容列表" items={report.report.candidate_questions ?? []} limit={10} compact />
        </div>
      </details>
    </div>
  );
};

const SourceDiscoveryCard: React.FC<{ discovery: GeoAgentGeoSourceDiscovery }> = ({ discovery }) => {
  const platformLabel = platformLabelFor(discovery.platform === 'deepseek' ? 'deepseek' : 'doubao');
  const verifiedSources = (discovery.discovery.verified_observed_sources ?? discovery.discovery.observed_citation_sources ?? []) as unknown[];
  const candidateSources = (discovery.discovery.channel_priorities ?? discovery.discovery.candidate_sources ?? discovery.discovery.ai_recommended_sources ?? []) as unknown[];
  const searchedQuestionCount = Number(discovery.discovery.searched_question_count ?? 0);
  const skippedQuestionCount = Number(discovery.discovery.skipped_question_count ?? 0);
  const searchedQuestions = (discovery.discovery.searched_questions ?? []) as unknown[];
  if (discovery.discovery.status === 'failed') {
    return (
      <div className="mb-5 rounded-2xl bg-red-50 p-4 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-200">
        {discovery.discovery.summary || '高权重信源发现失败'}
      </div>
    );
  }
  return (
    <div className="mb-5 space-y-4 border-b border-outline-variant/20 pb-5">
      <div>
        <div className="flex items-center gap-2 text-[14px] font-bold text-primary">
          <Globe className="size-4 text-secondary" />
          {platformLabel} 阶段三结果：信源证据盘点
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">
          {discovery.discovery.summary || '已完成信源证据盘点。'}
        </p>
      </div>
      <div className="rounded-2xl bg-[#eef6ff] p-4 text-[13px] leading-relaxed text-[#174d88] dark:bg-[#17324d] dark:text-[#c9e4ff]">
        <div className="font-bold">第三步主要做什么？</div>
        <p className="mt-1">
          它不是写文章，也不是发布计划；它只实测最关键的排行榜/推荐问题，用来判断哪些来源已有可核验证据。
        </p>
        {searchedQuestionCount > 0 && (
          <p className="mt-2 font-semibold">
            本次实测 {searchedQuestionCount} 条问题{skippedQuestionCount > 0 ? `，其余 ${skippedQuestionCount} 条保留为后续内容与检测输入。` : '。'}
          </p>
        )}
      </div>
      {searchedQuestions.length > 0 && (
        <ReportSection title="本次实测问题" items={searchedQuestions} limit={3} compact />
      )}
      {verifiedSources.length > 0 ? (
        <ReportSection title="已验证引用来源" items={verifiedSources} limit={5} variant="strong" />
      ) : (
        <div className="rounded-xl bg-[#f7f7f5] px-3 py-2 text-[12px] leading-relaxed text-on-surface-variant dark:bg-[#2a2a2a]">
          暂无可核验引用来源，需在联网检索或目标 AI 引用结果中补充 URL 后再作为实测信源。
        </div>
      )}
      <ReportSection
        title="待验证候选信源"
        items={candidateSources}
        limit={5}
        compact
      />
      <ReportSection
        title="综合证据评分"
        items={discovery.discovery.source_scores ?? []}
        limit={5}
        compact
      />
    </div>
  );
};

const ArticleDraftCard: React.FC<{ draft: GeoAgentGeoArticleDraft }> = ({ draft }) => {
  const typeLabel = articleTypeLabelFor(draft.article_type === 'review' ? 'review' : 'consulting');
  if (draft.status === 'failed') {
    return (
      <div className="mb-5 rounded-2xl bg-red-50 p-4 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-200">
        {draft.draft.error_message || `${typeLabel}支撑文章生成失败`}
      </div>
    );
  }
  return (
    <div className="mb-5 space-y-4 border-b border-outline-variant/20 pb-5">
      <div>
        <div className="flex items-center gap-2 text-[14px] font-bold text-primary">
          <FileText className="size-4 text-secondary" />
          阶段四结果：{typeLabel}支撑文章
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">
          {draft.draft.title || '已生成支撑文章草稿。'}
        </p>
      </div>
      <div className="grid gap-2 rounded-2xl bg-white/60 p-4 text-[12px] leading-relaxed text-on-surface-variant dark:bg-[#1f1f1f]/70">
        <div><span className="font-bold text-primary">目标问题：</span>{draft.draft.target_question || '未指定'}</div>
        <div><span className="font-bold text-primary">建议渠道：</span>{draft.draft.publish_target || '待根据信源确认'}</div>
      </div>
      <ReportSection title="文章大纲" items={draft.draft.outline ?? []} limit={8} />
      <ReportSection title="使用的企业事实" items={draft.draft.facts_used ?? []} limit={5} />
      <ReportSection title="建议引用信源" items={draft.draft.sources_to_reference ?? []} limit={5} />
      {(draft.draft.missing_facts ?? []).length > 0 && (
        <ReportSection title="仍需补充事实" items={draft.draft.missing_facts ?? []} limit={5} />
      )}
      <details className="rounded-2xl bg-white/50 p-3 text-[12px] dark:bg-[#1f1f1f]/70">
        <summary className="cursor-pointer font-bold text-primary">查看完整草稿</summary>
        <div className="mt-3 max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#faf9f7] p-4 leading-relaxed text-[#2f2f2f] dark:bg-[#161616] dark:text-[#f1f1f1]">
          {draft.draft.content || '暂无正文'}
        </div>
      </details>
    </div>
  );
};

const SupportArticlesCard: React.FC<{
  result: GeoAgentGeoSupportArticleRunResponse;
}> = ({ result }) => {
  const supportDrafts = Array.isArray(result.support_drafts) ? result.support_drafts : [];
  const rankingDrafts = Array.isArray(result.ranking_drafts) ? result.ranking_drafts : [];
  const allDrafts = [...supportDrafts, ...rankingDrafts];
  return (
    <div className="mb-5 space-y-4 border-b border-outline-variant/20 pb-5">
      <div>
        <div className="flex items-center gap-2 text-[14px] font-bold text-primary">
          <FileText className="size-4 text-secondary" />
          阶段四结果：首轮 9 篇内容资产
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">
          已生成 9 篇内容资产，可前往稿件管理校对、AI 改稿、OSS 预览和投递。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SupportArticleSummaryCard draft={result.consulting_draft ?? null} label="企业/品牌支撑文章" />
        <SupportArticleSummaryCard draft={result.review_draft ?? null} label="业务/测评支撑文章" />
      </div>
      {allDrafts.length > 0 && (
        <div className="rounded-2xl bg-white/50 p-4 text-[12px] leading-relaxed text-on-surface-variant dark:bg-[#1f1f1f]/70">
          <div className="mb-2 font-bold text-primary">全部草稿（{allDrafts.length} 篇）</div>
          <div className="grid gap-2">
            {allDrafts.map((draft) => (
              <div key={draft.id} className="rounded-xl bg-[#faf9f7] px-3 py-2 dark:bg-[#161616]">
                <div className="font-semibold text-[#2f2f2f] dark:text-[#f1f1f1]">{draft.draft.title || '未命名草稿'}</div>
                <div className="mt-1">
                  {draft.draft.article_role === 'ranking' ? '排行榜文章' : '支撑文章'} · {draft.draft.article_theme || draft.article_type}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.error_message && (
        <div className="rounded-2xl bg-red-50 p-4 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-200">
          {result.error_message}
        </div>
      )}
    </div>
  );
};

const SupportArticleSummaryCard: React.FC<{
  draft: GeoAgentGeoArticleDraft | null;
  label: string;
}> = ({ draft, label }) => (
  <div className="rounded-2xl bg-white/60 p-4 text-[12px] leading-relaxed text-on-surface-variant dark:bg-[#1f1f1f]/70">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="font-bold text-primary">{label}</span>
    </div>
    {!draft ? (
      <div>暂未生成</div>
    ) : draft.status === 'failed' ? (
      <div className="text-red-600 dark:text-red-300">{draft.draft.error_message || '生成失败'}</div>
    ) : (
      <div className="space-y-2">
        <div className="font-semibold text-[#2f2f2f] dark:text-[#f1f1f1]">{draft.draft.title || '未命名草稿'}</div>
        <div><span className="font-bold">目标问题：</span>{draft.draft.target_question || '未指定'}</div>
        <details>
          <summary className="cursor-pointer font-bold text-primary">查看正文</summary>
          <div className="mt-2 max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#faf9f7] p-3 dark:bg-[#161616]">
            {draft.draft.content || '暂无正文'}
          </div>
        </details>
      </div>
    )}
  </div>
);

const ReportSection: React.FC<{
  title: string;
  items: unknown[];
  limit?: number;
  compact?: boolean;
  variant?: 'default' | 'strong';
}> = ({ title, items, limit = 5, compact = false, variant = 'default' }) => (
  <div>
    <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-primary">{title}</h4>
    <div className="grid gap-2">
      {(items.length ? items : ['暂无']).slice(0, limit).map((item, index) => (
        <div
          className={cn(
            'rounded-xl px-3 py-2 text-[12px] leading-relaxed dark:bg-[#1f1f1f]',
            variant === 'strong'
              ? 'bg-[#f7f4ee] text-[#2f2f2f] dark:text-[#f1f1f1]'
              : 'bg-white/60 text-on-surface-variant',
            compact && 'py-1.5'
          )}
          key={`${title}-${index}`}
        >
          {formatReportItem(item, compact)}
        </div>
      ))}
    </div>
  </div>
);

const AssistantActionBar: React.FC<{
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  primaryLabel: string;
  busy?: boolean;
}> = ({ disabled = false, label, onClick, primaryLabel, busy = false }) => (
  <AssistantWorkflowActionBar
    busy={busy}
    cancelLabel=""
    confirmLabel={primaryLabel}
    disabled={disabled}
    id={`action-${primaryLabel}`}
    onConfirm={onClick}
    state="approval-requested"
    title={label}
    variant="action"
  />
);

const AssistantConfirmationBar: React.FC<{
  approved?: boolean;
  cancelLabel: string;
  confirmLabel: string;
  id: string;
  onCancel: () => void;
  onConfirm: () => void;
  state: 'approval-requested' | 'approval-responded' | 'output-available';
  title: string;
  busy?: boolean;
}> = ({ approved, cancelLabel, confirmLabel, id, onCancel, onConfirm, state, title, busy = false }) => (
  <AssistantWorkflowActionBar
    approved={approved}
    busy={busy}
    cancelLabel={cancelLabel}
    confirmLabel={confirmLabel}
    id={id}
    onCancel={onCancel}
    onConfirm={onConfirm}
    state={state}
    title={title}
  />
);

const workflowPrimaryClass = 'rounded-2xl bg-secondary px-5 py-2 text-[13px] font-bold text-on-secondary hover:opacity-90 disabled:cursor-wait disabled:opacity-70';
const workflowSecondaryClass = 'rounded-2xl border border-outline-variant/50 bg-white px-5 py-2 text-[13px] font-bold text-primary hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#1f1f1f]';

const AssistantWorkflowActionBar: React.FC<{
  approved?: boolean;
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  disabled?: boolean;
  id: string;
  onCancel?: () => void;
  onConfirm?: () => void;
  state: 'approval-requested' | 'approval-responded' | 'output-available';
  title: string;
  variant?: 'confirmation' | 'action';
}> = ({
  approved,
  busy = false,
  cancelLabel,
  confirmLabel,
  disabled = false,
  id,
  onCancel,
  onConfirm,
  state,
  title,
  variant = 'confirmation',
}) => (
  <MessageActions className="ml-auto mt-2 justify-end">
    <Confirmation
      approval={approved === undefined ? { id } : { id, approved }}
      className="w-fit border-0 bg-transparent p-0 shadow-none"
      state={state}
    >
      <ConfirmationRequest>
        <div className="flex flex-col items-end gap-2">
          <ConfirmationTitle className="max-w-[520px] text-right text-[12px] text-[#6b6258] dark:text-[#cfcfcf]">
            {title}
          </ConfirmationTitle>
          <ConfirmationActions className="justify-end gap-2">
            <ConfirmationAction
              className={cn(workflowPrimaryClass, disabled && 'cursor-default border border-outline-variant/60 bg-transparent text-on-surface-variant hover:opacity-100')}
              disabled={busy || disabled}
              onClick={onConfirm}
            >
              {busy ? '执行中...' : confirmLabel}
            </ConfirmationAction>
            {variant === 'confirmation' && cancelLabel && (
              <ConfirmationAction
                className={workflowSecondaryClass}
                disabled={busy}
                onClick={onCancel}
              >
                {cancelLabel}
              </ConfirmationAction>
            )}
          </ConfirmationActions>
        </div>
      </ConfirmationRequest>
    </Confirmation>
  </MessageActions>
);

const CitationSources: React.FC<{
  searchActions: SearchAction[];
  searchQueries: string[];
  searchUsage: SearchUsage;
  sources: SourceCitation[];
}> = ({ searchActions, searchQueries, searchUsage, sources }) => {
  const displayQueries = searchActions.length > 0
    ? searchActions.map((action) => action.query).filter((query): query is string => Boolean(query))
    : searchQueries;
  const toolCallCount = typeof searchUsage.tool_usage === 'number'
    ? searchUsage.tool_usage
    : searchActions.length;
  const sourceUsageEntries = Object.entries(searchUsage.tool_usage_details ?? {});
  const hasSearchTrace = displayQueries.length > 0 || searchActions.length > 0 || toolCallCount > 0;

  return (
    <Sources className="mb-5 text-[#1167d8] dark:text-[#7db4ff]" defaultOpen>
      <SourcesTrigger
        className="w-fit rounded-full px-0 text-[13px] font-medium text-[#6f7782] transition-colors hover:text-[#1167d8] dark:text-[#aab0b8] dark:hover:text-[#7db4ff]"
        count={sources.length}
      >
        <span>
          {displayQueries.length > 0 && `搜索 ${displayQueries.length} 个关键词`}
          {toolCallCount > 0 && `${displayQueries.length > 0 ? '，' : ''}调用 ${toolCallCount} 次`}
          {(displayQueries.length > 0 || toolCallCount > 0) && sources.length > 0 && '，'}
          {sources.length > 0 ? `参考 ${sources.length} 篇资料` : '暂无可点击来源'}
        </span>
        <ChevronDown className="size-4" />
      </SourcesTrigger>
      <SourcesContent className="mt-3 w-full max-w-full gap-2">
        {sourceUsageEntries.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {sourceUsageEntries.map(([sourceName, value]) => (
              <span
                className="rounded-full bg-[#e6eef8] px-2.5 py-1 text-[12px] font-medium text-[#53606d] dark:bg-[#303640] dark:text-[#c9d4e2]"
                key={sourceName}
              >
                {sourceName}: {formatUsageValue(value)}
              </span>
            ))}
          </div>
        )}
        {searchActions.length > 0 ? (
          <div className="mb-2 space-y-2">
            {searchActions.map((action, index) => (
              <div
                className="rounded-xl border border-[#d7dee8] bg-[#eef4fb] px-3 py-2 text-[12px] text-[#53606d] dark:border-[#3c4654] dark:bg-[#303640] dark:text-[#c9d4e2]"
                key={`${action.query ?? 'search'}-${index}`}
              >
                <div className="font-semibold text-[#26313d] dark:text-[#f4f7fb]">
                  {action.query || `搜索动作 ${index + 1}`}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {action.type && <span>动作：{action.type}</span>}
                  {action.sources && action.sources.length > 0 && (
                    <span>来源：{action.sources.join('、')}</span>
                  )}
                  {typeof action.max_keyword === 'number' && (
                    <span>关键词上限：{action.max_keyword}</span>
                  )}
                  {typeof action.limit === 'number' && (
                    <span>结果上限：{action.limit}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : searchQueries.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-2">
            {searchQueries.map((query) => (
              <span
                className="rounded-full bg-[#e6eef8] px-2.5 py-1 text-[12px] font-medium text-[#53606d] dark:bg-[#303640] dark:text-[#c9d4e2]"
                key={query}
              >
                {query}
              </span>
            ))}
          </div>
        )}
        {hasSearchTrace && sources.length > 0 && sources.length < 5 && (
          <div className="mb-2 rounded-lg border border-[#ead8a7] bg-[#fff8df] px-3 py-2 text-[12px] text-[#7a5b13] dark:border-[#6f5d2b] dark:bg-[#3a321e] dark:text-[#e6cf85]">
            本次豆包返回的可点击引用来源较少；系统只展示 API 返回的结构化引用，不伪造来源。
          </div>
        )}
        {sources.map((source, index) => (
          <Source
            className="group flex max-w-full items-start gap-2 rounded-lg px-0 py-1 text-[14px] leading-relaxed text-[#0969da] transition-colors hover:text-[#064f9f] dark:text-[#7db4ff] dark:hover:text-[#a9ccff]"
            href={source.url}
            key={`${source.url}-${index}`}
            title={source.title}
          >
            <SourceIcon source={source} />
            <span className="min-w-0 flex-1">
              <span className="block break-words underline-offset-4 group-hover:underline">
                {source.title}
              </span>
              <span className="mt-0.5 block break-all text-[12px] text-[#6f7782] group-hover:text-[#53606d] dark:text-[#aab0b8] dark:group-hover:text-[#c7d0dc]">
                {getHostname(source.url)}
              </span>
            </span>
          </Source>
        ))}
      </SourcesContent>
    </Sources>
  );
};

const SourceIcon: React.FC<{ source: SourceCitation }> = ({ source }) => {
  if (source.logo_url) {
    return (
      <img
        alt=""
        className="size-4 shrink-0 rounded-sm"
        src={source.logo_url}
      />
    );
  }

  const hostname = getHostname(source.url);
  return (
    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[#e6eef8] text-[9px] font-bold text-[#4f6178] dark:bg-[#303640] dark:text-[#c9d4e2]">
      {hostname.slice(0, 1).toUpperCase()}
    </span>
  );
};

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const formatUsageValue = (value: unknown) => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const count = (value as { count?: unknown; usage?: unknown; total?: unknown }).count
      ?? (value as { count?: unknown; usage?: unknown; total?: unknown }).usage
      ?? (value as { count?: unknown; usage?: unknown; total?: unknown }).total;
    if (typeof count === 'number' || typeof count === 'string') {
      return count;
    }
  }
  return '已调用';
};

const ThinkingIndicator: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-2.5 text-on-surface-variant">
    <Shimmer as="span" className="text-[13px] font-medium [--color-muted-foreground:var(--color-on-surface-variant)]" duration={1.5} spread={1.35}>
      {label || '正在思考'}
    </Shimmer>
    <span className="flex gap-1">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-1.5 rounded-full bg-secondary/80"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.16 }}
        />
      ))}
    </span>
  </div>
);

const StreamingTailIndicator: React.FC<{ label: string }> = ({ label }) => (
  <div className="mt-3 flex items-center gap-2.5 text-on-surface-variant">
    <Shimmer as="span" className="text-[12px] font-medium [--color-muted-foreground:var(--color-on-surface-variant)]" duration={1.5} spread={1.2}>
      {`仍在执行：${label || '正在等待模型继续输出'}`}
    </Shimmer>
    <span className="flex gap-1">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-1 rounded-full bg-secondary/70"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.16 }}
        />
      ))}
    </span>
  </div>
);

function restoreConversationMessage(message: GeoAgentConversationMessage): ChatMessage {
  const messageProjectId = (message as { project_id?: string }).project_id;
  const baseMessage = {
    id: message.id,
    role: message.role as 'user' | 'assistant',
    status: 'complete' as const,
  };
  const metadata = message.metadata ?? {};

  if (message.role === 'assistant' && metadata.type === 'knowledge_draft') {
    const draft = metadata.draft as GeoAgentKnowledgeDraft | undefined;
    const confirmationState = typeof metadata.confirmation_state === 'string'
      ? metadata.confirmation_state as ChatMessage['confirmationState']
      : 'approval-requested';
    return {
      ...baseMessage,
      content: message.content.startsWith(KNOWLEDGE_DRAFT_MESSAGE_MARKER)
        ? '我已根据资料生成企业知识库草稿。请先核对下方模板内容。'
        : message.content,
      knowledgeDraft: draft,
      progressiveDraftGroups: DRAFT_PREVIEW_GROUPS.length,
      confirmationState,
      confirmationApproved: typeof metadata.confirmation_approved === 'boolean'
        ? metadata.confirmation_approved
        : undefined,
    };
  }

  if (message.role === 'assistant' && metadata.type === 'knowledge_confirmed') {
    return {
      ...baseMessage,
      content: message.content,
      confirmationState: 'output-available',
      confirmationApproved: true,
      status: metadata.status === 'failed' ? 'error' : 'complete',
    };
  }

  if (message.role === 'assistant' && metadata.type === 'geo_phase_prompt') {
    const project = isValidGeoProject(metadata.project) ? metadata.project : undefined;
    const platform = metadata.platform === 'deepseek' ? 'deepseek' : 'doubao';
    const confirmationState = typeof metadata.confirmation_state === 'string'
      ? metadata.confirmation_state as ChatMessage['confirmationState']
      : 'approval-requested';
    const report = metadata.report as GeoAgentGeoReport | undefined;
    const sourceDiscovery = metadata.source_discovery as GeoAgentGeoSourceDiscovery | undefined;
    const supportArticles = metadata.support_articles as GeoAgentGeoSupportArticleRunResponse | undefined;
    const isPendingPrompt = Boolean(project && confirmationState === 'approval-requested' && metadata.status === 'pending');
    const phase = Number(metadata.phase || 0);
    if (metadata.status === 'streaming') {
      return {
        ...baseMessage,
        content: message.content,
        geoProjectId: messageProjectId ? `geo-${messageProjectId}` : undefined,
        phaseTwoPlatform: platform,
        phaseTwoExecution: phase === 2
          ? { platform, companyName: project?.company_name || '企业', activeStep: 0 }
          : undefined,
        sourceDiscoveryExecution: phase === 3
          ? { platform, activeStep: 0 }
          : undefined,
        articleDraftExecution: phase === 4
          ? { platform, activeStep: 0 }
          : undefined,
        confirmationState: 'approval-responded',
        confirmationApproved: true,
        actionBusy: true,
        sourceDiscoveryAttempted: phase === 3,
        status: 'streaming',
        reasoning: phase === 2
          ? `正在生成${platformLabelFor(platform)}阶段二排行榜问题池。`
          : phase === 3
            ? `正在发现${platformLabelFor(platform)}高权重信源。`
            : phase === 4
              ? `正在生成${platformLabelFor(platform)}阶段四 9 篇内容资产。`
              : undefined,
      };
    }
    return {
      ...baseMessage,
      content: message.content,
      phaseTwoPrompt: isPendingPrompt ? project : undefined,
      phaseTwoPlatform: platform,
      geoReport: report,
      sourceDiscovery,
      supportArticles,
      sourceDiscoveryAttempted: Boolean(sourceDiscovery) || Number(metadata.phase || 0) === 3,
      articleDraftAttempts: supportArticles
        ? { consulting: Boolean(supportArticles.consulting_draft), review: Boolean(supportArticles.review_draft) }
        : undefined,
      confirmationState,
      confirmationApproved: typeof metadata.confirmation_approved === 'boolean'
        ? metadata.confirmation_approved
        : undefined,
      status: metadata.status === 'failed' ? 'error' : 'complete',
    };
  }

  if (message.role === 'assistant' && metadata.type === 'geo_phase_result') {
    const platform = metadata.platform === 'deepseek' ? 'deepseek' : 'doubao';
    const sourceDiscovery = metadata.source_discovery as GeoAgentGeoSourceDiscovery | undefined;
    const supportArticles = metadata.support_articles as GeoAgentGeoSupportArticleRunResponse | undefined;
    const questionSet = metadata.question_set as GeoAgentGeoQuestionSet | undefined;
    const phase = Number(metadata.phase || 0);
    const geoReport = questionSet
      ? {
        id: questionSet.id,
        geo_project_id: questionSet.geo_project_id,
        enterprise_project_id: questionSet.enterprise_project_id,
        platform,
        status: 'completed',
        report: questionSet.questions,
        markdown: questionSet.questions?.summary || message.content,
        created_at: questionSet.created_at,
        updated_at: questionSet.updated_at,
      } as GeoAgentGeoReport
      : undefined;
    return {
      ...baseMessage,
      content: message.content,
      geoProjectId: messageProjectId ? `geo-${messageProjectId}` : undefined,
      phaseTwoPlatform: platform,
      geoReport,
      sourceDiscovery,
      supportArticles,
      sourceDiscoveryAttempted: phase === 3,
      articleDraftAttempts: supportArticles
        ? { consulting: Boolean(supportArticles.consulting_draft), review: Boolean(supportArticles.review_draft) }
        : undefined,
      confirmationState: typeof metadata.confirmation_state === 'string'
        ? metadata.confirmation_state as ChatMessage['confirmationState']
        : 'output-available',
      confirmationApproved: typeof metadata.confirmation_approved === 'boolean'
        ? metadata.confirmation_approved
        : undefined,
      status: metadata.status === 'failed' ? 'error' : 'complete',
    };
  }

  if (message.role === 'assistant' && metadata.type === 'chat_response') {
    const provider = typeof metadata.provider === 'string' ? metadata.provider : undefined;
    const model = typeof metadata.model === 'string' ? metadata.model : undefined;
    const error = typeof metadata.error === 'string' ? metadata.error : null;
    return {
      ...baseMessage,
      content: message.content,
      provider,
      model,
      error,
      sources: Array.isArray(metadata.sources) ? metadata.sources as SourceCitation[] : [],
      searchQueries: Array.isArray(metadata.search_queries) ? metadata.search_queries as string[] : [],
      searchActions: Array.isArray(metadata.search_actions) ? metadata.search_actions as SearchAction[] : [],
      searchUsage: metadata.search_usage && typeof metadata.search_usage === 'object'
        ? metadata.search_usage as SearchUsage
        : {},
      reasoningContent: typeof metadata.reasoning_content === 'string'
        ? metadata.reasoning_content
        : undefined,
      reasoning: buildAssistantReasoning(provider, model, { error: Boolean(error) }),
      status: metadata.status === 'error' || error ? 'error' : 'complete',
    };
  }

  if (message.role === 'assistant' && message.content.startsWith(KNOWLEDGE_DRAFT_MESSAGE_MARKER)) {
    try {
      const payload = JSON.parse(message.content.slice(KNOWLEDGE_DRAFT_MESSAGE_MARKER.length)) as {
        content?: string;
        draft?: GeoAgentKnowledgeDraft;
      };
      return {
        ...baseMessage,
        content: payload.content ?? '我已根据资料生成企业知识库草稿。请先核对下方模板内容。',
        knowledgeDraft: payload.draft,
        confirmationState: 'approval-requested',
      };
    } catch {
      return {
        ...baseMessage,
        content: '知识库草稿消息解析失败，请重新生成草稿。',
        status: 'error',
      };
    }
  }

  return {
    ...baseMessage,
    content: message.content,
  };
}

const QuickSuggestion: React.FC<{
  icon: React.ElementType;
  text: string;
  value: string;
  onSelect: (value: string) => void;
}> = ({ icon: Icon, text, value, onSelect }) => (
  <Suggestion
    className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-2xl border-transparent bg-[#f7f7f5] px-4 py-3 text-[13px] font-semibold leading-none text-on-surface transition-all hover:border-secondary hover:bg-[#f0eee9] dark:bg-surface-variant/45 dark:hover:bg-surface-variant/70"
    onClick={onSelect}
    suggestion={value}
    variant="outline"
  >
    <Icon className="size-4 shrink-0 text-secondary" />
    {text}
  </Suggestion>
);

function platformLabelFor(platform: 'doubao' | 'deepseek'): string {
  return platform === 'doubao' ? '豆包' : 'DeepSeek';
}

function articleTypeLabelFor(articleType: 'consulting' | 'review'): string {
  return articleType === 'consulting' ? '咨询类' : '测评类';
}

function formatReportItem(item: unknown, compact = false): string {
  if (typeof item === 'string') {
    return item;
  }
  if (item && typeof item === 'object') {
    const data = item as Record<string, unknown>;
    const primary = data.question || data.topic || data.query || data.title || data.keyword || data.source || data.channel || data.platform;
    const secondary = data.intent || data.why || data.purpose || data.reason || data.publish_reason || data.evidence;
    const priority = data.priority ? `优先级：${data.priority}` : '';
    const type = data.type ? `类型：${data.type}` : '';
    const score = data.score ? `评分：${data.score}` : '';
    const confidence = data.confidence ? `置信度：${data.confidence}` : '';
    const contentType = data.content_type ? `内容类型：${data.content_type}` : '';
    const region = data.region ? `区域：${data.region}` : '';
    const sourceType = data.source_type ? `信源类型：${data.source_type}` : '';
    const url = data.url ? `链接：${data.url}` : '';
    if (primary) {
      return compact
        ? String(primary)
        : [
          String(primary),
          [type, contentType, sourceType, region, priority, score, confidence, url].filter(Boolean).join('；'),
          secondary ? `原因：${secondary}` : '',
        ].filter(Boolean).join('\n');
    }
    return Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}：${Array.isArray(value) ? value.join('、') : String(value)}`)
      .join('；');
  }
  return String(item ?? '');
}

const OptionToggle: React.FC<{
  checked: boolean;
  disabled: boolean;
  icon: React.ElementType;
  label: string;
  title: string;
  onChange: () => void;
}> = ({ checked, disabled, icon: Icon, label, title, onChange }) => (
  <button
    className={cn(
      'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
      disabled
        ? 'cursor-not-allowed text-[#9d968d] dark:text-[#8a8a8a]'
        : 'text-[#3f3932] hover:bg-[#ebe5dc] dark:text-[#f0f0f0] dark:hover:bg-[#3a3a3a]'
    )}
    disabled={disabled}
    onClick={onChange}
    title={title}
    type="button"
  >
    <span className="flex min-w-0 items-center gap-2.5">
      <Icon className="size-4 shrink-0" />
      {label}
    </span>
    {disabled ? (
      <span className="shrink-0 text-[12px] font-semibold text-[#8d8479] dark:text-[#9a9a9a]">
        不可用
      </span>
    ) : (
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-[#2f8ae5]' : 'bg-[#d6cfc4] dark:bg-[#575757]'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          )}
        />
      </span>
    )}
  </button>
);
