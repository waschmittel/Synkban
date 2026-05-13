use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::models::*;

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

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, AppError> {
    let data = fs::read_to_string(path)?;
    serde_json::from_str(&data).map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let data = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
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

    // days since epoch to date
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
                boards.push(read_json::<Board>(&board_json)?);
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

    let board = Board {
        id,
        title: title.to_string(),
        created_at: now_timestamp(),
    };
    write_json(&dir.join("board.json"), &board)?;
    Ok(board)
}

pub fn get_board(data_dir: &Path, board_id: &str) -> Result<BoardDetail, AppError> {
    let dir = board_dir(data_dir, board_id);
    let board_json = dir.join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let board: Board = read_json(&board_json)?;

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
                                cards.push(read_json::<Card>(&path)?);
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
        id: board.id,
        title: board.title,
        created_at: board.created_at,
        lists: lists_with_cards,
    })
}

pub fn update_board(data_dir: &Path, board_id: &str, title: &str) -> Result<Board, AppError> {
    let dir = board_dir(data_dir, board_id);
    let board_json = dir.join("board.json");
    if !board_json.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    let mut board: Board = read_json(&board_json)?;
    board.title = title.to_string();
    write_json(&board_json, &board)?;
    Ok(board)
}

pub fn delete_board(data_dir: &Path, board_id: &str) -> Result<(), AppError> {
    let dir = board_dir(data_dir, board_id);
    if !dir.exists() {
        return Err(AppError::NotFound("Board not found".into()));
    }
    fs::remove_dir_all(&dir)?;
    Ok(())
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

pub fn delete_list(data_dir: &Path, list_id: &str) -> Result<(), AppError> {
    let board_id = find_board_for_list(data_dir, list_id)?;
    let dir = list_dir(data_dir, &board_id, list_id);
    fs::remove_dir_all(&dir)?;
    Ok(())
}

// --- Cards ---

fn find_board_and_list_for_card(data_dir: &Path, card_id: &str) -> Result<(String, String), AppError> {
    let boards = boards_dir(data_dir);
    if boards.exists() {
        for board_entry in fs::read_dir(&boards)? {
            let board_entry = board_entry?;
            if !board_entry.file_type()?.is_dir() {
                continue;
            }
            let board_id = board_entry.file_name().to_string_lossy().to_string();
            let lists_path = lists_dir(data_dir, &board_id);
            if !lists_path.exists() {
                continue;
            }
            for list_entry in fs::read_dir(&lists_path)? {
                let list_entry = list_entry?;
                if !list_entry.file_type()?.is_dir() {
                    continue;
                }
                let list_id = list_entry.file_name().to_string_lossy().to_string();
                let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
                if card_path.exists() {
                    return Ok((board_id, list_id));
                }
            }
        }
    }
    Err(AppError::NotFound("Card not found".into()))
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
) -> Result<Card, AppError> {
    let (board_id, old_list_id) = find_board_and_list_for_card(data_dir, card_id)?;
    let old_path = cards_dir(data_dir, &board_id, &old_list_id).join(format!("{card_id}.json"));
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

    if let Some(target_list_id) = new_list_id {
        if target_list_id != old_list_id {
            let target_board_id = find_board_for_list_id(data_dir, target_list_id)?;
            let new_dir = cards_dir(data_dir, &target_board_id, target_list_id);
            fs::create_dir_all(&new_dir)?;
            card.list_id = target_list_id.to_string();
            write_json(&new_dir.join(format!("{card_id}.json")), &card)?;
            fs::remove_file(&old_path)?;
            return Ok(card);
        }
    }

    write_json(&old_path, &card)?;
    Ok(card)
}

pub fn delete_card(data_dir: &Path, card_id: &str) -> Result<(), AppError> {
    let (board_id, list_id) = find_board_and_list_for_card(data_dir, card_id)?;
    let path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
    fs::remove_file(&path)?;
    Ok(())
}
