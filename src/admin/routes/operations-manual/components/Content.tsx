import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import { slugify } from "../toc";

type Props = {
  markdown: string;
};

// Cheap stable id generator that mirrors parseToc's disambiguation
// strategy (heading text → slug, with a numeric suffix when duplicate).
function makeIdFactory() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    let id = slugify(text);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count}`;
    return id;
  };
}

function flattenChildrenToText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(flattenChildrenToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return flattenChildrenToText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export function Content({ markdown }: Props) {
  const nextId = makeIdFactory();

  return (
    <article className="prose-strike-arena max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => {
            const text = flattenChildrenToText(children);
            const id = nextId(text);
            return (
              <h1
                id={id}
                className="scroll-mt-6 text-2xl font-semibold text-ui-fg-base mt-0 mb-6"
              >
                {children}
              </h1>
            );
          },
          h2: ({ children }) => {
            const text = flattenChildrenToText(children);
            const id = nextId(text);
            return (
              <h2
                id={id}
                className="scroll-mt-6 text-xl font-semibold text-ui-fg-base mt-12 mb-3 pb-2 border-b border-ui-border-base"
              >
                {children}
              </h2>
            );
          },
          h3: ({ children }) => {
            const text = flattenChildrenToText(children);
            const id = nextId(text);
            return (
              <h3
                id={id}
                className="scroll-mt-6 text-base font-semibold text-ui-fg-base mt-8 mb-2"
              >
                {children}
              </h3>
            );
          },
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-ui-fg-base mt-4 mb-1 uppercase tracking-wider text-ui-fg-subtle">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-sm leading-relaxed text-ui-fg-base mb-3">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-3 space-y-1 text-sm leading-relaxed text-ui-fg-base">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-3 space-y-1 text-sm leading-relaxed text-ui-fg-base">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="ml-1">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-ui-fg-base">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-ui-fg-interactive underline-offset-2 hover:underline"
              target={href?.startsWith("#") ? undefined : "_blank"}
              rel={href?.startsWith("#") ? undefined : "noreferrer noopener"}
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className={`${className ?? ""} font-mono text-xs`}>
                  {children}
                </code>
              );
            }
            return (
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-ui-bg-subtle text-ui-fg-base">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-ui-bg-subtle border border-ui-border-base rounded p-3 overflow-x-auto text-xs mb-3">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-ui-tag-orange-icon bg-ui-tag-orange-bg pl-4 pr-3 py-2 my-3 text-sm">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full text-sm border border-ui-border-base">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-ui-bg-subtle">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-ui-fg-base border-b border-ui-border-base">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 align-top border-b border-ui-border-base text-ui-fg-base">
              {children}
            </td>
          ),
          hr: () => <hr className="my-8 border-ui-border-base" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
