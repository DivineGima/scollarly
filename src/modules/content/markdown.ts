/**
 * Blog Markdown (ADR-028, architecture 16 A7: "the post with sanitised Markdown").
 *
 * This is a small parser that produces a tree, not HTML. The page turns the tree into React elements, and React escapes
 * every string, so a post can never inject a tag, an attribute or a script. Raw HTML in the source is shown as text.
 * Links must be `https:`, `http:` or `mailto:`; `javascript:`, `data:` and the like become plain text. Images are not
 * supported (no hotlinked images, CLAUDE.md); a post's picture is its uploaded cover.
 *
 * Supported: `#` to `######` headings (shown as h2 to h4, because the page title is the h1), paragraphs, `-`/`*` and `1.`
 * lists, `>` quotes, fenced code, `**bold**`, `*italic*`, `` `code` `` and `[text](https://link)`.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; text: string };

const MAX_SOURCE = 100_000;
const MAX_DEPTH = 4;

/** Only these address kinds become links. */
export function safeLinkHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 500) return null;
  if (/^mailto:[^\s<>"]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function parseInline(source: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flush();
      out.push({ type: "code", text: code[1] ?? "" });
      i += code[0].length;
      continue;
    }
    if (depth < MAX_DEPTH) {
      const strong = /^\*\*([^*]+?)\*\*/.exec(rest);
      if (strong) {
        flush();
        out.push({ type: "strong", children: parseInline(strong[1] ?? "", depth + 1) });
        i += strong[0].length;
        continue;
      }
      const em = /^\*([^*\s][^*]*?)\*/.exec(rest);
      if (em) {
        flush();
        out.push({ type: "em", children: parseInline(em[1] ?? "", depth + 1) });
        i += em[0].length;
        continue;
      }
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (link) {
        const href = safeLinkHref(link[2] ?? "");
        flush();
        if (href) out.push({ type: "link", href, children: parseInline(link[1] ?? "", depth + 1) });
        else out.push({ type: "text", text: link[1] ?? "" });
        i += link[0].length;
        continue;
      }
    }
    text += source[i];
    i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.slice(0, MAX_SOURCE).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (/^```/.test(line)) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(Math.max((heading[1]?.length ?? 1) + 1, 2), 4) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] ?? "") });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items: Inline[][] = [];
      for (; i < lines.length; i++) {
        const m = (ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*]\s+(.+)$/).exec(lines[i] ?? "");
        if (!m) break;
        items.push(parseInline(m[1] ?? ""));
      }
      i -= 1;
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      const quoted: string[] = [];
      for (; i < lines.length; i++) {
        const m = /^>\s?(.*)$/.exec(lines[i] ?? "");
        if (!m) break;
        quoted.push(m[1] ?? "");
      }
      i -= 1;
      blocks.push({ type: "quote", children: parseInline(quoted.join(" ")) });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

/** The first paragraph as plain text, cut at a word, for a post card and the page description. */
export function plainExcerpt(source: string, max = 160): string {
  const flat = (inlines: Inline[]): string =>
    inlines.map((n) => (n.type === "text" || n.type === "code" ? n.text : flat(n.children))).join("");
  const first = parseMarkdown(source).find((b) => b.type === "paragraph");
  const text = first && first.type === "paragraph" ? flat(first.children).trim() : "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}
