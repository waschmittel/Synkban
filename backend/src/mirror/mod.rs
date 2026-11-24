//! Readable Mirror exporter (ADR-0035): produces a one-way, incremental,
//! read-only HTML + attachment mirror of saved boards, lists, and cards.

pub mod assets;
pub mod html;
pub mod paths;
pub mod state;

use std::collections::{BTreeMap, BTreeSet, BinaryHeap};
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::errors::AppError;
use crate::models::{Card, Label};
use crate::store::{self, MirrorBoard, MirrorSnapshot};

pub use paths::validate_mirror_dir;
pub use state::{is_schedule_due, load_status, reset as reset_status, run_configured_mirror};

pub const MIRROR_FORMAT_VERSION: u32 = 2;
const MANIFEST_FILE: &str = ".synkban-mirror.json";
const LOCK_FILE: &str = ".synkban-mirror.lock";
const LOCK_STALE_AGE: Duration = Duration::from_secs(3600);

static EXPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MirrorStats {
    pub boards: usize,
    pub cards: usize,
    pub cards_written: usize,
    pub cards_pruned: usize,
    pub attachments_copied: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    #[serde(default)]
    index_hash: String,
    #[serde(default)]
    cards: BTreeMap<String, ManifestCard>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ManifestCard {
    board_id: String,
    card_id: String,
    card_file: String,
    html_hash: String,
    #[serde(default)]
    attachments: BTreeMap<String, ManifestAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ManifestAttachment {
    rel_path: String,
    size: u64,
    content_type: String,
    created_at: String,
    filename: String,
}

struct LockFileGuard {
    path: PathBuf,
}

impl Drop for LockFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn acquire_lockfile(mirror_dir: &Path) -> Result<LockFileGuard, AppError> {
    let lock_path = mirror_dir.join(LOCK_FILE);
    for attempt in 0..2 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(_) => return Ok(LockFileGuard { path: lock_path }),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && attempt == 0 => {
                let stale = fs::metadata(&lock_path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|mtime| SystemTime::now().duration_since(mtime).ok())
                    .is_some_and(|age| age > LOCK_STALE_AGE);
                if stale {
                    let _ = fs::remove_file(&lock_path);
                    continue;
                }
                return Err(AppError::Conflict(
                    "Another mirror export is currently running in this folder".into(),
                ));
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                return Err(AppError::Conflict(
                    "Another mirror export is currently running in this folder".into(),
                ));
            }
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Conflict(
        "Another mirror export is currently running in this folder".into(),
    ))
}

/// Deterministic 128-bit FNV-1a hasher with length-prefixed framing so changes
/// in any board/label/card/attachment input force an exact re-render.
struct Hasher128(u128);

impl Hasher128 {
    fn new() -> Self {
        Self(0x6c62_272e_07bb_0142_62b8_2175_6295_c58d)
    }

    fn feed_bytes(&mut self, bytes: &[u8]) {
        const PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;
        for &b in &(bytes.len() as u64).to_le_bytes() {
            self.0 ^= u128::from(b);
            self.0 = self.0.wrapping_mul(PRIME);
        }
        for &b in bytes {
            self.0 ^= u128::from(b);
            self.0 = self.0.wrapping_mul(PRIME);
        }
    }

    fn feed_str(&mut self, s: &str) {
        self.feed_bytes(s.as_bytes());
    }

    fn feed_opt_str(&mut self, s: Option<&str>) {
        match s {
            Some(v) => {
                self.feed_bytes(&[1]);
                self.feed_str(v);
            }
            None => self.feed_bytes(&[0]),
        }
    }

    fn feed_u64(&mut self, n: u64) {
        self.feed_bytes(&n.to_le_bytes());
    }

    fn finish_hex(self) -> String {
        format!("{:032x}", self.0)
    }
}

fn hash_card(
    board: &MirrorBoard,
    list_label: &str,
    card: &Card,
    is_archived: bool,
    att_filenames: &BTreeMap<String, String>,
) -> String {
    let mut h = Hasher128::new();
    h.feed_u64(u64::from(MIRROR_FORMAT_VERSION));
    h.feed_str(&board.id);
    h.feed_str(&board.title);
    h.feed_opt_str(board.color.as_deref());
    h.feed_u64(u64::from(board.archived));
    h.feed_str(list_label);
    h.feed_u64(u64::from(is_archived));

    for lbl in &board.labels {
        if card.label_ids.contains(&lbl.id) {
            h.feed_str(&lbl.id);
            h.feed_str(&lbl.name);
            h.feed_str(&lbl.color);
        }
    }

    h.feed_str(&card.id);
    h.feed_str(&card.title);
    h.feed_str(&card.description);
    h.feed_str(&card.created_at);
    h.feed_u64(u64::from(card.archived));
    h.feed_opt_str(card.archived_at.as_deref());
    h.feed_opt_str(card.due_date.as_deref());

    h.feed_u64(card.checklist.len() as u64);
    for item in &card.checklist {
        h.feed_str(&item.id);
        h.feed_str(&item.text);
        h.feed_u64(u64::from(item.done));
    }

    h.feed_u64(att_filenames.len() as u64);
    for (att_id, disk_name) in att_filenames {
        h.feed_str(att_id);
        h.feed_str(disk_name);
        if let Some(att) = card.attachments.iter().find(|a| &a.id == att_id) {
            h.feed_str(&att.filename);
            h.feed_str(&att.content_type);
            h.feed_u64(att.size);
        }
    }
    h.finish_hex()
}

fn hash_index(snapshot: &MirrorSnapshot) -> String {
    let mut h = Hasher128::new();
    h.feed_u64(u64::from(MIRROR_FORMAT_VERSION));
    for (group_idx, boards) in [
        (0u64, &snapshot.active_boards),
        (1u64, &snapshot.archived_boards),
    ] {
        h.feed_u64(group_idx);
        h.feed_u64(boards.len() as u64);
        for b in boards {
            h.feed_str(&b.id);
            h.feed_str(&b.title);
            h.feed_opt_str(b.color.as_deref());
            h.feed_u64(u64::from(b.archived));
            let label_map: BTreeMap<&str, &Label> =
                b.labels.iter().map(|l| (l.id.as_str(), l)).collect();
            h.feed_u64(b.lists.len() as u64);
            for l in &b.lists {
                h.feed_str(&l.id);
                h.feed_str(&l.title);
                h.feed_u64(l.cards.len() as u64);
                for c in &l.cards {
                    h.feed_str(&c.id);
                    h.feed_str(&c.title);
                    h.feed_str(&c.description_text);
                    h.feed_opt_str(c.due_date.as_deref());
                    h.feed_u64(c.label_ids.len() as u64);
                    for lid in &c.label_ids {
                        h.feed_str(lid);
                        if let Some(lbl) = label_map.get(lid.as_str()) {
                            h.feed_str(&lbl.name);
                        }
                    }
                }
            }
            h.feed_u64(b.archived_cards.len() as u64);
            for ac in &b.archived_cards {
                h.feed_str(&ac.card.id);
                h.feed_str(&ac.card.title);
                h.feed_str(&ac.card.description_text);
                h.feed_opt_str(ac.origin_list_title.as_deref());
                for lid in &ac.card.label_ids {
                    h.feed_str(lid);
                    if let Some(lbl) = label_map.get(lid.as_str()) {
                        h.feed_str(&lbl.name);
                    }
                }
            }
        }
    }
    h.finish_hex()
}

fn write_atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    Ok(())
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<bool, AppError> {
    if let Ok(existing) = fs::read(path) {
        if existing == bytes {
            return Ok(false);
        }
    }
    write_atomic_bytes(path, bytes)?;
    Ok(true)
}

fn is_safe_rel_path(rel: &str) -> bool {
    let p = Path::new(rel);
    !rel.is_empty() && !p.is_absolute() && p.components().all(|c| matches!(c, Component::Normal(_)))
}

fn remove_owned_file(mirror_dir: &Path, rel: &str, dirs_to_check: &mut BTreeSet<PathBuf>) {
    if !is_safe_rel_path(rel) {
        return;
    }
    let full = mirror_dir.join(rel);
    if fs::remove_file(&full).is_ok() {
        if let Some(parent) = full.parent() {
            dirs_to_check.insert(parent.to_path_buf());
        }
    }
}

/// Removes empty directories bottom-up strictly using `fs::remove_dir`
/// (never `remove_dir_all`) up to, but never including, `mirror_dir`.
fn cleanup_empty_dirs(mirror_dir: &Path, initial: BTreeSet<PathBuf>) {
    let mut heap: BinaryHeap<(usize, PathBuf)> = initial
        .into_iter()
        .map(|p| (p.components().count(), p))
        .collect();
    let mut seen = BTreeSet::new();
    while let Some((_, dir)) = heap.pop() {
        if dir == mirror_dir || !dir.starts_with(mirror_dir) || !seen.insert(dir.clone()) {
            continue;
        }
        if fs::remove_dir(&dir).is_ok() {
            if let Some(parent) = dir.parent() {
                if parent != mirror_dir {
                    let p = parent.to_path_buf();
                    heap.push((p.components().count(), p));
                }
            }
        }
    }
}

struct CardWork<'a> {
    board: &'a MirrorBoard,
    list_label: String,
    card: &'a Card,
    is_archived: bool,
}

