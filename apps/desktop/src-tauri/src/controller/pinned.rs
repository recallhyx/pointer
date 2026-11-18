//! 固定浮层: pinned panels, each its own transparent non-activating window. The geometry is in
//! `crate::pins`; this side owns the windows, click-through and dragging.
//!
//! `pinned` is never locked on the main thread, so it may be held while click-through is toggled
//! (on Windows that waits for the main thread).

use std::collections::HashMap;

use tauri::{Emitter, Manager};

use super::{on_main, on_main_wait, overlay_window, Controller, PINNED_PREFIX};
use crate::geometry::{Point, Rect};
use crate::pins::{self, Direction, TemporaryPanel, PIN_CASCADE, PIN_LIMIT, PIN_MARGIN};
use crate::platform;

/// One pinned panel. Rects are native units.
struct Pin {
    label: String,
    session: u64,
    /// The window, including the transparent shadow margin.
    frame: Rect,
    /// The surface: clickable, the rest of the window passes clicks through.
    hit: Rect,
    /// Native units per logical pixel on the display the panel is on.
    scale: f64,
    /// The tallest the surface can grow. The window is that tall from the start, so growing
    /// animates inside it instead of resizing the window every frame.
    max_height: f64,
    direction: Direction,
    presentation: Presentation,
    fixed: bool,
    ignoring: bool,
    hovered: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Presentation {
    Hidden,
    Shown,
    Revealing,
    Revealed,
    Cancelled,
}

impl Presentation {
    fn begin_reveal(&mut self) -> bool {
        if *self != Self::Shown {
            return false;
        }
        *self = Self::Revealing;
        true
    }

    /// Cancellation and paint confirmation compete under the same pinned-state lock.
    fn cancel(&mut self) -> bool {
        if matches!(*self, Self::Revealing | Self::Revealed) {
            return false;
        }
        *self = Self::Cancelled;
        true
    }
}

impl Pin {
    /// The space the surface may take: what must stay on screen.
    fn reach(&self) -> Rect {
        pins::reach(self.hit, self.max_height, self.direction)
    }
}

struct PinDrag {
    label: String,
    from: Point,
    frame: Rect,
    hit: Rect,
}

#[derive(Default)]
pub(super) struct Pinned {
    pins: Vec<Pin>,
    next: u64,
    /// What each pinned window shows first, taken once by its page.
    inits: HashMap<String, serde_json::Value>,
    drag: Option<PinDrag>,
}

impl Controller {
    /// A click outside the pinned panel typing a follow-up hands the keyboard back.
    pub(super) fn pins_left_down(&self, p: Point) {
        // An engaged temporary panel stays engaged until Esc or its close button.
        if self
            .session
            .lock()
            .unwrap()
            .temporary_panel
            .as_ref()
            .is_some_and(|p| p.engaged)
        {
            return;
        }
        let Some(label) = self.session.lock().unwrap().pinned_engaged.clone() else {
            return;
        };
        if self
            .pinned
            .lock()
            .unwrap()
            .pins
            .iter()
            .any(|pin| pin.label == label && pin.hit.contains(p))
        {
            return;
        }
        self.session.lock().unwrap().pinned_engaged = None;
        self.sync_panel_escape();
        let app = self.app.clone();
        let _ = self
            .app
            .run_on_main_thread(move || platform::set_keyboard_focus_of(&app, &label, false));
    }

    pub(super) fn pin_hit(&self, p: Point) -> bool {
        self.pinned.lock().unwrap().pins.iter().any(|pin| pin.hit.contains(p))
    }

    pub(super) fn sync_panel_escape(&self) {
        let picking = self.ocr_picking();
        let on = self.session.lock().unwrap().needs_escape(picking);
        self.shortcuts.set_escape(on);
    }

    pub(super) fn dismiss_temporary_pin(&self, reason: &'static str) {
        let panel = self.session.lock().unwrap().temporary_panel.clone();
        if let Some(panel) = panel.filter(|p| !p.engaged) {
            let _ = self.app.emit_to(panel.label.as_str(), "pin://dismiss", reason);
        }
    }

