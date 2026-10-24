import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/modules/content/markdown";

/**
 * Renders the Markdown tree as React elements. React escapes every string, so nothing a post contains can become markup
 * (architecture 16 A7, ADR-028). Links open in the same tab with `rel="noopener noreferrer"` when they leave the site.
 */
function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{inline(node.children)}</strong>;
      case "em":
        return <em key={index}>{inline(node.children)}</em>;
      case "link":
        return (
          <a key={index} href={node.href} rel="noopener noreferrer">
            {inline(node.children)}
          </a>
        );
    }
  });
}

function block(node: Block, index: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const Tag = `h${node.level}` as "h2" | "h3" | "h4";
      return <Tag key={index}>{inline(node.children)}</Tag>;
    }
    case "paragraph":
      return <p key={index}>{inline(node.children)}</p>;
    case "quote":
      return <blockquote key={index}>{inline(node.children)}</blockquote>;
    case "code":
      return (
        <pre key={index} tabIndex={0}>
          <code>{node.text}</code>
        </pre>
      );
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag key={index}>
          {node.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </Tag>
      );
    }
  }
}

export function MarkdownView({ source }: { source: string }) {
  return <div className="prose">{parseMarkdown(source).map(block)}</div>;
}
