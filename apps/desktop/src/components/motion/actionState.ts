export type ActionPhase = "idle" | "pending" | "done" | "error";
export type ActionEvent = { type: "start" } | { type: "resolve" } | { type: "reject" } | { type: "reset" };

/** The ActionButton state machine: only idle (or a settled result) can start, only pending can settle. */
export function actionReducer(phase: ActionPhase, event: ActionEvent): ActionPhase {
  switch (event.type) {
    case "start":
      return phase === "pending" ? phase : "pending";
    case "resolve":
      return phase === "pending" ? "done" : phase;
    case "reject":
      return phase === "pending" ? "error" : phase;
    case "reset":
      return phase === "done" || phase === "error" ? "idle" : phase;
  }
}
