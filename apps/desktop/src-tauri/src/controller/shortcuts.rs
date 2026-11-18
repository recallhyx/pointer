//! The global shortcuts: the trigger shortcut, the screen-OCR shortcut, and Esc while the overlay
//! is up. Registering waits for the main thread, so it never happens under `state`; changes are
//! serialized by `change` instead, which the main thread never takes.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcut, GlobalShortcutExt, Modifiers, Shortcut};

use crate::i18n;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Trigger = 0,
    Ocr = 1,
}

/// Parses an accelerator such as `Alt+Backquote`. A bare key is refused (CONTEXT.md: 全局快捷键),
/// and so is Shift alone, which would take over typing capitals; the same rules as `recordKey` in
/// the settings window, for a hand-edited settings file.
fn parse_shortcut(accelerator: &str) -> Result<Shortcut, String> {
    let shortcut =
        Shortcut::from_str(accelerator).map_err(|e| i18n::shortcut_unrecognized(accelerator, &e.to_string()))?;
    if shortcut.mods.is_empty() {
        return Err(i18n::tr(i18n::Text::ShortcutNeedsModifier).into());
    }
    if shortcut.mods == Modifiers::SHIFT {
        return Err(i18n::tr(i18n::Text::ShortcutShiftOnly).into());
    }
    Ok(shortcut)
}

pub fn escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

/// The system hotkey API, behind a trait so the bookkeeping below can be tested.
trait Registrar {
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&self, shortcut: Shortcut);
}

impl Registrar for GlobalShortcut<Wry> {
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        GlobalShortcut::register(self, shortcut).map_err(|e| i18n::shortcut_register_failed(&e.to_string()))
    }

    fn unregister(&self, shortcut: Shortcut) {
        let _ = GlobalShortcut::unregister(self, shortcut);
    }
}

#[derive(Clone, Debug, Default)]
struct Slot {
    /// The accelerator as written in the settings file, and what it parses to.
    current: Option<(String, Shortcut)>,
    registered: bool,
}

impl Slot {
    fn keys(&self) -> Option<Shortcut> {
        self.current.as_ref().map(|(_, s)| *s)
    }

    /// Registers or unregisters so the slot is live exactly when `live` is.
    fn sync(&mut self, reg: &impl Registrar, live: bool) -> Result<(), String> {
        let Some(keys) = self.keys() else {
            self.registered = false;
            return Ok(());
        };
        if live && !self.registered {
            reg.register(keys)?;
            self.registered = true;
        } else if !live && self.registered {
            reg.unregister(keys);
            self.registered = false;
        }
        Ok(())
    }
}

/// Indexed by `Kind`.
type Slots = [Slot; 2];

/// Puts `next` in the `kind` slot, then brings every slot in line with `live`. If `next` cannot be
/// registered the slot keeps what it had.
fn replace(
    slots: &mut Slots,
    kind: Kind,
    next: Option<(String, Shortcut)>,
    live: bool,
    reg: &impl Registrar,
) -> Result<(), String> {
    let target = &mut slots[kind as usize];
    let mut result = Ok(());
    if target.keys() == next.as_ref().map(|(_, s)| *s) {
        // Same keys, perhaps spelled differently.
        target.current = next;
    } else {
        let mut prev = std::mem::replace(
            target,
            Slot {
                current: next,
                registered: false,
            },
        );
        prev.sync(reg, false)?;
        if let Err(e) = target.sync(reg, live) {
            *target = prev;
            result = Err(e);
        }
    }
    sync_all(slots, live, reg);
    result
}

fn sync_all(slots: &mut Slots, live: bool, reg: &impl Registrar) {
    for slot in slots {
        if let Err(e) = slot.sync(reg, live) {
            eprintln!("[pointer] shortcut: {e}");
        }
    }
}

#[derive(Default)]
struct State {
    slots: Slots,
    /// The settings window is recording a shortcut: neither one may fire.
    paused: bool,
    escape: bool,
}

pub struct Shortcuts {
    app: AppHandle,
    state: Mutex<State>,
    change: Mutex<()>,
}

impl Shortcuts {
    pub fn new(app: &AppHandle) -> Self {
        Shortcuts {
            app: app.clone(),
            state: Mutex::default(),
            change: Mutex::new(()),
        }
    }

    /// The accelerator as written in the settings file, if one is set.
    pub fn accelerator(&self, kind: Kind) -> Option<String> {
        self.state.lock().unwrap().slots[kind as usize]
            .current
            .as_ref()
            .map(|(a, _)| a.clone())
    }

    pub fn kind_of(&self, shortcut: &Shortcut) -> Option<Kind> {
        let st = self.state.lock().unwrap();
        [Kind::Ocr, Kind::Trigger]
            .into_iter()
            .find(|&k| st.slots[k as usize].keys() == Some(*shortcut))
    }

    /// The user recorded a new shortcut in the settings window. Ends a pause, so both shortcuts
    /// are live again afterwards. If the new one cannot be registered (usually because another
    /// app holds it) the old one stays.
    pub fn set(&self, kind: Kind, accelerator: Option<&str>) -> Result<(), String> {
        self.update(kind, accelerator, true)
    }

    /// The settings file changed. Unlike [`Self::set`] this keeps a pause going: the file can
    /// be saved while a recording is under way.
    pub fn apply(&self, kind: Kind, accelerator: Option<&str>) -> Result<(), String> {
        self.update(kind, accelerator, false)
    }

