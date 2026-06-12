//! Attachment CRUD. Binary blobs live at
//! `boards/{bid}/attachments/{cid}/{att-id}` (no extension); image
//! attachments also get a JPEG thumbnail at `{att-id}_thumb` (max 400px).
//! Attachment metadata is stored on the card JSON.

use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::models::Attachment;
use crate::store::card_index::find_board_and_list;
use crate::store::io::{now_timestamp, remove_dir_if_empty, track, write_json};
use crate::store::paths::*;

pub fn create_attachment(
    data_dir: &Path,
    card_id: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> Result<Attachment, AppError> {
    let (board_id, list_id) = find_board_and_list(data_dir, card_id)?;
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
    let mut card = crate::store::cards::read_card(&card_path)?;
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
    let (board_id, list_id) = find_board_and_list(data_dir, card_id)?;
    let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
    let card = crate::store::cards::read_card(&card_path)?;
    let att = card
        .attachments
        .into_iter()
        .find(|a| a.id == att_id)
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let data = fs::read(attachment_dir(data_dir, &board_id, card_id).join(att_id))?;
    Ok((att, data))
}

pub fn delete_attachment(
    data_dir: &Path,
    card_id: &str,
    att_id: &str,
) -> Result<(), AppError> {
    let (board_id, list_id) = find_board_and_list(data_dir, card_id)?;
    let card_path = cards_dir(data_dir, &board_id, &list_id).join(format!("{card_id}.json"));
    let mut card = crate::store::cards::read_card(&card_path)?;
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

        let (board_id, list_id) = find_board_and_list(d.path(), &c.id).unwrap();
        let card: Card = read_json(
            &cards_dir(d.path(), &board_id, &list_id).join(format!("{}.json", c.id)),
        )
        .unwrap();
        assert_eq!(card.attachments.len(), 1);
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

        let att_path = attachment_dir(d.path(), &b.id, &c.id).join(&att.id);
        assert!(!att_path.exists());

        let (board_id, list_id) = find_board_and_list(d.path(), &c.id).unwrap();
        let card: Card = read_json(
            &cards_dir(d.path(), &board_id, &list_id).join(format!("{}.json", c.id)),
        )
        .unwrap();
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
