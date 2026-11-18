//! The few strings the native side shows itself: the tray menu, window titles and shortcut
//! errors. Everything inside the webviews is translated in `src/i18n/`; the language comes from
//! the same `uiLanguage` setting, so both sides agree.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Lang {
    Zh,
    En,
    Ja,
    Ko,
    Es,
    Fr,
}

static CURRENT: AtomicU8 = AtomicU8::new(Lang::Zh as u8);

impl Lang {
    /// `zh`, `en`, `ja`, `ko`, `es` and `fr` force a language; anything else follows the system, which gets
    /// its own language when there is one and English otherwise (same rule as `localeFromSystem`
    /// in the frontend).
    pub fn resolve(pref: &str) -> Lang {
        Self::from_code(pref).unwrap_or_else(|| Self::from_system(sys_locale::get_locale().as_deref()))
    }

    fn from_code(code: &str) -> Option<Lang> {
        match code {
            "zh" => Some(Lang::Zh),
            "en" => Some(Lang::En),
            "ja" => Some(Lang::Ja),
            "ko" => Some(Lang::Ko),
            "es" => Some(Lang::Es),
            "fr" => Some(Lang::Fr),
            _ => None,
        }
    }

    fn from_system(locale: Option<&str>) -> Lang {
        locale
            .and_then(|l| {
                l.to_ascii_lowercase()
                    .split(['-', '_'])
                    .next()
                    .and_then(Self::from_code)
            })
            .unwrap_or(Lang::En)
    }
}

pub fn set(lang: Lang) {
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

pub fn current() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        0 => Lang::Zh,
        1 => Lang::En,
        2 => Lang::Ja,
        3 => Lang::Ko,
        4 => Lang::Es,
        _ => Lang::Fr,
    }
}

#[derive(Clone, Copy)]
pub enum Text {
    AppName,
    SettingsTitle,
    MenuSettings,
    MenuOcr,
    MenuLogs,
    MenuQuit,
    HintNoShortcut,
    KeySpace,
    ShortcutNeedsModifier,
    ShortcutShiftOnly,
}

