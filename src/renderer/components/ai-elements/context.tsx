"use client";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheTokens?: number;
};

type ContextValue = {
  maxTokens: number;
  usedTokens: number;
  usage?: Usage;
  modelId?: string;
  percentage: number;
};

const ContextUsageContext = createContext<ContextValue | null>(null);

const formatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatTokens(value?: number) {
  return formatter.format(Math.max(0, Number(value || 0)));
}

function useContextUsage() {
  const value = useContext(ContextUsageContext);
  if (!value) {
    throw new Error("Context usage components must be used within Context");
  }
  return value;
}

export type ContextProps = ComponentProps<typeof HoverCard> & {
  maxTokens?: number;
  usedTokens?: number;
  usage?: Usage;
  modelId?: string;
};

export const Context = ({
  maxTokens = 0,
  usedTokens = 0,
  usage,
  modelId,
  children,
  ...props
}: ContextProps) => {
  const percentage = maxTokens > 0
    ? Math.min(100, Math.round((usedTokens / maxTokens) * 100))
    : 0;
  const value = useMemo(
    () => ({ maxTokens, usedTokens, usage, modelId, percentage }),
    [maxTokens, usedTokens, usage, modelId, percentage]
  );

  return (
    <ContextUsageContext.Provider value={value}>
      <HoverCard {...props}>{children}</HoverCard>
    </ContextUsageContext.Provider>
  );
};

export type ContextTriggerProps = ComponentProps<typeof Button> & {
  children?: ReactNode;
};

export const ContextTrigger = ({
  className,
  children,
  ...props
}: ContextTriggerProps) => {
  const { percentage } = useContextUsage();
  return (
    <HoverCardTrigger asChild>
      <Button
        className={cn("h-7 rounded-full px-2.5 text-[11px] font-semibold", className)}
        type="button"
        variant="ghost"
        {...props}
      >
        {children ?? `${percentage}%`}
      </Button>
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({ className, ...props }: ContextContentProps) => (
  <HoverCardContent className={cn("w-72 p-0", className)} align="end" {...props} />
);

export const ContextContentHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("border-b border-outline-variant/40 px-3 py-2", className)} {...props} />
);

export const ContextContentBody = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("space-y-2 px-3 py-2", className)} {...props} />
);

export const ContextContentFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("rounded-b-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground", className)} {...props} />
);

function UsageRow({ label, value, className }: { label: string; value?: number; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-[12px]", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{formatTokens(value)}</span>
    </div>
  );
}

export const ContextInputUsage = (props: ComponentProps<"div">) => {
  const { usage, usedTokens } = useContextUsage();
  return <UsageRow label="输入上下文" value={usage?.inputTokens ?? usedTokens} {...props} />;
};

export const ContextOutputUsage = (props: ComponentProps<"div">) => {
  const { usage } = useContextUsage();
  return <UsageRow label="输出" value={usage?.outputTokens} {...props} />;
};

export const ContextReasoningUsage = (props: ComponentProps<"div">) => {
  const { usage } = useContextUsage();
  return <UsageRow label="推理" value={usage?.reasoningTokens} {...props} />;
};

export const ContextCacheUsage = (props: ComponentProps<"div">) => {
  const { usage } = useContextUsage();
  return <UsageRow label="缓存" value={usage?.cacheTokens} {...props} />;
};

export const ContextUsageSummary = () => {
  const { usedTokens, maxTokens, percentage, modelId } = useContextUsage();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-semibold text-foreground">上下文用量</span>
        <span className="font-semibold text-foreground">{percentage}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-secondary" style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>{formatTokens(usedTokens)} / {formatTokens(maxTokens)} tokens</span>
        {modelId && <span className="truncate">{modelId}</span>}
      </div>
    </div>
  );
};