    pub(super) fn temporary_pin_left_down(&self, pointer: Point) {
        let panel = self.session.lock().unwrap().temporary_panel.clone();
        let Some(panel) = panel else { return };
        let should_dismiss = self
            .pinned
            .lock()
            .unwrap()
            .pins
            .iter()
            .find(|p| p.label == panel.label)
            .is_some_and(|p| panel.dismisses_outside(p.hit, pointer));
        if should_dismiss {
            let _ = self.app.emit_to(panel.label.as_str(), "pin://dismiss", "outside");
        }
    }

    pub fn pin_set_fixed(&self, label: &str, fixed: bool) -> Result<(), String> {
        {
            let mut pinned = self.pinned.lock().unwrap();
            let Some(index) = pinned.pins.iter().position(|p| p.label == label) else {
                return Err(format!("no pinned panel {label}"));
            };
            if fixed && !pinned.pins[index].fixed && pinned.pins.iter().filter(|p| p.fixed).count() >= PIN_LIMIT {
                return Err("limit".into());
            }
            pinned.pins[index].fixed = fixed;
        }
        let previous = {
            let mut st = self.session.lock().unwrap();
            let engaged = st.pinned_engaged.as_deref() == Some(label);
            if fixed {
                if st.temporary_panel.as_ref().is_some_and(|p| p.label == label) {
                    st.temporary_panel = None;
                }
                None
            } else {
                st.temporary_panel.replace(TemporaryPanel {
                    label: label.to_string(),
                    engaged,
                })
            }
        };
        if let Some(previous) = previous.filter(|p| p.label != label) {
            let _ = self.app.emit_to(previous.label.as_str(), "pin://dismiss", "replaced");
        }
        self.sync_panel_escape();
        Ok(())
    }

    /// Ends a drag, if one is under way, and returns the dragged panel.
    pub(super) fn pin_drag_end(&self) -> Option<String> {
        self.pinned.lock().unwrap().drag.take().map(|d| d.label)
    }

    /// Drags a pinned panel and keeps click-through and hover in step with the pointer.
    /// `over_overlay`: the main overlay is visible under the pointer, on top of any pin.
    pub(super) fn track_pins(&self, p: Point, over_overlay: bool, emit: bool) {
        let mut pinned = self.pinned.lock().unwrap();
        let pinned = &mut *pinned;
        if let Some(drag) = &pinned.drag {
            let d = Point {
                x: p.x - drag.from.x,
                y: p.y - drag.from.y,
            };
            let (label, frame, hit) = (
                drag.label.clone(),
                pins::offset(drag.frame, d),
                pins::offset(drag.hit, d),
            );
            if let Some(pin) = pinned.pins.iter_mut().find(|pin| pin.label == label) {
                pin.frame = frame;
                pin.hit = hit;
            }
            let app = self.app.clone();
            let _ = self
                .app
                .run_on_main_thread(move || platform::set_frame_of(&app, &label, frame));
            return;
        }
        if !platform::POINTER_EVENTS {
            return;
        }
        // Under the overlay the pin still accepts clicks (ignore=false), so that after the overlay
        // hides we are not stuck click-through until the next mouse move.
        for pin in pinned.pins.iter_mut() {
            let on_hit = pin.hit.contains(p);
            let want_ignore = !on_hit;
            if want_ignore != pin.ignoring {
                pin.ignoring = want_ignore;
                platform::set_ignore_cursor_of(&self.app, &pin.label, want_ignore);
            }
            let hover = on_hit && !over_overlay;
            if hover && emit {
                let local = Point {
                    x: (p.x - pin.frame.x) / pin.scale,
                    y: (p.y - pin.frame.y) / pin.scale,
                };
                let _ = self.app.emit_to(pin.label.as_str(), "pin://pointer", Some(local));
            } else if !hover && pin.hovered {
                let _ = self.app.emit_to(pin.label.as_str(), "pin://pointer", None::<Point>);
            }
            pin.hovered = hover;
        }
    }

