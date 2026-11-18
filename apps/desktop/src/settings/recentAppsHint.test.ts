import { describe, expect, it } from "vitest";

import { recentAppsEmptyHint } from "./recentAppsHint";

describe("recentAppsEmptyHint", () => {
  const hint = "Select text in a few other apps and they will be listed here.";

  it("shows hint when recent list is empty", () => {
    expect(recentAppsEmptyHint([], hint)).toBe(hint);
  });

  it("shows hint when recent entries have no id", () => {
    expect(recentAppsEmptyHint([{ id: null }], hint)).toBe(hint);
  });

  it("hides hint when any recent app has an id (even if all already excluded)", () => {
    expect(recentAppsEmptyHint([{ id: "com.apple.Safari" }], hint)).toBeUndefined();
  });
});
