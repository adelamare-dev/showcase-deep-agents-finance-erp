"use client";

import { createContext, useContext } from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import { useErp } from "@/context/erp-context";
import { figureCheckText } from "@/content/ui-text";
import { allowedValues, markUnverified, MARK_RE } from "@/lib/figure-guard";
import { frozenVerdict } from "@/lib/figure-verdicts";
import { cn } from "@/lib/utils";

// What an assistant message is judged against: its own turn, that is the tool
// results between the user message before it and the message itself, and the
// text of that user message.
export type FigureTurn = {
  messageId: string;
  toolTexts: string[];
  userText: string;
};

export const FigureTurnContext = createContext<FigureTurn | null>(null);

const BADGE_HREF = "#unverified-figure";

type MessageLike = { id: string; role: string; content?: unknown };

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join(" ");
};

/** The turn `message` belongs to, read from the thread's messages. */
export function turnOf(messages: readonly MessageLike[] | undefined, message: MessageLike): FigureTurn {
  const list = messages ?? [];
  const at = list.findIndex((m) => m.id === message.id);
  const toolTexts: string[] = [];
  let userText = "";
  for (let i = at - 1; i >= 0; i--) {
    const m = list[i];
    if (m.role === "user") {
      userText = textOf(m.content);
      break;
    }
    if (m.role === "tool") toolTexts.push(textOf(m.content));
  }
  return { messageId: message.id, toolTexts, userText };
}

function Badge({ children }: { children?: React.ReactNode }) {
  return (
    <span
      data-testid="unverified-figure"
      className={cn(
        "rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-950",
        "underline decoration-amber-600 decoration-dotted underline-offset-2",
      )}
    >
      {children}
      <em className="ml-1 text-xs font-semibold not-italic tracking-wide text-amber-800">
        {figureCheckText.unverified}
      </em>
    </span>
  );
}

// Each mark becomes a link to a fixed fragment, which the renderer below draws
// as the badge. Brackets in the figure are escaped so they cannot end the link.
const asBadgeLink = (marked: string) =>
  marked.replace(MARK_RE, (_all, raw: string) => `[${raw.replace(/([\[\]])/g, "\$1")}](${BADGE_HREF})`);

const components = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href === BADGE_HREF ? (
      <Badge>{children}</Badge>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

// Draws a reply as written, with a badge on each figure that no tool of the
// turn, no store figure and no word of the user supports. The verdict is given
// once per message (see `figure-verdicts.ts`).
export const VerifiedMarkdown: typeof CopilotChatAssistantMessage.MarkdownRenderer = ({
  content,
  ...props
}) => {
  const turn = useContext(FigureTurnContext);
  const erp = useErp();
  const text = content ?? "";
  const marked = turn
    ? frozenVerdict(turn.messageId, text, () => {
        const books = Object.fromEntries(Object.entries(erp).filter(([key]) => key !== "highlights"));
        return markUnverified(text, allowedValues(turn.toolTexts, books, turn.userText));
      })
    : text;
  return <CopilotChatAssistantMessage.MarkdownRenderer {...props} content={asBadgeLink(marked)} components={components} />;
};
