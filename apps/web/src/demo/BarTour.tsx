import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { BarFace } from "./faces";
import { CursorGlyph } from "./icons";
import { useLang } from "@/i18n";

/** Explain → Translate → Copy → Search, then off the bar for a beat. */
const TOUR: (number | null)[] = [0, 1, 2, 3, null];
/** The cursor's glide to the next button; the button lights up when it arrives, as under a real mouse. */
const GLIDE_MS = 420;
/** How long it rests on each action: long enough for its icon to finish playing. */
const REST_MS = 1000;
/** After the visitor's own pointer leaves, the tour waits this long before it picks up again. */
const RESUME_MS = 1600;

/**
 * The action bar at true size, live: the hover highlight glides between the buttons and each
 * action's icon plays, exactly as in the overlay. While it is on screen a cursor walks the actions
 * on its own; the visitor's own pointer takes over as soon as it enters.
 */
export function BarTour({ pillId }: { pillId: string }) {
  const lang = useLang();
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const resume = useRef(0);
  const [hovered, setHovered] = useState<number | null>(reduced ? 0 : null);
  /** Where the tour's cursor is heading; `hovered` follows once it gets there. */
  const [target, setTarget] = useState<number | null>(null);
  const [user, setUser] = useState(false);
  const [inView, setInView] = useState(false);
  const [spots, setSpots] = useState<{ x: number; y: number }[]>([]);

  // Where the cursor rests on each button, relative to the bar; the labels change with the language.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const base = bar.getBoundingClientRect();
    setSpots(
      [...bar.querySelectorAll(".bar-button")].map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.left - base.left + 20, y: r.top - base.top + r.height / 2 + 2 };
      }),
    );
  }, [lang]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const touring = !reduced && !user && inView;

  useEffect(() => {
    if (!touring) return;
    let live = true;
    let timer = 0;
    const step = (i: number) => {
      const next = TOUR[i];
      setTarget(next);
      timer = window.setTimeout(() => {
        if (!live) return;
        setHovered(next);
        timer = window.setTimeout(() => step((i + 1) % TOUR.length), REST_MS);
      }, GLIDE_MS);
    };
    step(0);
    return () => {
      live = false;
      clearTimeout(timer);
      setTarget(null);
    };
  }, [touring]);

  useEffect(() => () => clearTimeout(resume.current), []);

  const last = spots[spots.length - 1];
  // Off the bar, the cursor waits below its right end.
  const spot = target !== null ? spots[target] : last && { x: last.x + 64, y: last.y + 34 };

  return (
    <div
      ref={rootRef}
      className="still live"
      aria-hidden
      onMouseEnter={() => {
        clearTimeout(resume.current);
        setUser(true);
      }}
      onMouseLeave={() => {
        setHovered(null);
        resume.current = window.setTimeout(() => setUser(false), RESUME_MS);
      }}
    >
      <div className="surface still-surface" style={{ height: 40, borderRadius: 20 }}>
        <BarFace ref={barRef} hovered={hovered} onHover={setHovered} still pillId={pillId} />
      </div>
      {spot && (
        <motion.div
          className="tour-cursor"
          initial={false}
          animate={{ x: spot.x, y: spot.y, opacity: touring ? 1 : 0 }}
          transition={{
            x: { duration: GLIDE_MS / 1000, ease: [0.45, 0, 0.2, 1] },
            y: { duration: GLIDE_MS / 1000, ease: [0.45, 0, 0.2, 1] },
            opacity: { duration: 0.2 },
          }}
        >
          <CursorGlyph />
        </motion.div>
      )}
    </div>
  );
}
