//! Label CRUD. Labels live inside `board.json` (see `BoardFile` in
//! `super::boards`); there is no separate labels file.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::Label;
use crate::store::boards::{read_board_file, write_board_file, BoardFile};
use crate::store::io::read_json;
use crate::store::paths::{board_dir, boards_dir};

/// Distinct pastel colors for labels, arranged for max visual separation on sequential assignment.
/// Interleaved hues: 0°, 180°, 90°, 270°, 45°, 225°, 135°, 315°, 30°, 210°, 150°, 330°
pub(crate) const LABEL_COLORS: &[&str] = &[
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

pub fn create_label(data_dir: &Path, board_id: &str, name: &str) -> Result<Label, AppError> {
    let mut bf = read_board_file(data_dir, board_id)?;
    let color = LABEL_COLORS[bf.labels.len() % LABEL_COLORS.len()].to_string();
    let label = Label {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        color,
    };
    bf.labels.push(label.clone());
    write_board_file(data_dir, &bf)?;
    Ok(label)
}

pub fn update_label(
    data_dir: &Path,
    board_id: &str,
    label_id: &str,
    name: &str,
) -> Result<Label, AppError> {
    let mut bf = read_board_file(data_dir, board_id)?;
    let label = bf
        .labels
        .iter_mut()
        .find(|l| l.id == label_id)
        .ok_or_else(|| AppError::NotFound("Label not found".into()))?;
    label.name = name.to_string();
    let updated = label.clone();
    write_board_file(data_dir, &bf)?;
    Ok(updated)
}

pub fn delete_label(data_dir: &Path, board_id: &str, label_id: &str) -> Result<(), AppError> {
    let mut bf = read_board_file(data_dir, board_id)?;
    let before = bf.labels.len();
    bf.labels.retain(|l| l.id != label_id);
    if bf.labels.len() == before {
        return Err(AppError::NotFound("Label not found".into()));
    }
    write_board_file(data_dir, &bf)?;
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
                let board_json = board_dir(data_dir, &board_id).join("board.json");
                if board_json.exists() {
                    // Skip a corrupt board.json instead of failing the whole
                    // label op — the label's real owner may be another board.
                    let bf: BoardFile = match read_json(&board_json) {
                        Ok(bf) => bf,
                        Err(e) => {
                            crate::store::io::warn_skip(data_dir, &board_json, "board", &e);
                            continue;
                        }
                    };
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::boards::{create_board, get_board};
    use crate::store::io::drain_file_ops;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

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
        assert!(get_board(d.path(), &b.id).unwrap().labels.is_empty());
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
    fn find_board_for_label_skips_corrupt_board() {
        use std::fs;
        use crate::store::paths::board_dir;
        let d = tmp();
        let corrupt = create_board(d.path(), "Corrupt").unwrap();
        let b2 = create_board(d.path(), "Good").unwrap();
        let label = create_label(d.path(), &b2.id, "Bug").unwrap();
        // A corrupt board.json must not stop us finding the label's real owner.
        fs::write(board_dir(d.path(), &corrupt.id).join("board.json"), b"{ broken").unwrap();
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
        assert!(get_board(d.path(), &b2.id).unwrap().labels.is_empty());
    }

    #[test]
    fn labels_in_board_detail() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        create_label(d.path(), &b.id, "Bug").unwrap();
        create_label(d.path(), &b.id, "Feature").unwrap();
        assert_eq!(get_board(d.path(), &b.id).unwrap().labels.len(), 2);
    }
}
