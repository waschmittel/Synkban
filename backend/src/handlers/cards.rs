use actix_web::{web, HttpRequest, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::models::*;
use crate::store;

const MAX_ATTACHMENT_SIZE: usize = 50 * 1024 * 1024; // 50 MB

pub async fn create_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<CreateCard>,
) -> Result<HttpResponse, AppError> {
    let list_id = path.into_inner();
    let card = store::audit_op(
        &data_dir,
        |dd| store::create_card(dd, &list_id, &body.title),
        |c| format!("CREATE card \"{}\" (id: {}) in list {}", c.title, c.id, list_id),
    )?;
    Ok(HttpResponse::Created().json(card))
}

fn is_valid_iso_date(s: &str) -> bool {
    if s.len() != 10 { return false; }
    let b = s.as_bytes();
    if b[4] != b'-' || b[7] != b'-' { return false; }
    let Ok(y) = s[0..4].parse::<u32>() else { return false };
    let Ok(m) = s[5..7].parse::<u32>() else { return false };
    let Ok(d) = s[8..10].parse::<u32>() else { return false };
    if m < 1 || m > 12 || d < 1 || d > 31 || y < 1 { return false; }
    true
}

pub async fn update_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateCard>,
) -> Result<HttpResponse, AppError> {
    if let Some(Some(ref dd)) = body.due_date {
        if !is_valid_iso_date(dd) {
            return Err(AppError::BadRequest("due_date must be in YYYY-MM-DD format".to_string()));
        }
    }
    let card_id = path.into_inner();
    let due_date = body.due_date.as_ref().map(|dd| dd.as_deref());

    let mut changes = Vec::new();
    if body.title.is_some() { changes.push("title"); }
    if body.description.is_some() { changes.push("description"); }
    if body.position.is_some() { changes.push("position"); }
    if body.list_id.is_some() { changes.push("list_id"); }
    if body.label_ids.is_some() { changes.push("labels"); }
    if body.archived == Some(true) { changes.push("archived"); }
    if body.archived == Some(false) { changes.push("restored"); }
    if body.due_date.is_some() { changes.push("due_date"); }
    let fields = if changes.is_empty() { "no-op".to_string() } else { changes.join(", ") };

    let card = store::audit_op(
        &data_dir,
        |dd| {
            store::update_card(
                dd,
                &card_id,
                body.title.as_deref(),
                body.description.as_deref(),
                body.position,
                body.list_id.as_deref(),
                body.label_ids.as_deref(),
                body.archived,
                due_date,
            )
        },
        |c| format!("UPDATE card \"{}\" (id: {}) [{}]", c.title, c.id, fields),
    )?;
    Ok(HttpResponse::Ok().json(card))
}

