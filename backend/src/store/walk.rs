//! Directory-tree walker for the `boards/` data tree. The single place that
//! defines what counts as a valid entry at each level:
//!
//! - a *board* is a directory under `boards/` containing `board.json`
//! - a *list* is a directory under `boards/{bid}/lists/` containing `list.json`
//! - a *card* is a `*.json` file under a list's `cards/` dir (or under
//!   `archived_cards/` for orphans)
//!
//! Missing directories yield empty results, never errors. Every other store
//! module that needs to enumerate entities goes through these functions
//! instead of hand-rolling `fs::read_dir` loops.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::{Card, List};
use crate::store::boards::BoardFile;
use crate::store::cards::read_card;
use crate::store::io::read_json;
use crate::store::paths::*;

/// IDs (= directory names) of all board directories that contain a `board.json`.
pub(crate) fn board_ids(data_dir: &Path) -> Result<Vec<String>, AppError> {
    let dir = boards_dir(data_dir);
    let mut ids = Vec::new();
    if dir.exists() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() && entry.path().join("board.json").exists() {
                ids.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(ids)
}

/// All `board.json` records (archived and active alike).
pub(crate) fn board_files(data_dir: &Path) -> Result<Vec<BoardFile>, AppError> {
    let mut boards = Vec::new();
    for id in board_ids(data_dir)? {
        boards.push(read_json(&board_dir(data_dir, &id).join("board.json"))?);
    }
    Ok(boards)
}

/// IDs (= directory names) of all list directories of a board that contain a
/// `list.json`.
pub(crate) fn list_ids(data_dir: &Path, board_id: &str) -> Result<Vec<String>, AppError> {
    let dir = lists_dir(data_dir, board_id);
    let mut ids = Vec::new();
    if dir.exists() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() && entry.path().join("list.json").exists() {
                ids.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(ids)
}

/// All `list.json` records of a board.
pub(crate) fn lists(data_dir: &Path, board_id: &str) -> Result<Vec<List>, AppError> {
    let mut out = Vec::new();
    for id in list_ids(data_dir, board_id)? {
        out.push(read_json(&list_dir(data_dir, board_id, &id).join("list.json"))?);
    }
    Ok(out)
}

/// All cards in a list (archived-in-place ones included — callers filter).
pub(crate) fn cards(data_dir: &Path, board_id: &str, list_id: &str) -> Result<Vec<Card>, AppError> {
    read_cards_in(&cards_dir(data_dir, board_id, list_id))
}

/// All orphaned cards of a board (their list was deleted).
pub(crate) fn orphaned_cards(data_dir: &Path, board_id: &str) -> Result<Vec<Card>, AppError> {
    read_cards_in(&archived_cards_dir(data_dir, board_id))
}

fn read_cards_in(dir: &Path) -> Result<Vec<Card>, AppError> {
    let mut out = Vec::new();
    if dir.exists() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                out.push(read_card(&path)?);
            }
        }
    }
    Ok(out)
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
    fn empty_data_dir_yields_empty_everything() {
        let d = tmp();
        assert!(board_ids(d.path()).unwrap().is_empty());
        assert!(board_files(d.path()).unwrap().is_empty());
        assert!(list_ids(d.path(), "nope").unwrap().is_empty());
        assert!(cards(d.path(), "nope", "nope").unwrap().is_empty());
        assert!(orphaned_cards(d.path(), "nope").unwrap().is_empty());
    }

    #[test]
    fn board_without_board_json_is_not_a_board() {
        let d = tmp();
        let b = create_board(d.path(), "Real").unwrap();
        fs::create_dir_all(boards_dir(d.path()).join("half-written")).unwrap();
        let ids = board_ids(d.path()).unwrap();
        assert_eq!(ids, vec![b.id]);
    }

    #[test]
    fn list_without_list_json_is_not_a_list() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "Real").unwrap();
        fs::create_dir_all(lists_dir(d.path(), &b.id).join("half-written")).unwrap();
        let ids = list_ids(d.path(), &b.id).unwrap();
        assert_eq!(ids, vec![l.id]);
    }

    #[test]
    fn cards_skips_non_json_files() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        fs::write(cards_dir(d.path(), &b.id, &l.id).join("stray.tmp"), b"x").unwrap();
        let found = cards(d.path(), &b.id, &l.id).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, c.id);
    }
}
