import { describe, expect, it } from "vitest";

import { browserWindowLabelFromHash } from "./browserRoute";

describe("browserWindowLabelFromHash", () => {
  it("opens settings for #settings and deep-link query", () => {
    expect(browserWindowLabelFromHash("#settings")).toBe("settings");
    expect(browserWindowLabelFromHash("#settings?page=models")).toBe("settings");
    expect(browserWindowLabelFromHash("#settings?page=trigger&x=1")).toBe("settings");
  });

  it("keeps pinned hashes as pinned labels", () => {
    expect(browserWindowLabelFromHash("#pinned-1")).toBe("pinned-1");
    expect(browserWindowLabelFromHash("#pinned-abc?ignored=1")).toBe("pinned-abc?ignored=1");
  });

  it("does not treat #settingsfoo as settings", () => {
    expect(browserWindowLabelFromHash("#settingsfoo")).toBe("harness");
  });

  it("defaults other hashes to harness", () => {
    expect(browserWindowLabelFromHash("")).toBe("harness");
    expect(browserWindowLabelFromHash("#")).toBe("harness");
    expect(browserWindowLabelFromHash("#overlay")).toBe("harness");
  });

  it("routes the OCR picker hash", () => {
    expect(browserWindowLabelFromHash("#ocr-picker")).toBe("ocr-picker");
    expect(browserWindowLabelFromHash("#ocr-picker?x=1")).toBe("ocr-picker");
  });
});
