/* global window */
import assert from "node:assert/strict";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.env.POINTER_TEST_URL ?? "http://localhost:1420";
const version = (await (await fetch(`${url}/src/main.tsx`)).text()).match(/motion_react\.js(\?v=[^"]+)/)?.[1];
assert(version, "Start the desktop Vite dev server before running this test.");
const entry = `
import React from '/node_modules/.vite/deps/react.js${version}';
import Dom from '/node_modules/.vite/deps/react-dom_client.js${version}';
import {MotionConfig} from '/node_modules/.vite/deps/motion_react.js${version}';
import {Overlay} from '/src/overlay/Overlay.tsx';
import '/src/styles.css';
let show, shown, closed, hello;
window.opened = 0; window.sent = []; window.pushes = {};
const bridge = {
  onShow(cb) { show = cb; window.ready = true; return () => {}; },
  onEnv() { return () => {}; }, onPointer() { return () => {}; },
  onDismiss() { return () => {}; }, onWheel() { return () => {}; },
  toViewport(p, f) { return {x: p.x-f.x, y: p.y-f.y}; },
  fromViewport(p, f) { return {x: p.x+f.x, y: p.y+f.y}; },
  async present() {}, async setHit() {}, async painted() { return 0; },
  async setFrame() {}, async hide() {}, async engage() {},
  async copy() {}, async openUrl() {}, async openSettings() {}
};
const pins = {
  onShown(cb) { shown = cb; return () => {}; },
  onClosed(cb) { closed = cb; return () => {}; },
  onHello(cb) { hello = cb; return () => {}; }, onStop() { return () => {}; },
  async open() {
    const label = 'pinned-' + ++window.opened;
    return new Promise(resolve => { window.openResolve = () => resolve(label); });
  },
  send(label, a) { window.sent.push({label, ...a}); },
  async cancel(label) { closed(label); }
};
window.show = id => show({
  session: id, trigger: 'shortcut', gesture: 'shortcut', uiLanguage: 'zh', pointerEvents: true,
  platform: 'macos', workArea: {width: 1280, height: 720}, mouse: {x: 650, y: 150},
  selectionRect: null, text: 'test', contextBefore: null, contextAfter: null,
  app: {name: 'test', id: 'test'}, captureMs: 0, method: 'ax'
});
window.hello = label => hello(label);
window.closedPin = label => closed(label);
window.shownPin = label => shown(label);
Dom.createRoot(document.getElementById('root')).render(
  React.createElement(MotionConfig, {reducedMotion: 'user'},
    React.createElement(Overlay, {bridge, pins, autoDismiss: false}))
);
`;
const answer = `
export async function requestAnswer({onText, signal, current}) {
  const id = current().payload.session;
  window.pushes[id] = onText;
  return new Promise(resolve => {
    window.finish = () => resolve({status: 'done'});
    signal.addEventListener('abort', () => resolve({status: 'stopped'}), {once: true});
  });
}
`;
const browser = await playwright.webkit.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/src/main.tsx*", (r) => r.fulfill({ contentType: "application/javascript", body: entry }));
  await page.route("**/src/overlay/requestAnswer.ts*", (r) =>
    r.fulfill({ contentType: "application/javascript", body: answer }),
  );
  await page.goto(url);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.show(1));
  await page.locator('[data-action="explain"]').click();
  await page.waitForFunction(() => window.pushes[1]);
  await page.evaluate(() => window.pushes[1]("first answer"));
  await page.waitForTimeout(100);

  const pin = page.getByRole("button", { name: "固定", exact: true });
  await pin.click();
  await page.waitForFunction(() => window.opened === 1);
  await page.evaluate(() => window.openResolve());
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.hello("pinned-1");
    window.closedPin("pinned-1");
    window.pushes[1](" continued");
  });
  await page.waitForTimeout(150);
  assert((await page.locator(".panel-body").innerText()).includes("first answer continued"));

  await pin.click();
  await page.waitForFunction(() => window.opened === 2);
  await page.evaluate(() => window.openResolve());
  await page.waitForTimeout(100);
  await page.evaluate(() => window.finish());
  await page.waitForTimeout(100);
  await page.evaluate(() => window.closedPin("pinned-2"));
  await page.waitForTimeout(100);
  assert((await page.locator(".panel-body").innerText()).includes("first answer continued"));

  // A slow open from the old selection must never detach the new selection's request.
  await pin.click();
  await page.waitForFunction(() => window.opened === 3);
  await page.evaluate(() => window.show(2));
  await page.locator('[data-action="explain"]').click();
  await page.waitForFunction(() => window.pushes[2]);
  await page.evaluate(() => {
    window.pushes[2]("second answer");
    window.openResolve();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.hello("pinned-3"));
  await page.waitForTimeout(100);
  assert((await page.locator(".panel-body").innerText()).includes("second answer"));
  assert(
    !(await page.evaluate(() => window.sent.some((a) => a.label === "pinned-3" && a.text.includes("second answer")))),
  );
  await page.evaluate(() => window.shownPin("pinned-3"));
  await page.waitForTimeout(100);
  assert((await page.locator(".panel-body").innerText()).includes("second answer"));
  // A page that never reports paint must be cancelled, leaving the original stream usable.
  await pin.click();
  await page.waitForFunction(() => window.opened === 4);
  await page.evaluate(() => window.openResolve());
  await page.waitForTimeout(8300);
  await page.evaluate(() => window.pushes[2](" after timeout"));
  await page.waitForTimeout(100);
  assert((await page.locator(".panel-body").innerText()).includes("second answer after timeout"));
  await pin.click();
  await page.waitForFunction(() => window.opened === 5);
  assert.deepEqual(errors, []);
  console.log("Pin recovery: stream reattachment, settled snapshot, retry and stale selection checks passed.");
} finally {
  await browser.close();
}
