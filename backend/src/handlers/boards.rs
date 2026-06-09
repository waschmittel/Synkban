use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::models::*;
use crate::store;

pub async fn check_changes(data_dir: web::Data<PathBuf>) -> Result<HttpResponse, AppError> {
    let boards = store::get_per_board_mtimes(&data_dir)?;
    let mtime = boards.values().copied().max().unwrap_or(0);
    Ok(HttpResponse::Ok().json(crate::models::ChangeCheck { mtime, boards }))
}

pub async fn list_boards(data_dir: web::Data<PathBuf>) -> Result<HttpResponse, AppError> {
    let boards = store::list_boards(&data_dir)?;
    Ok(HttpResponse::Ok().json(boards))
}

pub async fn list_archived_boards(data_dir: web::Data<PathBuf>) -> Result<HttpResponse, AppError> {
    let boards = store::list_archived_boards(&data_dir)?;
    Ok(HttpResponse::Ok().json(boards))
}

pub async fn create_board(
    data_dir: web::Data<PathBuf>,
    body: web::Json<CreateBoard>,
) -> Result<HttpResponse, AppError> {
    let board = store::audit_op(
        &data_dir,
        |dd| store::create_board(dd, &body.title),
        |b| format!("CREATE board \"{}\" (id: {})", b.title, b.id),
    )?;
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
    let board_id = path.into_inner();
    let board = store::audit_op(
        &data_dir,
        |dd| {
            store::update_board(
                dd,
                &board_id,
                body.title.as_deref(),
                body.color.as_deref(),
                body.archived,
            )
        },
        |b| format!("UPDATE board \"{}\" (id: {})", b.title, b.id),
    )?;
    Ok(HttpResponse::Ok().json(board))
}

pub async fn delete_board(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let board_id = path.into_inner();
    store::audit_op(
        &data_dir,
        |dd| store::delete_board(dd, &board_id),
        |_| format!("DELETE board (id: {})", board_id),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn get_archived_cards(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let cards = store::get_archived_cards(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::Ok().json(cards))
}

pub async fn reorder_boards(
    data_dir: web::Data<PathBuf>,
    body: web::Json<ReorderBoards>,
) -> Result<HttpResponse, AppError> {
    let count = body.ids.len();
    store::audit_op(
        &data_dir,
        |dd| store::reorder_boards(dd, &body.ids),
        |_| format!("REORDER boards ({} ids)", count),
    )?;
    Ok(HttpResponse::NoContent().finish())
}
