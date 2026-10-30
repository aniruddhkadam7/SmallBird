"use client";

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

// An AI answer drawn the way the desktop app showed it to the user
// (src/InterviewOverlay.tsx: react-markdown + remark-gfm, fenced code through
// the same highlighter and theme): bold, lists, headings, tables, code, and
// "draw a diagram" sketches. Styles are .md-answer in app/globals.css.

function MarkdownCode({ className, children, ...rest }: ComponentPropsWithoutRef<"code">) {
  // A fenced block with no language is still a block (it has line breaks);
  // only single-line code is inline.
  const language = /language-(\w+)/.exec(className ?? "")?.[1] ?? (String(children).includes("\n") ? "text" : undefined);
  if (!language) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  // Diagrams come back as a ```text box-and-arrow sketch -- wrapping would
  // break its columns apart, so it scrolls sideways instead.
  const isDiagram = language === "text";
  const wrap = isDiagram
    ? { whiteSpace: "pre" as const, overflowWrap: "normal" as const }
    : { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const };
  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        padding: "10px 12px",
        background: "#1e1e1e",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: 8,
        fontSize: "0.85em",
        lineHeight: 1.45,
        ...wrap,
        overflowX: isDiagram ? "auto" : undefined,
      }}
      codeTagProps={{ style: { fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace', ...wrap } }}
    >
      {String(children).replace(/\n$/, "")}
    </SyntaxHighlighter>
  );
}

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md-answer ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCode, pre: ({ children }) => <>{children}</> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
