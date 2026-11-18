/**
 * Just enough Markdown for the prepared answers: paragraphs, `- ` lists, single line breaks,
 * `**bold**` and `*italic*`. A streamed prefix may end inside a marker, so open markers are
 * closed first rather than flashing as literal asterisks.
 */

export type Inline = { kind: "text" | "strong" | "em"; text: string };
export type Block = { kind: "p"; lines: Inline[][] } | { kind: "ul"; items: Inline[][] };

/**
 * Closes a `**` or `*` that a partial stream left open. Trailing asterisks are dropped first, so a
 * marker that is only half streamed never shows; a complete closing marker comes back from the count.
 */
export function closeMarkers(text: string): string {
  let t = text.replace(/\*+$/, "");
  if ((t.match(/\*\*/g)?.length ?? 0) % 2 === 1) t += "**";
  if ((t.replace(/\*\*/g, "").match(/\*/g)?.length ?? 0) % 2 === 1) t += "*";
  return t;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      out.push({ kind: "strong", text: part.slice(2, -2) });
    else if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      out.push({ kind: "em", text: part.slice(1, -1) });
    else out.push({ kind: "text", text: part });
  }
  return out;
}

export function parseMarkdown(text: string): Block[] {
  return closeMarkers(text)
    .split(/\n{2,}/)
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => l.startsWith("- ")))
        return { kind: "ul", items: lines.map((l) => parseInline(l.slice(2))) };
      return { kind: "p", lines: lines.map(parseInline) };
    });
}
