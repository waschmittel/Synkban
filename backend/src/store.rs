use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::models::*;

thread_local! {
    static FILE_OPS: RefCell<Vec<(&'static str, PathBuf)>> = RefCell::new(Vec::new());
}

fn track(op: &'static str, path: &Path) {
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

fn remove_dir_if_empty(dir: &Path) {
    if let Ok(mut entries) = fs::read_dir(dir) {
        if entries.next().is_none() {
            track("deleted empty dir", dir);
            let _ = fs::remove_dir(dir);
        }
    }
}

// Distinct pastel colors for labels, arranged for max visual separation on sequential assignment.
// Interleaved hues: 0°, 180°, 90°, 270°, 45°, 225°, 135°, 315°, 30°, 210°, 150°, 330°
const LABEL_COLORS: &[&str] = &[
    "#ffb3b3", // rose
    "#9bf6ff", // sky
    "#caffbf", // lime
    "#c9b3ff", // lavender
    "#ffd6a5", // peach
    "#a0c4ff", // periwinkle
    "#fdffb6", // lemon
    "#ffc6ff", // pink
    "#b5ead7", // mint
    "#ffdac1", // apricot
    "#c7ceea", // steel blue
    "#e2f0cb", // pale green
];

fn boards_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("boards")
}

fn board_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    boards_dir(data_dir).join(board_id)
}

fn lists_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("lists")
}

fn list_dir(data_dir: &Path, board_id: &str, list_id: &str) -> PathBuf {
    lists_dir(data_dir, board_id).join(list_id)
}

fn cards_dir(data_dir: &Path, board_id: &str, list_id: &str) -> PathBuf {
    list_dir(data_dir, board_id, list_id).join("cards")
}

fn attachment_dir(data_dir: &Path, board_id: &str, card_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("attachments").join(card_id)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, AppError> {
    let data = fs::read_to_string(path)?;
    serde_json::from_str(&data).map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let data = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    track("wrote", path);
    fs::write(path, data)?;
    Ok(())
}

fn now_timestamp() -> String {
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

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Internal representation of board.json on disk (includes labels).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct BoardFile {
    id: String,
    title: String,
    created_at: String,
    #[serde(default)]
    labels: Vec<Label>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    position: f64,
}

impl From<BoardFile> for Board {
    fn from(b: BoardFile) -> Self {
        Board { id: b.id, title: b.title, created_at: b.created_at, color: b.color, archived: b.archived, position: b.position }
    }
}

// --- Change detection ---

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

// --- Boards ---

pub fn list_boards(data_dir: &Path) -> Result<Vec<Board>, AppError> {
    let dir = boards_dir(data_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut boards = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let board_json = entry.path().join("board.json");
            if board_json.exists() {
                let bf: BoardFile = read_json(&board_json)?;
                if !bf.archived {
                    boards.push(Board::from(bf));
                }
            }
        }
    }
    // Sort by position ascending; created_at desc breaks ties (legacy rows have position 0).
    boards.sort_by(|a, b| {
        a.position
            .partial_cmp(&b.position)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.created_at.cmp(&a.created_at))
    });
    Ok(boards)
}

pub fn list_archived_boards(data_dir: &Path) -> Result<Vec<Board>, AppError> {
    let dir = boards_dir(data_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut boards = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let board_json = entry.path().join("board.json");
            if board_json.exists() {
                let bf: BoardFile = read_json(&board_json)?;
                if bf.archived {
                    boards.push(Board::from(bf));
                }
            }
        }
    }
    boards.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(boards)
}

pub fn create_board(data_dir: &Path, title: &str) -> Result<Board, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let dir = board_dir(data_dir, &id);
    fs::create_dir_all(dir.join("lists"))?;

    let max_pos = get_max_board_position(data_dir)?;
    let bf = BoardFile {
        id: id.clone(),
        title: title.to_string(),
        created_at: now_timestamp(),
        labels: Vec::new(),
        color: None,
        archived: false,
        position: max_pos + 1.0,
    };
    write_json(&dir.join("board.json"), &bf)?;
    Ok(Board::from(bf))
}