    /// Detaches the current panel into a new window. `surface` is the panel in the session's
    /// logical coordinates; `init` is whatever the page needs to carry on.
    pub fn pin_open(
        &self,
        session: u64,
        surface: Rect,
        max_height: f64,
        direction: Direction,
        init: serde_json::Value,
    ) -> Result<String, String> {
        let display = self.current_display(session)?;
        let max_h = max_height * display.scale;
        let (label, frame, hit) = {
            let mut pinned = self.pinned.lock().unwrap();
            if pinned.pins.iter().filter(|p| p.fixed).count() >= PIN_LIMIT {
                return Err("limit".into());
            }
            let existing: Vec<Rect> = pinned.pins.iter().map(|p| p.hit).collect();
            let mut hit = pins::cascade(display.rect_to_native(surface), &existing, PIN_CASCADE * display.scale);
            let reach = pins::reach(hit, max_h, direction);
            hit = pins::offset(hit, pins::clamp_offset(reach, display.area()));
            pinned.next += 1;
            let label = format!("{PINNED_PREFIX}{}", pinned.next);
            let frame = pins::inflate(pins::reach(hit, max_h, direction), PIN_MARGIN * display.scale);
            // The webview can call pin_init as soon as it is built. Publish its state first.
            pinned.inits.insert(label.clone(), init);
            pinned.pins.push(Pin {
                label: label.clone(),
                session,
                frame,
                hit,
                scale: display.scale,
                max_height: max_h.max(hit.height),
                direction,
                presentation: Presentation::Hidden,
                fixed: true,
                ignoring: false,
                hovered: false,
            });
            (label, frame, hit)
        };
        // Create + panelise on the main thread under with_no_activate. Building a Tauri window
        // otherwise activates the Accessory app and raises settings (and any other app windows).
        // Waits without a timeout: the window must be in `pins` once it exists, or nothing
        // would ever destroy it.
        let l = label.clone();
        let created = on_main_wait(&self.app, move |app| {
            platform::with_no_activate(|| -> Result<(), String> {
                let window = overlay_window(app, &l, "Pointer Pinned").map_err(|e| e.to_string())?;
                // Place the panel while converting so we never flash at the builder's (0,0).
                if let Err(e) = platform::setup_overlay_with_frame(app, &window, Some(frame)) {
                    platform::teardown_panel(app, &l);
                    let _ = window.destroy();
                    return Err(e.to_string());
                }
                platform::prepare_pin(app, &l);
                Ok(())
            })
        })
        .ok_or_else(|| "main thread did not respond".to_string())
        .and_then(|result| result);
        if let Err(e) = created {
            let mut pinned = self.pinned.lock().unwrap();
            pinned.inits.remove(&label);
            pinned.pins.retain(|pin| pin.label != label);
            return Err(e);
        }
        let inside = hit.contains(self.pointer());
        let mut pinned = self.pinned.lock().unwrap();
        if let Some(pin) = pinned.pins.iter_mut().find(|pin| pin.label == label) {
            pin.hovered = inside;
        }
        Ok(label)
    }

    pub fn pin_init(&self, label: &str) -> Option<serde_json::Value> {
        self.pinned.lock().unwrap().inits.remove(label)
    }

    /// Make the laid-out page visible. This is not yet permission to remove the old panel.
    pub fn pin_show(&self, label: &str) -> Result<(), String> {
        let pointer = self.pointer();
        let (frame, ignore) = {
            let mut pinned = self.pinned.lock().unwrap();
            let Some(pin) = pinned
                .pins
                .iter_mut()
                .find(|p| p.label == label && p.presentation == Presentation::Hidden)
            else {
                return Err(format!("no pinned panel {label}"));
            };
            // Re-apply geometry: WKWebView init can reset a never-shown window back to (0,0).
            let ignore = !pin.hit.contains(pointer);
            pin.ignoring = ignore;
            (pin.frame, ignore)
        };
        let l = label.to_string();
        on_main_wait(&self.app, move |app| {
            platform::set_frame_of(app, &l, frame);
            platform::set_ignore_cursor_of(app, &l, ignore);
            platform::prepare_pin(app, &l);
            // Native alpha masks the fully rendered page until its backing layer is ready.
            platform::show_of(app, &l);
            // Show can race with webview layout; set the frame again once visible.
            platform::set_frame_of(app, &l, frame);
        })
        .ok_or_else(|| "main thread did not respond".to_string())?;
        if let Some(pin) = self
            .pinned
            .lock()
            .unwrap()
            .pins
            .iter_mut()
            .find(|pin| pin.label == label)
        {
            if pin.presentation == Presentation::Hidden {
                pin.presentation = Presentation::Shown;
            }
        }
        Ok(())
    }

