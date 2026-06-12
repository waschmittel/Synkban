//! In-memory card location index. Maps `card_id → CardLocation` so that
//! mutating operations don't have to scan the whole `boards/` tree on every
//! call. Falls back to a disk scan on miss (or when an external sync invalidated
//! the cached entry), and verifies cached entries via a single `exists()` stat
//! before returning them.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

use crate::errors::AppError;
use crate::store::paths::*;

/// Where a card currently lives on disk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CardLocation {
    InList { board_id: String, list_id: String },
    Orphaned { board_id: String },
}

static INDEX: OnceLock<RwLock<HashMap<String, CardLocation>>> = OnceLock::new();

fn index() -> &'static RwLock<HashMap<String, CardLocation>> {
    INDEX.get_or_init(|| RwLock::new(HashMap::new()))
}

fn card_path(data_dir: &Path, card_id: &str, loc: &CardLocation) -> PathBuf {
    match loc {
        CardLocation::InList { board_id, list_id } => {
            cards_dir(data_dir, board_id, list_id).join(format!("{card_id}.json"))
        }
        CardLocation::Orphaned { board_id } => {
            archived_cards_dir(data_dir, board_id).join(format!("{card_id}.json"))
        }
    }
}

/// Cached lookup. Verifies the cached path still exists before returning it
/// (so external sync moving the file invalidates the entry transparently).
pub fn locate(data_dir: &Path, card_id: &str) -> Result<CardLocation, AppError> {
    if let Ok(guard) = index().read() {
        if let Some(loc) = guard.get(card_id) {
            if card_path(data_dir, card_id, loc).exists() {
                return Ok(loc.clone());
            }
        }
    }
    let loc = scan(data_dir, card_id)?;
    if let Ok(mut guard) = index().write() {
        guard.insert(card_id.to_string(), loc.clone());
    }
    Ok(loc)
}

/// `locate`, but errors on orphaned cards. Attachments need an actual list to
/// nest under, so they don't accept the orphan case.
pub fn find_board_and_list(data_dir: &Path, card_id: &str) -> Result<(String, String), AppError> {
    match locate(data_dir, card_id)? {
        CardLocation::InList { board_id, list_id } => Ok((board_id, list_id)),
        CardLocation::Orphaned { .. } => {
            Err(AppError::NotFound("Card not found in any list".into()))
        }
    }
}

/// Record (or update) where a card lives. Call after every write that moves
/// or creates a card.
pub fn record(card_id: &str, loc: CardLocation) {
    if let Ok(mut guard) = index().write() {
        guard.insert(card_id.to_string(), loc);
    }
}

/// Drop a card from the index. Call after delete.
pub fn forget(card_id: &str) {
    if let Ok(mut guard) = index().write() {
        guard.remove(card_id);
    }
}

fn scan(data_dir: &Path, card_id: &str) -> Result<CardLocation, AppError> {
    let boards = boards_dir(data_dir);
    if boards.exists() {
        for board_entry in fs::read_dir(&boards)? {
            let board_entry = board_entry?;
            if !board_entry.file_type()?.is_dir() {
                continue;
            }
            let board_id = board_entry.file_name().to_string_lossy().to_string();
            let lists_path = lists_dir(data_dir, &board_id);
            if lists_path.exists() {
                for list_entry in fs::read_dir(&lists_path)? {
                    let list_entry = list_entry?;
                    if !list_entry.file_type()?.is_dir() {
                        continue;
                    }
                    let list_id = list_entry.file_name().to_string_lossy().to_string();
                    let card_path = cards_dir(data_dir, &board_id, &list_id)
                        .join(format!("{card_id}.json"));
                    if card_path.exists() {
                        return Ok(CardLocation::InList { board_id, list_id });
                    }
                }
            }
            let orphan_path = archived_cards_dir(data_dir, &board_id)
                .join(format!("{card_id}.json"));
            if orphan_path.exists() {
                return Ok(CardLocation::Orphaned { board_id });
            }
        }
    }
    Err(AppError::NotFound("Card not found".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::boards::create_board;
    use crate::store::cards::create_card;
    use crate::store::io::drain_file_ops;
    use crate::store::lists::create_list;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    #[test]
    fn locate_finds_card_in_list() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let loc = locate(d.path(), &c.id).unwrap();
        assert_eq!(loc, CardLocation::InList { board_id: b.id, list_id: l.id });
    }

    #[test]
    fn locate_missing_card_errors() {
        let d = tmp();
        let err = locate(d.path(), "missing-uuid").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn locate_recovers_after_external_move() {
        // Simulate external sync: cache says one path, but file was moved.
        // Verify-on-read should fall back to scan and update the cache.
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l1 = create_list(d.path(), &b.id, "L1").unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        let c = create_card(d.path(), &l1.id, "C").unwrap();

        // Poison: tell index the card lives at a non-existent location.
        record(&c.id, CardLocation::InList {
            board_id: b.id.clone(),
            list_id: l2.id.clone(),
        });

        let loc = locate(d.path(), &c.id).unwrap();
        assert_eq!(loc, CardLocation::InList { board_id: b.id, list_id: l1.id });
    }
}
