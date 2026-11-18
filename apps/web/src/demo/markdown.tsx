import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type Inline } from "./markdownParse";

function renderInline(parts: Inline[]): ReactNode {
  return parts.map((p, i) =>
    p.kind === "strong" ? (
      <strong key={i}>{p.text}</strong>
    ) : p.kind === "em" ? (
      <em key={i}>{p.text}</em>
    ) : (
      <Fragment key={i}>{p.text}</Fragment>
    ),
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parseMarkdown(text).map((block, i) =>
        block.kind === "ul" ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
