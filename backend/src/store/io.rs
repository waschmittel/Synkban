//! File-op tracking, JSON read/write, timestamp, mtime walk, empty-dir cleanup.

use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::store::paths::boards_dir;

thread_local! {
    static FILE_OPS: RefCell<Vec<(&'static str, PathBuf)>> = RefCell::new(Vec::new());
}

pub(crate) fn track(op: &'static str, path: &Path) {
    FILE_OPS.with(|ops| ops.borrow_mut().push((op, path.to_path_buf())));
}

pub fn drain_file_ops(data_dir: &Path) -> Vec<String> {
    FILE_OPS.with(|ops| {
        ops.borrow_mut()
            .drain(..)
            .map(|(op, path)| {
                let rel = path.strip_prefix(data_dir).unwrap_or(&path);
                format!("  {} {}", op, rel.display())
            })
            .collect()
    })
}

pub(crate) fn remove_dir_if_empty(dir: &Path) {
    if let Ok(mut entries) = fs::read_dir(dir) {
        if entries.next().is_none() {
            track("deleted empty dir", dir);
            let _ = fs::remove_dir(dir);
        }
    }
}

pub(crate) fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, AppError> {
    let data = fs::read_to_string(path)?;
    serde_json::from_str(&data)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
}

pub(crate) fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let data = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    track("wrote", path);
    fs::write(path, data)?;
    Ok(())
}

pub(crate) fn now_timestamp() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let secs = d.as_secs();
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let month_days = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 0;
    for md in &month_days {
        if remaining < *md {
            break;
        }
        remaining -= md;
        m += 1;
    }
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        y,
        m + 1,
        remaining + 1,
        hours,
        minutes,
        seconds
    )
}

pub(crate) fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

pub fn get_latest_mtime(data_dir: &Path) -> Result<u64, AppError> {
    let dir = boards_dir(data_dir);
    if !dir.exists() {
        return Ok(0);
    }
    let mut latest = 0u64;
    walk_mtime(&dir, &mut latest)?;
    Ok(latest)
}

fn walk_mtime(dir: &Path, latest: &mut u64) -> Result<(), AppError> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                let millis = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                if millis > *latest {
                    *latest = millis;
                }
            }
        }
        if ft.is_dir() {
            walk_mtime(&entry.path(), latest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::boards::create_board;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    #[test]
    fn get_latest_mtime_empty() {
        let d = tmp();
        assert_eq!(get_latest_mtime(d.path()).unwrap(), 0);
    }

    #[test]
    fn get_latest_mtime_after_writes() {
        let d = tmp();
        assert_eq!(get_latest_mtime(d.path()).unwrap(), 0);
        create_board(d.path(), "Board").unwrap();
        assert!(get_latest_mtime(d.path()).unwrap() > 0);
    }

    #[test]
    fn drain_file_ops_basic() {
        let d = tmp();
        create_board(d.path(), "Board").unwrap();
        let ops = drain_file_ops(d.path());
        assert!(!ops.is_empty());
        assert!(ops.iter().any(|o| o.contains("wrote")));
        // second drain should be empty
        assert!(drain_file_ops(d.path()).is_empty());
    }

    #[test]
    fn now_timestamp_format() {
        let ts = now_timestamp();
        assert_eq!(ts.len(), 19);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], " ");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
    }

    #[test]
    fn is_leap_year_cases() {
        assert!(is_leap(2000));
        assert!(!is_leap(1900));
        assert!(is_leap(2024));
        assert!(!is_leap(2023));
    }
}
