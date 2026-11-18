//! Diagnostics log: one JSON object per line. Never contains the selected text itself.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

pub struct Log {
    pub dir: Option<PathBuf>,
    file: Mutex<Option<File>>,
}

impl Log {
    pub fn open(dir: Option<PathBuf>) -> Self {
        let file = dir.as_ref().and_then(|d| {
            fs::create_dir_all(d).ok()?;
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(d.join("captures.jsonl"))
                .ok()
        });
        Self {
            dir,
            file: Mutex::new(file),
        }
    }

    pub fn record(&self, kind: &str, fields: Value) {
        let mut obj = Map::new();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        obj.insert("ts".into(), ts.into());
        obj.insert("type".into(), kind.into());
        if let Value::Object(extra) = fields {
            obj.extend(extra);
        }
        let line = Value::Object(obj).to_string();
        eprintln!("[pointer] {line}");
        if let Some(f) = self.file.lock().unwrap().as_mut() {
            let _ = writeln!(f, "{line}");
        }
    }
}

pub fn ms(d: std::time::Duration) -> f64 {
    (d.as_secs_f64() * 10_000.0).round() / 10.0
}
