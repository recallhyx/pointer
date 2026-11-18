import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DOWNLOADS, RELEASE_REPO, RELEASES, STABLE_INSTALLERS } from "./downloads";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/package.yml"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const webReadme = readFileSync(join(root, "apps/web/README.md"), "utf8");
const packaging = readFileSync(join(root, "docs/packaging.md"), "utf8");

const stage = join(root, "scripts/stage-stable-installer.sh");
const check = join(root, "scripts/check-stable-installers.sh");

/** First-party logo files reserved in README.md. Code that draws the mark is not in this list. */
const RESERVED_LOGO_FILES = [
  "apps/desktop/src-tauri/icons/source.svg",
  "apps/desktop/src-tauri/icons/icon.png",
  "apps/desktop/src-tauri/icons/icon.icns",
  "apps/desktop/src-tauri/icons/icon.ico",
  "apps/desktop/src-tauri/icons/32x32.png",
  "apps/desktop/src-tauri/icons/128x128.png",
  "apps/desktop/src-tauri/icons/128x128@2x.png",
  "apps/desktop/src-tauri/icons/tray/tray-template.svg",
  "apps/desktop/src-tauri/icons/tray/tray-template.png",
  "apps/desktop/src-tauri/icons/tray/tray-template@2x.png",
  "apps/desktop/src-tauri/icons/tray/tray-windows.svg",
  "apps/desktop/src-tauri/icons/tray/tray-windows.png",
  "apps/web/public/favicon.svg",
  "docs/design/icon-concepts/selection-handle/preview.png",
];

describe("public download target", () => {
  it("links only to the future public repository and the stable installer names", () => {
    expect(RELEASE_REPO).toBe("recallhyx/pointer");
    expect(RELEASES).toBe("https://github.com/recallhyx/pointer/releases");
    expect(DOWNLOADS.mac).toBe(`${RELEASES}/latest/download/${STABLE_INSTALLERS.mac}`);
    expect(DOWNLOADS.windows).toBe(`${RELEASES}/latest/download/${STABLE_INSTALLERS.windows}`);
    expect(STABLE_INSTALLERS.mac).toBe("Pointer-macos-universal.dmg");
    expect(STABLE_INSTALLERS.windows).toBe("Pointer-windows-x64-setup.exe");
    expect(JSON.stringify(DOWNLOADS)).not.toContain("pointer-app");
  });

  it("documents that nothing is downloadable until a release is published", () => {
    for (const doc of [readme, webReadme, packaging]) {
      expect(doc).toContain("https://github.com/recallhyx/pointer/releases");
      expect(doc).toContain("Pointer-macos-universal.dmg");
      expect(doc).toContain("Pointer-windows-x64-setup.exe");
    }
    expect(webReadme).toContain("pointer-app");
    expect(packaging).toContain("pointer-app");
    expect(readme).toContain("没有可下载的安装包");
    expect(webReadme).toContain("no installers to download until a release is **published**");
    expect(packaging).toContain("没有可下载的安装包");
  });
});

describe("package workflow", () => {
  it("uploads exactly the stable names and still refuses a published release", () => {
    for (const name of Object.values(STABLE_INSTALLERS)) {
      expect(workflow).toContain(`stable: ${name}`);
      expect(workflow).toContain(name);
    }
    expect(workflow).toContain("scripts/stage-stable-installer.sh");
    expect(workflow).toContain("scripts/check-stable-installers.sh");
    expect(workflow).toContain("path: dist-release/${{ matrix.stable }}");
    expect(workflow).not.toContain("path: ${{ matrix.installer }}");
    expect(workflow).not.toContain("pointer-app");

    const published = workflow.indexOf("already published; not overwriting its installers.");
    const clobber = workflow.indexOf("--clobber");
    const deleteAsset = workflow.indexOf("delete-asset");
    const create = workflow.indexOf("gh release create");
    expect(published).toBeGreaterThan(0);
    expect(clobber).toBeGreaterThan(published);
    expect(deleteAsset).toBeGreaterThan(published);
    expect(create).toBeGreaterThan(published);
    expect(workflow.slice(create)).toContain("--draft");
    expect(workflow.slice(create)).not.toContain("--clobber");
    expect(workflow).toContain("github.ref_type == 'tag' && startsWith(github.ref_name, 'v')");
    expect(workflow).toContain("cancel-in-progress: ${{ github.ref_type != 'tag' }}");
  });
});

describe("stable installer scripts", () => {
  it("renames the one matched installer and rejects any other set", () => {
    const dir = mkdtempSync(join(tmpdir(), "pointer-installers-"));
    try {
      const bundle = join(dir, "bundle");
      const staged = join(dir, "dist-release");
      execFileSync("mkdir", ["-p", bundle]);
      writeFileSync(join(bundle, "Pointer_0.1.0_universal.dmg"), "dmg");
      writeFileSync(join(bundle, "notes.txt"), "no");
      const quiet: ExecFileSyncOptionsWithStringEncoding = {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      };
      execFileSync("bash", [stage, join(bundle, "*.dmg"), staged, STABLE_INSTALLERS.mac], quiet);
      expect(execFileSync("bash", [check, staged, STABLE_INSTALLERS.mac], quiet)).toBe("");

      writeFileSync(join(staged, "extra.exe"), "exe");
      expect(() =>
        execFileSync("bash", [check, staged, STABLE_INSTALLERS.mac, STABLE_INSTALLERS.windows], quiet),
      ).toThrow();
      expect(() =>
        execFileSync("bash", [stage, join(bundle, "*"), staged, STABLE_INSTALLERS.windows], quiet),
      ).toThrow();
      expect(() => execFileSync("bash", [stage, join(bundle, "*.missing"), staged, "nope.dmg"], quiet)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("license wording", () => {
  it("reserves only the enumerated first-party logo files", () => {
    expect(readme).toContain("Apache License 2.0");
    expect(readme).toContain("THIRD_PARTY_NOTICES.md");
    expect(readme).toContain("商标");
    expect(readme).toContain("著作权");
    expect(readme).toContain("mark.tsx");
    for (const path of RESERVED_LOGO_FILES) {
      expect(readme).toContain(`\`${path}\``);
      expect(existsSync(join(root, path))).toBe(true);
    }
    const reserved = readme.slice(readme.indexOf("图标文件的著作权"));
    expect(reserved).not.toContain("apps/web/public/margin/");
    expect(reserved).not.toContain("lucide");
    expect(reserved).not.toContain("shadcn");
    expect(readme).toContain("apps/web/public/margin/");
  });
});
