use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn distance(self, other: Point) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x < self.x + self.width && p.y >= self.y && p.y < self.y + self.height
    }

    pub fn is_empty(&self) -> bool {
        !(self.width > 0.0 && self.height > 0.0)
    }
}

/// The work area (screen minus menu bar / dock / taskbar) of one display.
///
/// Native units are points on macOS and physical pixels on Windows and Linux. The frontend works
/// in logical pixels relative to the work area's top-left corner, so every coordinate crossing
/// the IPC boundary goes through `to_logical` / `rect_to_native`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Display {
    pub origin: Point,
    pub width: f64,
    pub height: f64,
    /// Native units per logical pixel.
    pub scale: f64,
}

impl Display {
    /// The work area as a rect in native units.
    pub fn area(&self) -> Rect {
        Rect {
            x: self.origin.x,
            y: self.origin.y,
            width: self.width,
            height: self.height,
        }
    }

    pub fn logical_size(&self) -> (f64, f64) {
        (self.width / self.scale, self.height / self.scale)
    }

    pub fn to_logical(self, p: Point) -> Point {
        Point {
            x: (p.x - self.origin.x) / self.scale,
            y: (p.y - self.origin.y) / self.scale,
        }
    }

    pub fn rect_to_logical(&self, r: Rect) -> Rect {
        let o = self.to_logical(Point { x: r.x, y: r.y });
        Rect {
            x: o.x,
            y: o.y,
            width: r.width / self.scale,
            height: r.height / self.scale,
        }
    }

    pub fn rect_to_native(&self, r: Rect) -> Rect {
        Rect {
            x: self.origin.x + r.x * self.scale,
            y: self.origin.y + r.y * self.scale,
            width: r.width * self.scale,
            height: r.height * self.scale,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_between_native_and_logical() {
        let d = Display {
            origin: Point { x: 1920.0, y: 40.0 },
            width: 2880.0,
            height: 1760.0,
            scale: 1.5,
        };
        let native = Rect {
            x: 2070.0,
            y: 340.0,
            width: 630.0,
            height: 300.0,
        };
        let logical = d.rect_to_logical(native);
        assert_eq!(
            logical,
            Rect {
                x: 100.0,
                y: 200.0,
                width: 420.0,
                height: 200.0
            }
        );
        assert_eq!(d.rect_to_native(logical), native);
        assert_eq!(d.logical_size(), (1920.0, 1173.3333333333333));
    }
}
