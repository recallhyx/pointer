/**
 * Whether a keydown belongs to an IME composition rather than to the page. WebKit ends the
 * composition before the Enter that confirmed it reaches keydown, so `isComposing` is already
 * false there; keyCode 229 still marks it as the IME's key.
 */
export function isImeKey(e: { nativeEvent: { isComposing: boolean }; keyCode: number }) {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
