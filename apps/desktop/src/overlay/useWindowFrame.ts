import { useMemo } from "react";

import type { Bridge } from "./bridge";
import { surfaceRect, type Session } from "./session";
import type { Rect } from "./types";

const noop = () => {};

/**
 * Keeps the native click-through region in step with the surface. The window itself is sized
 * once per session to cover every shape the surface can take (ADR 0001).
 */
export function useWindowFrame(bridge: Bridge) {
  return useMemo(
    () => ({
      /** The surface is about to animate over `hit`, which must stay clickable meanwhile. */
      beginMotion(id: number, hit: Rect) {
        void bridge.setHit(id, hit).catch(noop);
      },
      /** The surface stopped at its target: clicks pass through everywhere else again. */
      settle(s: Session) {
        void bridge.setHit(s.payload.session, surfaceRect(s)).catch(noop);
      },
    }),
    [bridge],
  );
}
