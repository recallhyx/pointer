import { describe, expect, it } from "vitest";

import { isImeKey } from "./ime";

const key = (isComposing: boolean, keyCode: number) => ({ nativeEvent: { isComposing }, keyCode });

describe("isImeKey", () => {
  it("is true while the composition is still open", () => {
    expect(isImeKey(key(true, 229))).toBe(true);
  });

  it("is true for the Enter that confirmed it, after WebKit closed the composition", () => {
    expect(isImeKey(key(false, 229))).toBe(true);
  });

  it("is false for a plain Enter", () => {
    expect(isImeKey(key(false, 13))).toBe(false);
  });
});