fn get_max_board_position(data_dir: &Path) -> Result<f64, AppError> {
    let dir = boards_dir(data_dir);
    if !dir.exists() {
        return Ok(0.0);
    }
    let mut max = 0.0f64;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let board_json = entry.path().join("board.json");
            if board_json.exists() {
                let bf: BoardFile = read_json(&board_json)?;
                if !bf.archived && bf.position > max {
                    max = bf.position;
                }
            }
        }
    }
    Ok(max)
}

/// Renumbers active boards to positions 1.0, 2.0, … in the order given.
/// IDs missing or pointing to archived boards are skipped.
pub fn reorder_boards(data_dir: &Path, ids: &[String]) -> Result<(), AppError> {
    let mut pos = 1.0f64;
    for id in ids {
        let dir = board_dir(data_dir, id);
        let board_json = dir.join("board.json");
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
    let dir = board_dir(data_dir, board_id);
    let board_json = dir.join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let bf: BoardFile = read_json(&board_json)?;

    let mut lists_with_cards = Vec::new();
    let lists_path = lists_dir(data_dir, board_id);
    if lists_path.exists() {
        for entry in fs::read_dir(&lists_path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let list_json = entry.path().join("list.json");
                if list_json.exists() {
                    let list: List = read_json(&list_json)?;
                    let mut cards = Vec::new();
                    let cards_path = cards_dir(data_dir, board_id, &list.id);
                    if cards_path.exists() {
                        for card_entry in fs::read_dir(&cards_path)? {
                            let card_entry = card_entry?;
                            let path = card_entry.path();
                            if path.extension().is_some_and(|e| e == "json") {
                                let card = read_json::<Card>(&path)?;
                                if !card.archived {
                                    cards.push(card);
                                }
                            }
                        }
                    }
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
            }
        }
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
                    let list: List = read_json(&list_json)?;
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
                let card = read_json::<Card>(&path)?;
                archived.push(card);
            }
        }
    }
    archived.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(archived)
}

pub fn update_board(
    data_dir: &Path,
    board_id: &str,
    title: Option<&str>,
    color: Option<&str>,
    archived: Option<bool>,
) -> Result<Board, AppError> {
    let dir = board_dir(data_dir, board_id);
    let board_json = dir.join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let mut bf: BoardFile = read_json(&board_json)?;
    if let Some(t) = title {
        bf.title = t.to_string();
    }
    if let Some(c) = color {
        bf.color = Some(c.to_string());
    }
    if let Some(a) = archived {
        bf.archived = a;
    }
    write_json(&board_json, &bf)?;
    Ok(Board::from(bf))
}

pub fn delete_board(data_dir: &Path, board_id: &str) -> Result<(), AppError> {
    let dir = board_dir(data_dir, board_id);
    let board_json = dir.join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let bf: BoardFile = read_json(&board_json)?;
    if !bf.archived {
        return Err(AppError::BadRequest("Cannot delete non-archived board".into()));
    }
    track("deleted dir", &dir);
    fs::remove_dir_all(&dir)?;
    Ok(())
}

// --- Labels ---

pub fn create_label(data_dir: &Path, board_id: &str, name: &str) -> Result<Label, AppError> {
    let board_json = board_dir(data_dir, board_id).join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let mut bf: BoardFile = read_json(&board_json)?;
    let color = LABEL_COLORS[bf.labels.len() % LABEL_COLORS.len()].to_string();
    let label = Label {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        color,
    };
    bf.labels.push(label.clone());
    write_json(&board_json, &bf)?;
    Ok(label)
}

pub fn update_label(data_dir: &Path, board_id: &str, label_id: &str, name: &str) -> Result<Label, AppError> {
    let board_json = board_dir(data_dir, board_id).join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let mut bf: BoardFile = read_json(&board_json)?;
    let label = bf.labels.iter_mut().find(|l| l.id == label_id)
        .ok_or_else(|| AppError::NotFound("Label not found".into()))?;
    label.name = name.to_string();
    let updated = label.clone();
    write_json(&board_json, &bf)?;
    Ok(updated)
}

pub fn delete_label(data_dir: &Path, board_id: &str, label_id: &str) -> Result<(), AppError> {
    let board_json = board_dir(data_dir, board_id).join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let mut bf: BoardFile = read_json(&board_json)?;
    let before = bf.labels.len();
    bf.labels.retain(|l| l.id != label_id);
    if bf.labels.len() == before {
        return Err(AppError::NotFound("Label not found".into()));
    }
    write_json(&board_json, &bf)?;
    Ok(())
}

