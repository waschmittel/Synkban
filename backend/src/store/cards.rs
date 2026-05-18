//! Card CRUD. Cards live in `boards/{bid}/lists/{lid}/cards/{cid}.json` when
//! active; archived-but-orphaned cards (e.g. their list was deleted) live in
//! `boards/{bid}/archived_cards/{cid}.json`.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::Card;
use crate::store::io::{now_timestamp, read_json, remove_dir_if_empty, track, write_json};
use crate::store::lists::find_board_for_list;
use crate::store::paths::*;

/// Where a card currently lives. Used by `update_card`/`delete_card` to know
/// whether to operate on the list-scoped path or the orphan path.
pub(crate) enum CardLocation {
    InList { board_id: String, list_id: String },
    Orphaned { board_id: String },
}

pub(crate) fn find_card_location(
    data_dir: &Path,
    card_id: &str,
) -> Result<CardLocation, AppError> {
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
            let orphan_path =
                archived_cards_dir(data_dir, &board_id).join(format!("{card_id}.json"));
            if orphan_path.exists() {
                return Ok(CardLocation::Orphaned { board_id });
            }
        }
    }
    Err(AppError::NotFound("Card not found".into()))
}

pub(crate) fn find_board_and_list_for_card(
    data_dir: &Path,
    card_id: &str,
) -> Result<(String, String), AppError> {
    match find_card_location(data_dir, card_id)? {
        CardLocation::InList { board_id, list_id } => Ok((board_id, list_id)),
        CardLocation::Orphaned { .. } => {
            Err(AppError::NotFound("Card not found in any list".into()))
        }
    }
}

pub fn create_card(data_dir: &Path, list_id: &str, title: &str) -> Result<Card, AppError> {
    let board_id = find_board_for_list(data_dir, list_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let max_pos = max_position(data_dir, &board_id, list_id)?;

    let dir = cards_dir(data_dir, &board_id, list_id);
    fs::create_dir_all(&dir)?;

    let card = Card {
        id: id.clone(),
        list_id: list_id.to_string(),
        title: title.to_string(),
        description: String::new(),
        position: max_pos + 1.0,
        created_at: now_timestamp(),
        label_ids: Vec::new(),
        archived: false,
        attachments: Vec::new(),
        due_date: None,
    };
    write_json(&dir.join(format!("{id}.json")), &card)?;
    Ok(card)
}

fn max_position(data_dir: &Path, board_id: &str, list_id: &str) -> Result<f64, AppError> {
    let dir = cards_dir(data_dir, board_id, list_id);
    let mut max = 0.0f64;
    if dir.exists() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                let card: Card = read_json(&path)?;
                if card.position > max {
                    max = card.position;
                }
            }
        }
    }
    Ok(max)
}

