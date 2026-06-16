//! Attachment CRUD. Each attachment is a file trio under
//! `boards/{bid}/attachments/{cid}/`:
//!   - `{att-id}`        binary blob (no extension)
//!   - `{att-id}_thumb`  JPEG thumbnail (images only, max 400px)
//!   - `{att-id}.json`   metadata sidecar (the `Attachment` record)
//!
//! The sidecar — not the card JSON — is the source of truth for attachment
//! metadata, so attachment persistence is independent of the card record: it
//! survives concurrent card edits without write-conflicts (additive new files
//! instead of rewriting one shared file), and travels with the attachment dir
//! when a card moves between boards. Card responses are populated from the
//! sidecars via `load_attachments`. `store::gc` reconciles leftovers (partial
//! writes, orphaned dirs, pre-sidecar data).

use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::models::Attachment;
use crate::store::card_index::find_board_and_list;
use crate::store::io::{now_timestamp, read_json, remove_dir_if_empty, track, write_json};
use crate::store::paths::*;

fn sidecar_path(data_dir: &Path, board_id: &str, card_id: &str, att_id: &str) -> PathBuf {
    attachment_dir(data_dir, board_id, card_id).join(format!("{att_id}.json"))
}

/// Load a card's attachment metadata from its sidecar files, sorted by
/// creation time. Empty if the card has no attachment dir. This is how card
/// responses get their `attachments` — the card JSON never stores them.
pub(crate) fn load_attachments(data_dir: &Path, board_id: &str, card_id: &str) -> Vec<Attachment> {
    let dir = attachment_dir(data_dir, board_id, card_id);
    let mut out: Vec<Attachment> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                match read_json::<Attachment>(&path) {
                    Ok(att) => out.push(att),
                    Err(e) => crate::store::io::warn_skip(data_dir, &path, "attachment", &e),
                }
            }
        }
    }
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    out
}

/// Relocate a card's attachment dir when the card moves to a list on a
/// different board. No-op if the card has no attachments. The sidecars live
/// inside the dir, so they move atomically with it (same filesystem).
pub(crate) fn move_card_attachments(
    data_dir: &Path,
    from_board: &str,
    to_board: &str,
    card_id: &str,
) -> Result<(), AppError> {
    let from = attachment_dir(data_dir, from_board, card_id);
    if !from.exists() {
        return Ok(());
    }
    let to = attachment_dir(data_dir, to_board, card_id);
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    track("moved dir", &to);
    fs::rename(&from, &to)?;
    if let Some(parent) = from.parent() {
        remove_dir_if_empty(parent);
    }
    Ok(())
}

