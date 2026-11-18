import { MotionConfig } from "motion/react";
import { type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { BrowserRoot } from "./BrowserRoot";
import { t } from "./i18n";
import { browserWindowLabelFromHash } from "./shared/browserRoute";
import { isTauri } from "./shared/runtime";

const root = createRoot(document.getElementById("root")!);

async function windowLabel(): Promise<string> {
  if (!isTauri()) {
    return browserWindowLabelFromHash(location.hash);
  }
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().label;
}

async function renderLabel(label: string): Promise<ReactNode> {
  // Each window loads only its own code and styles: the overlay's transparent page and the
  // settings window's Tailwind theme must not see each other.
  if (label === "settings") {
    document.title = t("settings.title");
    const { SettingsApp } = await import("./settings/SettingsApp");
    return <SettingsApp />;
  }
  if (label === "ocr-picker") {
    document.title = t("ocr.title");
    const [{ OcrPicker }] = await Promise.all([import("./ocr/OcrPicker"), import("./styles.css")]);
    return <OcrPicker />;
  }
  if (label === "ocr-lightbox") {
    document.title = t("ocr.enlarge");
    const [{ OcrLightbox }] = await Promise.all([import("./ocr/OcrLightbox"), import("./styles.css")]);
    return (
      <MotionConfig reducedMotion="user">
        <OcrLightbox />
      </MotionConfig>
    );
  }
  if (label.startsWith("pinned-")) {
    const [{ Pinned }, pins] = await Promise.all([
      import("./overlay/Pinned"),
      import("./overlay/pins"),
      import("./styles.css"),
    ]);
    const bridge = isTauri() ? await pins.createTauriPinnedBridge(label) : pins.createBrowserPinnedBridge(label);
    return (
      <MotionConfig reducedMotion="user">
        <Pinned bridge={bridge} />
      </MotionConfig>
    );
  }
  const [{ Overlay }] = await Promise.all([import("./overlay/Overlay"), import("./styles.css")]);
  if (label === "harness") {
    const { Harness } = await import("./harness/Harness");
    return (
      <MotionConfig reducedMotion="user">
        <Harness />
      </MotionConfig>
    );
  }
  const [{ createTauriBridge }, { createTauriPinHost }] = await Promise.all([
    import("./overlay/bridge"),
    import("./overlay/pins"),
  ]);
  const [bridge, pins] = await Promise.all([createTauriBridge(), createTauriPinHost()]);
  return (
    <MotionConfig reducedMotion="user">
      <Overlay bridge={bridge} pins={pins} />
    </MotionConfig>
  );
}

void windowLabel().then(async (label) => {
  const tree = await renderLabel(label);
  if (!isTauri()) {
    root.render(<BrowserRoot initialLabel={label} initialTree={tree} resolve={renderLabel} />);
    return;
  }
  root.render(tree);
});
