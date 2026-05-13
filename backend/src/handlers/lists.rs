use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::models::*;
use crate::store;

pub async fn create_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<CreateList>,
) -> Result<HttpResponse, AppError> {
    let board_id = path.into_inner();
    let list = store::create_list(&data_dir, &board_id, &body.title)?;
    let ops = store::drain_file_ops(&data_dir);
    println!(
        "[{}] CREATE list \"{}\" (id: {}) in board {}\n{}",
        crate::log_timestamp(), list.title, list.id, board_id, ops.join("\n")
    );
    Ok(HttpResponse::Created().json(list))
}

pub async fn update_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateList>,
) -> Result<HttpResponse, AppError> {
    let list_id = path.into_inner();
    let list = store::update_list(
        &data_dir,
        &list_id,
        body.title.as_deref(),
        body.position,
    )?;
    let ops = store::drain_file_ops(&data_dir);
    println!(
        "[{}] UPDATE list \"{}\" (id: {}) in board {}\n{}",
        crate::log_timestamp(), list.title, list.id, list.board_id, ops.join("\n")
    );
    Ok(HttpResponse::Ok().json(list))
}

pub async fn delete_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let list_id = path.into_inner();
    store::delete_list(&data_dir, &list_id)?;
    let ops = store::drain_file_ops(&data_dir);
    println!(
        "[{}] DELETE list (id: {})\n{}",
        crate::log_timestamp(), list_id, ops.join("\n")
    );
    Ok(HttpResponse::NoContent().finish())
}