pub fn update_card(
    data_dir: &Path,
    card_id: &str,
    title: Option<&str>,
    description: Option<&str>,
    position: Option<f64>,
    new_list_id: Option<&str>,
    label_ids: Option<&[String]>,
    archived: Option<bool>,
    due_date: Option<Option<&str>>,
) -> Result<Card, AppError> {
    let loc = find_card_location(data_dir, card_id)?;
    let (_board_id, old_list_id, old_path, is_orphaned) = match &loc {
        CardLocation::InList { board_id, list_id } => {
            let path =
                cards_dir(data_dir, board_id, list_id).join(format!("{card_id}.json"));
            (board_id.clone(), list_id.clone(), path, false)
        }
        CardLocation::Orphaned { board_id } => {
            let path = archived_cards_dir(data_dir, board_id).join(format!("{card_id}.json"));
            (board_id.clone(), String::new(), path, true)
        }
    };
    let mut card: Card = read_json(&old_path)?;

    if let Some(t) = title {
        card.title = t.to_string();
    }
    if let Some(d) = description {
        card.description = d.to_string();
    }
    if let Some(p) = position {
        card.position = p;
    }
    if let Some(ids) = label_ids {
        card.label_ids = ids.to_vec();
    }
    if let Some(a) = archived {
        card.archived = a;
    }
    if let Some(dd) = due_date {
        card.due_date = dd.map(|s| s.to_string());
    }

    // Restoring an orphaned card requires a target list.
    if is_orphaned && !card.archived {
        let target_list_id = new_list_id.ok_or_else(|| {
            AppError::BadRequest("list_id required when restoring orphaned card".into())
        })?;
        let target_board_id = find_board_for_list(data_dir, target_list_id)?;
        let max_pos = max_position(data_dir, &target_board_id, target_list_id)?;
        card.list_id = target_list_id.to_string();
        card.position = max_pos + 1.0;
        let new_dir = cards_dir(data_dir, &target_board_id, target_list_id);
        fs::create_dir_all(&new_dir)?;
        write_json(&new_dir.join(format!("{card_id}.json")), &card)?;
        track("deleted", &old_path);
        fs::remove_file(&old_path)?;
        if let Some(parent) = old_path.parent() {
            remove_dir_if_empty(parent);
        }
        return Ok(card);
    }

    if let Some(target_list_id) = new_list_id {
        if target_list_id != old_list_id {
            let target_board_id = find_board_for_list(data_dir, target_list_id)?;
            let new_dir = cards_dir(data_dir, &target_board_id, target_list_id);
            fs::create_dir_all(&new_dir)?;
            card.list_id = target_list_id.to_string();
            write_json(&new_dir.join(format!("{card_id}.json")), &card)?;
            track("deleted", &old_path);
            fs::remove_file(&old_path)?;
            return Ok(card);
        }
    }

    write_json(&old_path, &card)?;
    Ok(card)
}

pub fn delete_card(data_dir: &Path, card_id: &str) -> Result<(), AppError> {
    let loc = find_card_location(data_dir, card_id)?;
    let (board_id, path) = match &loc {
        CardLocation::InList { board_id, list_id } => (
            board_id.clone(),
            cards_dir(data_dir, board_id, list_id).join(format!("{card_id}.json")),
        ),
        CardLocation::Orphaned { board_id } => (
            board_id.clone(),
            archived_cards_dir(data_dir, board_id).join(format!("{card_id}.json")),
        ),
    };
    let card: Card = read_json(&path)?;
    if !card.archived {
        return Err(AppError::BadRequest(
            "only archived cards can be permanently deleted".into(),
        ));
    }
    track("deleted", &path);
    fs::remove_file(&path)?;
    let att_dir = attachment_dir(data_dir, &board_id, card_id);
    if att_dir.exists() {
        track("deleted dir", &att_dir);
        let _ = fs::remove_dir_all(&att_dir);
    }
    if let Some(parent) = att_dir.parent() {
        remove_dir_if_empty(parent);
    }
    // Clean up archived_cards/ dir if empty after deleting orphaned card.
    remove_dir_if_empty(&archived_cards_dir(data_dir, &board_id));
    Ok(())
}

