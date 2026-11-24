//! Desktop-mode mirror status persistence (`config_dir()/mirror-state.json`)
//! and serialized execution of the configured Readable Mirror.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::errors::AppError;
use crate::log_timestamp;
use crate::models::MirrorStatus;

const STATE_FILE: &str = "mirror-state.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct MirrorState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_succeeded_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_attempt_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cards_mirrored: Option<usize>,
}

static STATE_LOCK: Mutex<()> = Mutex::new(());
static RUN_LOCK: Mutex<()> = Mutex::new(());
static RUNNING: AtomicBool = AtomicBool::new(false);

struct RunningGuard;

impl Drop for RunningGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn load_state_inner(dir: &Path) -> MirrorState {
    match fs::read(dir.join(STATE_FILE)) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => MirrorState::default(),
    }
}

fn save_state_inner(dir: &Path, state: &MirrorState) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(STATE_FILE);
    let tmp = dir.join(format!(".{STATE_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn update_state(mutate: impl FnOnce(&mut MirrorState)) {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = config::config_dir();
    let mut state = load_state_inner(&dir);
    mutate(&mut state);
    if let Err(e) = save_state_inner(&dir, &state) {
        eprintln!(
            "[{}] warning: failed to save {}: {e}",
            log_timestamp(),
            STATE_FILE
        );
    }
}

/// Returns the current Desktop-mode mirror status (combining persisted
/// `mirror-state.json` with the live `running` flag).
pub fn load_status() -> MirrorStatus {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let s = load_state_inner(&config::config_dir());
    MirrorStatus {
        running: RUNNING.load(Ordering::SeqCst),
        last_succeeded_at: s.last_succeeded_at,
        last_attempt_at: s.last_attempt_at,
        last_error: s.last_error,
        cards_mirrored: s.cards_mirrored,
    }
}

/// Clears persisted status (used when the user picks a different `mirror_dir`
/// or clears it).
pub fn reset() {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = config::config_dir().join(STATE_FILE);
    let _ = fs::remove_file(path);
}

/// Runs the mirror using `mirror_dir` from `synkban.toml`, updating
/// `mirror-state.json` on both success and failure.
pub fn run_configured_mirror(data_dir: &Path) -> Result<MirrorStatus, AppError> {
    let _run_guard = RUN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let cfg = config::load();
    let Some(mirror_dir) = cfg.mirror_dir.filter(|s| !s.trim().is_empty()) else {
        return Err(AppError::BadRequest(
            "No readable mirror folder is configured".into(),
        ));
    };

    RUNNING.store(true, Ordering::SeqCst);
    let _running_guard = RunningGuard;
    let attempt_ms = now_ms();
    update_state(|s| {
        s.last_attempt_at = Some(attempt_ms);
    });

    match super::export_to_dir(data_dir, Path::new(&mirror_dir)) {
        Ok(stats) => {
            let done_ms = now_ms();
            update_state(|s| {
                s.last_succeeded_at = Some(done_ms);
                s.last_error = None;
                s.cards_mirrored = Some(stats.cards);
            });
            println!(
                "[{}] MIRROR {} -> {} ({} board(s), {} card(s); {} written, {} pruned, {} attachment(s) copied)",
                log_timestamp(),
                data_dir.display(),
                mirror_dir,
                stats.boards,
                stats.cards,
                stats.cards_written,
                stats.cards_pruned,
                stats.attachments_copied
            );
            Ok(MirrorStatus {
                running: false,
                last_succeeded_at: Some(done_ms),
                last_attempt_at: Some(attempt_ms),
                last_error: None,
                cards_mirrored: Some(stats.cards),
            })
        }
        Err(e) => {
            let msg = e.to_string();
            update_state(|s| {
                s.last_error = Some(msg.clone());
            });
            eprintln!("[{}] MIRROR failed: {msg}", log_timestamp());
            Err(e)
        }
    }
}

/// True when the configured schedule (`daily` / `weekly`) is due to run now.
pub fn is_schedule_due(schedule: &str, now: u64) -> bool {
    let interval_ms: u64 = match schedule {
        "daily" => 24 * 60 * 60 * 1000,
        "weekly" => 7 * 24 * 60 * 60 * 1000,
        _ => return false,
    };
    let status = load_status();
    if status.running {
        return false;
    }
    let past_interval = status
        .last_succeeded_at
        .is_none_or(|t| now.saturating_sub(t) >= interval_ms);
    if !past_interval {
        return false;
    }
    // Back off 15 minutes after a failed attempt (e.g. unmounted external drive).
    if status.last_error.is_some() {
        return status
            .last_attempt_at
            .is_none_or(|a| now.saturating_sub(a) >= 15 * 60 * 1000);
    }
    true
}
