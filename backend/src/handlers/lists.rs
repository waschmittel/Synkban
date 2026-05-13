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
    println!(
        "[{}] CREATE list \"{}\" (id: {}) in board {} → boards/{}/lists/{}/list.json",
        crate::log_timestamp(), list.title, list.id, board_id, board_id, list.id
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
    println!(
        "[{}] UPDATE list \"{}\" (id: {}) in board {} → boards/{}/lists/{}/list.json",
        crate::log_timestamp(), list.title, list.id, list.board_id, list.board_id, list.id
    );
    Ok(HttpResponse::Ok().json(list))
}

pub async fn delete_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let list_id = path.into_inner();
    println!(
        "[{}] DELETE list (id: {}) → removed list dir + archived cards",
        crate::log_timestamp(), list_id
    );
    store::delete_list(&data_dir, &list_id)?;
    Ok(HttpResponse::NoContent().finish())
}
