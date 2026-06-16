//! Startup reconcile / garbage collection for attachment storage.
//!
//! Attachment metadata lives in per-attachment sidecar files next to the
//! binaries (see `store::attachments`), decoupled from the card JSON. This
//! sweep keeps that storage consistent after crashes, partial syncs, or
//! pre-sidecar data:
//!   1. migrate legacy attachment metadata still embedded in card JSON into
//!      sidecar files (then strip it from the card),
//!   2. drop attachment dirs whose card no longer exists on the board,
//!   3. drop partial files — binary without sidecar, sidecar without binary,
//!      orphan thumbnail.
//!
//! Steps 2 and 3 only act on files older than [`GRACE`], so an in-flight sync
//! (attachment arriving before its card, or a half-transferred blob) is left
//! alone rather than mistaken for garbage.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::errors::AppError;
use crate::store::cards::{read_card, write_card};
use crate::store::io::{track, write_json};
use crate::store::paths::*;

/// Files younger than this are skipped — they may be mid-write or mid-sync.
const GRACE: Duration = Duration::from_secs(300);

/// Reconcile attachment storage across all boards. Returns the number of
/// actions taken (sidecars migrated + files/dirs removed). Best-effort: a
/// failure on one board aborts with the error so the caller can log it.
pub fn reconcile(data_dir: &Path) -> Result<usize, AppError> {
    let mut actions = 0;
    for board_id in crate::store::walk::board_ids(data_dir)? {
        actions += migrate_board(data_dir, &board_id)?;
        actions += sweep_board(data_dir, &board_id)?;
    }
    Ok(actions)
}

/// Move any attachment metadata still embedded in card JSON into sidecar files,
/// then rewrite the card (which strips the embedded copy).
fn migrate_board(data_dir: &Path, board_id: &str) -> Result<usize, AppError> {
    let mut n = 0;
    let mut card_files: Vec<PathBuf> = Vec::new();
    for list_id in crate::store::walk::list_ids(data_dir, board_id)? {
        collect_json(&cards_dir(data_dir, board_id, &list_id), &mut card_files);
    }
    collect_json(&archived_cards_dir(data_dir, board_id), &mut card_files);

    for path in card_files {
        // A single corrupt card must not abort the whole startup sweep — skip
        // it (with a warning) so migration/cleanup still runs for the rest.
        let mut card = match read_card(&path) {
            Ok(card) => card,
            Err(e) => {
                crate::store::io::warn_skip(data_dir, &path, "card", &e);
                continue;
            }
        };
        if card.attachments.is_empty() {
            continue;
        }
        let att_dir = attachment_dir(data_dir, board_id, &card.id);
        fs::create_dir_all(&att_dir)?;
        for att in &card.attachments {
            let sidecar = att_dir.join(format!("{}.json", att.id));
            if !sidecar.exists() {
                write_json(&sidecar, att)?;
                n += 1;
            }
        }
        write_card(&path, &mut card)?;
    }
    Ok(n)
}

/// Drop orphaned attachment dirs and partial files for a board.
fn sweep_board(data_dir: &Path, board_id: &str) -> Result<usize, AppError> {
    let att_root = board_dir(data_dir, board_id).join("attachments");
    if !att_root.exists() {
        return Ok(0);
    }
    let live = live_card_ids(data_dir, board_id)?;
    let mut n = 0;
    for entry in fs::read_dir(&att_root)?.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let card_id = entry.file_name().to_string_lossy().to_string();
        let dir = entry.path();
        if live.contains(&card_id) {
            n += sweep_card_dir(&dir);
        } else if dir_older_than_grace(&dir) {
            // Card gone (and not mid-sync) — reclaim the whole dir.
            track("deleted dir", &dir);
            let _ = fs::remove_dir_all(&dir);
            n += 1;
        }
    }
    crate::store::io::remove_dir_if_empty(&att_root);
    Ok(n)
}

/// Within a live card's attachment dir, remove files that aren't a complete
/// (binary + sidecar) pair: binary without sidecar (partial write), sidecar
/// without binary (broken), thumbnail without binary.
fn sweep_card_dir(dir: &Path) -> usize {
    let mut binaries: HashSet<String> = HashSet::new();
    let mut sidecars: HashSet<String> = HashSet::new();
    let mut thumbs: HashSet<String> = HashSet::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(id) = name.strip_suffix(".json") {
            sidecars.insert(id.to_string());
        } else if let Some(id) = name.strip_suffix("_thumb") {
            thumbs.insert(id.to_string());
        } else {
            binaries.insert(name);
        }
    }

    let mut n = 0;
    let remove = |id: &str, suffix: &str, n: &mut usize| {
        let path = dir.join(format!("{id}{suffix}"));
        if older_than_grace(&path) {
            track("deleted", &path);
            let _ = fs::remove_file(&path);
            *n += 1;
        }
    };

    for id in &binaries {
        if !sidecars.contains(id) {
            remove(id, "", &mut n);
        }
    }
    for id in &sidecars {
        if !binaries.contains(id) {
            remove(id, ".json", &mut n);
            remove(id, "_thumb", &mut n);
        }
    }
    for id in &thumbs {
        if !binaries.contains(id) {
            remove(id, "_thumb", &mut n);
        }
    }
    n
}

fn live_card_ids(data_dir: &Path, board_id: &str) -> Result<HashSet<String>, AppError> {
    let mut ids = HashSet::new();
    for list_id in crate::store::walk::list_ids(data_dir, board_id)? {
        collect_ids(&cards_dir(data_dir, board_id, &list_id), &mut ids);
    }
    collect_ids(&archived_cards_dir(data_dir, board_id), &mut ids);
    Ok(ids)
}

