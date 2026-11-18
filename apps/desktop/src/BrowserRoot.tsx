import { useEffect, useRef, useState, type ReactNode } from "react";

import { browserWindowLabelFromHash } from "./shared/browserRoute";

/**
 * Browser: re-resolve the hash when it changes so `#settings?page=…` cold links and in-tab
 * navigations both land on Settings (not a stale Harness mount).
 */
export function BrowserRoot({
  initialLabel,
  initialTree,
  resolve,
}: {
  initialLabel: string;
  initialTree: ReactNode;
  resolve: (label: string) => Promise<ReactNode>;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [tree, setTree] = useState<ReactNode>(initialTree);
  const first = useRef(true);

  useEffect(() => {
    const onHash = () => setLabel(browserWindowLabelFromHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let cancelled = false;
    void resolve(label).then((node) => {
      if (!cancelled) setTree(node);
    });
    return () => {
      cancelled = true;
    };
  }, [label, resolve]);

  return <>{tree}</>;
}
