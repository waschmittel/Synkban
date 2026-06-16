//! Board CRUD + on-disk board.json shape. Labels live on the board record
//! (loaded/saved via `BoardFile`) but their CRUD is in `super::labels`.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::*;
use crate::store::io::{now_timestamp, read_json, track, write_json};
use crate::store::paths::*;

/// Internal representation of board.json on disk (includes labels).
/// Public `Board` response type omits labels (labels only appear in `BoardDetail`).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct BoardFile {
    pub id: String,
    pub title: String,
    pub created_at: String,
    #[serde(default)]
    pub labels: Vec<Label>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub position: f64,
}

impl From<BoardFile> for Board {
    fn from(b: BoardFile) -> Self {
        Board {
            id: b.id,
            title: b.title,
            created_at: b.created_at,
            color: b.color,
            archived: b.archived,
            archived_at: b.archived_at,
            position: b.position,
        }
    }
}

pub(crate) fn read_board_file(data_dir: &Path, board_id: &str) -> Result<BoardFile, AppError> {
    let path = board_dir(data_dir, board_id).join("board.json");
    if !path.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    read_json(&path)
}

pub(crate) fn write_board_file(data_dir: &Path, bf: &BoardFile) -> Result<(), AppError> {
    write_json(&board_dir(data_dir, &bf.id).join("board.json"), bf)
}

pub fn list_boards(data_dir: &Path) -> Result<Vec<Board>, AppError> {
    let mut boards = scan_boards(data_dir, false)?;
    // Sort by position ASC; created_at DESC breaks ties (legacy rows have position 0).
    boards.sort_by(|a, b| {
        a.position
            .partial_cmp(&b.position)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.created_at.cmp(&a.created_at))
    });
    Ok(boards)
}

pub fn list_archived_boards(data_dir: &Path) -> Result<Vec<Board>, AppError> {
    let mut boards = scan_boards(data_dir, true)?;
    // Descending by archival date; legacy boards without one fall back to created_at.
    boards.sort_by(|a, b| {
        let ka = a.archived_at.as_deref().unwrap_or(&a.created_at);
        let kb = b.archived_at.as_deref().unwrap_or(&b.created_at);
        kb.cmp(ka)
    });
    Ok(boards)
}

fn scan_boards(data_dir: &Path, want_archived: bool) -> Result<Vec<Board>, AppError> {
    Ok(crate::store::walk::board_files(data_dir)?
        .into_iter()
        .filter(|bf| bf.archived == want_archived)
        .map(Board::from)
        .collect())
}

pub fn create_board(data_dir: &Path, title: &str) -> Result<Board, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let dir = board_dir(data_dir, &id);
    fs::create_dir_all(dir.join("lists"))?;

    let max_pos = max_position(data_dir)?;
    let bf = BoardFile {
        id: id.clone(),
        title: title.to_string(),
        created_at: now_timestamp(),
        labels: Vec::new(),
        color: None,
        archived: false,
        archived_at: None,
        position: max_pos + 1.0,
    };
    write_board_file(data_dir, &bf)?;
    Ok(Board::from(bf))
}

fn max_position(data_dir: &Path) -> Result<f64, AppError> {
    Ok(crate::store::walk::board_files(data_dir)?
        .iter()
        .filter(|bf| !bf.archived)
        .map(|bf| bf.position)
        .fold(0.0, f64::max))
}

/// Renumbers active boards to positions 1.0, 2.0, … in the order given.
/// IDs missing or pointing to archived boards are skipped.
pub fn reorder_boards(data_dir: &Path, ids: &[String]) -> Result<(), AppError> {
    let mut pos = 1.0f64;
    for id in ids {
        let board_json = board_dir(data_dir, id).join("board.json");
        if !board_json.exists() {
            continue;
        }
        let mut bf: BoardFile = read_json(&board_json)?;
        if bf.archived {
            continue;
        }
        bf.position = pos;
        write_json(&board_json, &bf)?;
        pos += 1.0;
    }
    Ok(())
}