/// Exports or incrementally updates the Readable Mirror in `mirror_dir`.
/// Aborts before touching `mirror_dir` if `data_dir` contains unreadable JSON
/// files or if `mirror_dir` overlaps `data_dir` / `config_dir`.
pub fn export_to_dir(data_dir: &Path, mirror_dir: &Path) -> Result<MirrorStats, AppError> {
    let _process_guard = EXPORT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mirror_canon = validate_mirror_dir(mirror_dir, data_dir, &config::config_dir())?;

    let snapshot = store::snapshot_for_mirror(data_dir)?;
    if let Some(first_warning) = snapshot.warnings.first() {
        return Err(AppError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Mirror aborted because the data folder has unreadable files: {first_warning}"),
        )));
    }

    fs::create_dir_all(&mirror_canon)?;
    let _lock_guard = acquire_lockfile(&mirror_canon)?;

    let manifest_path = mirror_canon.join(MANIFEST_FILE);
    let prev_manifest: Manifest = if manifest_path.exists() {
        let bytes = fs::read(&manifest_path)?;
        serde_json::from_slice(&bytes).map_err(|e| {
            AppError::Io(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Existing {MANIFEST_FILE} is unreadable ({e}); refusing to prune"),
            ))
        })?
    } else {
        Manifest::default()
    };

    write_if_changed(
        &mirror_canon.join("README.md"),
        assets::README_MD.as_bytes(),
    )?;
    write_if_changed(
        &mirror_canon.join("style.css"),
        assets::STYLE_CSS.as_bytes(),
    )?;

    let mut stats = MirrorStats {
        boards: snapshot.active_boards.len() + snapshot.archived_boards.len(),
        ..Default::default()
    };
    let mut dirs_to_check: BTreeSet<PathBuf> = BTreeSet::new();
    let mut next_cards: BTreeMap<String, ManifestCard> = BTreeMap::new();

    let mut work_items: Vec<CardWork<'_>> = Vec::new();
    for board in snapshot
        .active_boards
        .iter()
        .chain(snapshot.archived_boards.iter())
    {
        for list in &board.lists {
            for card in &list.cards {
                work_items.push(CardWork {
                    board,
                    list_label: list.title.clone(),
                    card,
                    is_archived: false,
                });
            }
        }
        for ac in &board.archived_cards {
            let list_label = ac
                .origin_list_title
                .as_deref()
                .map(|t| format!("Archived (from {t})"))
                .unwrap_or_else(|| "Archived (orphaned)".to_string());
            work_items.push(CardWork {
                board,
                list_label,
                card: &ac.card,
                is_archived: true,
            });
        }
    }

    stats.cards = work_items.len();

    for item in work_items {
        let key = format!("{}/{}", item.board.id, item.card.id);
        let card_rel_dir = format!("boards/{}/cards/{}", item.board.id, item.card.id);
        let card_rel_file = format!("{card_rel_dir}/card.html");
        let card_abs_file = mirror_canon.join(&card_rel_file);

        let att_filenames = paths::assign_attachment_filenames(&item.card.attachments);
        let prev_card = prev_manifest.cards.get(&key);

        let mut next_atts: BTreeMap<String, ManifestAttachment> = BTreeMap::new();
        for att in &item.card.attachments {
            let disk_name = &att_filenames[&att.id];
            let att_rel_path = format!("{card_rel_dir}/attachments/{disk_name}");
            let att_abs_path = mirror_canon.join(&att_rel_path);
            let entry = ManifestAttachment {
                rel_path: att_rel_path.clone(),
                size: att.size,
                content_type: att.content_type.clone(),
                created_at: att.created_at.clone(),
                filename: att.filename.clone(),
            };
            let unchanged = prev_card
                .and_then(|pc| pc.attachments.get(&att.id))
                .is_some_and(|pa| pa == &entry)
                && att_abs_path.exists();
            if !unchanged {
                store::copy_attachment_blob(
                    data_dir,
                    &item.board.id,
                    &item.card.id,
                    &att.id,
                    &att_abs_path,
                )?;
                stats.attachments_copied += 1;
            }
            next_atts.insert(att.id.clone(), entry);
        }

        // Remove stale attachments for this card (deleted or renamed on collision change).
        if let Some(prev_c) = prev_card {
            for (att_id, prev_att) in &prev_c.attachments {
                let kept_same_path = next_atts
                    .get(att_id)
                    .is_some_and(|na| na.rel_path == prev_att.rel_path);
                if !kept_same_path {
                    remove_owned_file(&mirror_canon, &prev_att.rel_path, &mut dirs_to_check);
                }
            }
        }
        if next_atts.is_empty() {
            dirs_to_check.insert(mirror_canon.join(format!("{card_rel_dir}/attachments")));
        }

        let html_hash = hash_card(
            item.board,
            &item.list_label,
            item.card,
            item.is_archived,
            &att_filenames,
        );
        let needs_html =
            prev_card.is_none_or(|pc| pc.html_hash != html_hash) || !card_abs_file.exists();
        if needs_html {
            let rendered = html::render_card_html(
                item.board,
                &item.list_label,
                item.card,
                item.is_archived,
                &att_filenames,
            );
            write_atomic_bytes(&card_abs_file, rendered.as_bytes())?;
            stats.cards_written += 1;
        }

        next_cards.insert(
            key,
            ManifestCard {
                board_id: item.board.id.clone(),
                card_id: item.card.id.clone(),
                card_file: card_rel_file,
                html_hash,
                attachments: next_atts,
            },
        );
    }

    // Prune cards no longer present in the snapshot.
    for (key, prev_c) in &prev_manifest.cards {
        if !next_cards.contains_key(key) {
            for prev_att in prev_c.attachments.values() {
                remove_owned_file(&mirror_canon, &prev_att.rel_path, &mut dirs_to_check);
            }
            remove_owned_file(&mirror_canon, &prev_c.card_file, &mut dirs_to_check);
            stats.cards_pruned += 1;
        }
    }

    cleanup_empty_dirs(&mirror_canon, dirs_to_check);

    let index_hash = hash_index(&snapshot);
    let index_path = mirror_canon.join("index.html");
    if prev_manifest.index_hash != index_hash || !index_path.exists() {
        let index_html = html::render_index_html(&snapshot);
        write_atomic_bytes(&index_path, index_html.as_bytes())?;
    }

    let next_manifest = Manifest {
        version: MIRROR_FORMAT_VERSION,
        index_hash,
        cards: next_cards,
    };
    if prev_manifest != next_manifest || !manifest_path.exists() {
        let manifest_bytes = serde_json::to_vec_pretty(&next_manifest)
            .map_err(|e| AppError::Io(io::Error::new(io::ErrorKind::InvalidData, e)))?;
        write_atomic_bytes(&manifest_path, &manifest_bytes)?;
    }

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CardPatch;
    use crate::store::{
        create_attachment, create_board, create_card, create_list, delete_board, delete_card,
        update_board, update_card,
    };
    use tempfile::TempDir;

    #[test]
    fn incremental_sync_move_archive_prune_and_preserve_untracked() {
        let root = TempDir::new().unwrap();
        let data = root.path().join("data");
        let mirror = root.path().join("mirror");
        fs::create_dir_all(&data).unwrap();

        let board = create_board(&data, "Engineering").unwrap();
        let l_todo = create_list(&data, &board.id, "Todo").unwrap();
        let l_done = create_list(&data, &board.id, "Done").unwrap();
        let c1 = create_card(&data, &l_todo.id, "Task *One*").unwrap();
        let c2 = create_card(&data, &l_todo.id, "Task Two").unwrap();
        let att1 = create_attachment(&data, &c1.id, "spec.txt", "text/plain", b"hello").unwrap();
        create_attachment(
            &data,
            &c1.id,
            "Release (1).tar.gz",
            "application/gzip",
            b"tarball",
        )
        .unwrap();

        // Unrelated user file in mirror must never be deleted.
        fs::create_dir_all(&mirror).unwrap();
        fs::write(mirror.join("personal-notes.txt"), b"keep").unwrap();

        // First export writes everything.
        let s1 = export_to_dir(&data, &mirror).unwrap();
        assert_eq!(s1.boards, 1);
        assert_eq!(s1.cards, 2);
        assert_eq!(s1.cards_written, 2);
        assert_eq!(s1.attachments_copied, 2);
        assert!(mirror.join("README.md").exists());
        assert!(mirror.join("style.css").exists());
        assert!(mirror.join("index.html").exists());
        assert!(mirror
            .join(format!("boards/{}/cards/{}/card.html", board.id, c1.id))
            .exists());
        assert!(mirror
            .join(format!(
                "boards/{}/cards/{}/attachments/spec.txt",
                board.id, c1.id
            ))
            .exists());

        // Second export with zero changes does zero card/attachment writes.
        let s2 = export_to_dir(&data, &mirror).unwrap();
        assert_eq!(s2.cards_written, 0);
        assert_eq!(s2.attachments_copied, 0);
        assert_eq!(s2.cards_pruned, 0);

        // Moving c1 to Done updates c1's card.html (list name) without re-copying attachments.
        update_card(
            &data,
            &c1.id,
            CardPatch {
                list_id: Some(&l_done.id),
                ..Default::default()
            },
        )
        .unwrap();
        let s3 = export_to_dir(&data, &mirror).unwrap();
        assert_eq!(s3.cards_written, 1);
        assert_eq!(s3.attachments_copied, 0);
        let c1_html = fs::read_to_string(
            mirror.join(format!("boards/{}/cards/{}/card.html", board.id, c1.id)),
        )
        .unwrap();
        assert!(c1_html.contains("Done"));
        let _ = att1;

        // Archiving c2 keeps it in the mirror; permanently deleting it prunes it.
        update_card(
            &data,
            &c2.id,
            CardPatch {
                archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let s4 = export_to_dir(&data, &mirror).unwrap();
        assert_eq!(s4.cards, 2);
        assert_eq!(s4.cards_pruned, 0);

        delete_card(&data, &c2.id).unwrap();
        let s5 = export_to_dir(&data, &mirror).unwrap();
        assert_eq!(s5.cards, 1);
        assert_eq!(s5.cards_pruned, 1);
        assert!(!mirror
            .join(format!("boards/{}/cards/{}", board.id, c2.id))
            .exists());

        // Corrupt JSON in data_dir aborts BEFORE pruning c1!
        let corrupt = data
            .join("boards")
            .join(&board.id)
            .join("lists")
            .join(&l_done.id)
            .join("cards")
            .join("broken.json");
        fs::write(&corrupt, b"{ bad json").unwrap();
        assert!(export_to_dir(&data, &mirror).is_err());
        assert!(mirror
            .join(format!("boards/{}/cards/{}/card.html", board.id, c1.id))
            .exists());
        fs::remove_file(&corrupt).unwrap();

        // Archiving and permanently deleting the board prunes all owned dirs but keeps personal-notes.txt.
        update_board(&data, &board.id, None, None, Some(true), None).unwrap();
        delete_board(&data, &board.id).unwrap();
        let s6 = export_to_dir(&data, &mirror).unwrap();
        assert_eq!(s6.boards, 0);
        assert_eq!(s6.cards_pruned, 1);
        assert!(!mirror.join("boards").exists());
        assert_eq!(
            fs::read_to_string(mirror.join("personal-notes.txt")).unwrap(),
            "keep"
        );
    }
}
