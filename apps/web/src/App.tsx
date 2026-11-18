import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { DOWNLOADS, RELEASES, detectPlatform, shortcutLabel, type Platform } from "./downloads";
import { LangContext, MESSAGES, initialLang, saveLang, useLang, useT, type Lang } from "./i18n";
import { PASSAGE, PASSAGE_TITLE, answerFor } from "./demo/answers";
import { BarFace, BubbleFace, FollowUpBox, PanelView } from "./demo/faces";
import { AppleIcon, ArrowDownIcon, MarkIcon, WindowsIcon } from "./demo/icons";
import { useDemo, type DemoKey } from "./demo/context";
import { BarTour } from "./demo/BarTour";
import { DemoProvider } from "./demo/Overlay";

type Named = string | { zh: string; en: string };
const named = (n: Named, lang: Lang) => (typeof n === "string" ? n : n[lang]);

/** apps/desktop/src/llm/presets.ts, with the host each preset points at. */
const CLOUD_PRESETS: [Named, string][] = [
  ["OpenAI", "api.openai.com"],
  ["Anthropic", "api.anthropic.com"],
  ["Google Gemini", "generativelanguage.googleapis.com"],
  ["DeepSeek", "api.deepseek.com"],
  [{ zh: "阿里云百炼", en: "Alibaba Bailian" }, "dashscope.aliyuncs.com"],
  [{ zh: "火山方舟", en: "Volcano Ark" }, "ark.cn-beijing.volces.com"],
  ["Moonshot", "api.moonshot.cn"],
  [{ zh: "智谱", en: "Zhipu AI" }, "open.bigmodel.cn"],
  [{ zh: "硅基流动", en: "SiliconFlow" }, "api.siliconflow.cn"],
  ["OpenRouter", "openrouter.ai"],
];

const LOCAL_PRESETS: [Named, string][] = [
  ["Ollama", "127.0.0.1:11434"],
  ["LM Studio", "127.0.0.1:1234"],
];

/** apps/desktop/src/shared/default-excluded-apps.json. */
const EXCLUDED_MAC: Named[] = [
  "1Password",
  "1Password 7",
  "Bitwarden",
  { zh: "密码", en: "Passwords" },
  { zh: "钥匙串访问", en: "Keychain Access" },
  { zh: "终端", en: "Terminal" },
  "iTerm2",
  "Warp",
  "Ghostty",
  "kitty",
  { zh: "Windows App（远程桌面）", en: "Windows App (Remote Desktop)" },
];

const EXCLUDED_WINDOWS: Named[] = [
  "1Password",
  "Bitwarden",
  "KeePass",
  "KeePassXC",
  { zh: "Windows 终端", en: "Windows Terminal" },
  { zh: "命令提示符", en: "Command Prompt" },
  "Windows PowerShell",
  "PowerShell",
  { zh: "远程桌面连接", en: "Remote Desktop Connection" },
  { zh: "远程桌面客户端", en: "Remote Desktop client" },
];

/** The open-licence pictures in public/margin; their credits are in the footer. */
const PICTURES = {
  manicule: {
    src: "/margin/manicule.jpg",
    width: 1800,
    height: 1096,
    title: "Manicule",
    by: "POP",
    licence: "CC BY 2.0",
    licenceUrl: "https://creativecommons.org/licenses/by/2.0",
    page: "https://commons.wikimedia.org/wiki/File:Manicule.jpg",
  },
  psalter: {
    src: "/margin/psalter.jpg",
    width: 1100,
    height: 846,
    title: "The Rebdorf Psalter Gloss by Anselm",
    by: "The Schøyen Collection",
    licence: "public domain",
    licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    page: "https://commons.wikimedia.org/wiki/File:The_Rebdorf_Psalter_Gloss_by_Anselm.jpg",
  },
  beccadelli: {
    src: "/margin/beccadelli.jpg",
    width: 1100,
    height: 761,
    title: "Marginalia by Antonio Beccadelli in a Plutarch translation, Vat. lat. 3349",
    by: "Antonio Beccadelli",
    licence: "public domain",
    licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    page: "https://commons.wikimedia.org/wiki/File:Marginalia_by_Antonio_Beccadelli_in_a_Plutarch_translation,_Rom,_Vat._lat._3349,_fol._161v.jpg",
  },
  xixiang: {
    src: "/margin/xixiangji.jpg",
    width: 1067,
    height: 1100,
    title: "李卓吾先生批点西厢记真本",
    by: "Uuongkinghe",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    page: "https://commons.wikimedia.org/wiki/File:%E6%9D%8E%E5%8D%93%E5%90%BE%E5%85%88%E7%94%9F%E6%89%B9%E7%82%B9%E8%A5%BF%E5%8E%A2%E8%AE%B0%E7%9C%9F%E6%9C%AC_20240201.jpg",
  },
} as const;

