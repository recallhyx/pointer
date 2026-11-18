//! 固定浮层: pure geometry for pinned panels. Each pinned panel is its own transparent,
//! non-activating window (see `Controller::pin_open`); rects here are in native units.

use crate::geometry::{Point, Rect};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Down,
    Up,
}

/// A detached panel can become temporary without replacing its native window or webview.
#[derive(Clone, Debug)]
pub struct TemporaryPanel {
    pub label: String,
    pub engaged: bool,
}

impl TemporaryPanel {
    pub fn dismisses_outside(&self, hit: Rect, pointer: Point) -> bool {
        !self.engaged && !hit.contains(pointer)
    }
}

/// At most this many pinned panels at once.
pub const PIN_LIMIT: usize = 5;
/// Transparent margin around the surface, in logical pixels, so its shadow is not clipped.
pub const PIN_MARGIN: f64 = 16.0;
/// Offset between panels pinned at the same spot, in logical pixels.
pub const PIN_CASCADE: f64 = 24.0;

/// Reserve growth space without changing the surface's anchored edge.
pub fn reach(hit: Rect, max_height: f64, direction: Direction) -> Rect {
    let height = max_height.max(hit.height);
    Rect {
        y: match direction {
            Direction::Down => hit.y,
            Direction::Up => hit.y + hit.height - height,
        },
        height,
        ..hit
    }
}

pub fn resize(hit: Rect, height: f64, direction: Direction) -> Rect {
    Rect {
        y: match direction {
            Direction::Down => hit.y,
            Direction::Up => hit.y + hit.height - height,
        },
        height,
        ..hit
    }
}

/// Shifts `hit` down and right by `step` until it no longer sits on top of another pinned panel.
pub fn cascade(hit: Rect, existing: &[Rect], step: f64) -> Rect {
    let mut r = hit;
    for _ in 0..=PIN_LIMIT * 2 {
        let taken = existing
            .iter()
            .any(|e| (e.x - r.x).abs() < step / 2.0 && (e.y - r.y).abs() < step / 2.0);
        if !taken {
            break;
        }
        r.x += step;
        r.y += step;
    }
    r
}

/// The offset that moves `hit` fully inside `area` (or onto its top-left edge if it is larger).
pub fn clamp_offset(hit: Rect, area: Rect) -> Point {
    let fit = |pos: f64, len: f64, start: f64, size: f64| {
        let max = start + (size - len).max(0.0);
        pos.clamp(start, max) - pos
    };
    Point {
        x: fit(hit.x, hit.width, area.x, area.width),
        y: fit(hit.y, hit.height, area.y, area.height),
    }
}

pub fn inflate(r: Rect, by: f64) -> Rect {
    Rect {
        x: r.x - by,
        y: r.y - by,
        width: r.width + by * 2.0,
        height: r.height + by * 2.0,
    }
}

pub fn offset(r: Rect, d: Point) -> Rect {
    Rect {
        x: r.x + d.x,
        y: r.y + d.y,
        ..r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn cascades_past_panels_at_the_same_spot() {
        let hit = rect(100.0, 100.0, 300.0, 200.0);
        assert_eq!(cascade(hit, &[], 24.0), hit);
        let existing = [rect(100.0, 100.0, 300.0, 200.0), rect(124.0, 124.0, 300.0, 200.0)];
        assert_eq!(cascade(hit, &existing, 24.0), rect(148.0, 148.0, 300.0, 200.0));
        // Far enough away is not "the same spot".
        assert_eq!(cascade(hit, &[rect(400.0, 100.0, 300.0, 200.0)], 24.0), hit);
    }

    #[test]
    fn clamps_into_the_work_area() {
        let area = rect(0.0, 25.0, 1440.0, 875.0);
        assert_eq!(
            clamp_offset(rect(10.0, 30.0, 100.0, 100.0), area),
            Point { x: 0.0, y: 0.0 }
        );
        assert_eq!(
            clamp_offset(rect(-50.0, 0.0, 100.0, 100.0), area),
            Point { x: 50.0, y: 25.0 }
        );
        assert_eq!(
            clamp_offset(rect(1400.0, 850.0, 100.0, 100.0), area),
            Point { x: -60.0, y: -50.0 }
        );
        // Taller than the area: keep the top (the header) visible.
        assert_eq!(
            clamp_offset(rect(0.0, 500.0, 100.0, 1000.0), area),
            Point { x: 0.0, y: -475.0 }
        );
    }

    #[test]
    fn clamps_on_a_secondary_display_with_negative_origin() {
        let area = rect(-1920.0, 0.0, 1920.0, 1040.0);
        assert_eq!(
            clamp_offset(rect(-100.0, 10.0, 300.0, 200.0), area),
            Point { x: -200.0, y: 0.0 }
        );
    }

    #[test]
    fn upward_pin_keeps_its_position_near_the_bottom_of_the_screen() {
        let area = rect(0.0, 25.0, 1440.0, 875.0);
        let hit = rect(100.0, 700.0, 420.0, 180.0);
        let reserved = reach(hit, 480.0, Direction::Up);
        assert_eq!(reserved, rect(100.0, 400.0, 420.0, 480.0));
        assert_eq!(clamp_offset(reserved, area), Point { x: 0.0, y: 0.0 });
        let frame = inflate(reserved, PIN_MARGIN);
        assert_eq!(frame.y + frame.height - PIN_MARGIN, hit.y + hit.height);
    }

    #[test]
    fn growth_and_shrink_preserve_the_anchored_edge() {
        let hit = rect(100.0, 700.0, 420.0, 180.0);
        let grown = resize(hit, 480.0, Direction::Up);
        assert_eq!(grown, rect(100.0, 400.0, 420.0, 480.0));
        assert_eq!(resize(grown, 180.0, Direction::Up), hit);
        assert_eq!(reach(grown, 480.0, Direction::Up), reach(hit, 480.0, Direction::Up));
        assert_eq!(resize(hit, 480.0, Direction::Down), rect(100.0, 700.0, 420.0, 480.0));
        assert_eq!(reach(hit, 480.0, Direction::Down), rect(100.0, 700.0, 420.0, 480.0));
    }

    #[test]
    fn upward_geometry_uses_native_units_on_a_negative_origin_display() {
        let hit = rect(-1200.0, -200.0, 840.0, 360.0);
        let reserved = reach(hit, 960.0, Direction::Up);
        assert_eq!(reserved, rect(-1200.0, -800.0, 840.0, 960.0));
        assert_eq!(resize(hit, 960.0, Direction::Up), reserved);
    }

    #[test]
    fn unpinned_panel_dismisses_only_outside_until_engaged() {
        let mut panel = TemporaryPanel {
            label: "pinned-1".into(),
            engaged: false,
        };
        let hit = rect(100.0, 200.0, 420.0, 180.0);
        assert!(!panel.dismisses_outside(hit, Point { x: 110.0, y: 210.0 }));
        assert!(panel.dismisses_outside(hit, Point { x: 10.0, y: 10.0 }));
        panel.engaged = true;
        assert!(!panel.dismisses_outside(hit, Point { x: 10.0, y: 10.0 }));
    }
}
