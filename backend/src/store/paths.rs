//! Filesystem path helpers and shared input validators. No I/O — only path
//! construction and pure validation.

use std::path::{Path, PathBuf};

use crate::errors::AppError;

/// Ensures an entity ID is a single safe path segment (`1..=64` ASCII
/// alphanumeric, `-`, or `_`), rejecting empty or path-traversal strings.
pub(crate) fn check_id(id: &str) -> Result<(), AppError> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(())
        .ok_or_else(|| AppError::BadRequest("invalid id".into()))
}

/// Validates a `YYYY-MM-DD` calendar date (including month lengths and leap years).
pub fn is_valid_iso_date(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let b = s.as_bytes();
    if b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let Ok(y) = s[0..4].parse::<u32>() else {
        return false;
    };
    let Ok(m) = s[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(d) = s[8..10].parse::<u32>() else {
        return false;
    };
    if y < 1 || d < 1 {
        return false;
    }
    let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
    let max_day = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    d <= max_day
}

pub(crate) fn boards_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("boards")
}

pub(crate) fn board_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    boards_dir(data_dir).join(board_id)
}

pub(crate) fn lists_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("lists")
}

pub(crate) fn list_dir(data_dir: &Path, board_id: &str, list_id: &str) -> PathBuf {
    lists_dir(data_dir, board_id).join(list_id)
}

pub(crate) fn cards_dir(data_dir: &Path, board_id: &str, list_id: &str) -> PathBuf {
    list_dir(data_dir, board_id, list_id).join("cards")
}

pub(crate) fn attachment_dir(data_dir: &Path, board_id: &str, card_id: &str) -> PathBuf {
    board_dir(data_dir, board_id)
        .join("attachments")
        .join(card_id)
}

pub(crate) fn archived_cards_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("archived_cards")
}
