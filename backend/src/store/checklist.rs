//! Checklist CRUD. Items live inside the card JSON (`checklist: Vec<ChecklistItem>`),
//! no separate file. Vec order is the display order.

use std::path::Path;

use crate::errors::AppError;
use crate::models::{Card, ChecklistItem};
use crate::store::cards::{locate_card_path, read_card};
use crate::store::io::write_json;

pub fn create_checklist_item(
    data_dir: &Path,
    card_id: &str,
    text: &str,
) -> Result<ChecklistItem, AppError> {
    let (_board_id, path) = locate_card_path(data_dir, card_id)?;
    let mut card = read_card(&path)?;
    let item = ChecklistItem {
        id: uuid::Uuid::new_v4().to_string(),
        text: text.to_string(),
        done: false,
    };
    card.checklist.push(item.clone());
    write_json(&path, &card)?;
    Ok(item)
}

pub fn update_checklist_item(
    data_dir: &Path,
    card_id: &str,
    item_id: &str,
    text: Option<&str>,
    done: Option<bool>,
    pos: Option<usize>,
) -> Result<ChecklistItem, AppError> {
    let (_board_id, path) = locate_card_path(data_dir, card_id)?;
    let mut card = read_card(&path)?;
    let idx = card
        .checklist
        .iter()
        .position(|i| i.id == item_id)
        .ok_or_else(|| AppError::NotFound("Checklist item not found".into()))?;
    {
        let item = &mut card.checklist[idx];
        if let Some(t) = text {
            item.text = t.to_string();
        }
        if let Some(d) = done {
            item.done = d;
        }
    }
    if let Some(p) = pos {
        let target = p.min(card.checklist.len() - 1);
        let item = card.checklist.remove(idx);
        card.checklist.insert(target, item);
        let item = card.checklist[target].clone();
        write_json(&path, &card)?;
        return Ok(item);
    }
    let item = card.checklist[idx].clone();
    write_json(&path, &card)?;
    Ok(item)
}

pub fn delete_checklist_item(
    data_dir: &Path,
    card_id: &str,
    item_id: &str,
) -> Result<(), AppError> {
    let (_board_id, path) = locate_card_path(data_dir, card_id)?;
    let mut card = read_card(&path)?;
    let before = card.checklist.len();
    card.checklist.retain(|i| i.id != item_id);
    if card.checklist.len() == before {
        return Err(AppError::NotFound("Checklist item not found".into()));
    }
    write_json(&path, &card)?;
    Ok(())
}

