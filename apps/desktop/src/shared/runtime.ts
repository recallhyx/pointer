export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Requests go through Rust in the app (ADR 0003: no CORS, system proxy handled natively). The
 * browser harness falls back to the page's own fetch, which only works with CORS-enabled servers.
 */
export async function providerFetch(): Promise<typeof globalThis.fetch> {
  if (isTauri()) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch as typeof globalThis.fetch;
  }
  return globalThis.fetch.bind(globalThis);
}
