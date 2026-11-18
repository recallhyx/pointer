import {
  CopyIcon,
  LanguagesIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  type AnimatedIcon,
} from "@/components/animated-icons";

import type { MessageKey } from "@/i18n";

export type ActionId = "explain" | "translate" | "copy" | "search";

export interface ActionDef {
  id: ActionId;
  labelKey: MessageKey;
  icon: AnimatedIcon;
  kind: "prompt" | "local";
}

/** CONTEXT.md 默认 Action: fixed order in v1. */
export const ACTIONS: ActionDef[] = [
  { id: "explain", labelKey: "action.explain", icon: MessageCircleQuestionIcon, kind: "prompt" },
  { id: "translate", labelKey: "action.translate", icon: LanguagesIcon, kind: "prompt" },
  { id: "copy", labelKey: "action.copy", icon: CopyIcon, kind: "local" },
  { id: "search", labelKey: "action.search", icon: SearchIcon, kind: "local" },
];

export function actionById(id: ActionId): ActionDef {
  return ACTIONS.find((a) => a.id === id)!;
}
