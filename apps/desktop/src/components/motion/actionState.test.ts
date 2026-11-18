import { describe, expect, it } from "vitest";
import { actionReducer, type ActionEvent, type ActionPhase } from "./actionState";

const run = (events: ActionEvent["type"][], from: ActionPhase = "idle") =>
  events.reduce<ActionPhase>((p, type) => actionReducer(p, { type } as ActionEvent), from);

describe("actionReducer", () => {
  it("goes idle -> pending -> done -> idle", () => {
    expect(run(["start"])).toBe("pending");
    expect(run(["start", "resolve"])).toBe("done");
    expect(run(["start", "resolve", "reset"])).toBe("idle");
  });
  it("goes pending -> error -> idle", () => {
    expect(run(["start", "reject"])).toBe("error");
    expect(run(["start", "reject", "reset"])).toBe("idle");
  });
  it("ignores settling when not pending", () => {
    expect(run(["resolve"])).toBe("idle");
    expect(run(["reject"])).toBe("idle");
    expect(run(["start", "resolve", "reject"])).toBe("done");
  });
  it("does not reset while pending", () => {
    expect(run(["start", "reset"])).toBe("pending");
  });
  it("can restart from a settled result", () => {
    expect(run(["start", "reject", "start"])).toBe("pending");
    expect(run(["start", "resolve", "start"])).toBe("pending");
  });
});
