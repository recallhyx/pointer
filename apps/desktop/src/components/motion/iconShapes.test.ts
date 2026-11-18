import { describe, expect, it } from "vitest";
import { STOP_REGENERATE } from "./iconShapes";

/** motion tweens `d` number by number, so both ends need identical commands and number counts. */
const skeleton = (d: string) => ({ cmds: d.replace(/[^A-Za-z]/g, ""), nums: d.match(/-?\d*\.?\d+/g)?.length });

describe("STOP_REGENERATE", () => {
  it("pairs paths with matching structure", () => {
    for (const p of STOP_REGENERATE.paths) expect(skeleton(p.from)).toEqual(skeleton(p.to));
  });
});
