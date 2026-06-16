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

/// All `board.json` records (archived and active alike). A board whose
/// `board.json` cannot be parsed is skipped (with a warning) rather than
/// failing the whole scan — one corrupt file must not hide every board.
pub(crate) fn board_files(data_dir: &Path) -> Result<Vec<BoardFile>, AppError> {
    let mut boards = Vec::new();
    for id in board_ids(data_dir)? {
        let path = board_dir(data_dir, &id).join("board.json");
        match read_json(&path) {
            Ok(bf) => boards.push(bf),
            Err(e) => crate::store::io::warn_skip(data_dir, &path, "board", &e),
        }
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

/// All `list.json` records of a board. A list whose `list.json` cannot be
/// parsed is skipped (with a warning) so one corrupt list doesn't take the
/// whole board down with it.
pub(crate) fn lists(data_dir: &Path, board_id: &str) -> Result<Vec<List>, AppError> {
    let mut out = Vec::new();
    for id in list_ids(data_dir, board_id)? {
        let path = list_dir(data_dir, board_id, &id).join("list.json");
        match read_json(&path) {
            Ok(list) => out.push(list),
            Err(e) => crate::store::io::warn_skip(data_dir, &path, "list", &e),
        }
    }
    Ok(out)
}

/// All cards in a list (archived-in-place ones included — callers filter).
pub(crate) fn cards(data_dir: &Path, board_id: &str, list_id: &str) -> Result<Vec<Card>, AppError> {
    read_cards_in(data_dir, &cards_dir(data_dir, board_id, list_id))
}

/// All orphaned cards of a board (their list was deleted).
pub(crate) fn orphaned_cards(data_dir: &Path, board_id: &str) -> Result<Vec<Card>, AppError> {
    read_cards_in(data_dir, &archived_cards_dir(data_dir, board_id))
}

/// Reads every `*.json` card in `dir`, skipping (with a warning) any single
/// card file that fails to parse so the rest of the list still loads.
fn read_cards_in(data_dir: &Path, dir: &Path) -> Result<Vec<Card>, AppError> {
    let mut out = Vec::new();
    if dir.exists() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                match read_card(&path) {
                    Ok(card) => out.push(card),
                    Err(e) => crate::store::io::warn_skip(data_dir, &path, "card", &e),
                }
            }
        }
    }
    Ok(out)
}

/// Walks the entire `boards/` tree attempting to parse every board, list, and
/// card, and returns a deduplicated list of warnings for any file that could
/// not be read. Drives the `GET /api/warnings` health endpoint so the UI can
/// surface silently-skipped (corrupt/partially-synced) files to the user.
pub fn collect_warnings(data_dir: &Path) -> Vec<String> {
    // Clear any warnings left over from earlier work on this thread so the
    // health check reports only what this scan finds.
    let _ = crate::store::io::drain_warnings();
    let _ = board_files(data_dir);
    if let Ok(board_ids) = board_ids(data_dir) {
        for bid in &board_ids {
            let _ = lists(data_dir, bid);
            if let Ok(list_ids) = list_ids(data_dir, bid) {
                for lid in &list_ids {
                    let _ = cards(data_dir, bid, lid);
                }
            }
            let _ = orphaned_cards(data_dir, bid);
            scan_attachment_sidecars(data_dir, bid);
        }
    }
    let mut warnings = crate::store::io::drain_warnings();
    warnings.sort();
    warnings.dedup();
    warnings
}

/// Try-parse every attachment sidecar under a board, warning on any that fail.
/// Sidecars are read lazily during card responses (`attachments::load_attachments`),
/// so the health check walks them explicitly to surface a corrupt one even when
/// no card is being rendered.
fn scan_attachment_sidecars(data_dir: &Path, board_id: &str) {
    let root = board_dir(data_dir, board_id).join("attachments");
    let Ok(card_dirs) = fs::read_dir(&root) else {
        return;
    };
    for cd in card_dirs.flatten() {
        if !cd.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(files) = fs::read_dir(cd.path()) else {
            continue;
        };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Err(e) = read_json::<crate::models::Attachment>(&path) {
                    crate::store::io::warn_skip(data_dir, &path, "attachment", &e);
                }
            }
        }
    }
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

    #[test]
    fn corrupt_board_json_is_skipped_not_fatal() {
        let d = tmp();
        let good = create_board(d.path(), "Good").unwrap();
        // A second board dir with a marker file present but unparseable.
        let bad = boards_dir(d.path()).join("corrupt");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("board.json"), b"{ not valid json").unwrap();

        let boards = board_files(d.path()).unwrap();
        assert_eq!(boards.len(), 1, "good board still loads");
        assert_eq!(boards[0].id, good.id);
    }

    #[test]
    fn corrupt_card_is_skipped_not_fatal() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let good = create_card(d.path(), &l.id, "Good").unwrap();
        fs::write(cards_dir(d.path(), &b.id, &l.id).join("broken.json"), b"{ oops").unwrap();

        let found = cards(d.path(), &b.id, &l.id).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, good.id);
    }

    #[test]
    fn collect_warnings_reports_corrupt_files_and_is_clean_otherwise() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        create_card(d.path(), &l.id, "C").unwrap();
        assert!(collect_warnings(d.path()).is_empty(), "healthy tree has no warnings");

        fs::write(cards_dir(d.path(), &b.id, &l.id).join("broken.json"), b"nope").unwrap();
        let warnings = collect_warnings(d.path());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("broken.json"));
        assert!(warnings[0].contains("card"));
        // Re-running does not accumulate duplicates across calls.
        assert_eq!(collect_warnings(d.path()).len(), 1);
    }

    #[test]
    fn collect_warnings_includes_corrupt_attachment_sidecar() {
        use crate::store::attachments::create_attachment;
        use crate::store::paths::attachment_dir;
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        create_attachment(d.path(), &c.id, "ok.txt", "text/plain", b"hi").unwrap();
        assert!(collect_warnings(d.path()).is_empty());

        fs::write(attachment_dir(d.path(), &b.id, &c.id).join("broken.json"), b"x").unwrap();
        let warnings = collect_warnings(d.path());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("attachment"));
    }
}
