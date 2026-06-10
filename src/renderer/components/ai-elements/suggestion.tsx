"use client";

import { Button } from "@/components/ui/button";
import {
  ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { useCallback } from "react";

export type SuggestionsProps = ComponentProps<typeof ScrollArea>;

export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => (
  <ScrollArea className="w-full overflow-x-auto whitespace-nowrap" {...props}>
    <div className={cn("flex w-max flex-nowrap items-center gap-2", className)}>
      {children}
    </div>
    <ScrollBar className="hidden" orientation="horizontal" />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = useCallback(() => {
    onClick?.(suggestion);
  }, [onClick, suggestion]);

  return (
    <Button
      className={cn(
        "cursor-pointer rounded-full px-4 py-2 h-auto min-h-[36px]",
        "inline-flex items-center justify-center gap-2",
        "text-sm font-medium",
        "border border-[#d4d0c9] bg-white text-[#3d3a35]",
        "hover:bg-[#f5f3ef] hover:border-[#c4c0b9]",
        "dark:border-[#444] dark:bg-[#2a2a2a] dark:text-[#e0e0e0]",
        "dark:hover:bg-[#333] dark:hover:border-[#555]",
        "transition-colors duration-150",
        className
      )}
      onClick={handleClick}
      size={size}
      type="button"
      variant="ghost"
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};
