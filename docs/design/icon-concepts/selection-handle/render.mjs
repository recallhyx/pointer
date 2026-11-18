// Renders the "selection + bubble" icon concept as one overview sheet (app icon, menu bar, bubble).
// Run from the repo root: `node docs/design/icon-concepts/selection-handle/render.mjs`
// (reuses @resvg/resvg-js from apps/desktop).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../../apps/desktop/package.json", import.meta.url));
const { Resvg } = require("@resvg/resvg-js");

const out = new URL("./", import.meta.url);
const BRAND = "#0a84ff";
const FONT = "Hiragino Sans GB";

// The glyph, in a 100×100 box: the product in one picture. A selected word (rounded highlight)
// and the bubble (solid dot) that pops up at its lower right; a gap cut around the dot keeps
// the two shapes apart at 16px. `id` keeps mask ids unique when several copies share a sheet.
let maskId = 0;
const glyph = (dot, highlight, highlightOpacity) => {
  const id = `cut${maskId++}`;
  return (
    `<mask id="${id}"><rect width="100" height="100" fill="#fff"/><circle cx="70" cy="66" r="25" fill="#000"/></mask>` +
    `<rect x="8" y="22" width="70" height="38" rx="11" fill="${highlight}" fill-opacity="${highlightOpacity}" mask="url(#${id})"/>` +
    `<circle cx="70" cy="66" r="17" fill="${dot}"/>`
  );
};

// macOS app icon grid: 824×824 rounded square inside the 1024 canvas.
const appIcon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2d34"/><stop offset="1" stop-color="#15161a"/>
    </linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4aa3ff"/><stop offset="1" stop-color="#0a6cff"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
  <g transform="translate(212 212) scale(6)">${glyph("#ffffff", "url(#hl)", 1)}</g>
</svg>`;

// Menu-bar template: one colour + alpha, macOS recolours it.
const tray = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 10 90 90">${glyph(color, color, 0.42)}</svg>`;

// Glyph inside the 28pt bubble, in the system accent colour.
const bubble = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 10 90 90">${glyph(color, color, 0.32)}</svg>`;

// Current icons, for comparison.
const SPARK = "M512 232c22 150 98 226 248 248c-150 22-226 98-248 248c-22-150-98-226-248-248c150-22 226-98 248-248z";
const SPARK_SMALL = "M736 640c8 54 34 80 88 88c-54 8-80 34-88 88c-8-54-34-80-88-88c54-8 80-34 88-88z";
const current = {
  app: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="448" fill="#2b2f36"/><path d="${SPARK}" fill="#fff"/><path d="${SPARK_SMALL}" fill="#fff" opacity="0.7"/></svg>`,
  tray: (c) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="234 214 620 620"><path d="${SPARK}" fill="${c}"/><path d="${SPARK_SMALL}" fill="${c}" opacity="0.7"/></svg>`,
  bubble: (c) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/></svg>`,
  bubbleSize: 15,
};
// A getter so each nested copy of the app icon gets its own mask id.
const next = {
  get app() {
    return appIcon();
  },
  tray,
  bubble,
  bubbleSize: 18,
};

const nest = (svg, x, y, w, h) =>
  svg.replace(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/, `<svg x="${x}" y="${y}" width="${w}" height="${h}"`);
const text = (x, y, s, size, fill = "#1d1d1f", weight = 400, opacity = 1) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}">${s}</text>`;

// Menu bar strip: the icon at 18pt (36px), then stand-in battery / Wi-Fi / clock icons.
const menubar = (x, y, set, dark) => {
  const bg = dark ? "#1e1e20" : "#ececec";
  const fg = dark ? "#ffffff" : "#000000";
  const a = x + 130;
  return (
    `<rect x="${x}" y="${y}" width="330" height="48" rx="10" fill="${bg}"/>` +
    nest(set.tray(fg), x + 34, y + 6, 36, 36) +
    `<rect x="${a - 18}" y="${y + 16}" width="34" height="16" rx="4" fill="none" stroke="${fg}" stroke-width="2.5"/><rect x="${a - 15}" y="${y + 19}" width="22" height="10" rx="2" fill="${fg}"/>` +
    `<path d="M${a + 44} ${y + 22}a22 22 0 0 1 32 0M${a + 50} ${y + 28}a13 13 0 0 1 20 0" fill="none" stroke="${fg}" stroke-width="3" stroke-linecap="round"/><circle cx="${a + 60}" cy="${y + 34}" r="3" fill="${fg}"/>` +
    `<circle cx="${a + 120}" cy="${y + 24}" r="12" fill="none" stroke="${fg}" stroke-width="3"/><path d="M${a + 120} ${y + 16}v8l6 4" fill="none" stroke="${fg}" stroke-width="3" stroke-linecap="round"/>`
  );
};

// A line of text with a selection, and the 28pt (56px) bubble below-right of where the mouse let go.
const bubbleMock = (x, y, set, dark) => {
  const bg = dark ? "#1c1c1e" : "#ffffff";
  const ink = dark ? "#e5e5ea" : "#1d1d1f";
  const surface = dark ? "#28282c" : "#fcfcfd";
  const border = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)";
  const s = set.bubbleSize * 2;
  const cx = x + 300;
  const cy = y + 150;
  return (
    `<rect x="${x}" y="${y}" width="380" height="230" rx="16" fill="${bg}"/>` +
    `<rect x="${x + 124}" y="${y + 68}" width="152" height="38" rx="4" fill="${BRAND}" fill-opacity="${dark ? 0.45 : 0.28}"/>` +
    text(x + 28, y + 96, "这是一个关于量子纠缠的段落", 25, ink) +
    text(x + 28, y + 156, "下一行文字", 25, ink, 400, 0.4) +
    `<circle cx="${cx}" cy="${cy + 3}" r="28" fill="#000" fill-opacity="${dark ? 0.5 : 0.16}" filter="url(#sh)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="28" fill="${surface}" stroke="${border}" stroke-width="1"/>` +
    nest(set.bubble(BRAND), cx - s / 2, cy - s / 2, s, s)
  );
};

// App icon at Dock size, then the small Finder / list sizes.
const appTile = (x, y, set) =>
  nest(set.app, x, y, 220, 220) +
  nest(set.app, x + 240, y + 92, 64, 64) +
  nest(set.app, x + 320, y + 108, 32, 32) +
  nest(set.app, x + 368, y + 116, 16, 16);

const row = (y, set) =>
  `<rect x="20" y="${y}" width="1560" height="270" rx="20" fill="#ffffff"/>` +
  appTile(40, y + 25, set) +
  menubar(460, y + 76, set, false) +
  menubar(460, y + 146, set, true) +
  bubbleMock(810, y + 20, set, false) +
  bubbleMock(1190, y + 20, set, true);

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="690">
  <defs><filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>
  <rect width="100%" height="100%" fill="#f5f5f7"/>
  ${text(40, 52, "应用图标", 22, "#6e6e73")}
  ${text(460, 52, "菜单栏（浅色 / 深色）", 22, "#6e6e73")}
  ${text(810, 52, "浮标（浅色 / 深色）", 22, "#6e6e73")}
  ${row(80, next)}
  ${row(370, current)}
  ${text(40, 674, "上：新方案　下：现在", 20, "#8e8e93")}
</svg>`;

writeFileSync(
  new URL("preview.png", out),
  new Resvg(sheet, { fitTo: { mode: "width", value: 1600 }, font: { loadSystemFonts: true, defaultFontFamily: FONT } })
    .render()
    .asPng(),
);
console.log("preview.png");