    /// The visible webview completed its first frames, so the overlay may now hand over.
    pub fn pin_painted(&self, label: &str) -> Result<(), String> {
        let session = {
            let mut pinned = self.pinned.lock().unwrap();
            let Some(pin) = pinned.pins.iter_mut().find(|pin| pin.label == label) else {
                return Err(format!("pinned panel {label} is not shown"));
            };
            if !pin.presentation.begin_reveal() {
                return Err(format!("pinned panel {label} is not awaiting paint"));
            }
            pin.session
        };
        let ctrl = self.app.state::<std::sync::Arc<Controller>>().inner().clone();
        let l = label.to_string();
        let replaced = on_main_wait(&self.app, move |app| {
            // Check on the main thread: a newer selection must never be hidden by a late pin.
            let replace_overlay = {
                let mut st = ctrl.session.lock().unwrap();
                let replace = st.session == session && st.visible;
                if replace {
                    st.visible = false;
                    st.hit = None;
                    st.engaged = false;
                }
                replace
            };
            platform::reveal_pin(app, &l, replace_overlay);
            replace_overlay
        })
        .ok_or("main thread did not respond")?;
        if let Some(pin) = self
            .pinned
            .lock()
            .unwrap()
            .pins
            .iter_mut()
            .find(|pin| pin.label == label)
        {
            pin.presentation = Presentation::Revealed;
        }
        if replaced {
            self.sync_panel_escape();
            self.track_pins(self.pointer(), false, true);
        }
        if let Err(e) = self.app.emit_to(super::OVERLAY, "pin://shown", label) {
            eprintln!("[pointer] pin acknowledgement failed: {e}");
        }
        Ok(())
    }

    pub fn pin_cancel(&self, label: &str) -> Result<(), String> {
        let state = {
            let mut pinned = self.pinned.lock().unwrap();
            let pin = pinned.pins.iter_mut().find(|p| p.label == label);
            pin.map(|pin| {
                let state = pin.presentation;
                pin.presentation.cancel();
                state
            })
        };
        if state == Some(Presentation::Revealing) {
            // Its main-thread swap will send the acknowledgement once it actually completes.
            Ok(())
        } else if state == Some(Presentation::Revealed) {
            // A delayed shown event is not a failed handoff. Repeat its acknowledgement only.
            self.app
                .emit_to(super::OVERLAY, "pin://shown", label)
                .map_err(|e| e.to_string())
        } else {
            self.pin_close(label)
        }
    }

    /// The surface's height changed (logical pixels). Only the clickable part follows; the window
    /// already covers the tallest the panel can get.
    pub fn pin_resize(&self, label: &str, height: f64) -> Result<(), String> {
        let mut pinned = self.pinned.lock().unwrap();
        let Some(pin) = pinned.pins.iter_mut().find(|p| p.label == label) else {
            return Err(format!("no pinned panel {label}"));
        };
        pin.hit = pins::resize(pin.hit, (height * pin.scale).min(pin.max_height), pin.direction);
        Ok(())
    }