type PictureId = keyof typeof PICTURES;

/** Phones and tablets can't run Pointer, and their own selection menu would cover the overlay. */
function useTouchOnly(): boolean {
  const query = "(hover: none) and (pointer: coarse)";
  const [touch, setTouch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setTouch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return touch;
}

/**
 * Marks each `[data-reveal]` once it scrolls into view; the CSS gives it its entrance. Elements that
 * mount later (a language switch re-renders some lists) are picked up too, or they would stay hidden.
 */
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    const scan = () => document.querySelectorAll("[data-reveal]:not([data-in])").forEach((el) => io.observe(el));
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);
}

const reveal = (i: number) => ({ "data-reveal": "", style: { "--i": i } as CSSProperties });

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const platform = useMemo(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints), []);
  useReveal();

  useEffect(() => {
    const m = MESSAGES[lang];
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = m["meta.title"];
    document.querySelector('meta[name="description"]')?.setAttribute("content", m["meta.description"]);
  }, [lang]);

  const toggle = () => {
    const next = lang === "zh" ? "en" : "zh";
    saveLang(next);
    setLang(next);
  };

  return (
    <LangContext.Provider value={lang}>
      <DemoProvider>
        <Header platform={platform} onToggleLang={toggle} />
        <main data-selectable>
          <Hero platform={platform} />
          <How />
          <Margin />
          <ContextSection />
          <Features platform={platform} />
          <Models />
          <Privacy />
          <Faq platform={platform} />
          <Cta platform={platform} />
        </main>
        <Footer />
      </DemoProvider>
    </LangContext.Provider>
  );
}

function Header({ platform, onToggleLang }: { platform: Platform; onToggleLang: () => void }) {
  const t = useT();
  return (
    <header className="site-header" data-no-overlay>
      <div className="wrap header-row">
        <a className="brand" href="#top">
          <AppMark />
          {t("brand")}
        </a>
        <nav className="header-links" aria-label={t("brand")}>
          <a href="#how">{t("nav.how")}</a>
          <a href="#models">{t("nav.models")}</a>
          <a href="#privacy">{t("nav.privacy")}</a>
          <a href="#faq">{t("nav.faq")}</a>
        </nav>
        <div className="header-actions">
          <button type="button" className="lang-toggle" onClick={onToggleLang} aria-label={t("nav.langLabel")}>
            {t("nav.lang")}
          </button>
          <a className="header-download" href={platform === "other" ? "#download" : DOWNLOADS[platform]}>
            {t("nav.download")}
            <ArrowDownIcon size={14} />
          </a>
        </div>
      </div>
    </header>
  );
}

/** The app icon (src-tauri/icons/source.svg): the bubble in the light theme. */
function AppMark() {
  return (
    <svg viewBox="100 100 824 824" width="22" height="22" aria-hidden>
      <mask id="app-cut">
        <rect width="1024" height="1024" fill="#fff" />
        <circle cx="632" cy="608" r="150" fill="#000" />
      </mask>
      <rect
        x="104"
        y="104"
        width="816"
        height="816"
        rx="181"
        fill="#fcfcfd"
        stroke="#000"
        strokeOpacity="0.14"
        strokeWidth="8"
      />
      <rect x="260" y="344" width="420" height="228" rx="66" fill="#aed6fe" mask="url(#app-cut)" />
      <circle cx="632" cy="608" r="102" fill="#0a84ff" />
    </svg>
  );
}

