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
    let card = store::create_card(&data_dir, &path.into_inner(), &body.title)?;
    Ok(HttpResponse::Created().json(card))
}

pub async fn update_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateCard>,
) -> Result<HttpResponse, AppError> {
    let due_date = body.due_date.as_ref().map(|dd| dd.as_deref());
    let card = store::update_card(
        &data_dir,
        &path.into_inner(),
        body.title.as_deref(),
        body.description.as_deref(),
        body.position,
        body.list_id.as_deref(),
        body.label_ids.as_deref(),
        body.archived,
        due_date,
    )?;
    Ok(HttpResponse::Ok().json(card))
}

pub async fn delete_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    store::delete_card(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
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
    let content_type = req
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let att = store::create_attachment(
        &data_dir,
        &path.into_inner(),
        &query.filename,
        &content_type,
        &body,
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
    store::delete_attachment(&data_dir, &card_id, &att_id)?;
    Ok(HttpResponse::NoContent().finish())
}
