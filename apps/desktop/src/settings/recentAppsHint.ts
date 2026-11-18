/** Empty-state copy under "Recently used apps" — only when no capture host was ever recorded. */
export function recentAppsEmptyHint(recent: ReadonlyArray<{ id: string | null }>, hint: string): string | undefined {
  return recent.some((a) => a.id) ? undefined : hint;
}