function DownloadButtons({ platform }: { platform: Platform }) {
  const t = useT();
  const order: ("mac" | "windows")[] = platform === "windows" ? ["windows", "mac"] : ["mac", "windows"];
  const primary = platform === "other" ? "mac" : platform;
  return (
    <div className="downloads" data-no-overlay>
      {order.map((os) => {
        const isPrimary = os === primary;
        const Icon = os === "mac" ? AppleIcon : WindowsIcon;
        const label = isPrimary
          ? t(os === "mac" ? "download.mac" : "download.windows")
          : t(os === "mac" ? "download.macShort" : "download.windowsShort");
        return (
          <a key={os} className={isPrimary ? "button primary" : "button secondary"} href={DOWNLOADS[os]}>
            <Icon size={16} />
            {label}
          </a>
        );
      })}
    </div>
  );
}

function Passage() {
  return (
    <>
      {PASSAGE.map((paragraph, i) => (
        <p key={i}>
          {paragraph.map((run, j) =>
            "demo" in run ? (
              <span key={j} className="demo-phrase" data-demo={run.demo}>
                {run.text}
              </span>
            ) : (
              <span key={j}>{run.text}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}

function Hero({ platform }: { platform: Platform }) {
  const t = useT();
  const touch = useTouchOnly();
  const { play } = useDemo();

  // Touch screens can't select into the overlay, so the demo plays itself once it is in view.
  useEffect(() => {
    if (!touch) return;
    const id = setTimeout(() => play("goodhart", "explain"), 1400);
    return () => clearTimeout(id);
  }, [touch, play]);

  return (
    <section className="hero wrap" id="top">
      <div className="hero-text">
        <h1 className="display lines">
          <span className="line">
            <span data-line style={{ "--i": 0 } as CSSProperties}>
              {t("hero.title1")}
            </span>
          </span>
          <span className="line">
            <span data-line style={{ "--i": 1 } as CSSProperties}>
              {t("hero.title2")}
            </span>
          </span>
        </h1>
        <p className="lede" data-load>
          {t("hero.lede")}
        </p>
        <div data-load>
          <DownloadButtons platform={platform} />
          <p className="note">{platform === "other" ? t("download.desktopOnly") : t("download.note")}</p>
        </div>
      </div>

      <div className="hero-page" data-load>
        <article className="sample" lang="en" aria-label={PASSAGE_TITLE}>
          <h2 className="sample-title">{PASSAGE_TITLE}</h2>
          <Passage />
        </article>
        <p className="try" data-no-overlay>
          {touch ? (
            <>
              {t("hero.touch")}{" "}
              <button type="button" className="link-button" onClick={() => play("goodhart", "explain")}>
                {t("hero.replay")}
              </button>
            </>
          ) : (
            <>
              <span className="try-mark" aria-hidden>
                <MarkIcon size={16} />
              </span>
              {t("hero.try")}{" "}
              <button type="button" className="link-button" onClick={() => play("goodhart", "explain")}>
                {t("hero.watch")}
              </button>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/** A still frame of the overlay, drawn with the live components so it can't drift from the demo. */
function Still({
  children,
  width,
  height,
  radius,
  fit,
}: {
  children: ReactNode;
  width: number;
  height: number;
  radius: number;
  /** Scale for a slot narrower than the overlay's real size, like a scaled-down screenshot. */
  fit?: number;
}) {
  return (
    <div className="still" style={fit ? ({ "--fit": fit } as CSSProperties) : undefined} aria-hidden>
      <div className="surface still-surface" style={{ width, height, borderRadius: radius }}>
        {children}
      </div>
    </div>
  );
}

/** A line of the sample essay with one phrase selected and an overlay frame where the mouse let go. */
function Excerpt({ before, phrase, children }: { before: string; phrase: string; children?: ReactNode }) {
  return (
    <p className="excerpt" lang="en">
      {before}
      <span className="anchor">
        <mark className="faux-selection">{phrase}</mark>
        {children && <span className="anchor-pop">{children}</span>}
      </span>
    </p>
  );
}

function How() {
  const t = useT();
  const lang = useLang();
  const answer = answerFor("Goodhart's law", "explain", lang).split("\n\n")[0];
  const steps = [
    {
      title: t("how.step1"),
      body: t("how.step1Body"),
      stage: (
        <Excerpt before="Economists call this " phrase="Goodhart's law">
          <Still width={28} height={28} radius={14}>
            <BubbleFace play />
          </Still>
        </Excerpt>
      ),
    },
    {
      title: t("how.step2"),
      body: t("how.step2Body"),
      stage: (
        <Excerpt before="call this " phrase="Goodhart's law">
          <BarTour pillId="how-pill" />
        </Excerpt>
      ),
    },
    {
      title: t("how.step3"),
      body: t("how.step3Body"),
      stage: (
        <Excerpt before="call this " phrase="Goodhart's law">
          <span className="drop">
            <Still width={420} height={236} radius={12}>
              <PanelView action="explain" exchanges={[{ text: answer }]} footer={<FollowUpBox value="" />} />
            </Still>
          </span>
        </Excerpt>
      ),
    },
  ];
  return (
    <section className="section wrap how" id="how">
      <div className="col-text">
        <h2 className="heading" {...reveal(0)}>
          {t("how.title")}
        </h2>
        <p {...reveal(1)}>{t("how.intro")}</p>
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={i} className={i === 2 ? "step last" : "step"}>
            <div className="step-text" {...reveal(0)}>
              <h3 className="subheading">{s.title}</h3>
              <p>{s.body}</p>
            </div>
            <div className="stage" data-ui data-no-overlay {...reveal(1)}>
              {s.stage}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Picture({
  id,
  caption,
  className,
  eager,
}: {
  id: PictureId;
  caption: string;
  className?: string;
  eager?: boolean;
}) {
  const p = PICTURES[id];
  return (
    <figure className={className ? `picture ${className}` : "picture"} data-no-overlay>
      <div className="picture-frame">
        <img
          src={p.src}
          width={p.width}
          height={p.height}
          alt={caption}
          loading={eager ? undefined : "lazy"}
          decoding="async"
        />
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Margin() {
  const t = useT();
  return (
    <section className="section wrap margin" aria-labelledby="margin-title">
      <div className="margin-text">
        <h2 className="heading" id="margin-title" {...reveal(0)}>
          {t("margin.title")}
        </h2>
        <p {...reveal(1)}>{t("margin.body1")}</p>
        <p {...reveal(2)}>{t("margin.body2")}</p>
      </div>
      <div className="margin-lead" {...reveal(1)}>
        <Picture id="manicule" caption={t("margin.manicule")} className="drift" />
      </div>
      <div className="margin-row">
        <div {...reveal(0)}>
          <Picture id="psalter" caption={t("margin.psalter")} />
        </div>
        <div {...reveal(1)}>
          <Picture id="xixiang" caption={t("margin.xixiang")} />
        </div>
        <div {...reveal(2)}>
          <Picture id="beccadelli" caption={t("margin.beccadelli")} />
        </div>
      </div>
    </section>
  );
}

const PHRASES: { key: DemoKey; text: string }[] = [
  { key: "velocity", text: "velocity" },
  { key: "goodhart", text: "Goodhart's law" },
  { key: "inflate", text: "inflate" },
  { key: "ceases", text: "ceases to be" },
];

/** Up to `n` characters of `s` from one end, cut at a space, with an ellipsis where it was cut. */
function clip(s: string, n: number, end: "start" | "end"): string {
  if (s.length <= n) return s;
  if (end === "end") {
    const cut = s.slice(s.length - n);
    return "…" + cut.slice(cut.indexOf(" ") + 1);
  }
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

/** The first user message, as apps/desktop/src/llm/message.ts writes it. */
function envelope(phrase: string, around: boolean, windowInfo: boolean, url: string): { key: string; text: string }[] {
  const text = PASSAGE.map((p) => p.map((r) => r.text).join("")).join("\n\n");
  const at = text.indexOf(phrase);
  const before = clip(text.slice(0, at), 90, "end").replace(/\n+/g, " ");
  const after = clip(text.slice(at + phrase.length), 90, "start").replace(/\n+/g, " ");
  const lines = [
    { key: "env", text: "<environment>" },
    { key: "app", text: "<app>Google Chrome</app>" },
    ...(around && windowInfo
      ? [
          { key: "title", text: `<window_title>${PASSAGE_TITLE}</window_title>` },
          { key: "url", text: `<url>https://${url}</url>` },
        ]
      : []),
    { key: "date", text: `<date>${new Date().toISOString().slice(0, 10)}</date>` },
    { key: "/env", text: "</environment>" },
    ...(around ? [{ key: "before", text: `<context_before>${before}</context_before>` }] : []),
    { key: "sel", text: `<selection>${phrase}</selection>` },
    ...(around ? [{ key: "after", text: `<context_after>${after}</context_after>` }] : []),
  ];
  return lines;
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function ContextSection() {
  const t = useT();
  const { play } = useDemo();
  const [phrase, setPhrase] = useState<DemoKey>("velocity");
  const [around, setAround] = useState(true);
  const [windowInfo, setWindowInfo] = useState(true);
  const chosen = PHRASES.find((p) => p.key === phrase)!;
  const lines = envelope(chosen.text, around, windowInfo, t("chrome.url"));

  return (
    <section className="section wrap context" aria-labelledby="context-title">
      <div className="col-text">
        <h2 className="heading" id="context-title" {...reveal(0)}>
          {t("context.title")}
        </h2>
        <p {...reveal(1)}>{t("context.body1")}</p>
      </div>
      <div className="console" data-ui data-no-overlay {...reveal(2)}>
        <figure className="console-message">
          <figcaption>{t("context.receives")}</figcaption>
          <pre lang="en">
            <code>
              {lines.map((l) => (
                <span key={l.key} className="console-line">
                  {l.text.split(/(<\/?[a-z_]+>)/).map((part, i) =>
                    part.startsWith("<") ? (
                      <span key={i} className="tag">
                        {part}
                      </span>
                    ) : l.key === "sel" ? (
                      <mark key={i} className="faux-selection">
                        {part}
                      </mark>
                    ) : (
                      part
                    ),
                  )}
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
        </figure>
        <div className="console-controls">
          <label className="control">
            <span>{t("context.row.selection")}</span>
            <select value={phrase} onChange={(e) => setPhrase(e.target.value as DemoKey)}>
              {PHRASES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.text}
                </option>
              ))}
            </select>
          </label>
          <div className="control">
            <span>{t("context.row.app")}</span>
            <span className="value">Google Chrome</span>
          </div>
          <div className="control">
            <span id="ctl-around">{t("context.row.around")}</span>
            <Switch checked={around} onChange={setAround} label={t("context.row.around")} />
          </div>
          <div className="control">
            <span id="ctl-window">{t("context.row.window")}</span>
            <Switch
              checked={around && windowInfo}
              disabled={!around}
              onChange={setWindowInfo}
              label={t("context.row.window")}
            />
          </div>
          <div className="control">
            <span>{t("context.row.chars")}</span>
            <span className="value">{t("context.row.charsValue")}</span>
          </div>
          <div className="control">
            <span>{t("context.row.lang")}</span>
            <span className="value">{t("context.row.langValue")}</span>
          </div>
          <button type="button" className="link-button console-try" onClick={() => play(phrase, "explain")}>
            {t("context.try")} ↑
          </button>
        </div>
      </div>
      <p className="col-text after" {...reveal(0)}>
        {t("context.body2")}
      </p>
    </section>
  );
}

function Features({ platform }: { platform: Platform }) {
  const t = useT();
  const lang = useLang();
  const shortcut = shortcutLabel(platform);
  const keys = shortcut.split(" + ");
  const followFirst = answerFor("velocity", "explain", lang).split("\n\n")[0];
  const question = lang === "zh" ? "那 story point 是什么？" : "And what's a story point?";
  const reply =
    lang === "zh"
      ? "**故事点**是团队给任务估的“相对大小”，不是小时数。比如登录页记 3 点、改个文案记 1 点。"
      : "A **story point** is a team's relative estimate of a task's size, not hours. A login page might be 3 points, a copy change 1.";

  const modules: { id: string; title: string; body: [string, string]; demo: ReactNode }[] = [
    {
      id: "anywhere",
      title: t("features.anywhere"),
      body: [t("features.anywhere1"), t("features.anywhere2", { shortcut })],
      demo: (
        <div className="demo-keys">
          <span className="keys" aria-hidden>
            {keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
          <Still width={lang === "zh" ? 296 : 360} height={40} radius={20} fit={lang === "zh" ? 0.95 : 0.8}>
            <BarFace hovered={null} still pillId="keys-pill" />
          </Still>
        </div>
      ),
    },
    {
      id: "translate",
      title: t("features.translate"),
      body: [t("features.translate1"), t("features.translate2")],
      demo: (
        <Still width={360} height={196} radius={12} fit={0.86}>
          <PanelView
            action="translate"
            exchanges={[{ text: answerFor("inflate", "translate", lang) }]}
            footer={<FollowUpBox value="" />}
          />
        </Still>
      ),
    },
    {
      id: "followup",
      title: t("features.followup"),
      body: [t("features.followup1"), t("features.followup2")],
      demo: (
        <Still width={420} height={262} radius={12} fit={0.74}>
          <PanelView
            action="explain"
            exchanges={[{ text: followFirst }, { question, text: reply }]}
            footer={<FollowUpBox value="" />}
          />
        </Still>
      ),
    },
    {
      id: "quiet",
      title: t("features.quiet"),
      body: [t("features.quiet1"), t("features.quiet2")],
      demo: (
        <Excerpt before="their " phrase="velocity">
          <span className="fading">
            <Still width={28} height={28} radius={14}>
              <BubbleFace />
            </Still>
          </span>
        </Excerpt>
      ),
    },
  ];

  return (
    <section className="section wrap features" aria-labelledby="features-title">
      <h2 className="heading col-text" id="features-title" {...reveal(0)}>
        {t("features.title")}
      </h2>
      <div className="modules">
        {modules.map((m) => (
          <div className="module" key={m.id}>
            <div className="module-demo" data-ui data-no-overlay {...reveal(0)}>
              {m.demo}
            </div>
            <div className="module-text" {...reveal(1)}>
              <h3 className="subheading">{m.title}</h3>
              <p>{m.body[0]}</p>
              <p>{m.body[1]}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Rows({ title, rows }: { title: string; rows: [string, string][] }) {
  // Keyed by position: the names change with the language, the list does not.
  return (
    <div className="rows-group">
      <p className="rows-title">{title}</p>
      <ul className="rows">
        {rows.map(([name, value], i) => (
          <li key={i} {...reveal(i)}>
            <span>{name}</span>
            <span className="value">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Models() {
  const t = useT();
  const lang = useLang();
  const rows = (list: [Named, string][]): [string, string][] => list.map(([n, host]) => [named(n, lang), host]);
  return (
    <section className="section wrap models" id="models">
      <div className="col-text">
        <h2 className="heading" {...reveal(0)}>
          {t("models.title")}
        </h2>
        <p {...reveal(1)}>{t("models.body1")}</p>
      </div>
      <div className="models-lists" data-no-overlay>
        <div className="cloud">
          <Rows title={t("models.cloud")} rows={rows(CLOUD_PRESETS)} />
        </div>
        <div>
          <Rows title={t("models.local")} rows={rows(LOCAL_PRESETS)} />
          <Rows title={t("models.custom")} rows={[[t("models.customValue"), "/v1"]]} />
        </div>
      </div>
      <p className="col-text after" {...reveal(0)}>
        {t("models.body2")}
      </p>
    </section>
  );
}

function Privacy() {
  const t = useT();
  const lang = useLang();
  return (
    <section className="band" id="privacy">
      <div className="wrap privacy">
        <h2 className="heading" {...reveal(0)}>
          {t("privacy.title")}
        </h2>
        <ul className="statements">
          {(["privacy.1", "privacy.2", "privacy.3", "privacy.4"] as const).map((k, i) => (
            <li key={k} {...reveal(i)}>
              {t(k)}
            </li>
          ))}
        </ul>
        <p className="excluded-intro" {...reveal(0)}>
          {t("privacy.excluded")}
        </p>
        <div className="excluded-columns">
          {(
            [
              ["privacy.mac", EXCLUDED_MAC],
              ["privacy.win", EXCLUDED_WINDOWS],
            ] as const
          ).map(([k, list]) => (
            <div key={k} {...reveal(1)}>
              <p className="rows-title">{t(k)}</p>
              <ul className="names">
                {list.map((n) => (
                  <li key={named(n, "en")}>{named(n, lang)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq({ platform }: { platform: Platform }) {
  const t = useT();
  const shortcut = shortcutLabel(platform);
  const keys = ["price", "os", "mac", "win", "perm", "miss", "offline", "history", "trigger"] as const;
  const items = keys.map((k) => ({ k, q: t(`faq.${k}.q`), a: t(`faq.${k}.a`, { shortcut }) }));
  // On the visitor's own system, the unsigned-installer answer comes first.
  const first = platform === "mac" ? "mac" : platform === "windows" ? "win" : null;
  const ordered = first ? [...items.filter((i) => i.k === first), ...items.filter((i) => i.k !== first)] : items;
  return (
    <section className="section wrap faq" id="faq">
      <h2 className="heading faq-title" {...reveal(0)}>
        {t("faq.title")}
      </h2>
      <div className="faq-text">
        {ordered.map((item, i) => (
          <p key={item.k} {...reveal(i % 3)}>
            <strong>{item.q}</strong> {item.a}
          </p>
        ))}
      </div>
    </section>
  );
}

function Cta({ platform }: { platform: Platform }) {
  const t = useT();
  return (
    <section className="cta" id="download">
      <div className="cta-mark" aria-hidden {...reveal(0)}>
        <MarkIcon size={36} />
      </div>
      <div className="cta-text">
        <h2 className="heading" {...reveal(0)}>
          {t("cta.title")}
        </h2>
        <div {...reveal(1)}>
          <DownloadButtons platform={platform} />
          <p className="note">{t("download.note")}</p>
          <p className="note">{t("cta.unsigned")}</p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const t = useT();
  const credits = Object.values(PICTURES);
  return (
    <footer className="site-footer wrap" data-no-overlay>
      <p className="credits">
        {t("footer.pictures")}{" "}
        {credits.map((p, i) => (
          <span key={p.src}>
            <a href={p.page}>“{p.title}”</a>, {p.by}, <a href={p.licenceUrl}>{p.licence}</a>
            {i < credits.length - 1 ? "; " : `, ${t("footer.via")}.`}
          </span>
        ))}
      </p>
      <div className="footer-line">
        <span>{t("footer.what")}</span>
        <span className="footer-links">
          <a href={RELEASES}>{t("footer.releases")}</a>
          <a href="#faq">{t("nav.faq")}</a>
          <a href="#privacy">{t("nav.privacy")}</a>
        </span>
        <span className="footer-end">
          © {new Date().getFullYear()}. {t("footer.note")}
        </span>
      </div>
    </footer>
  );
}
