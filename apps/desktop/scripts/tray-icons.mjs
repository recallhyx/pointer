// Renders the tray icons from their SVG sources: `node scripts/tray-icons.mjs` (in apps/desktop).
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const dir = new URL("../src-tauri/icons/tray/", import.meta.url);
const jobs = [
  ["tray-template.svg", "tray-template.png", 18],
  ["tray-template.svg", "tray-template@2x.png", 36],
  ["tray-windows.svg", "tray-windows.png", 32],
];
for (const [src, out, size] of jobs) {
  const svg = readFileSync(new URL(src, dir), "utf8");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(new URL(out, dir), png);
  console.log(`${out} ${size}px`);
}
