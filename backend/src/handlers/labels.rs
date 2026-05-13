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
    let label = store::create_label(&data_dir, &board_id, &body.name)?;
    println!(
        "[{}] CREATE label \"{}\" (id: {}, color: {}) in board {} → boards/{}/board.json",
        crate::log_timestamp(), label.name, label.id, label.color, board_id, board_id
    );
    Ok(HttpResponse::Created().json(label))
}

pub async fn update_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateLabel>,
) -> Result<HttpResponse, AppError> {
    let label_id = path.into_inner();
    let label = store::update_label_by_id(&data_dir, &label_id, &body.name)?;
    println!(
        "[{}] UPDATE label \"{}\" (id: {}) → board.json updated",
        crate::log_timestamp(), label.name, label.id
    );
    Ok(HttpResponse::Ok().json(label))
}

pub async fn delete_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let label_id = path.into_inner();
    println!(
        "[{}] DELETE label (id: {}) → board.json updated",
        crate::log_timestamp(), label_id
    );
    store::delete_label_by_id(&data_dir, &label_id)?;
    Ok(HttpResponse::NoContent().finish())
}