pub async fn delete_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let card_id = path.into_inner();
    store::audit_op(
        &data_dir,
        |dd| store::delete_card(dd, &card_id),
        |_| format!("DELETE card (id: {})", card_id),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn create_checklist_item(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<CreateChecklistItem>,
) -> Result<HttpResponse, AppError> {
    let card_id = path.into_inner();
    let item = store::audit_op(
        &data_dir,
        |dd| store::create_checklist_item(dd, &card_id, &body.text),
        |i| format!("CREATE checklist item \"{}\" (id: {}) on card {}", i.text, i.id, card_id),
    )?;
    Ok(HttpResponse::Created().json(item))
}

pub async fn update_checklist_item(
    data_dir: web::Data<PathBuf>,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateChecklistItem>,
) -> Result<HttpResponse, AppError> {
    let (card_id, item_id) = path.into_inner();
    let mut changes = Vec::new();
    if body.text.is_some() { changes.push("text"); }
    if body.done == Some(true) { changes.push("done"); }
    if body.done == Some(false) { changes.push("undone"); }
    let fields = if changes.is_empty() { "no-op".to_string() } else { changes.join(", ") };
    let item = store::audit_op(
        &data_dir,
        |dd| store::update_checklist_item(dd, &card_id, &item_id, body.text.as_deref(), body.done),
        |i| format!("UPDATE checklist item \"{}\" (id: {}) on card {} [{}]", i.text, i.id, card_id, fields),
    )?;
    Ok(HttpResponse::Ok().json(item))
}

pub async fn delete_checklist_item(
    data_dir: web::Data<PathBuf>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, AppError> {
    let (card_id, item_id) = path.into_inner();
    store::audit_op(
        &data_dir,
        |dd| store::delete_checklist_item(dd, &card_id, &item_id),
        |_| format!("DELETE checklist item (id: {}) from card {}", item_id, card_id),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn set_checklist_all(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<SetChecklistAll>,
) -> Result<HttpResponse, AppError> {
    let card_id = path.into_inner();
    let card = store::audit_op(
        &data_dir,
        |dd| store::set_checklist_all(dd, &card_id, body.done),
        |c| {
            format!(
                "UPDATE checklist on card \"{}\" (id: {}) [all {}]",
                c.title,
                c.id,
                if body.done { "done" } else { "undone" }
            )
        },
    )?;
    Ok(HttpResponse::Ok().json(card))
}

pub async fn upload_attachment(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    query: web::Query<AttachmentQuery>,
    body: web::Bytes,
    req: HttpRequest,
) -> Result<HttpResponse, AppError> {
    if body.len() > MAX_ATTACHMENT_SIZE {
        return Err(AppError::TooLarge);
    }
    let card_id = path.into_inner();
    let content_type = req
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let att = store::audit_op(
        &data_dir,
        |dd| store::create_attachment(dd, &card_id, &query.filename, &content_type, &body),
        |a| format!(
            "CREATE attachment \"{}\" ({}, {} bytes) on card {}",
            a.filename, a.content_type, a.size, card_id
        ),
    )?;
    Ok(HttpResponse::Created().json(att))
}

pub async fn download_attachment(
    data_dir: web::Data<PathBuf>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, AppError> {
    let (card_id, att_id) = path.into_inner();
    let (att, data) = store::get_attachment_data(&data_dir, &card_id, &att_id)?;
    let disposition = format!("attachment; filename=\"{}\"", att.filename);
    Ok(HttpResponse::Ok()
        .content_type(att.content_type)
        .append_header(("Content-Disposition", disposition))
        .body(data))
}

pub async fn download_thumbnail(
    data_dir: web::Data<PathBuf>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, AppError> {
    let (card_id, att_id) = path.into_inner();
    let data = store::get_thumbnail_data(&data_dir, &card_id, &att_id)?;
    Ok(HttpResponse::Ok()
        .content_type("image/jpeg")
        .body(data))
}

pub async fn delete_attachment(
    data_dir: web::Data<PathBuf>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, AppError> {
    let (card_id, att_id) = path.into_inner();
    store::audit_op(
        &data_dir,
        |dd| store::delete_attachment(dd, &card_id, &att_id),
        |_| format!("DELETE attachment (id: {}) from card {}", att_id, card_id),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_iso_dates() {
        assert!(is_valid_iso_date("2024-01-01"));
        assert!(is_valid_iso_date("2024-12-31"));
        assert!(is_valid_iso_date("2000-02-29"));
        assert!(is_valid_iso_date("1999-06-15"));
    }

    #[test]
    fn invalid_too_short() {
        assert!(!is_valid_iso_date("2024-1-1"));
    }

    #[test]
    fn invalid_not_a_date() {
        assert!(!is_valid_iso_date("not-a-date"));
    }

    #[test]
    fn invalid_wrong_separators() {
        assert!(!is_valid_iso_date("2024/01/01"));
    }

    #[test]
    fn invalid_month_zero() {
        assert!(!is_valid_iso_date("2024-00-01"));
    }

    #[test]
    fn invalid_month_thirteen() {
        assert!(!is_valid_iso_date("2024-13-01"));
    }

    #[test]
    fn invalid_day_zero() {
        assert!(!is_valid_iso_date("2024-01-00"));
    }

    #[test]
    fn invalid_day_thirtytwo() {
        assert!(!is_valid_iso_date("2024-01-32"));
    }

    #[test]
    fn invalid_empty() {
        assert!(!is_valid_iso_date(""));
    }

    #[test]
    fn invalid_no_dashes() {
        assert!(!is_valid_iso_date("20240101"));
    }

    #[test]
    fn invalid_year_zero() {
        assert!(!is_valid_iso_date("0000-01-01"));
    }
}
