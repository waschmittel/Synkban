//! List CRUD. `delete_list` archives any cards in the list before removing
//! the list directory (so cards become orphaned-but-archived).

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::List;
use crate::store::card_index::{self, CardLocation};
use crate::store::io::{now_timestamp, read_json, remove_dir_if_empty, track, write_json};
use crate::store::paths::*;

pub(crate) fn find_board_for_list(data_dir: &Path, list_id: &str) -> Result<String, AppError> {
    for board_id in crate::store::walk::board_ids(data_dir)? {
        if list_dir(data_dir, &board_id, list_id).join("list.json").exists() {
            return Ok(board_id);
        }
    }
    Err(AppError::NotFound("List not found".into()))
}

pub fn create_list(data_dir: &Path, board_id: &str, title: &str) -> Result<List, AppError> {
    let board_path = board_dir(data_dir, board_id).join("board.json");
    if !board_path.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let max_pos = max_position(data_dir, board_id)?;

    let dir = list_dir(data_dir, board_id, &id);
    fs::create_dir_all(dir.join("cards"))?;

    let list = List {
        id,
        board_id: board_id.to_string(),
        title: title.to_string(),
        position: max_pos + 1.0,
        created_at: now_timestamp(),
    };
    write_json(&dir.join("list.json"), &list)?;
    Ok(list)
}

fn max_position(data_dir: &Path, board_id: &str) -> Result<f64, AppError> {
    Ok(crate::store::walk::lists(data_dir, board_id)?
        .iter()
        .map(|l| l.position)
        .fold(0.0, f64::max))
}

pub fn update_list(
    data_dir: &Path,
    list_id: &str,
    title: Option<&str>,
    position: Option<f64>,
) -> Result<List, AppError> {
    let board_id = find_board_for_list(data_dir, list_id)?;
    let list_json = list_dir(data_dir, &board_id, list_id).join("list.json");
    let mut list: List = read_json(&list_json)?;

    if let Some(t) = title {
        list.title = t.to_string();
    }
    if let Some(p) = position {
        list.position = p;
    }
    write_json(&list_json, &list)?;
    Ok(list)
}

pub fn delete_list(data_dir: &Path, list_id: &str) -> Result<(), AppError> {
    let board_id = find_board_for_list(data_dir, list_id)?;
    let dir = list_dir(data_dir, &board_id, list_id);
    let cdir = cards_dir(data_dir, &board_id, list_id);
    let mut orphaned_card_ids: Vec<String> = Vec::new();
    if cdir.exists() {
        let archive_dir = archived_cards_dir(data_dir, &board_id);
        for entry in fs::read_dir(&cdir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                let mut card = crate::store::cards::read_card(&path)?;
                card.archived = true;
                card.archived_at = Some(now_timestamp());
                fs::create_dir_all(&archive_dir)?;
                crate::store::cards::write_card(
                    &archive_dir.join(format!("{}.json", card.id)),
                    &mut card,
                )?;
                orphaned_card_ids.push(card.id);
            }
        }
    }
    track("deleted dir", &dir);
    fs::remove_dir_all(&dir)?;
    remove_dir_if_empty(&lists_dir(data_dir, &board_id));
    for cid in orphaned_card_ids {
        card_index::record(&cid, CardLocation::Orphaned { board_id: board_id.clone() });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::boards::{create_board, get_board};
    use crate::store::cards::{create_card, get_archived_cards};
    use crate::store::io::drain_file_ops;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    #[test]
    fn create_list_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "To Do").unwrap();
        assert_eq!(l.title, "To Do");
        assert_eq!(l.board_id, b.id);
        assert_eq!(l.position, 1.0);
    }

    #[test]
    fn create_list_position_increments() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l1 = create_list(d.path(), &b.id, "A").unwrap();
        let l2 = create_list(d.path(), &b.id, "B").unwrap();
        let l3 = create_list(d.path(), &b.id, "C").unwrap();
        assert_eq!(l1.position, 1.0);
        assert_eq!(l2.position, 2.0);
        assert_eq!(l3.position, 3.0);
    }

    #[test]
    fn create_list_board_not_found() {
        let d = tmp();
        let err = create_list(d.path(), "fake", "List").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn update_list_title() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "Old").unwrap();
        let updated = update_list(d.path(), &l.id, Some("New"), None).unwrap();
        assert_eq!(updated.title, "New");
        assert_eq!(updated.position, l.position);
    }

    #[test]
    fn update_list_position() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        let updated = update_list(d.path(), &l.id, None, Some(5.5)).unwrap();
        assert_eq!(updated.position, 5.5);
        assert_eq!(updated.title, "List");
    }

    #[test]
    fn update_list_not_found() {
        let d = tmp();
        let err = update_list(d.path(), "fake", Some("X"), None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_list_empty() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        delete_list(d.path(), &l.id).unwrap();
        assert!(get_board(d.path(), &b.id).unwrap().lists.is_empty());
    }

    #[test]
    fn delete_list_archives_cards() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        create_card(d.path(), &l.id, "Card 1").unwrap();
        create_card(d.path(), &l.id, "Card 2").unwrap();
        create_card(d.path(), &l.id, "Card 3").unwrap();
        delete_list(d.path(), &l.id).unwrap();

        assert!(!list_dir(d.path(), &b.id, &l.id).exists());
        let archived = get_archived_cards(d.path(), &b.id).unwrap();
        assert_eq!(archived.len(), 3);
        assert!(archived.iter().all(|c| c.archived));
    }

    #[test]
    fn delete_list_not_found() {
        let d = tmp();
        let err = delete_list(d.path(), "fake").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_last_list_removes_lists_parent_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let lists_parent = lists_dir(d.path(), &b.id);
        assert!(lists_parent.exists());
        delete_list(d.path(), &l.id).unwrap();
        assert!(!lists_parent.exists(), "lists/ parent should be cleaned up when empty");
    }

    #[test]
    fn lists_parent_kept_with_remaining_lists() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l1 = create_list(d.path(), &b.id, "L1").unwrap();
        let _l2 = create_list(d.path(), &b.id, "L2").unwrap();
        delete_list(d.path(), &l1.id).unwrap();
        assert!(lists_dir(d.path(), &b.id).exists(), "lists/ kept while l2 remains");
    }
}