/// Marks every checklist item done (or not done). Returns the updated card.
pub fn set_checklist_all(data_dir: &Path, card_id: &str, done: bool) -> Result<Card, AppError> {
    let (_board_id, path) = locate_card_path(data_dir, card_id)?;
    let mut card = read_card(&path)?;
    for item in &mut card.checklist {
        item.done = done;
    }
    write_json(&path, &card)?;
    Ok(card)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::boards::{create_board, get_board};
    use crate::store::cards::create_card;
    use crate::store::io::drain_file_ops;
    use crate::store::lists::{create_list, delete_list};
    use tempfile::TempDir;

    fn setup() -> (TempDir, String) {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        (d, c.id)
    }

    #[test]
    fn create_item_appends_in_order() {
        let (d, cid) = setup();
        let i1 = create_checklist_item(d.path(), &cid, "first").unwrap();
        let i2 = create_checklist_item(d.path(), &cid, "second").unwrap();
        assert!(!i1.done);

        let board_id = locate_card_path(d.path(), &cid).unwrap().0;
        let detail = get_board(d.path(), &board_id).unwrap();
        let card = &detail.lists[0].cards[0];
        assert_eq!(card.checklist.len(), 2);
        assert_eq!(card.checklist[0].id, i1.id);
        assert_eq!(card.checklist[1].id, i2.id);
        assert_eq!(card.checklist[0].text, "first");
        assert_eq!(card.checklist[1].text, "second");
    }

    #[test]
    fn create_item_card_not_found() {
        let d = TempDir::new().unwrap();
        let err = create_checklist_item(d.path(), "fake", "x").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn toggle_item_done() {
        let (d, cid) = setup();
        let item = create_checklist_item(d.path(), &cid, "task").unwrap();
        let updated =
            update_checklist_item(d.path(), &cid, &item.id, None, Some(true), None).unwrap();
        assert!(updated.done);
        assert_eq!(updated.text, "task");

        let updated =
            update_checklist_item(d.path(), &cid, &item.id, None, Some(false), None).unwrap();
        assert!(!updated.done);
    }

    #[test]
    fn rename_item_keeps_done_state() {
        let (d, cid) = setup();
        let item = create_checklist_item(d.path(), &cid, "old").unwrap();
        update_checklist_item(d.path(), &cid, &item.id, None, Some(true), None).unwrap();
        let updated =
            update_checklist_item(d.path(), &cid, &item.id, Some("new"), None, None).unwrap();
        assert_eq!(updated.text, "new");
        assert!(updated.done);
    }

    #[test]
    fn update_item_not_found() {
        let (d, cid) = setup();
        let err =
            update_checklist_item(d.path(), &cid, "fake", None, Some(true), None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_item() {
        let (d, cid) = setup();
        let i1 = create_checklist_item(d.path(), &cid, "keep").unwrap();
        let i2 = create_checklist_item(d.path(), &cid, "remove").unwrap();
        delete_checklist_item(d.path(), &cid, &i2.id).unwrap();

        let (_, path) = locate_card_path(d.path(), &cid).unwrap();
        let card = read_card(&path).unwrap();
        assert_eq!(card.checklist.len(), 1);
        assert_eq!(card.checklist[0].id, i1.id);
    }

    #[test]
    fn delete_item_not_found() {
        let (d, cid) = setup();
        let err = delete_checklist_item(d.path(), &cid, "fake").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    fn checklist_ids(d: &TempDir, cid: &str) -> Vec<String> {
        let (_, path) = locate_card_path(d.path(), cid).unwrap();
        read_card(&path)
            .unwrap()
            .checklist
            .iter()
            .map(|i| i.id.clone())
            .collect()
    }

    #[test]
    fn move_item_down() {
        let (d, cid) = setup();
        let a = create_checklist_item(d.path(), &cid, "a").unwrap();
        let b = create_checklist_item(d.path(), &cid, "b").unwrap();
        let c = create_checklist_item(d.path(), &cid, "c").unwrap();

        update_checklist_item(d.path(), &cid, &a.id, None, None, Some(1)).unwrap();
        assert_eq!(checklist_ids(&d, &cid), vec![b.id, a.id, c.id]);
    }

    #[test]
    fn move_item_up() {
        let (d, cid) = setup();
        let a = create_checklist_item(d.path(), &cid, "a").unwrap();
        let b = create_checklist_item(d.path(), &cid, "b").unwrap();
        let c = create_checklist_item(d.path(), &cid, "c").unwrap();

        update_checklist_item(d.path(), &cid, &c.id, None, None, Some(0)).unwrap();
        assert_eq!(checklist_ids(&d, &cid), vec![c.id, a.id, b.id]);
    }

    #[test]
    fn move_item_pos_clamped_to_end() {
        let (d, cid) = setup();
        let a = create_checklist_item(d.path(), &cid, "a").unwrap();
        let b = create_checklist_item(d.path(), &cid, "b").unwrap();

        update_checklist_item(d.path(), &cid, &a.id, None, None, Some(99)).unwrap();
        assert_eq!(checklist_ids(&d, &cid), vec![b.id, a.id]);
    }

    #[test]
    fn move_item_same_pos_is_noop() {
        let (d, cid) = setup();
        let a = create_checklist_item(d.path(), &cid, "a").unwrap();
        let b = create_checklist_item(d.path(), &cid, "b").unwrap();

        update_checklist_item(d.path(), &cid, &b.id, None, None, Some(1)).unwrap();
        assert_eq!(checklist_ids(&d, &cid), vec![a.id, b.id]);
    }

    #[test]
    fn move_item_with_done_update_applies_both() {
        let (d, cid) = setup();
        let a = create_checklist_item(d.path(), &cid, "a").unwrap();
        let b = create_checklist_item(d.path(), &cid, "b").unwrap();

        let updated =
            update_checklist_item(d.path(), &cid, &b.id, None, Some(true), Some(0)).unwrap();
        assert!(updated.done);
        assert_eq!(checklist_ids(&d, &cid), vec![b.id, a.id]);
    }

    #[test]
    fn set_all_done_and_undone() {
        let (d, cid) = setup();
        create_checklist_item(d.path(), &cid, "a").unwrap();
        create_checklist_item(d.path(), &cid, "b").unwrap();
        create_checklist_item(d.path(), &cid, "c").unwrap();

        let card = set_checklist_all(d.path(), &cid, true).unwrap();
        assert!(card.checklist.iter().all(|i| i.done));

        let card = set_checklist_all(d.path(), &cid, false).unwrap();
        assert!(card.checklist.iter().all(|i| !i.done));
    }

    #[test]
    fn set_all_on_empty_checklist_is_noop() {
        let (d, cid) = setup();
        let card = set_checklist_all(d.path(), &cid, true).unwrap();
        assert!(card.checklist.is_empty());
    }

    #[test]
    fn checklist_survives_orphaning() {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let item = create_checklist_item(d.path(), &c.id, "task").unwrap();
        delete_list(d.path(), &l.id).unwrap();

        // Card is now orphaned in archived_cards/ — checklist still editable.
        let updated =
            update_checklist_item(d.path(), &c.id, &item.id, None, Some(true), None).unwrap();
        assert!(updated.done);
    }

    #[test]
    fn legacy_card_without_checklist_deserializes_empty() {
        let (d, cid) = setup();
        let (_, path) = locate_card_path(d.path(), &cid).unwrap();
        // Strip the checklist field to simulate a pre-checklist card file.
        let raw = std::fs::read_to_string(&path).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        v.as_object_mut().unwrap().remove("checklist");
        std::fs::write(&path, serde_json::to_string(&v).unwrap()).unwrap();

        let card = read_card(&path).unwrap();
        assert!(card.checklist.is_empty());
    }
}