    pub fn pin_drag(&self, label: &str) -> Result<(), String> {
        let from = {
            let st = self.session.lock().unwrap();
            st.left_down.map(|(p, _)| p).unwrap_or(st.pointer)
        };
        let mut pinned = self.pinned.lock().unwrap();
        let Some(pin) = pinned.pins.iter().find(|p| p.label == label) else {
            return Err(format!("no pinned panel {label}"));
        };
        if !pin.fixed {
            return Ok(());
        }
        pinned.drag = Some(PinDrag {
            label: label.to_string(),
            from,
            frame: pin.frame,
            hit: pin.hit,
        });
        Ok(())
    }

    /// After a drag: keep the panel inside the work area of the display it was dropped on.
    pub(super) fn pin_settle(&self, label: &str) {
        let Some(reach) = self
            .pinned
            .lock()
            .unwrap()
            .pins
            .iter()
            .find(|p| p.label == label)
            .map(Pin::reach)
        else {
            return;
        };
        let center = Point {
            x: reach.x + reach.width / 2.0,
            y: reach.y + reach.height / 2.0,
        };
        let Some(display) = platform::display_at(&self.app, center) else {
            return;
        };
        let d = pins::clamp_offset(reach, display.area());
        let frame = {
            let mut pinned = self.pinned.lock().unwrap();
            let Some(pin) = pinned.pins.iter_mut().find(|p| p.label == label) else {
                return;
            };
            pin.hit = pins::offset(pin.hit, d);
            pin.frame = pins::offset(pin.frame, d);
            pin.frame
        };
        if d.x != 0.0 || d.y != 0.0 {
            let l = label.to_string();
            on_main(&self.app, move |app| platform::set_frame_of(app, &l, frame));
        }
    }

    pub fn pin_engage(&self, label: &str) -> Result<(), String> {
        {
            let pinned = self.pinned.lock().unwrap();
            if !pinned.pins.iter().any(|p| p.label == label) {
                return Err(format!("no pinned panel {label}"));
            }
        }
        {
            let mut st = self.session.lock().unwrap();
            st.focus_pin(label);
        }
        self.sync_panel_escape();
        let l = label.to_string();
        on_main(&self.app, move |app| platform::prepare_keyboard_focus_of(app, &l))
            .ok_or("main thread did not respond")?;
        Ok(())
    }

    pub fn pin_close(&self, label: &str) -> Result<(), String> {
        {
            let mut st = self.session.lock().unwrap();
            if st.temporary_panel.as_ref().is_some_and(|p| p.label == label) {
                st.temporary_panel = None;
            }
            if st.pinned_engaged.as_deref() == Some(label) {
                st.pinned_engaged = None;
            }
        }
        {
            let mut pinned = self.pinned.lock().unwrap();
            pinned.pins.retain(|p| p.label != label);
            pinned.inits.remove(label);
            if pinned.drag.as_ref().is_some_and(|d| d.label == label) {
                pinned.drag = None;
            }
        }
        self.sync_panel_escape();
        let l = label.to_string();
        on_main_wait(&self.app, move |app| {
            // Restore the NSWindow class before destroy: destroying a live NSPanel (or one whose
            // original_class was corrupted by nested to_panel) can throw an NSException into Rust.
            platform::teardown_panel(app, &l);
            if let Some(w) = app.get_webview_window(&l) {
                let _ = w.destroy();
            }
        })
        .ok_or("main thread did not respond")?;
        let _ = self.app.emit_to(super::OVERLAY, "pin://closed", label);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Presentation;

    #[test]
    fn cancelled_handoff_cannot_reveal_or_hide_the_old_overlay() {
        let mut state = Presentation::Shown;
        assert!(state.cancel());
        assert!(!state.begin_reveal());
    }

    #[test]
    fn paint_confirmation_wins_over_late_watchdog_cancellation() {
        let mut state = Presentation::Shown;
        assert!(state.begin_reveal());
        assert!(!state.cancel());
        assert!(!state.begin_reveal(), "duplicate paint must not hide another overlay");
        state = Presentation::Revealed;
        assert!(!state.cancel());
    }

    #[test]
    fn hidden_window_cannot_acknowledge_a_paint() {
        let mut state = Presentation::Hidden;
        assert!(!state.begin_reveal());
        assert!(state.cancel());
    }
}
