import { describe, expect, it } from "vitest";

import { offsetInRoot } from "./GlidePill";

describe("offsetInRoot", () => {
  it("returns top/height relative to the root including scrollTop", () => {
    const root = {
      getBoundingClientRect: () => ({ top: 100, left: 0, width: 200, height: 400 }),
      scrollTop: 40,
    } as HTMLElement;
    const el = {
      getBoundingClientRect: () => ({ top: 180, left: 8, width: 184, height: 32 }),
    } as HTMLElement;
    expect(offsetInRoot(el, root)).toEqual({ top: 120, height: 32 });
  });
});