pub fn get_board(data_dir: &Path, board_id: &str) -> Result<BoardDetail, AppError> {
    let bf = read_board_file(data_dir, board_id)?;

    let mut lists_with_cards = Vec::new();
    for list in crate::store::walk::lists(data_dir, board_id)? {
        let mut cards: Vec<Card> = crate::store::walk::cards(data_dir, board_id, &list.id)?
            .into_iter()
            .filter(|c| !c.archived)
            .collect();
        cards.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap());
        lists_with_cards.push(ListWithCards {
            id: list.id,
            board_id: list.board_id,
            title: list.title,
            position: list.position,
            created_at: list.created_at,
            cards,
        });
    }
    lists_with_cards.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap());

    Ok(BoardDetail {
        id: bf.id,
        title: bf.title,
        created_at: bf.created_at,
        color: bf.color,
        labels: bf.labels,
        lists: lists_with_cards,
    })
}

pub fn update_board(
    data_dir: &Path,
    board_id: &str,
    title: Option<&str>,
    color: Option<&str>,
    archived: Option<bool>,
) -> Result<Board, AppError> {
    let mut bf = read_board_file(data_dir, board_id)?;
    if let Some(t) = title {
        bf.title = t.to_string();
    }
    if let Some(c) = color {
        bf.color = Some(c.to_string());
    }
    if let Some(a) = archived {
        if a && !bf.archived {
            bf.archived_at = Some(now_timestamp());
        } else if !a {
            bf.archived_at = None;
        }
        bf.archived = a;
    }
    write_board_file(data_dir, &bf)?;
    Ok(Board::from(bf))
}

