import type { FollowUp } from "@/llm/client";
import type { Language } from "@/llm/language";
import type { ActionId } from "./actions";
import {
  BAR_HEIGHT,
  BUBBLE_SIZE,
  PANEL_HEADER_HEIGHT,
  PANEL_MIN_HEIGHT,
  panelRect,
  sessionFrame,
  type Placement,
} from "./placement";
import { roundRect, type EnvPayload, type Rect, type ShowPayload } from "./types";

export type Phase = "bubble" | "bar" | "panel" | "check";
export type MotionKind = "enter" | "expand" | "collapse" | "grow";

export interface FaceDirection {
  axis: "x" | "y";
  sign: 1 | -1;
}

/** A finished round of the conversation. The first one answers the Action and has no question. */
export interface Exchange {
  question: string | null;
  answer: string;
}

/** One selection, from the bubble appearing until the overlay is gone. */
export interface Session {
  payload: ShowPayload;
  env: EnvPayload | null;
  placement: Placement;
  phase: Phase;
  motion: MotionKind;
  dir: FaceDirection;
  /** Window frame in work-area coordinates. The stage is translated by its inverse. */
  frame: Rect;
  action: ActionId | null;
  panelHeight: number;
  /** Translate only: the language the selection is written in, or null when it could not be told. */
  source: Language | null;
  target: Language | null;
  /** Incremented to (re)start the answer. */
  run: number;
  /** CONTEXT.md 追问: finished rounds, oldest first. Empty until the first follow-up. */
  thread: Exchange[];
  /** The follow-up the current answer replies to; null while answering the Action itself. */
  question: string | null;
  /** CONTEXT.md 驻留: the user clicked into the follow-up input. */
  engaged: boolean;
  presented: boolean;
  leaving: boolean;
  /** The last morph has landed; cleared by the next one. Growth after it never overshoots. */
  settled: boolean;
  showLatency: number | null;
}

/**
 * The global shortcut skips the bubble (CONTEXT.md 全局快捷键). The window is sized once for
 * everything the session can grow into (ADR 0001).
 */
export function initialSession(
  payload: ShowPayload,
  placement: Placement,
  /** When auto-trigger skips the bubble (CONTEXT.md 展开方式). Shortcut always starts on the bar. */
  expandMode: "hover" | "click" | "skip" = "hover",
): Session {
  const phase: Phase = payload.trigger === "shortcut" || expandMode === "skip" ? "bar" : "bubble";
  const frame = roundRect(sessionFrame(placement, payload.workArea));
  return {
    payload,
    env: null,
    placement,
    phase,
    motion: "enter",
    dir: { axis: "x", sign: 1 },
    frame,
    action: null,
    panelHeight: PANEL_MIN_HEIGHT,
    source: null,
    target: null,
    run: 0,
    thread: [],
    question: null,
    engaged: false,
    presented: false,
    leaving: false,
    settled: false,
    showLatency: null,
  };
}

export const area = (r: Rect) => r.width * r.height;

export function surfaceRect(s: Pick<Session, "phase" | "placement" | "panelHeight">): Rect {
  switch (s.phase) {
    case "bubble":
    case "check":
      return s.placement.bubble;
    case "bar":
      return s.placement.bar;
    case "panel":
      return panelRect(s.placement.panel, s.panelHeight);
  }
}

/** Bubble/check are circles; the option bar is a capsule; the result panel keeps 12px corners. */
export function surfaceRadius(s: Pick<Session, "phase">): number {
  if (s.phase === "bubble" || s.phase === "check") return BUBBLE_SIZE / 2;
  if (s.phase === "bar") return BAR_HEIGHT / 2;
  return 12;
}

/** New content slides in along the direction the surface grows (CONTEXT.md 形变). */
export function faceDirection(s: Session, to: Phase): FaceDirection {
  const barSign = s.placement.barDirection === "right" ? 1 : -1;
  if (to === "panel") return { axis: "y", sign: s.placement.panel.direction === "down" ? 1 : -1 };
  if (to === "bar") return { axis: "x", sign: barSign };
  return { axis: "x", sign: barSign === 1 ? -1 : 1 };
}

export interface MorphStep {
  next: Partial<Session>;
  from: Rect;
  to: Rect;
}

export function morphStep(s: Session, to: Phase, patch: Partial<Session> = {}): MorphStep {
  const from = surfaceRect(s);
  const toRect = surfaceRect({ ...s, ...patch, phase: to });
  const growing = area(toRect) > area(from);
  return {
    next: { ...patch, phase: to, motion: growing ? "expand" : "collapse", dir: faceDirection(s, to), settled: false },
    from,
    to: toRect,
  };
}

/** Panel height for a body of `contentHeight`: at least the minimum, scrolling past the maximum. */
export function panelHeightFor(s: Session, contentHeight: number): number {
  return Math.round(
    Math.min(Math.max(PANEL_HEADER_HEIGHT + contentHeight, PANEL_MIN_HEIGHT), s.placement.panel.maxHeight),
  );
}

/** The rounds before the current question, in the shape the client sends them. */
export function followUps(s: Pick<Session, "thread" | "question">): FollowUp[] {
  return s.thread.map((e, i) => ({
    previousAnswer: e.answer,
    question: (i + 1 < s.thread.length ? s.thread[i + 1].question : s.question) ?? "",
  }));
}
