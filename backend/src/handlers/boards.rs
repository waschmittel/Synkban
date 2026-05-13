use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::models::*;
use crate::store;

pub async fn check_changes(data_dir: web::Data<PathBuf>) -> Result<HttpResponse, AppError> {
    let mtime = store::get_latest_mtime(&data_dir)?;
    Ok(HttpResponse::Ok().json(crate::models::ChangeCheck { mtime }))
}

pub async fn list_boards(data_dir: web::Data<PathBuf>) -> Result<HttpResponse, AppError> {
    let boards = store::list_boards(&data_dir)?;
    Ok(HttpResponse::Ok().json(boards))
}

pub async fn create_board(
    data_dir: web::Data<PathBuf>,
    body: web::Json<CreateBoard>,
) -> Result<HttpResponse, AppError> {
    let board = store::create_board(&data_dir, &body.title)?;
    Ok(HttpResponse::Created().json(board))
}

pub async fn get_board(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let detail = store::get_board(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::Ok().json(detail))
}

pub async fn update_board(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateBoard>,
) -> Result<HttpResponse, AppError> {
    let board = store::update_board(&data_dir, &path.into_inner(), &body.title, body.color.as_deref())?;
    Ok(HttpResponse::Ok().json(board))
}

pub async fn delete_board(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    store::delete_board(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}
