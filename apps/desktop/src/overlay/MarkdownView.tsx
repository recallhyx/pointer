import "katex/dist/katex.min.css";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CheckIcon, CopyIcon, useIconAnimation, useIconPlaying } from "@/components/animated-icons";
import { IconSwap } from "@/components/motion";
import { useT } from "@/i18n";
import { isOpenableUrl, normalizeMath } from "./markdown";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [
  [rehypeKatex, { throwOnError: false, strict: "ignore" }],
  [rehypeHighlight, { detect: false }],
] as const;

function CodeBlock({ children, onCopy }: { children: ReactNode; onCopy: (text: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLPreElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const fromAttr = () => el.hasAttribute("data-hover");
    const sync = () => setHovered(fromAttr());
    const onEnter = () => setHovered(true);
    const onLeave = () => setHovered(fromAttr());
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["data-hover"] });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    sync();
    return () => {
      observer.disconnect();
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  const copyRef = useIconPlaying(hovered && !copied);
  const { ref: checkRef } = useIconAnimation(copied);
  return (
    <div className="code-block">
      <pre ref={ref}>{children}</pre>
      <button
        ref={btnRef}
        type="button"
        className="icon-button code-copy"
        title={t("markdown.copyCode")}
        aria-label={t("markdown.copyCode")}
        onClick={() => {
          onCopy(ref.current?.textContent ?? "");
          setCopied(true);
        }}
      >
        <IconSwap swapKey={copied}>
          {copied ? (
            <CheckIcon ref={checkRef} size={13} className="glyph" />
          ) : (
            <CopyIcon ref={copyRef} size={13} className="glyph" />
          )}
        </IconSwap>
      </button>
    </div>
  );
}

/**
 * Answers are untrusted: raw HTML is dropped, images are not loaded (the CSP blocks them too),
 * and links open in the default browser instead of navigating the overlay.
 */
export const Markdown = memo(function Markdown(props: {
  text: string;
  onOpenUrl: (url: string) => void;
  onCopy: (text: string) => void;
}) {
  const t = useT();
  const { onOpenUrl, onCopy } = props;
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <a
          href={href}
          title={href}
          onClick={(e) => {
            e.preventDefault();
            if (isOpenableUrl(href)) onOpenUrl(href);
          }}
        >
          {children}
        </a>
      ),
      img: ({ alt }) => (
        <span className="md-image">{alt ? t("markdown.imageNamed", { alt }) : t("markdown.image")}</span>
      ),
      pre: ({ children }) => <CodeBlock onCopy={onCopy}>{children}</CodeBlock>,
      table: ({ children }) => (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      ),
    }),
    [onOpenUrl, onCopy, t],
  );
  const source = useMemo(() => normalizeMath(props.text), [props.text]);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as never}
        components={components}
        skipHtml
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
