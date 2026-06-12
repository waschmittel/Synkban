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
    let list = store::audit_op(
        &data_dir,
        |dd| store::create_list(dd, &board_id, &body.title),
        |l| format!("CREATE list \"{}\" (id: {}) in board {}", l.title, l.id, board_id),
    )?;
    Ok(HttpResponse::Created().json(list))
}

pub async fn update_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateList>,
) -> Result<HttpResponse, AppError> {
    let list_id = path.into_inner();
    let list = store::audit_op(
        &data_dir,
        |dd| store::update_list(dd, &list_id, body.title.as_deref(), body.position),
        |l| format!("UPDATE list \"{}\" (id: {}) in board {}", l.title, l.id, l.board_id),
    )?;
    Ok(HttpResponse::Ok().json(list))
}

pub async fn delete_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let list_id = path.into_inner();
    store::audit_op(
        &data_dir,
        |dd| store::delete_list(dd, &list_id),
        |_| format!("DELETE list (id: {})", list_id),
    )?;
    Ok(HttpResponse::NoContent().finish())
}