/// Find the board_id that owns the given label_id (scans all boards).
fn find_board_for_label(data_dir: &Path, label_id: &str) -> Result<String, AppError> {
    let dir = boards_dir(data_dir);
    if dir.exists() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let board_id = entry.file_name().to_string_lossy().to_string();
                let board_json = entry.path().join("board.json");
                if board_json.exists() {
                    let bf: BoardFile = read_json(&board_json)?;
                    if bf.labels.iter().any(|l| l.id == label_id) {
                        return Ok(board_id);
                    }
                }
            }
        }
    }
    Err(AppError::NotFound("Label not found".into()))
}

pub fn update_label_by_id(data_dir: &Path, label_id: &str, name: &str) -> Result<Label, AppError> {
    let board_id = find_board_for_label(data_dir, label_id)?;
    update_label(data_dir, &board_id, label_id, name)
}

pub fn delete_label_by_id(data_dir: &Path, label_id: &str) -> Result<(), AppError> {
    let board_id = find_board_for_label(data_dir, label_id)?;
    delete_label(data_dir, &board_id, label_id)
}

// --- Lists ---

fn find_board_for_list(data_dir: &Path, list_id: &str) -> Result<String, AppError> {
    let boards = boards_dir(data_dir);
    if boards.exists() {
        for entry in fs::read_dir(&boards)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let board_id = entry.file_name().to_string_lossy().to_string();
                let list_path = list_dir(data_dir, &board_id, list_id).join("list.json");
                if list_path.exists() {
                    return Ok(board_id);
                }
            }
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
    let max_pos = get_max_list_position(data_dir, board_id)?;

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

fn get_max_list_position(data_dir: &Path, board_id: &str) -> Result<f64, AppError> {
    let dir = lists_dir(data_dir, board_id);
    let mut max = 0.0f64;
    if dir.exists() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let list_json = entry.path().join("list.json");
                if list_json.exists() {
                    let list: List = read_json(&list_json)?;
                    if list.position > max {
                        max = list.position;
                    }
                }
            }
        }
    }
    Ok(max)
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

fn archived_cards_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("archived_cards")
}

pub fn delete_list(data_dir: &Path, list_id: &str) -> Result<(), AppError> {
    let board_id = find_board_for_list(data_dir, list_id)?;
    let dir = list_dir(data_dir, &board_id, list_id);
    let cdir = cards_dir(data_dir, &board_id, list_id);
    if cdir.exists() {
        let archive_dir = archived_cards_dir(data_dir, &board_id);
        for entry in fs::read_dir(&cdir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                let mut card: Card = read_json(&path)?;
                card.archived = true;
                fs::create_dir_all(&archive_dir)?;
                write_json(&archive_dir.join(format!("{}.json", card.id)), &card)?;
            }
        }
    }
    track("deleted dir", &dir);
    fs::remove_dir_all(&dir)?;
    let lists_parent = lists_dir(data_dir, &board_id);
    remove_dir_if_empty(&lists_parent);
    Ok(())
}

// --- Cards ---

enum CardLocation {
    InList { board_id: String, list_id: String },
    Orphaned { board_id: String },
}

fn find_card_location(data_dir: &Path, card_id: &str) -> Result<CardLocation, AppError> {
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
                    let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
                    if card_path.exists() {
                        return Ok(CardLocation::InList { board_id, list_id });
                    }
                }
            }
            let orphan_path = archived_cards_dir(data_dir, &board_id).join(format!("{card_id}.json"));
            if orphan_path.exists() {
                return Ok(CardLocation::Orphaned { board_id });
            }
        }
    }
    Err(AppError::NotFound("Card not found".into()))
}

fn find_board_and_list_for_card(data_dir: &Path, card_id: &str) -> Result<(String, String), AppError> {
    match find_card_location(data_dir, card_id)? {
        CardLocation::InList { board_id, list_id } => Ok((board_id, list_id)),
        CardLocation::Orphaned { .. } => Err(AppError::NotFound("Card not found in any list".into())),
    }
}

fn find_board_for_list_id(data_dir: &Path, list_id: &str) -> Result<String, AppError> {
    find_board_for_list(data_dir, list_id)
}

