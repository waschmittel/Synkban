//! Label CRUD. Labels live inside `board.json` (see `BoardFile` in
//! `super::boards`); there is no separate labels file.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::{CardPatch, Label};
use crate::store::boards::{read_board_file, write_board_file, BoardFile};
use crate::store::cards::update_card;
use crate::store::io::read_json;
use crate::store::paths::{board_dir, boards_dir, check_id};
use crate::store::walk;

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

/// Labels are the same when their names differ only in case, whitespace and
/// dashes ("In Progress" = "in-progress"). Empty keys never match.
pub fn label_key(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn same_label<'a>(labels: &'a [Label], name: &str, except: &str) -> Option<&'a Label> {
    let key = label_key(name);
    (!key.is_empty())
        .then(|| {
            labels
                .iter()
                .find(|l| l.id != except && label_key(&l.name) == key)
        })
        .flatten()
}

/// Returns the new label and `true`, or an existing one with the same
/// `label_key` and `false` (no duplicates).
pub fn create_label(
    data_dir: &Path,
    board_id: &str,
    name: &str,
) -> Result<(Label, bool), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::BadRequest("label name must not be empty".into()));
    }
    let mut bf = read_board_file(data_dir, board_id)?;
    if let Some(existing) = same_label(&bf.labels, name, "") {
        return Ok((existing.clone(), false));
    }
    let color = LABEL_COLORS[bf.labels.len() % LABEL_COLORS.len()].to_string();
    let label = Label {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        color,
    };
    bf.labels.push(label.clone());
    write_board_file(data_dir, &bf)?;
    Ok((label, true))
}

pub fn update_label(
    data_dir: &Path,
    board_id: &str,
    label_id: &str,
    name: &str,
    merge: bool,
) -> Result<Label, AppError> {
    check_id(label_id)?;
    if name.trim().is_empty() {
        return Err(AppError::BadRequest("label name must not be empty".into()));
    }
    let mut bf = read_board_file(data_dir, board_id)?;
    if !bf.labels.iter().any(|l| l.id == label_id) {
        return Err(AppError::NotFound("Label not found".into()));
    }
    // Renamed onto another label: merge into that one — only when asked to
    // (destructive: the renamed label is removed, its cards relabelled).
    let other = same_label(&bf.labels, name, label_id);
    if let (Some(o), false) = (other, merge) {
        return Err(AppError::Conflict(format!(
            "A label named \"{}\" exists; renaming merges into it (send merge: true)",
            o.name
        )));
    }
    let target_id = other.map_or(label_id, |l| &l.id);
    let target_id = target_id.to_string();
    for l in bf.labels.iter_mut().filter(|l| l.id == target_id) {
        l.name = name.to_string();
    }
    let updated = bf
        .labels
        .iter()
        .find(|l| l.id == target_id)
        .cloned()
        .unwrap();
    if target_id != label_id {
        bf.labels.retain(|l| l.id != label_id);
        write_board_file(data_dir, &bf)?;
        relabel_cards(data_dir, board_id, label_id, &target_id)?;
    } else {
        write_board_file(data_dir, &bf)?;
    }
    Ok(updated)
}

/// Every card of the board (archived ones too) carrying `from` gets `to`
/// instead, once. Through `update_card`: a history entry each.
fn relabel_cards(data_dir: &Path, board_id: &str, from: &str, to: &str) -> Result<(), AppError> {
    let mut cards = Vec::new();
    for list_id in walk::list_ids(data_dir, board_id)? {
        cards.extend(walk::cards(data_dir, board_id, &list_id)?);
    }
    cards.extend(walk::orphaned_cards(data_dir, board_id)?);
    for card in cards
        .iter()
        .filter(|c| c.label_ids.iter().any(|id| id == from))
    {
        let mut ids: Vec<String> = Vec::new();
        for id in &card.label_ids {
            let id = if id == from { to } else { id };
            if !ids.iter().any(|i| i == id) {
                ids.push(id.to_string());
            }
        }
        let patch = CardPatch {
            label_ids: Some(&ids),
            ..Default::default()
        };
        update_card(data_dir, &card.id, patch)?;
    }
    Ok(())
}