    fn update(&self, kind: Kind, accelerator: Option<&str>, end_pause: bool) -> Result<(), String> {
        let next = accelerator
            .map(|a| parse_shortcut(a).map(|s| (a.to_string(), s)))
            .transpose()?;
        let _guard = self.change.lock().unwrap();
        let (mut slots, live) = {
            let st = self.state.lock().unwrap();
            (st.slots.clone(), end_pause || !st.paused)
        };
        let result = replace(&mut slots, kind, next, live, self.app.global_shortcut());
        let mut st = self.state.lock().unwrap();
        st.slots = slots;
        if end_pause {
            st.paused = false;
        }
        result
    }

    /// Lets the settings window record a new shortcut without either one firing.
    pub fn pause(&self, paused: bool) {
        let _guard = self.change.lock().unwrap();
        let mut slots = {
            let mut st = self.state.lock().unwrap();
            if st.paused == paused {
                return;
            }
            st.paused = paused;
            st.slots.clone()
        };
        sync_all(&mut slots, !paused, self.app.global_shortcut());
        self.state.lock().unwrap().slots = slots;
    }

    /// Esc is registered only while the overlay or the OCR picker is up (CONTEXT.md: 消失).
    /// Not serialized by `change`, since it is also called on the main thread (OCR started from
    /// the tray or its shortcut).
    pub fn set_escape(&self, on: bool) {
        if self.state.lock().unwrap().escape == on {
            return;
        }
        let gs = self.app.global_shortcut();
        let result = if on {
            gs.register(escape_shortcut())
        } else {
            gs.unregister(escape_shortcut())
        };
        match result {
            Ok(()) => self.state.lock().unwrap().escape = on,
            Err(e) => eprintln!("[pointer] escape shortcut: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashSet;

    use super::*;

    /// Tracks what is registered; refuses anything in `taken`, like another app holding it.
    #[derive(Default)]
    struct Fake {
        live: RefCell<HashSet<Shortcut>>,
        taken: HashSet<Shortcut>,
    }

    impl Registrar for Fake {
        fn register(&self, shortcut: Shortcut) -> Result<(), String> {
            if self.taken.contains(&shortcut) {
                return Err("taken".into());
            }
            self.live.borrow_mut().insert(shortcut);
            Ok(())
        }

        fn unregister(&self, shortcut: Shortcut) {
            self.live.borrow_mut().remove(&shortcut);
        }
    }

    fn sc(accelerator: &str) -> Option<(String, Shortcut)> {
        Some((accelerator.into(), parse_shortcut(accelerator).unwrap()))
    }

    fn keys(accelerator: &str) -> Shortcut {
        parse_shortcut(accelerator).unwrap()
    }

    fn startup(reg: &Fake) -> Slots {
        let mut slots = Slots::default();
        replace(&mut slots, Kind::Trigger, sc("Alt+Backquote"), true, reg).unwrap();
        replace(&mut slots, Kind::Ocr, sc("Alt+Super+KeyO"), true, reg).unwrap();
        slots
    }

    #[test]
    fn recording_a_trigger_shortcut_brings_the_ocr_one_back() {
        let reg = Fake::default();
        let mut slots = startup(&reg);
        // Recording: both off.
        sync_all(&mut slots, false, &reg);
        assert!(reg.live.borrow().is_empty());
        // Saved: the new trigger and the untouched OCR shortcut are both live.
        replace(&mut slots, Kind::Trigger, sc("Alt+KeyP"), true, &reg).unwrap();
        let live = reg.live.borrow();
        assert_eq!(live.len(), 2);
        assert!(live.contains(&keys("Alt+KeyP")));
        assert!(live.contains(&keys("Alt+Super+KeyO")));
    }

    #[test]
    fn a_taken_shortcut_keeps_the_old_one() {
        let mut reg = Fake::default();
        let mut slots = startup(&reg);
        reg.taken.insert(keys("Alt+KeyP"));
        assert!(replace(&mut slots, Kind::Trigger, sc("Alt+KeyP"), true, &reg).is_err());
        assert_eq!(slots[Kind::Trigger as usize].keys(), Some(keys("Alt+Backquote")));
        assert!(reg.live.borrow().contains(&keys("Alt+Backquote")));
    }

    #[test]
    fn a_settings_change_during_a_pause_registers_nothing() {
        let reg = Fake::default();
        let mut slots = startup(&reg);
        sync_all(&mut slots, false, &reg);
        replace(&mut slots, Kind::Ocr, sc("Alt+KeyO"), false, &reg).unwrap();
        assert!(reg.live.borrow().is_empty());
        sync_all(&mut slots, true, &reg);
        assert!(reg.live.borrow().contains(&keys("Alt+KeyO")));
        assert!(!reg.live.borrow().contains(&keys("Alt+Super+KeyO")));
    }

    #[test]
    fn clearing_a_shortcut_unregisters_it() {
        let reg = Fake::default();
        let mut slots = startup(&reg);
        replace(&mut slots, Kind::Ocr, None, true, &reg).unwrap();
        assert_eq!(*reg.live.borrow(), HashSet::from([keys("Alt+Backquote")]));
    }

    #[test]
    fn a_bare_key_or_shift_alone_is_refused() {
        assert!(parse_shortcut("Backquote").is_err());
        assert!(parse_shortcut("Shift+KeyA").is_err());
        assert!(parse_shortcut("Shift+Alt+KeyA").is_ok());
    }
}