pub fn create_card(data_dir: &Path, list_id: &str, title: &str) -> Result<Card, AppError> {
    let board_id = find_board_for_list(data_dir, list_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let max_pos = get_max_card_position(data_dir, &board_id, list_id)?;

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

fn get_max_card_position(data_dir: &Path, board_id: &str, list_id: &str) -> Result<f64, AppError> {
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
            let path = cards_dir(data_dir, board_id, list_id).join(format!("{card_id}.json"));
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

    if is_orphaned && !card.archived {
        let target_list_id = new_list_id
            .ok_or_else(|| AppError::BadRequest("list_id required when restoring orphaned card".into()))?;
        let target_board_id = find_board_for_list_id(data_dir, target_list_id)?;
        let max_pos = get_max_card_position(data_dir, &target_board_id, target_list_id)?;
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
            let target_board_id = find_board_for_list_id(data_dir, target_list_id)?;
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
        CardLocation::InList { board_id, list_id } => {
            (board_id.clone(), cards_dir(data_dir, board_id, list_id).join(format!("{card_id}.json")))
        }
        CardLocation::Orphaned { board_id } => {
            (board_id.clone(), archived_cards_dir(data_dir, board_id).join(format!("{card_id}.json")))
        }
    };
    let card: Card = read_json(&path)?;
    if !card.archived {
        return Err(AppError::BadRequest("only archived cards can be permanently deleted".into()));
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
    // Clean up archived_cards/ dir if empty after deleting orphaned card
    let orphan_dir = archived_cards_dir(data_dir, &board_id);
    remove_dir_if_empty(&orphan_dir);
    Ok(())
}

// --- Attachments ---

pub fn create_attachment(
    data_dir: &Path,
    card_id: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> Result<Attachment, AppError> {
    let (board_id, list_id) = find_board_and_list_for_card(data_dir, card_id)?;
    let att_id = uuid::Uuid::new_v4().to_string();

    let att_dir = attachment_dir(data_dir, &board_id, card_id);
    fs::create_dir_all(&att_dir)?;
    let att_path = att_dir.join(&att_id);
    track("wrote", &att_path);
    fs::write(&att_path, data)?;
    if content_type.starts_with("image/") {
        create_thumbnail(&att_dir, &att_id, data);
    }

    let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
    let mut card: Card = read_json(&card_path)?;
    let att = Attachment {
        id: att_id,
        filename: filename.to_string(),
        size: data.len() as u64,
        content_type: content_type.to_string(),
        created_at: now_timestamp(),
    };
    card.attachments.push(att.clone());
    write_json(&card_path, &card)?;
    Ok(att)
}

pub fn get_attachment_data(
    data_dir: &Path,
    card_id: &str,
    att_id: &str,
) -> Result<(Attachment, Vec<u8>), AppError> {
    let (board_id, list_id) = find_board_and_list_for_card(data_dir, card_id)?;
    let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
    let card: Card = read_json(&card_path)?;
    let att = card
        .attachments
        .into_iter()
        .find(|a| a.id == att_id)
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let att_dir = attachment_dir(data_dir, &board_id, card_id);
    let data = fs::read(att_dir.join(att_id))?;
    Ok((att, data))
}

pub fn delete_attachment(
    data_dir: &Path,
    card_id: &str,
    att_id: &str,
) -> Result<(), AppError> {
    let (board_id, list_id) = find_board_and_list_for_card(data_dir, card_id)?;
    let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
    let mut card: Card = read_json(&card_path)?;
    let before = card.attachments.len();
    card.attachments.retain(|a| a.id != att_id);
    if card.attachments.len() == before {
        return Err(AppError::NotFound("Attachment not found".into()));
    }
    write_json(&card_path, &card)?;
    let att_dir = attachment_dir(data_dir, &board_id, card_id);
    let att_file = att_dir.join(att_id);
    let thumb_file = att_dir.join(format!("{att_id}_thumb"));
    if att_file.exists() {
        track("deleted", &att_file);
    }
    let _ = fs::remove_file(&att_file);
    if thumb_file.exists() {
        track("deleted", &thumb_file);
    }
    let _ = fs::remove_file(&thumb_file);
    remove_dir_if_empty(&att_dir);
    if let Some(parent) = att_dir.parent() {
        remove_dir_if_empty(parent);
    }
    Ok(())
}

fn create_thumbnail(att_dir: &Path, att_id: &str, data: &[u8]) {
    let Ok(img) = image::load_from_memory(data) else { return };
    let thumb = img.thumbnail(400, 400);
    let mut buf = std::io::Cursor::new(Vec::new());
    if thumb.write_to(&mut buf, image::ImageFormat::Jpeg).is_ok() {
        let thumb_path = att_dir.join(format!("{att_id}_thumb"));
        track("wrote", &thumb_path);
        let _ = fs::write(&thumb_path, buf.into_inner());
    }
}

pub fn get_thumbnail_data(
    data_dir: &Path,
    card_id: &str,
    att_id: &str,
) -> Result<Vec<u8>, AppError> {
    let (board_id, _) = find_board_and_list_for_card(data_dir, card_id)?;
    let thumb_path = attachment_dir(data_dir, &board_id, card_id).join(format!("{att_id}_thumb"));
    if !thumb_path.exists() {
        return Err(AppError::NotFound("Thumbnail not found".into()));
    }
    Ok(fs::read(&thumb_path)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    // -- Boards --

    #[test]
    fn list_boards_empty() {
        let d = tmp();
        let boards = list_boards(d.path()).unwrap();
        assert!(boards.is_empty());
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
        // lists sorted by position
        assert_eq!(detail.lists[0].title, "List 1");
        assert_eq!(detail.lists[1].title, "List 2");
        assert_eq!(detail.lists[0].cards.len(), 2);
        assert_eq!(detail.lists[1].cards.len(), 1);
        // cards sorted by position
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
        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.title, "New");
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
        // Reverse order: C, B, A
        reorder_boards(d.path(), &[c.id.clone(), b.id.clone(), a.id.clone()]).unwrap();
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
        // archived b should be ignored; reorder still works with just a
        reorder_boards(d.path(), &[b.id.clone(), a.id.clone()]).unwrap();
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
        // restore
        update_board(d.path(), &b.id, None, None, Some(false)).unwrap();
        assert_eq!(list_boards(d.path()).unwrap().len(), 1);
        assert!(list_archived_boards(d.path()).unwrap().is_empty());
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

    // -- Labels --

    #[test]
    fn create_label_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let label = create_label(d.path(), &b.id, "Bug").unwrap();
        assert_eq!(label.name, "Bug");
        assert_eq!(label.color, "#ffb3b3");
        assert!(!label.id.is_empty());
    }

    #[test]
    fn create_label_color_cycling() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let mut colors = Vec::new();
        for i in 0..13 {
            let label = create_label(d.path(), &b.id, &format!("L{i}")).unwrap();
            colors.push(label.color);
        }
        for i in 0..12 {
            assert_eq!(colors[i], LABEL_COLORS[i]);
        }
        // 13th wraps to first color
        assert_eq!(colors[12], LABEL_COLORS[0]);
    }

    #[test]
    fn create_label_board_not_found() {
        let d = tmp();
        let err = create_label(d.path(), "fake", "Bug").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn update_label_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let label = create_label(d.path(), &b.id, "Bug").unwrap();
        let updated = update_label(d.path(), &b.id, &label.id, "Feature").unwrap();
        assert_eq!(updated.name, "Feature");
        assert_eq!(updated.id, label.id);
        assert_eq!(updated.color, label.color);
    }

    #[test]
    fn update_label_not_found() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let err = update_label(d.path(), &b.id, "fake", "X").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_label_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let label = create_label(d.path(), &b.id, "Bug").unwrap();
        delete_label(d.path(), &b.id, &label.id).unwrap();
        let detail = get_board(d.path(), &b.id).unwrap();
        assert!(detail.labels.is_empty());
    }

    #[test]
    fn delete_label_not_found() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let err = delete_label(d.path(), &b.id, "fake").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn update_label_by_id_scans_boards() {
        let d = tmp();
        let _b1 = create_board(d.path(), "Board 1").unwrap();
        let b2 = create_board(d.path(), "Board 2").unwrap();
        let label = create_label(d.path(), &b2.id, "Original").unwrap();
        let updated = update_label_by_id(d.path(), &label.id, "Renamed").unwrap();
        assert_eq!(updated.name, "Renamed");
    }

    #[test]
    fn delete_label_by_id_scans_boards() {
        let d = tmp();
        let _b1 = create_board(d.path(), "Board 1").unwrap();
        let b2 = create_board(d.path(), "Board 2").unwrap();
        let label = create_label(d.path(), &b2.id, "Bug").unwrap();
        delete_label_by_id(d.path(), &label.id).unwrap();
        let detail = get_board(d.path(), &b2.id).unwrap();
        assert!(detail.labels.is_empty());
    }

    #[test]
    fn labels_in_board_detail() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        create_label(d.path(), &b.id, "Bug").unwrap();
        create_label(d.path(), &b.id, "Feature").unwrap();
        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.labels.len(), 2);
    }

    // -- Lists --

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
        let detail = get_board(d.path(), &b.id).unwrap();
        assert!(detail.lists.is_empty());
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

    // -- Cards --

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
        let updated = update_card(d.path(), &c.id, Some("New"), None, None, None, None, None, None).unwrap();
        assert_eq!(updated.title, "New");
    }

    #[test]
    fn update_card_description() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let updated = update_card(d.path(), &c.id, None, Some("desc"), None, None, None, None, None).unwrap();
        assert_eq!(updated.description, "desc");
    }

    #[test]
    fn update_card_position() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let updated = update_card(d.path(), &c.id, None, None, Some(5.5), None, None, None, None).unwrap();
        assert_eq!(updated.position, 5.5);
    }

    #[test]
    fn update_card_label_ids() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let ids = vec!["id1".into(), "id2".into()];
        let updated = update_card(d.path(), &c.id, None, None, None, None, Some(&ids), None, None).unwrap();
        assert_eq!(updated.label_ids, vec!["id1", "id2"]);
    }

    #[test]
    fn update_card_archive_and_restore() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();

        // archive
        let updated = update_card(d.path(), &c.id, None, None, None, None, None, Some(true), None).unwrap();
        assert!(updated.archived);
        let detail = get_board(d.path(), &b.id).unwrap();
        assert!(detail.lists[0].cards.is_empty());
        let archived = get_archived_cards(d.path(), &b.id).unwrap();
        assert_eq!(archived.len(), 1);

        // restore
        let restored = update_card(d.path(), &c.id, None, None, None, None, None, Some(false), None).unwrap();
        assert!(!restored.archived);
        let detail = get_board(d.path(), &b.id).unwrap();
        assert_eq!(detail.lists[0].cards.len(), 1);
    }

    #[test]
    fn update_card_due_date_set() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let updated = update_card(d.path(), &c.id, None, None, None, None, None, None, Some(Some("2024-06-15"))).unwrap();
        assert_eq!(updated.due_date, Some("2024-06-15".into()));
    }

    #[test]
    fn update_card_due_date_clear() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        // set
        update_card(d.path(), &c.id, None, None, None, None, None, None, Some(Some("2024-06-15"))).unwrap();
        // clear
        let updated = update_card(d.path(), &c.id, None, None, None, None, None, None, Some(None)).unwrap();
        assert!(updated.due_date.is_none());
    }

    #[test]
    fn update_card_due_date_omit_leaves_unchanged() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        update_card(d.path(), &c.id, None, None, None, None, None, None, Some(Some("2024-06-15"))).unwrap();
        // None = omit field, should leave date unchanged
        let updated = update_card(d.path(), &c.id, Some("New Title"), None, None, None, None, None, None).unwrap();
        assert_eq!(updated.due_date, Some("2024-06-15".into()));
    }

    #[test]
    fn update_card_move_between_lists() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l1 = create_list(d.path(), &b.id, "L1").unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        let c = create_card(d.path(), &l1.id, "C").unwrap();

        let moved = update_card(d.path(), &c.id, None, None, None, Some(&l2.id), None, None, None).unwrap();
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
        let err = update_card(d.path(), "fake", Some("X"), None, None, None, None, None, None).unwrap_err();
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
        let archived = get_archived_cards(d.path(), &b.id).unwrap();
        assert!(archived.is_empty());
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
        // delete list orphans card
        delete_list(d.path(), &l.id).unwrap();
        let archived = get_archived_cards(d.path(), &b.id).unwrap();
        assert_eq!(archived.len(), 1);

        delete_card(d.path(), &c.id).unwrap();
        let archived = get_archived_cards(d.path(), &b.id).unwrap();
        assert!(archived.is_empty());
    }

    #[test]
    fn get_archived_cards_includes_orphaned() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l1 = create_list(d.path(), &b.id, "L1").unwrap();
        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        let c1 = create_card(d.path(), &l1.id, "InList").unwrap();
        let _c2 = create_card(d.path(), &l2.id, "Orphaned").unwrap();

        // archive c1 in-place
        update_card(d.path(), &c1.id, None, None, None, None, None, Some(true), None).unwrap();
        // delete l2, orphaning c2
        delete_list(d.path(), &l2.id).unwrap();

        let archived = get_archived_cards(d.path(), &b.id).unwrap();
        assert_eq!(archived.len(), 2);
    }

    #[test]
    fn restore_orphaned_card_requires_list_id() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        delete_list(d.path(), &l.id).unwrap();

        let l2 = create_list(d.path(), &b.id, "L2").unwrap();
        // try restore without list_id
        let err = update_card(d.path(), &c.id, None, None, None, None, None, Some(false), None).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));

        // restore with list_id
        let restored = update_card(d.path(), &c.id, None, None, None, Some(&l2.id), None, Some(false), None).unwrap();
        assert!(!restored.archived);
        assert_eq!(restored.list_id, l2.id);

        let detail = get_board(d.path(), &b.id).unwrap();
        let target = detail.lists.iter().find(|l| l.id == l2.id).unwrap();
        assert_eq!(target.cards.len(), 1);
    }

    // -- Attachments --

    #[test]
    fn create_attachment_basic() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();

        let att = create_attachment(d.path(), &c.id, "test.txt", "text/plain", b"hello").unwrap();
        assert_eq!(att.filename, "test.txt");
        assert_eq!(att.size, 5);
        assert_eq!(att.content_type, "text/plain");

        // file on disk
        let att_path = attachment_dir(d.path(), &b.id, &c.id).join(&att.id);
        assert!(att_path.exists());

        // card JSON updated
        let (board_id, list_id) = find_board_and_list_for_card(d.path(), &c.id).unwrap();
        let card: Card = read_json(&cards_dir(d.path(), &board_id, &list_id).join(format!("{}.json", c.id))).unwrap();
        assert_eq!(card.attachments.len(), 1);
    }

    #[test]
    fn create_attachment_image_thumbnail() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();

        // generate valid PNG bytes via image crate
        let img = image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0]));
        let mut png_buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png_buf, image::ImageFormat::Png).unwrap();
        let png_data = png_buf.into_inner();

        let att = create_attachment(d.path(), &c.id, "img.png", "image/png", &png_data).unwrap();
        let thumb_path = attachment_dir(d.path(), &b.id, &c.id).join(format!("{}_thumb", att.id));
        assert!(thumb_path.exists());
    }

    #[test]
    fn get_attachment_data_basic() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att = create_attachment(d.path(), &c.id, "test.txt", "text/plain", b"hello world").unwrap();

        let (meta, data) = get_attachment_data(d.path(), &c.id, &att.id).unwrap();
        assert_eq!(meta.filename, "test.txt");
        assert_eq!(data, b"hello world");
    }

    #[test]
    fn get_attachment_not_found() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let err = get_attachment_data(d.path(), &c.id, "fake").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_attachment_basic() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att = create_attachment(d.path(), &c.id, "test.txt", "text/plain", b"data").unwrap();

        delete_attachment(d.path(), &c.id, &att.id).unwrap();

        let att_path = attachment_dir(d.path(), &b.id, &c.id).join(&att.id);
        assert!(!att_path.exists());

        let (board_id, list_id) = find_board_and_list_for_card(d.path(), &c.id).unwrap();
        let card: Card = read_json(&cards_dir(d.path(), &board_id, &list_id).join(format!("{}.json", c.id))).unwrap();
        assert!(card.attachments.is_empty());
    }

    #[test]
    fn delete_attachment_not_found() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let err = delete_attachment(d.path(), &c.id, "fake").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn get_thumbnail_not_found_for_text() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att = create_attachment(d.path(), &c.id, "test.txt", "text/plain", b"data").unwrap();
        let err = get_thumbnail_data(d.path(), &c.id, &att.id).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    // -- Utilities --

    #[test]
    fn get_latest_mtime_empty() {
        let d = tmp();
        let mtime = get_latest_mtime(d.path()).unwrap();
        assert_eq!(mtime, 0);
    }

    #[test]
    fn get_latest_mtime_after_writes() {
        let d = tmp();
        let m1 = get_latest_mtime(d.path()).unwrap();
        assert_eq!(m1, 0);
        create_board(d.path(), "Board").unwrap();
        let m2 = get_latest_mtime(d.path()).unwrap();
        assert!(m2 > 0);
    }

    #[test]
    fn drain_file_ops_basic() {
        let d = tmp();
        create_board(d.path(), "Board").unwrap();
        let ops = drain_file_ops(d.path());
        assert!(!ops.is_empty());
        assert!(ops.iter().any(|o| o.contains("wrote")));
        // second drain should be empty
        let ops2 = drain_file_ops(d.path());
        assert!(ops2.is_empty());
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
        assert!(is_leap(2000));   // divisible by 400
        assert!(!is_leap(1900));  // divisible by 100 but not 400
        assert!(is_leap(2024));   // divisible by 4
        assert!(!is_leap(2023)); // not divisible by 4
    }

    // -- Empty-dir cleanup --

    #[test]
    fn delete_last_attachment_removes_card_attachment_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att = create_attachment(d.path(), &c.id, "f.txt", "text/plain", b"x").unwrap();

        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        assert!(att_dir.exists());

        delete_attachment(d.path(), &c.id, &att.id).unwrap();
        assert!(!att_dir.exists(), "card-scoped attachment dir should be cleaned up");
    }

    #[test]
    fn delete_last_attachment_removes_board_attachments_parent_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att = create_attachment(d.path(), &c.id, "f.txt", "text/plain", b"x").unwrap();

        let attachments_parent = board_dir(d.path(), &b.id).join("attachments");
        assert!(attachments_parent.exists());

        delete_attachment(d.path(), &c.id, &att.id).unwrap();
        assert!(!attachments_parent.exists(), "board attachments/ parent should be cleaned up when empty");
    }

    #[test]
    fn attachments_parent_kept_when_other_cards_have_attachments() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c1 = create_card(d.path(), &l.id, "C1").unwrap();
        let c2 = create_card(d.path(), &l.id, "C2").unwrap();
        let att1 = create_attachment(d.path(), &c1.id, "a.txt", "text/plain", b"x").unwrap();
        create_attachment(d.path(), &c2.id, "b.txt", "text/plain", b"y").unwrap();

        delete_attachment(d.path(), &c1.id, &att1.id).unwrap();
        let attachments_parent = board_dir(d.path(), &b.id).join("attachments");
        assert!(attachments_parent.exists(), "parent kept while c2's attachments exist");
        assert!(!attachment_dir(d.path(), &b.id, &c1.id).exists());
        assert!(attachment_dir(d.path(), &b.id, &c2.id).exists());
    }

    #[test]
    fn delete_orphaned_card_removes_archived_cards_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        delete_list(d.path(), &l.id).unwrap(); // orphans c

        let arch_dir = archived_cards_dir(d.path(), &b.id);
        assert!(arch_dir.exists());

        delete_card(d.path(), &c.id).unwrap();
        assert!(!arch_dir.exists(), "archived_cards/ should be cleaned up when last orphan deleted");
    }

    #[test]
    fn archived_cards_dir_kept_with_remaining_orphans() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c1 = create_card(d.path(), &l.id, "C1").unwrap();
        let _c2 = create_card(d.path(), &l.id, "C2").unwrap();
        delete_list(d.path(), &l.id).unwrap(); // orphans both

        let arch_dir = archived_cards_dir(d.path(), &b.id);
        assert!(arch_dir.exists());

        delete_card(d.path(), &c1.id).unwrap();
        assert!(arch_dir.exists(), "kept while c2 remains orphaned");
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
        let lists_parent = lists_dir(d.path(), &b.id);
        assert!(lists_parent.exists(), "lists/ kept while l2 remains");
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

        update_card(d.path(), &c.id, None, None, None, Some(&l2.id), None, Some(false), None).unwrap();
        assert!(!arch_dir.exists(), "archived_cards/ cleaned up after restoring last orphan");
    }
}