fn collect_json(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                out.push(path);
            }
        }
    }
}

fn collect_ids(dir: &Path, out: &mut HashSet<String>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Some(stem) = path.file_stem() {
                    out.insert(stem.to_string_lossy().to_string());
                }
            }
        }
    }
}

fn older_than_grace(path: &Path) -> bool {
    let Ok(modified) = fs::metadata(path).and_then(|m| m.modified()) else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age > GRACE)
        .unwrap_or(false)
}

/// True when every file in the dir is older than the grace window (or the dir
/// is empty), i.e. nothing in it looks freshly synced.
fn dir_older_than_grace(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut newest: Option<SystemTime> = None;
    for entry in entries.flatten() {
        if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
            newest = Some(newest.map_or(modified, |n| n.max(modified)));
        }
    }
    match newest {
        Some(t) => SystemTime::now()
            .duration_since(t)
            .map(|age| age > GRACE)
            .unwrap_or(false),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Attachment, Card};
    use crate::store::attachments::{create_attachment, load_attachments};
    use crate::store::boards::create_board;
    use crate::store::cards::create_card;
    use crate::store::io::{drain_file_ops, read_json, write_json as raw_write_json};
    use crate::store::lists::create_list;
    use std::fs::{self, File};
    use std::time::{Duration, SystemTime};
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

    /// Backdate a file's mtime past the grace window so the sweep will touch it.
    fn age(path: &Path) {
        let old = SystemTime::now() - Duration::from_secs(GRACE.as_secs() + 60);
        let f = File::options().write(true).open(path).unwrap();
        f.set_modified(old).unwrap();
    }

    fn age_all(dir: &Path) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            age(&entry.path());
        }
    }

    #[test]
    fn reconcile_removes_orphaned_attachment_dir() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        create_attachment(d.path(), &c.id, "f.txt", "text/plain", b"x").unwrap();

        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        // Simulate the card being gone but its attachment dir left behind.
        fs::remove_file(cards_dir(d.path(), &b.id, &l.id).join(format!("{}.json", c.id)))
            .unwrap();
        age_all(&att_dir);

        let n = reconcile(d.path()).unwrap();
        assert!(n >= 1);
        assert!(!att_dir.exists());
    }

    #[test]
    fn reconcile_keeps_live_card_attachments() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att = create_attachment(d.path(), &c.id, "f.txt", "text/plain", b"x").unwrap();
        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        age_all(&att_dir);

        reconcile(d.path()).unwrap();
        assert!(att_dir.join(&att.id).exists());
        assert!(att_dir.join(format!("{}.json", att.id)).exists());
    }

    #[test]
    fn reconcile_removes_binary_without_sidecar() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        fs::create_dir_all(&att_dir).unwrap();
        // Partial write: binary only, no sidecar.
        let orphan = att_dir.join("11111111-1111-1111-1111-111111111111");
        fs::write(&orphan, b"leftover").unwrap();
        age(&orphan);

        let n = reconcile(d.path()).unwrap();
        assert!(n >= 1);
        assert!(!orphan.exists());
    }

    #[test]
    fn reconcile_skips_recent_partial_files() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        fs::create_dir_all(&att_dir).unwrap();
        // Fresh binary without sidecar — looks mid-sync, must be left alone.
        let recent = att_dir.join("22222222-2222-2222-2222-222222222222");
        fs::write(&recent, b"in-flight").unwrap();

        reconcile(d.path()).unwrap();
        assert!(recent.exists());
    }

    #[test]
    fn reconcile_skips_corrupt_card_without_aborting_sweep() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        // A corrupt card sitting next to a real orphaned attachment dir.
        fs::write(cards_dir(d.path(), &b.id, &l.id).join("broken.json"), b"{ nope").unwrap();
        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        fs::create_dir_all(&att_dir).unwrap();
        let orphan = att_dir.join("44444444-4444-4444-4444-444444444444");
        fs::write(&orphan, b"leftover").unwrap();
        age(&orphan);

        // Must not error despite the corrupt card, and still sweep the orphan.
        let n = reconcile(d.path()).unwrap();
        assert!(n >= 1);
        assert!(!orphan.exists());
    }

    #[test]
    fn reconcile_migrates_legacy_card_attachments() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();

        // Hand-craft a pre-sidecar card: attachment metadata embedded in JSON,
        // binary present, but no sidecar file.
        let card_path = cards_dir(d.path(), &b.id, &l.id).join(format!("{}.json", c.id));
        let mut card: Card = read_json(&card_path).unwrap();
        let legacy = Attachment {
            id: "33333333-3333-3333-3333-333333333333".into(),
            filename: "legacy.txt".into(),
            size: 3,
            content_type: "text/plain".into(),
            created_at: "2024-01-01 00:00:00".into(),
        };
        card.attachments.push(legacy.clone());
        raw_write_json(&card_path, &card).unwrap();
        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        fs::create_dir_all(&att_dir).unwrap();
        fs::write(att_dir.join(&legacy.id), b"abc").unwrap();

        let n = reconcile(d.path()).unwrap();
        assert!(n >= 1);

        // Sidecar now exists and the card JSON no longer carries attachments.
        let loaded = load_attachments(d.path(), &b.id, &c.id);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].filename, "legacy.txt");
        let reread: Card = read_json(&card_path).unwrap();
        assert!(reread.attachments.is_empty());
    }
}