/// Returns all archived cards on the board — both archived-in-place (still in
/// their list directory with `archived=true`) and orphaned (in `archived_cards/`).
pub fn get_archived_cards(data_dir: &Path, board_id: &str) -> Result<Vec<Card>, AppError> {
    let board_json = board_dir(data_dir, board_id).join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let mut archived = Vec::new();
    let lists_path = lists_dir(data_dir, board_id);
    if lists_path.exists() {
        for entry in fs::read_dir(&lists_path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let list_json = entry.path().join("list.json");
                if list_json.exists() {
                    let list: crate::models::List = read_json(&list_json)?;
                    let cards_path = cards_dir(data_dir, board_id, &list.id);
                    if cards_path.exists() {
                        for card_entry in fs::read_dir(&cards_path)? {
                            let card_entry = card_entry?;
                            let path = card_entry.path();
                            if path.extension().is_some_and(|e| e == "json") {
                                let card = read_json::<Card>(&path)?;
                                if card.archived {
                                    archived.push(card);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let orphan_dir = archived_cards_dir(data_dir, board_id);
    if orphan_dir.exists() {
        for entry in fs::read_dir(&orphan_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                archived.push(read_json::<Card>(&path)?);
            }
        }
    }
    archived.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(archived)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::attachments::create_attachment;
    use crate::store::boards::{create_board, get_board};
    use crate::store::io::drain_file_ops;
    use crate::store::lists::{create_list, delete_list};
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    #[test]
    fn create_card_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        let c = create_card(d.path(), &l.id, "Task").unwrap();
        assert_eq!(c.title, "Task");
        assert_eq!(c.list_id, l.id);
        assert_eq!(c.position, 1.0);
        assert_eq!(c.description, "");
        assert!(c.label_ids.is_empty());
        assert!(!c.archived);
        assert!(c.attachments.is_empty());
        assert!(c.due_date.is_none());
    }

    #[test]
    fn create_card_position_increments() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        let c1 = create_card(d.path(), &l.id, "A").unwrap();
        let c2 = create_card(d.path(), &l.id, "B").unwrap();
        let c3 = create_card(d.path(), &l.id, "C").unwrap();
        assert_eq!(c1.position, 1.0);
        assert_eq!(c2.position, 2.0);
        assert_eq!(c3.position, 3.0);
    }

    #[test]
    fn create_card_list_not_found() {
        let d = tmp();
        let err = create_card(d.path(), "fake", "Card").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn update_card_title() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "Old").unwrap();
        let updated =
            update_card(d.path(), &c.id, Some("New"), None, None, None, None, None, None).unwrap();
        assert_eq!(updated.title, "New");
    }

    #[test]
    fn update_card_description() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let updated =
            update_card(d.path(), &c.id, None, Some("desc"), None, None, None, None, None).unwrap();
        assert_eq!(updated.description, "desc");
    }

    #[test]
    fn update_card_position() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let updated =
            update_card(d.path(), &c.id, None, None, Some(5.5), None, None, None, None).unwrap();
        assert_eq!(updated.position, 5.5);
    }

    #[test]
    fn update_card_label_ids() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let ids = vec!["id1".into(), "id2".into()];
        let updated =
            update_card(d.path(), &c.id, None, None, None, None, Some(&ids), None, None).unwrap();
        assert_eq!(updated.label_ids, vec!["id1", "id2"]);
    }

    #[test]
    fn update_card_archive_and_restore() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();

        let updated =
            update_card(d.path(), &c.id, None, None, None, None, None, Some(true), None).unwrap();
        assert!(updated.archived);
        let detail = get_board(d.path(), &b.id).unwrap();
        assert!(detail.lists[0].cards.is_empty());
        assert_eq!(get_archived_cards(d.path(), &b.id).unwrap().len(), 1);

        let restored =
            update_card(d.path(), &c.id, None, None, None, None, None, Some(false), None).unwrap();
        assert!(!restored.archived);
        assert_eq!(get_board(d.path(), &b.id).unwrap().lists[0].cards.len(), 1);
    }

    #[test]
    fn update_card_due_date_set() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let updated = update_card(
            d.path(),
            &c.id,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Some("2024-06-15")),
        )
        .unwrap();
        assert_eq!(updated.due_date, Some("2024-06-15".into()));
    }

    #[test]
    fn update_card_due_date_clear() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        update_card(
            d.path(),
            &c.id,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Some("2024-06-15")),
        )
        .unwrap();
        let updated =
            update_card(d.path(), &c.id, None, None, None, None, None, None, Some(None)).unwrap();
        assert!(updated.due_date.is_none());
    }

    #[test]
    fn update_card_due_date_omit_leaves_unchanged() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        update_card(
            d.path(),
            &c.id,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Some("2024-06-15")),
        )
        .unwrap();
        let updated = update_card(
            d.path(),
            &c.id,
            Some("New Title"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(updated.due_date, Some("2024-06-15".into()));
    }

    #[test]
    fn update_card_move_between_lists() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l1 = create_list(d.path(), &b.id, "L1").unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        let c = create_card(d.path(), &l1.id, "C").unwrap();

        let moved = update_card(
            d.path(),
            &c.id,
            None,
            None,
            None,
            Some(&l2.id),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(moved.list_id, l2.id);

        let detail = get_board(d.path(), &b.id).unwrap();
        let list1 = detail.lists.iter().find(|l| l.id == l1.id).unwrap();
        let list2 = detail.lists.iter().find(|l| l.id == l2.id).unwrap();
        assert!(list1.cards.is_empty());
        assert_eq!(list2.cards.len(), 1);
    }

    #[test]
    fn update_card_not_found() {
        let d = tmp();
        let err = update_card(d.path(), "fake", Some("X"), None, None, None, None, None, None)
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_card_must_be_archived() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let err = delete_card(d.path(), &c.id).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn delete_card_archived() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        update_card(d.path(), &c.id, None, None, None, None, None, Some(true), None).unwrap();
        delete_card(d.path(), &c.id).unwrap();
        assert!(get_archived_cards(d.path(), &b.id).unwrap().is_empty());
    }

    #[test]
    fn delete_card_cleans_attachments() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        create_attachment(d.path(), &c.id, "test.txt", "text/plain", b"hello").unwrap();
        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        assert!(att_dir.exists());

        update_card(d.path(), &c.id, None, None, None, None, None, Some(true), None).unwrap();
        delete_card(d.path(), &c.id).unwrap();
        assert!(!att_dir.exists());
    }

    #[test]
    fn delete_card_orphaned() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        delete_list(d.path(), &l.id).unwrap();
        assert_eq!(get_archived_cards(d.path(), &b.id).unwrap().len(), 1);

        delete_card(d.path(), &c.id).unwrap();
        assert!(get_archived_cards(d.path(), &b.id).unwrap().is_empty());
    }

    #[test]
    fn get_archived_cards_includes_orphaned() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l1 = create_list(d.path(), &b.id, "L1").unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        let c1 = create_card(d.path(), &l1.id, "InList").unwrap();
        let _c2 = create_card(d.path(), &l2.id, "Orphaned").unwrap();

        update_card(d.path(), &c1.id, None, None, None, None, None, Some(true), None).unwrap();
        delete_list(d.path(), &l2.id).unwrap();

        assert_eq!(get_archived_cards(d.path(), &b.id).unwrap().len(), 2);
    }

    #[test]
    fn restore_orphaned_card_requires_list_id() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        delete_list(d.path(), &l.id).unwrap();

        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        let err =
            update_card(d.path(), &c.id, None, None, None, None, None, Some(false), None)
                .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));

        let restored = update_card(
            d.path(),
            &c.id,
            None,
            None,
            None,
            Some(&l2.id),
            None,
            Some(false),
            None,
        )
        .unwrap();
        assert!(!restored.archived);
        assert_eq!(restored.list_id, l2.id);

        let detail = get_board(d.path(), &b.id).unwrap();
        let target = detail.lists.iter().find(|l| l.id == l2.id).unwrap();
        assert_eq!(target.cards.len(), 1);
    }

    #[test]
    fn delete_orphaned_card_removes_archived_cards_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        delete_list(d.path(), &l.id).unwrap();

        let arch_dir = archived_cards_dir(d.path(), &b.id);
        assert!(arch_dir.exists());
        delete_card(d.path(), &c.id).unwrap();
        assert!(!arch_dir.exists());
    }

    #[test]
    fn archived_cards_dir_kept_with_remaining_orphans() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c1 = create_card(d.path(), &l.id, "C1").unwrap();
        let _c2 = create_card(d.path(), &l.id, "C2").unwrap();
        delete_list(d.path(), &l.id).unwrap();

        let arch_dir = archived_cards_dir(d.path(), &b.id);
        assert!(arch_dir.exists());
        delete_card(d.path(), &c1.id).unwrap();
        assert!(arch_dir.exists(), "kept while c2 remains orphaned");
    }

    #[test]
    fn restore_orphaned_card_removes_archived_cards_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        delete_list(d.path(), &l.id).unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();

        let arch_dir = archived_cards_dir(d.path(), &b.id);
        assert!(arch_dir.exists());
        update_card(
            d.path(),
            &c.id,
            None,
            None,
            None,
            Some(&l2.id),
            None,
            Some(false),
            None,
        )
        .unwrap();
        assert!(!arch_dir.exists());
    }
}
