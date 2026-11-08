"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const linkClass = "text-sky-300 underline underline-offset-2 hover:text-sky-200";

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-lg font-semibold text-white first:mt-0 sm:text-xl">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-lg font-semibold text-white first:mt-0 sm:text-xl">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-1 mt-2.5 text-base font-semibold text-white first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-base font-semibold text-slate-100 first:mt-0">{children}</h4>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-slate-500">{children}</del>,
  ul: ({ className, children }) => (
    <ul
      className={`my-2 space-y-1 ${
        className?.includes("contains-task-list")
          ? "list-none pl-0.5"
          : "list-disc pl-5 marker:text-slate-500"
      }`}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-slate-500">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-slate-600 pl-3 text-slate-300">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-700" />,
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} font-mono text-sm`}>{children}</code>
    ) : (
      <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-100">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="board-scrollbar my-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="board-scrollbar my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-slate-700 px-2.5 py-1.5 font-semibold text-slate-200">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-slate-800 px-2.5 py-1.5 align-top">{children}</td>
  ),
  input: ({ checked }) => (
    <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="mr-1.5 align-middle" />
  ),
};

/**
 * GitHub-flavored Markdown with no raw HTML. `onRelativeLink` receives links
 * without a scheme (e.g. wiki cross-links like `../people/maya.md`).
 */
export function ChatMarkdown({
  children,
  onRelativeLink,
}: {
  children: string;
  onRelativeLink?: (href: string) => void;
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

  return (
    <div className="break-words text-[1.05rem] leading-relaxed sm:text-lg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={merged}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
