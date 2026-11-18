use tauri_nspanel::tauri_panel;

tauri_panel! {
    // Kept for binary compatibility / docs. Overlays now start as OverlayKeyPanel so follow-up
    // engage never swaps classes (class swap dropped the Cocoa frame and bounced the panel).
    panel!(OverlayPanel {
        config: {
            can_become_key_window: false,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })

    // Overlay + pinned + lightbox windows. `becomesKeyOnlyIfNeeded` is toggled at runtime so
    // clicks do not steal key until the user engages the follow-up (ADR 0002).
    panel!(OverlayKeyPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}
