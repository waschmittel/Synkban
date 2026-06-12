use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::models::*;
use crate::store;

pub async fn create_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<CreateLabel>,
) -> Result<HttpResponse, AppError> {
    let board_id = path.into_inner();
    let label = store::audit_op(
        &data_dir,
        |dd| store::create_label(dd, &board_id, &body.name),
        |l| format!("CREATE label \"{}\" (id: {}, color: {}) in board {}", l.name, l.id, l.color, board_id),
    )?;
    Ok(HttpResponse::Created().json(label))
}

pub async fn update_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateLabel>,
) -> Result<HttpResponse, AppError> {
    let label_id = path.into_inner();
    let label = store::audit_op(
        &data_dir,
        |dd| store::update_label_by_id(dd, &label_id, &body.name),
        |l| format!("UPDATE label \"{}\" (id: {})", l.name, l.id),
    )?;
    Ok(HttpResponse::Ok().json(label))
}

pub async fn delete_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let label_id = path.into_inner();
    store::audit_op(
        &data_dir,
        |dd| store::delete_label_by_id(dd, &label_id),
        |_| format!("DELETE label (id: {})", label_id),
    )?;
    Ok(HttpResponse::NoContent().finish())
}
