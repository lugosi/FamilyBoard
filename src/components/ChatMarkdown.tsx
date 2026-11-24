"use client";

import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatChart } from "@/components/ChatChart";
import { parseChatChart } from "@/lib/chat-chart";

const linkClass = "text-sky-300 underline underline-offset-2 hover:text-sky-200";

function codeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("")
    .replace(/\n$/, "");
}

const components: Components = {
  p: ({ children }) => (
    <p className="my-3 first:mt-0 last:mb-0 leading-[inherit] text-slate-50">{children}</p>
  ),
  h1: ({ children }) => (
    <h2 className="mb-3 mt-6 text-[1.35em] font-semibold tracking-tight text-white first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2.5 mt-5 text-[1.2em] font-semibold tracking-tight text-slate-50 first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-2 mt-4 text-[1.08em] font-semibold text-slate-100 first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mb-1.5 mt-3 text-[0.95em] font-semibold uppercase tracking-wide text-slate-300 first:mt-0">
      {children}
    </h5>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-100">{children}</em>,
  del: ({ children }) => <del className="text-slate-500">{children}</del>,
  ul: ({ className, children }) => (
    <ul
      className={`my-3 space-y-2 ${
        className?.includes("contains-task-list")
          ? "list-none pl-0.5"
          : "list-disc pl-5 marker:text-slate-400"
      }`}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-2 pl-5 marker:text-slate-400">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5 leading-[inherit] text-slate-50">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-slate-600 pl-3.5 text-slate-300">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-slate-700" />,
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} font-mono text-[0.9em]`}>{children}</code>
    ) : (
      <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-100">
        {children}
      </code>
    ),
  pre: ({ children }) => {
    const only = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(only)) {
      const className = only.props.className ?? "";
      const lang = /language-([\w-]+)/.exec(className)?.[1]?.toLowerCase();
      if (lang === "chart") {
        const spec = parseChatChart(codeText(only.props.children));
        if (spec) return <ChatChart spec={spec} />;
      }
    }
    return (
      <pre className="board-scrollbar my-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-3.5 text-[0.9em] leading-relaxed">
        {children}
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="board-scrollbar my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[0.95em] tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-slate-700 px-2.5 py-2 font-semibold text-slate-200">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-slate-800 px-2.5 py-2 align-top">{children}</td>
  ),
  input: ({ checked }) => (
    <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="mr-1.5 align-middle" />
  ),
};

/**
 * GitHub-flavored Markdown with no raw HTML. `onRelativeLink` receives links
 * without a scheme (e.g. wiki cross-links like `../people/maya.md`).
 * Fenced ` ```chart ` JSON blocks render as inline SVG charts.
 */
export function ChatMarkdown({
  children,
  onRelativeLink,
  /** Wiki pages read larger than chat bubbles. */
  size = "chat",
}: {
  children: string;
  onRelativeLink?: (href: string) => void;
  size?: "chat" | "wiki";
}) {
  const merged = useMemo<Components>(() => {
    if (!onRelativeLink) return components;
    return {
      ...components,
      a: ({ href, children: label }) =>
        href && !/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href) ? (
          <button
            type="button"
            className={`${linkClass} cursor-pointer`}
            onClick={() => onRelativeLink(href)}
          >
            {label}
          </button>
        ) : (
          <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
            {label}
          </a>
        ),
    };
  }, [onRelativeLink]);

  const sizeClass =
    size === "wiki"
      ? "text-[1.5rem] leading-[1.75]"
      : "text-[1.25rem] leading-[1.7]";

  return (
    <div className={`break-words text-slate-50 ${sizeClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={merged}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