/// Reorder a board's labels to match `ids`. Ids not in the board are ignored;
/// labels missing from `ids` keep their relative order after the listed ones.
pub fn reorder_labels(data_dir: &Path, board_id: &str, ids: &[String]) -> Result<(), AppError> {
    let mut bf = read_board_file(data_dir, board_id)?;
    // Stable sort: unlisted labels share the max key and stay in place at the end.
    bf.labels
        .sort_by_key(|l| ids.iter().position(|id| *id == l.id).unwrap_or(ids.len()));
    write_board_file(data_dir, &bf)
}

pub fn delete_label(data_dir: &Path, board_id: &str, label_id: &str) -> Result<(), AppError> {
    check_id(label_id)?;
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
    check_id(label_id)?;
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

pub fn update_label_by_id(
    data_dir: &Path,
    label_id: &str,
    name: &str,
    merge: bool,
) -> Result<Label, AppError> {
    let board_id = find_board_for_label(data_dir, label_id)?;
    update_label(data_dir, &board_id, label_id, name, merge)
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
        let label = create_label(d.path(), &b.id, "Bug").unwrap().0;
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
            let label = create_label(d.path(), &b.id, &format!("L{i}")).unwrap().0;
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
        let label = create_label(d.path(), &b.id, "Bug").unwrap().0;
        let updated = update_label(d.path(), &b.id, &label.id, "Feature", false).unwrap();
        assert_eq!(updated.name, "Feature");
        assert_eq!(updated.id, label.id);
        assert_eq!(updated.color, label.color);
    }

    #[test]
    fn label_key_ignores_case_whitespace_and_dashes() {
        assert_eq!(label_key("In Progress"), "inprogress");
        assert_eq!(label_key(" in-progress "), "inprogress");
        assert_eq!(label_key("IN--PRO gress"), "inprogress");
        assert_eq!(label_key("Größe"), "größe");
        assert_eq!(label_key(" - "), "");
    }

    #[test]
    fn create_label_reuses_a_same_named_one() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let (first, created) = create_label(d.path(), &b.id, "In Progress").unwrap();
        assert!(created);
        let (again, created) = create_label(d.path(), &b.id, "in-progress").unwrap();
        assert!(!created);
        assert_eq!(again.id, first.id);
        assert_eq!(again.name, "In Progress");
        assert_eq!(get_board(d.path(), &b.id).unwrap().labels.len(), 1);
        // Names without letters never match each other.
        create_label(d.path(), &b.id, "-").unwrap();
        assert!(create_label(d.path(), &b.id, "--").unwrap().1);
    }

    #[test]
    fn renaming_onto_another_label_merges_and_relabels_cards() {
        use crate::models::CardPatch;
        use crate::store::cards::{create_card, get_card_history, update_card};
        use crate::store::lists::create_list;
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let other = create_board(d.path(), "Other").unwrap();
        let keep = create_label(d.path(), &b.id, "Bug").unwrap().0;
        let gone = create_label(d.path(), &b.id, "Defect").unwrap().0;
        let extra = create_label(d.path(), &b.id, "Extra").unwrap().0;
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let set = |card: &str, ids: &[String], archived: Option<bool>| {
            let patch = CardPatch {
                label_ids: Some(ids),
                archived,
                ..Default::default()
            };
            update_card(d.path(), card, patch).unwrap();
        };
        let only_gone = create_card(d.path(), &l.id, "only gone").unwrap();
        set(&only_gone.id, &[extra.id.clone(), gone.id.clone()], None);
        let both = create_card(d.path(), &l.id, "both").unwrap();
        set(&both.id, &[gone.id.clone(), keep.id.clone()], None);
        let archived = create_card(d.path(), &l.id, "archived").unwrap();
        set(&archived.id, std::slice::from_ref(&gone.id), Some(true));
        let untouched = create_card(d.path(), &l.id, "untouched").unwrap();
        set(&untouched.id, std::slice::from_ref(&extra.id), None);
        // Another board's same-named label is not a merge target.
        create_label(d.path(), &other.id, "bug").unwrap();
        let history = |id: &str| get_card_history(d.path(), id).unwrap().entries.len();
        let untouched_history = history(&untouched.id);
        let both_history = history(&both.id);

        // Without the flag: refused, nothing changes.
        let err = update_label(d.path(), &b.id, &gone.id, "BUG", false).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        assert_eq!(get_board(d.path(), &b.id).unwrap().labels.len(), 3);
        assert_eq!(history(&both.id), both_history);

        let merged = update_label(d.path(), &b.id, &gone.id, "BUG", true).unwrap();
        assert_eq!(merged.id, keep.id);
        assert_eq!(merged.name, "BUG");
        assert_eq!(merged.color, keep.color);
        let board = get_board(d.path(), &b.id).unwrap();
        let names: Vec<_> = board.labels.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["BUG", "Extra"]);
        let labels_of = |id: &str| {
            board.lists[0]
                .cards
                .iter()
                .find(|c| c.id == id)
                .unwrap()
                .label_ids
                .clone()
        };
        // Replaced in place, never twice.
        assert_eq!(
            labels_of(&only_gone.id),
            [extra.id.clone(), keep.id.clone()]
        );
        assert_eq!(labels_of(&both.id), [keep.id.as_str()]);
        assert_eq!(labels_of(&untouched.id), [extra.id.as_str()]);
        let arch = crate::store::get_archived_cards(d.path(), &b.id).unwrap();
        assert_eq!(arch[0].label_ids, [keep.id.as_str()]);
        // A history entry for each relabelled card only.
        assert_eq!(history(&both.id), both_history + 1);
        assert_eq!(history(&untouched.id), untouched_history);
    }

    #[test]
    fn renaming_a_label_to_its_own_variant_is_a_plain_rename() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let label = create_label(d.path(), &b.id, "in progress").unwrap().0;
        let updated = update_label(d.path(), &b.id, &label.id, "In-Progress", false).unwrap();
        assert_eq!(updated.id, label.id);
        assert_eq!(get_board(d.path(), &b.id).unwrap().labels.len(), 1);
    }

    #[test]
    fn update_label_not_found() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let err = update_label(d.path(), &b.id, "fake", "X", false).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn delete_label_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let label = create_label(d.path(), &b.id, "Bug").unwrap().0;
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
        let label = create_label(d.path(), &b2.id, "Original").unwrap().0;
        let updated = update_label_by_id(d.path(), &label.id, "Renamed", false).unwrap();
        assert_eq!(updated.name, "Renamed");
    }

    #[test]
    fn find_board_for_label_skips_corrupt_board() {
        use crate::store::paths::board_dir;
        use std::fs;
        let d = tmp();
        let corrupt = create_board(d.path(), "Corrupt").unwrap();
        let b2 = create_board(d.path(), "Good").unwrap();
        let label = create_label(d.path(), &b2.id, "Bug").unwrap().0;
        // A corrupt board.json must not stop us finding the label's real owner.
        fs::write(
            board_dir(d.path(), &corrupt.id).join("board.json"),
            b"{ broken",
        )
        .unwrap();
        let updated = update_label_by_id(d.path(), &label.id, "Renamed", false).unwrap();
        assert_eq!(updated.name, "Renamed");
    }

    #[test]
    fn delete_label_by_id_scans_boards() {
        let d = tmp();
        let _b1 = create_board(d.path(), "Board 1").unwrap();
        let b2 = create_board(d.path(), "Board 2").unwrap();
        let label = create_label(d.path(), &b2.id, "Bug").unwrap().0;
        delete_label_by_id(d.path(), &label.id).unwrap();
        assert!(get_board(d.path(), &b2.id).unwrap().labels.is_empty());
    }

    #[test]
    fn reorder_labels_basic() {
        let d = tmp();
        let b = create_board(d.path(), "Board").unwrap();
        let a = create_label(d.path(), &b.id, "A").unwrap().0;
        let bb = create_label(d.path(), &b.id, "B").unwrap().0;
        let c = create_label(d.path(), &b.id, "C").unwrap().0;
        // C first, B second; A unlisted -> last. Unknown id ignored.
        reorder_labels(
            d.path(),
            &b.id,
            &[c.id.clone(), "fake".into(), bb.id.clone()],
        )
        .unwrap();
        let names: Vec<_> = get_board(d.path(), &b.id)
            .unwrap()
            .labels
            .into_iter()
            .map(|l| l.id)
            .collect();
        assert_eq!(names, vec![c.id, bb.id, a.id]);
    }

    #[test]
    fn reorder_labels_board_not_found() {
        let d = tmp();
        let err = reorder_labels(d.path(), "fake", &[]).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
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