pub fn create_attachment(
    data_dir: &Path,
    card_id: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> Result<Attachment, AppError> {
    let (board_id, _list_id) = find_board_and_list(data_dir, card_id)?;
    let att_id = uuid::Uuid::new_v4().to_string();

    let att_dir = attachment_dir(data_dir, &board_id, card_id);
    fs::create_dir_all(&att_dir)?;
    let att_path = att_dir.join(&att_id);
    track("wrote", &att_path);
    fs::write(&att_path, data)?;
    if content_type.starts_with("image/") {
        create_thumbnail(&att_dir, &att_id, data);
    }

    // Sidecar written LAST: its presence marks the attachment complete. A crash
    // before this leaves only the binary, which `store::gc` reclaims.
    let att = Attachment {
        id: att_id.clone(),
        filename: filename.to_string(),
        size: data.len() as u64,
        content_type: content_type.to_string(),
        created_at: now_timestamp(),
    };
    write_json(&att_dir.join(format!("{att_id}.json")), &att)?;
    Ok(att)
}

pub fn get_attachment_data(
    data_dir: &Path,
    card_id: &str,
    att_id: &str,
) -> Result<(Attachment, Vec<u8>), AppError> {
    let (board_id, _list_id) = find_board_and_list(data_dir, card_id)?;
    let sidecar = sidecar_path(data_dir, &board_id, card_id, att_id);
    if !sidecar.exists() {
        return Err(AppError::NotFound("Attachment not found".into()));
    }
    let att: Attachment = read_json(&sidecar)?;
    let data = fs::read(attachment_dir(data_dir, &board_id, card_id).join(att_id))?;
    Ok((att, data))
}

pub fn delete_attachment(
    data_dir: &Path,
    card_id: &str,
    att_id: &str,
) -> Result<(), AppError> {
    let (board_id, _list_id) = find_board_and_list(data_dir, card_id)?;
    let att_dir = attachment_dir(data_dir, &board_id, card_id);
    let sidecar = att_dir.join(format!("{att_id}.json"));
    if !sidecar.exists() {
        return Err(AppError::NotFound("Attachment not found".into()));
    }
    // Remove the sidecar first (the completeness marker), then the blobs.
    track("deleted", &sidecar);
    fs::remove_file(&sidecar)?;
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
    let Ok(img) = image::load_from_memory(data) else {
        return;
    };
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
    let (board_id, _) = find_board_and_list(data_dir, card_id)?;
    let thumb_path =
        attachment_dir(data_dir, &board_id, card_id).join(format!("{att_id}_thumb"));
    if !thumb_path.exists() {
        return Err(AppError::NotFound("Thumbnail not found".into()));
    }
    Ok(fs::read(&thumb_path)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Card;
    use crate::store::boards::create_board;
    use crate::store::cards::create_card;
    use crate::store::io::{drain_file_ops, read_json};
    use crate::store::lists::create_list;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        let d = TempDir::new().unwrap();
        drain_file_ops(d.path());
        d
    }

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

        let att_path = attachment_dir(d.path(), &b.id, &c.id).join(&att.id);
        assert!(att_path.exists());
        let sidecar = attachment_dir(d.path(), &b.id, &c.id).join(format!("{}.json", att.id));
        assert!(sidecar.exists());
        assert_eq!(load_attachments(d.path(), &b.id, &c.id).len(), 1);

        // Attachment metadata must NOT be persisted on the card JSON.
        let card: Card = read_json(
            &cards_dir(d.path(), &b.id, &l.id).join(format!("{}.json", c.id)),
        )
        .unwrap();
        assert!(card.attachments.is_empty());
    }

    #[test]
    fn load_attachments_skips_and_warns_on_corrupt_sidecar() {
        use crate::store::io::drain_warnings;
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let good = create_attachment(d.path(), &c.id, "ok.txt", "text/plain", b"hi").unwrap();

        let _ = drain_warnings();
        let bad = attachment_dir(d.path(), &b.id, &c.id).join("broken.json");
        fs::write(&bad, b"{ not json").unwrap();

        let loaded = load_attachments(d.path(), &b.id, &c.id);
        assert_eq!(loaded.len(), 1, "good sidecar still loads");
        assert_eq!(loaded[0].id, good.id);

        let warnings = drain_warnings();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("broken.json"));
        assert!(warnings[0].contains("attachment"));
    }

    #[test]
    fn create_attachment_image_thumbnail() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();

        let img = image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0]));
        let mut png_buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png_buf, image::ImageFormat::Png).unwrap();
        let png_data = png_buf.into_inner();

        let att = create_attachment(d.path(), &c.id, "img.png", "image/png", &png_data).unwrap();
        let thumb_path =
            attachment_dir(d.path(), &b.id, &c.id).join(format!("{}_thumb", att.id));
        assert!(thumb_path.exists());
    }

    #[test]
    fn get_attachment_data_basic() {
        let d = tmp();
        let b = create_board(d.path(), "B").unwrap();
        let l = create_list(d.path(), &b.id, "L").unwrap();
        let c = create_card(d.path(), &l.id, "C").unwrap();
        let att =
            create_attachment(d.path(), &c.id, "test.txt", "text/plain", b"hello world").unwrap();

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

        let att_dir = attachment_dir(d.path(), &b.id, &c.id);
        assert!(!att_dir.join(&att.id).exists());
        assert!(!att_dir.join(format!("{}.json", att.id)).exists());
        assert!(load_attachments(d.path(), &b.id, &c.id).is_empty());
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
        assert!(!att_dir.exists());
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
        assert!(!attachments_parent.exists());
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
        assert!(attachments_parent.exists());
        assert!(!attachment_dir(d.path(), &b.id, &c1.id).exists());
        assert!(attachment_dir(d.path(), &b.id, &c2.id).exists());
    }
}