pub fn delete_board(data_dir: &Path, board_id: &str) -> Result<(), AppError> {
    let bf = read_board_file(data_dir, board_id)?;
    if !bf.archived {
        return Err(AppError::BadRequest("Cannot delete non-archived board".into()));
    }
    let dir = board_dir(data_dir, board_id);
    track("deleted dir", &dir);
    fs::remove_dir_all(&dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::cards::{create_card, update_card};
    use crate::store::io::drain_file_ops;
    use crate::store::lists::create_list;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    #[test]
    fn list_boards_empty() {
        let d = tmp();
        assert!(list_boards(d.path()).unwrap().is_empty());
    }

    #[test]
    fn create_board_basic() {
        let d = tmp();
        let b = create_board(d.path(), "My Board").unwrap();
        assert_eq!(b.title, "My Board");
        assert!(!b.id.is_empty());
        assert!(!b.created_at.is_empty());
        assert!(b.color.is_none());
        assert!(board_dir(d.path(), &b.id).join("board.json").exists());
        assert!(lists_dir(d.path(), &b.id).exists());
    }

    #[test]
    fn list_boards_returns_created() {
        let d = tmp();
        let b1 = create_board(d.path(), "A").unwrap();
        let b2 = create_board(d.path(), "B").unwrap();
        let b3 = create_board(d.path(), "C").unwrap();
        let boards = list_boards(d.path()).unwrap();
        assert_eq!(boards.len(), 3);
        let ids: Vec<&str> = boards.iter().map(|b| b.id.as_str()).collect();
        assert!(ids.contains(&b1.id.as_str()));
        assert!(ids.contains(&b2.id.as_str()));
        assert!(ids.contains(&b3.id.as_str()));
    }

    #[test]
    fn get_board_not_found() {
        let d = tmp();
        let err = get_board(d.path(), "nonexistent").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn get_board_empty() {
        let d = tmp();
        let b = create_board(d.path(), "Test").unwrap();
        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.id, b.id);
        assert_eq!(detail.title, "Test");
        assert!(detail.lists.is_empty());
        assert!(detail.labels.is_empty());
    }

    #[test]
    fn get_board_with_lists_and_cards() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l1 = create_list(d.path(), &b.id, "List 1").unwrap();
        let l2 = create_list(d.path(), &b.id, "List 2").unwrap();
        let c1 = create_card(d.path(), &l1.id, "Card A").unwrap();
        let c2 = create_card(d.path(), &l1.id, "Card B").unwrap();
        let _c3 = create_card(d.path(), &l2.id, "Card C").unwrap();

        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.lists.len(), 2);
        assert_eq!(detail.lists[0].title, "List 1");
        assert_eq!(detail.lists[1].title, "List 2");
        assert_eq!(detail.lists[0].cards.len(), 2);
        assert_eq!(detail.lists[1].cards.len(), 1);
        assert_eq!(detail.lists[0].cards[0].id, c1.id);
        assert_eq!(detail.lists[0].cards[1].id, c2.id);
    }

    #[test]
    fn get_board_filters_archived_cards() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        let c1 = create_card(d.path(), &l.id, "Visible").unwrap();
        let c2 = create_card(d.path(), &l.id, "Archived").unwrap();
        update_card(d.path(), &c2.id, None, None, None, None, None, Some(true), None).unwrap();

        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.lists[0].cards.len(), 1);
        assert_eq!(detail.lists[0].cards[0].id, c1.id);
    }

    #[test]
    fn update_board_title() {
        let d = tmp();
        let b = create_board(d.path(), "Old").unwrap();
        let updated = update_board(d.path(), &b.id, Some("New"), None, None).unwrap();
        assert_eq!(updated.title, "New");
        assert_eq!(get_board(d.path(), &b.id).unwrap().title, "New");
    }

    #[test]
    fn update_board_color() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let updated = update_board(d.path(), &b.id, None, Some("#ff0000"), None).unwrap();
        assert_eq!(updated.color, Some("#ff0000".into()));
    }

    #[test]
    fn update_board_not_found() {
        let d = tmp();
        let err = update_board(d.path(), "fake", Some("X"), None, None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn reorder_boards_renumbers_positions() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();
        let c = create_board(d.path(), "C").unwrap();
        reorder_boards(d.path(), &[c.id, b.id, a.id]).unwrap();
        let boards = list_boards(d.path()).unwrap();
        let titles: Vec<&str> = boards.iter().map(|b| b.title.as_str()).collect();
        assert_eq!(titles, vec!["C", "B", "A"]);
        assert_eq!(boards[0].position, 1.0);
        assert_eq!(boards[1].position, 2.0);
        assert_eq!(boards[2].position, 3.0);
    }

    #[test]
    fn reorder_boards_skips_archived() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();
        update_board(d.path(), &b.id, None, None, Some(true)).unwrap();
        reorder_boards(d.path(), &[b.id, a.id]).unwrap();
        let active = list_boards(d.path()).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].position, 1.0);
    }

    #[test]
    fn create_board_assigns_increasing_position() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();
        assert!(b.position > a.position);
    }

    #[test]
    fn archive_board() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        assert!(!b.archived);
        update_board(d.path(), &b.id, None, None, Some(true)).unwrap();
        assert!(list_boards(d.path()).unwrap().is_empty());
        assert_eq!(list_archived_boards(d.path()).unwrap().len(), 1);
        update_board(d.path(), &b.id, None, None, Some(false)).unwrap();
        assert_eq!(list_boards(d.path()).unwrap().len(), 1);
        assert!(list_archived_boards(d.path()).unwrap().is_empty());
    }

    #[test]
    fn archive_sets_archived_at_and_restore_clears_it() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        assert!(b.archived_at.is_none());
        let archived = update_board(d.path(), &b.id, None, None, Some(true)).unwrap();
        assert!(archived.archived_at.is_some());
        let restored = update_board(d.path(), &b.id, None, None, Some(false)).unwrap();
        assert!(restored.archived_at.is_none());
    }

    #[test]
    fn list_archived_boards_sorted_descending_by_archival_date() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();

        update_board(d.path(), &b.id, None, None, Some(true)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        update_board(d.path(), &a.id, None, None, Some(true)).unwrap();

        let archived = list_archived_boards(d.path()).unwrap();
        let titles: Vec<&str> = archived.iter().map(|b| b.title.as_str()).collect();
        assert_eq!(titles, vec!["A", "B"]);
    }

    #[test]
    fn delete_board_requires_archived() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let err = delete_board(d.path(), &b.id).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn delete_board_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        update_board(d.path(), &b.id, None, None, Some(true)).unwrap();
        delete_board(d.path(), &b.id).unwrap();
        assert!(!board_dir(d.path(), &b.id).exists());
        assert!(list_boards(d.path()).unwrap().is_empty());
    }

    #[test]
    fn delete_board_not_found() {
        let d = tmp();
        let err = delete_board(d.path(), "fake").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_board_cascades() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let l = create_list(d.path(), &b.id, "List").unwrap();
        create_card(d.path(), &l.id, "Card").unwrap();
        update_board(d.path(), &b.id, None, None, Some(true)).unwrap();
        delete_board(d.path(), &b.id).unwrap();
        assert!(!board_dir(d.path(), &b.id).exists());
    }
}
