import { createContext, useContext } from "react";

import type { PromptActionId } from "./answers";

/** The passage phrases a scripted run can select; see `demo` in answers.ts. */
export type DemoKey = "goodhart" | "velocity" | "ceases" | "inflate";

export interface DemoApi {
  /** Plays the overlay on a passage phrase with a fake cursor, ending on `action`'s answer. */
  play: (key: DemoKey, action: PromptActionId) => void;
}

export const DemoContext = createContext<DemoApi>({ play: () => {} });
export const useDemo = () => useContext(DemoContext);