/// `[zh, en, ja, ko, es, fr]`, in `Lang` order.
fn pick(texts: [&'static str; 6]) -> &'static str {
    texts[current() as usize]
}

pub fn tr(text: Text) -> &'static str {
    match text {
        Text::AppName => pick(["点拨", "Pointer", "Pointer", "Pointer", "Pointer", "Pointer"]),
        Text::SettingsTitle => pick([
            "点拨 设置",
            "Pointer Settings",
            "Pointer 設定",
            "Pointer 설정",
            "Ajustes de Pointer",
            "Réglages de Pointer",
        ]),
        Text::MenuSettings => pick(["设置…", "Settings…", "設定…", "설정…", "Ajustes…", "Réglages…"]),
        Text::MenuOcr => pick([
            "框选识字…",
            "Capture text…",
            "文字を取り込む…",
            "텍스트 캡처…",
            "Capturar texto…",
            "Capturer du texte…",
        ]),
        Text::MenuLogs => pick([
            "打开日志文件夹",
            "Open Log Folder",
            "ログフォルダーを開く",
            "로그 폴더 열기",
            "Abrir carpeta de registros",
            "Ouvrir le dossier des journaux",
        ]),
        Text::MenuQuit => pick(["退出", "Quit", "終了", "종료", "Salir", "Quitter"]),
        Text::HintNoShortcut => pick([
            "划词即可唤出",
            "Select text to bring it up",
            "文字を選択すると呼び出せます",
            "텍스트를 선택하면 나타납니다",
            "Selecciona texto para abrirlo",
            "Sélectionnez du texte pour l’ouvrir",
        ]),
        Text::KeySpace => pick(["空格", "Space", "スペース", "스페이스", "Espacio", "Espace"]),
        Text::ShortcutNeedsModifier => pick([
            "快捷键至少要包含一个修饰键",
            "A shortcut needs at least one modifier key",
            "ショートカットには修飾キーが 1 つ以上必要です",
            "단축키에는 보조 키가 하나 이상 있어야 합니다",
            "Un atajo necesita al menos una tecla modificadora",
            "Un raccourci doit comporter au moins une touche de modification",
        ]),
        Text::ShortcutShiftOnly => pick([
            "只按 Shift 会和正常打字冲突",
            "Shift alone would clash with normal typing",
            "Shift だけでは通常の入力と衝突します",
            "Shift만 쓰면 일반 입력과 충돌합니다",
            "Shift por sí sola interferiría con la escritura normal",
            "Maj seule entrerait en conflit avec la saisie normale",
        ]),
    }
}

/// "Select text, or press ⌥ + ` to bring it up", in the current language.
pub fn hint_with_shortcut(shortcut: &str) -> String {
    match current() {
        Lang::Zh => format!("划词，或按 {shortcut} 唤出"),
        Lang::En => format!("Select text, or press {shortcut}"),
        Lang::Ja => format!("文字を選択するか {shortcut} で呼び出せます"),
        Lang::Ko => format!("텍스트를 선택하거나 {shortcut}을(를) 누르세요"),
        Lang::Es => format!("Selecciona texto o pulsa {shortcut}"),
        Lang::Fr => format!("Sélectionnez du texte ou appuyez sur {shortcut}"),
    }
}

pub fn shortcut_unrecognized(accelerator: &str, error: &str) -> String {
    match current() {
        Lang::Zh => format!("无法识别的快捷键 {accelerator}：{error}"),
        Lang::En => format!("Unrecognized shortcut {accelerator}: {error}"),
        Lang::Ja => format!("認識できないショートカット {accelerator}：{error}"),
        Lang::Ko => format!("인식할 수 없는 단축키 {accelerator}: {error}"),
        Lang::Es => format!("Atajo no reconocido {accelerator}: {error}"),
        Lang::Fr => format!("Raccourci non reconnu {accelerator} : {error}"),
    }
}

pub fn shortcut_register_failed(error: &str) -> String {
    match current() {
        Lang::Zh => format!("注册失败，可能已被其他应用占用：{error}"),
        Lang::En => format!("Registration failed; another app may be using it: {error}"),
        Lang::Ja => format!("登録できませんでした。ほかのアプリが使用している可能性があります：{error}"),
        Lang::Ko => format!("등록하지 못했습니다. 다른 앱이 사용 중일 수 있습니다: {error}"),
        Lang::Es => format!("No se pudo registrar; puede que otra app lo esté usando: {error}"),
        Lang::Fr => format!("Échec de l’enregistrement ; une autre app l’utilise peut-être : {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_system_only_when_not_forced() {
        assert_eq!(Lang::resolve("zh"), Lang::Zh);
        assert_eq!(Lang::resolve("en"), Lang::En);
        assert_eq!(Lang::resolve("ja"), Lang::Ja);
        assert_eq!(Lang::resolve("ko"), Lang::Ko);
        assert_eq!(Lang::resolve("es"), Lang::Es);
        assert_eq!(Lang::resolve("fr"), Lang::Fr);
    }

    #[test]
    fn system_locales_get_their_language_and_the_rest_english() {
        assert_eq!(Lang::from_system(Some("zh-CN")), Lang::Zh);
        assert_eq!(Lang::from_system(Some("zh-Hant-TW")), Lang::Zh);
        assert_eq!(Lang::from_system(Some("en-US")), Lang::En);
        assert_eq!(Lang::from_system(Some("ja-JP")), Lang::Ja);
        assert_eq!(Lang::from_system(Some("ko_KR")), Lang::Ko);
        assert_eq!(Lang::from_system(Some("es-ES")), Lang::Es);
        assert_eq!(Lang::from_system(Some("fr_CA")), Lang::Fr);
        assert_eq!(Lang::from_system(Some("de-DE")), Lang::En);
        assert_eq!(Lang::from_system(None), Lang::En);
    }

    #[test]
    fn every_text_exists_in_every_language() {
        let all = [
            Text::AppName,
            Text::SettingsTitle,
            Text::MenuSettings,
            Text::MenuOcr,
            Text::MenuLogs,
            Text::MenuQuit,
            Text::HintNoShortcut,
            Text::KeySpace,
            Text::ShortcutNeedsModifier,
            Text::ShortcutShiftOnly,
        ];
        for lang in [Lang::Zh, Lang::En, Lang::Ja, Lang::Ko, Lang::Es, Lang::Fr] {
            set(lang);
            assert_eq!(current(), lang);
            for text in all {
                assert!(!tr(text).is_empty());
            }
            assert!(hint_with_shortcut("Alt + `").contains("Alt + `"));
        }
        set(Lang::Zh);
    }
}
