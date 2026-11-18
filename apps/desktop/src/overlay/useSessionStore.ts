import { useCallback, useRef, useState } from "react";

import type { Session } from "./session";

export type SessionPatch = Partial<Session> | ((s: Session) => Partial<Session>);

/**
 * The current session, readable synchronously through `ref` from native-event callbacks and
 * rendered from `session`. Both always change together.
 */
export function useSessionStore() {
  const ref = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const commit = useCallback((next: Session | null) => {
    ref.current = next;
    setSession(next);
  }, []);

  /** Patches the session only if it is still `id`: late callbacks of a dismissed session are dropped. */
  const update = useCallback(
    (id: number, patch: SessionPatch) => {
      const s = ref.current;
      if (!s || s.payload.session !== id) return;
      commit({ ...s, ...(typeof patch === "function" ? patch(s) : patch) });
    },
    [commit],
  );

  return { session, ref, commit, update };
}
