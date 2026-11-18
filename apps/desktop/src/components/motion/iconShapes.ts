/**
 * A two-state icon whose strokes interpolate their path data. Every path pair must share the
 * same command structure (same commands, same number count) so motion can tween each number.
 */
export interface MorphShape {
  /** Paths in the `false` and `true` states, pairwise matching. */
  paths: { from: string; to: string; fill?: [number, number]; opacity?: [number, number] }[];
  /** Whole-icon rotation in each state, degrees. */
  rotate?: [number, number];
}

/** Stop (filled rounded square) <-> Regenerate (lucide rotate-cw), 24-unit grid. */
export const STOP_REGENERATE: MorphShape = {
  rotate: [-90, 0],
  paths: [
    {
      // Five cubics: the square's four rounded corners vs. the arc's three quarters plus its tail.
      from: "M18 12C18 18 18 18 12 18C6 18 6 18 6 12C6 6 6 6 12 6C18 6 18 6 18 9C18 10 18 11 18 12",
      to: "M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C14.52 3 16.93 4 18.74 5.74C19.5 6.5 20.25 7.25 21 8",
      fill: [1, 0],
    },
    { from: "M18 9L18 9L18 9", to: "M21 3L21 8L16 8", opacity: [0, 1] },
  ],
};
