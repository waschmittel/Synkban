//! Board CRUD + on-disk board.json shape. Labels live on the board record
//! (loaded/saved via `BoardFile`) but their CRUD is in `super::labels`.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::*;
use crate::store::io::{now_timestamp, read_json, track, write_json};
use crate::store::paths::*;
use crate::store::walk;

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
    #[serde(default)]
    pub mode: BoardMode,
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
            mode: b.mode,
            stats: None,
        }
    }
}

pub(crate) fn read_board_file(data_dir: &Path, board_id: &str) -> Result<BoardFile, AppError> {
    check_id(board_id)?;
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

/// Active boards with their `BoardStats` (`today`: `YYYY-MM-DD`).
pub fn list_boards_with_stats(
    data_dir: &Path,
    today: Option<&str>,
) -> Result<Vec<Board>, AppError> {
    if let Some(t) = today {
        if !is_valid_iso_date(t) {
            return Err(AppError::BadRequest(
                "today must be in YYYY-MM-DD format".into(),
            ));
        }
    }
    let mut boards = list_boards(data_dir)?;
    let mtimes = crate::store::io::get_per_board_mtimes(data_dir)?;
    for b in &mut boards {
        let mut stats = BoardStats {
            edited_at: mtimes.get(&b.id).copied().unwrap_or(0),
            ..Default::default()
        };
        for list_id in walk::list_ids(data_dir, &b.id)? {
            for c in walk::cards(data_dir, &b.id, &list_id)? {
                if c.archived {
                    continue;
                }
                stats.cards += 1;
                if let (Some(due), Some(today)) = (c.due_date.as_deref(), today) {
                    stats.overdue += usize::from(due < today);
                }
            }
        }
        b.stats = Some(stats);
    }
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
    if title.trim().is_empty() {
        return Err(AppError::BadRequest("board title must not be empty".into()));
    }
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
        mode: BoardMode::Kanban,
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
        check_id(id)?;
        let board_json = board_dir(data_dir, id).join("board.json");
        if !board_json.exists() {
            continue;
        }
        // Skip a corrupt board.json rather than failing the whole reorder.
        let mut bf: BoardFile = match read_json(&board_json) {
            Ok(bf) => bf,
            Err(e) => {
                crate::store::io::warn_skip(data_dir, &board_json, "board", &e);
                continue;
            }
        };
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
        for c in &mut cards {
            c.attachments = crate::store::attachments::load_attachments(data_dir, board_id, &c.id);
        }
        cards.sort_by(|a, b| {
            a.position
                .partial_cmp(&b.position)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        lists_with_cards.push(ListWithCards {
            id: list.id,
            board_id: list.board_id,
            title: list.title,
            position: list.position,
            created_at: list.created_at,
            collapsed: list.collapsed,
            cards,
        });
    }
    lists_with_cards.sort_by(|a, b| {
        a.position
            .partial_cmp(&b.position)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(BoardDetail {
        id: bf.id,
        title: bf.title,
        created_at: bf.created_at,
        color: bf.color,
        labels: bf.labels,
        mode: bf.mode,
        lists: lists_with_cards,
    })
}

fn is_valid_hex_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

pub fn update_board(
    data_dir: &Path,
    board_id: &str,
    title: Option<&str>,
    color: Option<Option<&str>>,
    archived: Option<bool>,
    mode: Option<BoardMode>,
) -> Result<Board, AppError> {
    let mut bf = read_board_file(data_dir, board_id)?;
    if let Some(t) = title {
        if t.trim().is_empty() {
            return Err(AppError::BadRequest("board title must not be empty".into()));
        }
        bf.title = t.to_string();
    }
    if let Some(c) = color {
        match c {
            Some(hex) => {
                if !is_valid_hex_color(hex) {
                    return Err(AppError::BadRequest(
                        "color must be in #RRGGBB format".into(),
                    ));
                }
                bf.color = Some(hex.to_string());
            }
            None => bf.color = None,
        }
    }
    if let Some(a) = archived {
        if a && !bf.archived {
            bf.archived_at = Some(now_timestamp());
        } else if !a {
            bf.archived_at = None;
        }
        bf.archived = a;
    }
    if let Some(m) = mode {
        bf.mode = m;
    }
    write_board_file(data_dir, &bf)?;
    Ok(Board::from(bf))
}

pub fn delete_board(data_dir: &Path, board_id: &str) -> Result<(), AppError> {
    let bf = read_board_file(data_dir, board_id)?;
    if !bf.archived {
        return Err(AppError::BadRequest(
            "Cannot delete non-archived board".into(),
        ));
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
        update_card(
            d.path(),
            &c2.id,
            CardPatch {
                archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.lists[0].cards.len(), 1);
        assert_eq!(detail.lists[0].cards[0].id, c1.id);
    }

    #[test]
    fn update_board_title() {
        let d = tmp();
        let b = create_board(d.path(), "Old").unwrap();
        let updated = update_board(d.path(), &b.id, Some("New"), None, None, None).unwrap();
        assert_eq!(updated.title, "New");
        assert_eq!(get_board(d.path(), &b.id).unwrap().title, "New");
    }

    #[test]
    fn update_board_color() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let updated =
            update_board(d.path(), &b.id, None, Some(Some("#ff0000")), None, None).unwrap();
        assert_eq!(updated.color, Some("#ff0000".into()));
        let cleared = update_board(d.path(), &b.id, None, Some(None), None, None).unwrap();
        assert!(cleared.color.is_none());
        assert!(update_board(d.path(), &b.id, None, Some(Some("red")), None, None).is_err());
    }

    #[test]
    fn board_mode_defaults_to_kanban_and_persists() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        assert_eq!(b.mode, BoardMode::Kanban);
        let updated =
            update_board(d.path(), &b.id, None, None, None, Some(BoardMode::Notes)).unwrap();
        assert_eq!(updated.mode, BoardMode::Notes);
        assert_eq!(get_board(d.path(), &b.id).unwrap().mode, BoardMode::Notes);
        // Other updates leave it alone.
        update_board(d.path(), &b.id, Some("Renamed"), None, None, None).unwrap();
        assert_eq!(
            read_board_file(d.path(), &b.id).unwrap().mode,
            BoardMode::Notes
        );
    }

    #[test]
    fn board_file_without_mode_reads_as_kanban() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let path = board_dir(d.path(), &b.id).join("board.json");
        let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        v.as_object_mut().unwrap().remove("mode");
        fs::write(&path, serde_json::to_vec(&v).unwrap()).unwrap();
        assert_eq!(
            read_board_file(d.path(), &b.id).unwrap().mode,
            BoardMode::Kanban
        );
    }

    #[test]
    fn board_stats_count_active_cards_and_overdue_ones() {
        use crate::store::cards::{create_card_with, update_card};
        use crate::store::lists::create_list;
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let empty = create_board(d.path(), "Empty").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        create_card_with(d.path(), &l.id, "past", &[], Some("2026-11-16")).unwrap();
        create_card_with(d.path(), &l2.id, "today", &[], Some("2026-11-17")).unwrap();
        create_card_with(d.path(), &l2.id, "none", &[], None).unwrap();
        let archived = create_card_with(d.path(), &l.id, "a", &[], Some("2020-01-01")).unwrap();
        let patch = CardPatch {
            archived: Some(true),
            ..Default::default()
        };
        update_card(d.path(), &archived.id, patch).unwrap();

        let boards = list_boards_with_stats(d.path(), Some("2026-11-17")).unwrap();
        let stats = |id: &str| {
            boards
                .iter()
                .find(|x| x.id == id)
                .unwrap()
                .stats
                .as_ref()
                .unwrap()
        };
        assert_eq!((stats(&b.id).cards, stats(&b.id).overdue), (3, 1));
        assert!(stats(&b.id).edited_at > 0);
        assert_eq!((stats(&empty.id).cards, stats(&empty.id).overdue), (0, 0));
        // Without a date nothing is overdue.
        let boards = list_boards_with_stats(d.path(), None).unwrap();
        assert_eq!(
            boards
                .iter()
                .map(|b| b.stats.as_ref().unwrap().overdue)
                .sum::<usize>(),
            0
        );
        // Other endpoints don't carry stats.
        assert!(list_boards(d.path())
            .unwrap()
            .iter()
            .all(|b| b.stats.is_none()));
    }

    #[test]
    fn update_board_not_found() {
        let d = tmp();
        let err = update_board(d.path(), "fake", Some("X"), None, None, None).unwrap_err();
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
    fn reorder_boards_skips_corrupt_board() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();
        // Corrupt B's board.json: reorder must still renumber A, not error out.
        fs::write(board_dir(d.path(), &b.id).join("board.json"), b"{ broken").unwrap();
        reorder_boards(d.path(), &[b.id.clone(), a.id.clone()]).unwrap();
        let bf = read_board_file(d.path(), &a.id).unwrap();
        assert_eq!(bf.position, 1.0);
    }

    #[test]
    fn reorder_boards_skips_archived() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();
        update_board(d.path(), &b.id, None, None, Some(true), None).unwrap();
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
        update_board(d.path(), &b.id, None, None, Some(true), None).unwrap();
        assert!(list_boards(d.path()).unwrap().is_empty());
        assert_eq!(list_archived_boards(d.path()).unwrap().len(), 1);
        update_board(d.path(), &b.id, None, None, Some(false), None).unwrap();
        assert_eq!(list_boards(d.path()).unwrap().len(), 1);
        assert!(list_archived_boards(d.path()).unwrap().is_empty());
    }

    #[test]
    fn archive_sets_archived_at_and_restore_clears_it() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        assert!(b.archived_at.is_none());
        let archived = update_board(d.path(), &b.id, None, None, Some(true), None).unwrap();
        assert!(archived.archived_at.is_some());
        let restored = update_board(d.path(), &b.id, None, None, Some(false), None).unwrap();
        assert!(restored.archived_at.is_none());
    }

    #[test]
    fn list_archived_boards_sorted_descending_by_archival_date() {
        let d = tmp();
        let a = create_board(d.path(), "A").unwrap();
        let b = create_board(d.path(), "B").unwrap();

        update_board(d.path(), &b.id, None, None, Some(true), None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        update_board(d.path(), &a.id, None, None, Some(true), None).unwrap();

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
        update_board(d.path(), &b.id, None, None, Some(true), None).unwrap();
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
        update_board(d.path(), &b.id, None, None, Some(true), None).unwrap();
        delete_board(d.path(), &b.id).unwrap();
        assert!(!board_dir(d.path(), &b.id).exists());
    }
}
