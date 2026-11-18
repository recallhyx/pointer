const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/**
 * Many models write LaTeX as `\[ … \]` and `\( … \)`, which Markdown would read as escaped
 * brackets. Rewrites them to `$$ … $$` and `$ … $` outside code.
 */
export function normalizeMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n$$\n${m.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`);
    })
    .join("");
}

/** Only web links open; anything else in an answer is inert. */
export function isOpenableUrl(href: string | undefined): href is string {
  return !!href && /^https?:\/\//i.test(href);
}
