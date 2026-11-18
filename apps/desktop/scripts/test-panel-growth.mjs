/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PLAYWRIGHT_MODULE may point to an existing test-tool installation; no production dependency.
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.env.POINTER_TEST_URL ?? "http://localhost:1420";
const engine = process.argv[2] ?? "webkit";
const output = join(tmpdir(), `pointer-panel-growth-${engine}`);
await mkdir(output, { recursive: true });
const main = await (await fetch(`${url}/src/main.tsx`)).text();
const version = main.match(/motion_react\.js(\?v=[^"]+)/)?.[1];
assert(version, "Start the desktop Vite dev server before running this test.");

const entry = `
import React from '/node_modules/.vite/deps/react.js${version}';
import Dom from '/node_modules/.vite/deps/react-dom_client.js${version}';
import {MotionConfig} from '/node_modules/.vite/deps/motion_react.js${version}';
import {Overlay} from '/src/overlay/Overlay.tsx';
import '/src/styles.css';
let show, dismiss;
window.__resizes = 0;
const bridge = {
  onShow(cb) { show = cb; return () => {}; },
  onDismiss(cb) { dismiss = cb; return () => {}; },
  onEnv() { return () => {}; }, onPointer() { return () => {}; }, onWheel() { return () => {}; },
  toViewport(p, f) { return {x: p.x - f.x, y: p.y - f.y}; },
  fromViewport(p, f) { return {x: p.x + f.x, y: p.y + f.y}; },
  async present() {}, async setHit() {}, async painted() { return 0; },
  async setFrame() { window.__resizes++; }, async hide() {}, async engage() {},
  async copy() {}, async openUrl() {}, async openSettings() {}
};
window.__show = up => show({
  session: 1, trigger: 'shortcut', gesture: 'shortcut', uiLanguage: 'zh', pointerEvents: true,
  platform: 'macos', workArea: {width: 1280, height: 720}, mouse: {x: 650.25, y: up ? 680.5 : 150.5},
  selectionRect: null, text: 'test', contextBefore: null, contextAfter: null,
  app: {name: 'test', id: 'test'}, captureMs: 0, method: 'ax'
});
window.__dismiss = () => dismiss({session: 1, reason: 'escape'});
Dom.createRoot(document.getElementById('root')).render(
  React.createElement(MotionConfig, {reducedMotion: 'user'},
    React.createElement(Overlay, {bridge, autoDismiss: false}))
);
`;
const answer = `
export async function requestAnswer({onText, signal}) {
  window.__requests = (window.__requests ?? 0) + 1;
  window.__push = onText;
  return new Promise(resolve => {
    window.__done = () => resolve({status: 'done'});
    signal.addEventListener('abort', () => resolve({status: 'stopped'}), {once: true});
  });
}
`;
const browser = await (engine === "webkit"
  ? playwright.webkit.launch()
  : playwright.chromium.launch({ channel: "chrome" }));
const results = [];
try {
  for (const up of [true, false]) {
    for (const dpr of [1, 2]) {
      for (const reduced of [false, true]) {
        for (const firstTokenDelay of [0, 900]) {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: dpr,
            reducedMotion: reduced ? "reduce" : "no-preference",
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.route("**/src/main.tsx*", (r) =>
            r.fulfill({ contentType: "application/javascript", body: entry }),
          );
          await page.route("**/src/overlay/requestAnswer.ts*", (r) =>
            r.fulfill({ contentType: "application/javascript", body: answer }),
          );
          await page.goto(url);
          await page.waitForFunction(() => window.__show);
          await page.evaluate((up) => window.__show(up), up);
          await page.locator("[data-action='explain']").waitFor();
          await page.waitForTimeout(200);
          await page.locator("[data-action='explain']").click();
          await page.waitForFunction(() => window.__push);
          if (firstTokenDelay) await page.waitForTimeout(firstTokenDelay);
          const frames = await page.evaluate(async () => {
            const frames = [];
            let running = true;
            const sample = () => {
              const r = document.querySelector(".surface").getBoundingClientRect();
              const f = document.querySelector(".face:has(.panel-face)").getBoundingClientRect();
              const body = document.querySelector(".panel-body");
              frames.push({
                top: r.top,
                bottom: r.bottom,
                height: r.height,
                contentTop: f.top,
                contentBottom: f.bottom,
                scrollable: getComputedStyle(body).overflowY === "auto",
                scrollTop: body.scrollTop,
              });
              if (running) requestAnimationFrame(sample);
            };
            sample();
            for (let i = 0; i < 24; i++) {
              window.__push("Streaming growth regression: the anchored edge must stay still.\n\n");
              await new Promise((r) => setTimeout(r, 45));
            }
            window.__done();
            await new Promise((r) => setTimeout(r, 800));
            running = false;
            return frames;
          });
          const edge = up ? "bottom" : "top";
          const drift = Math.max(...frames.map((f) => Math.abs(f[edge] - frames[0][edge])));
          const mismatch = Math.max(
            ...frames.map((f) => Math.max(Math.abs(f.top - f.contentTop), Math.abs(f.bottom - f.contentBottom))),
          );
          const result = { up, dpr, reduced, firstTokenDelay, frames: frames.length, drift, mismatch };
          assert(drift < 0.05, JSON.stringify(result));
          assert(mismatch < 0.06, JSON.stringify(result));
          assert(frames.at(-1).height > frames[0].height + 200);
          assert.equal(await page.evaluate(() => window.__resizes), 0);
          assert.deepEqual(errors, []);
          const growing = frames.filter((f) => !f.scrollable);
          assert(growing.length > 0);
          assert(
            growing.every((f) => f.scrollTop === 0),
            "Growing panels must not scroll ahead of their height.",
          );
          assert(
            frames.some((f) => f.scrollable && f.scrollTop > 0),
            "Full-height panels must still follow the stream.",
          );
          await page.screenshot({ path: join(output, `${up}-${dpr}-${reduced}-${firstTokenDelay}.png`) });
          await page.locator('button[aria-label="重新生成"]').click();
          await page.waitForFunction(() => window.__requests === 2);
          await page.waitForTimeout(800);
          const shrunk = await page.locator(".surface").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height };
          });
          assert(Math.abs(shrunk[edge] - frames[0][edge]) < 0.05);
          assert(shrunk.height < frames.at(-1).height - 200);
          await page.evaluate(() => window.__dismiss());
          await page.locator(".surface-group").waitFor({ state: "detached" });
          results.push(result);
          await context.close();
        }
      }
    }
  }
  console.log(
    JSON.stringify({ engine, cases: results.length, assertions: results.length * 11, output, results }, null, 2),
  );
} finally {
  await browser.close();
}
