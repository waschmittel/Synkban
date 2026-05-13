use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::git_sync::GitSync;
use crate::models::*;
use crate::store;

pub async fn create_list(
    data_dir: web::Data<PathBuf>,
    git_sync: web::Data<GitSync>,
    path: web::Path<String>,
    body: web::Json<CreateList>,
) -> Result<HttpResponse, AppError> {
    let list = store::create_list(&data_dir, &path.into_inner(), &body.title)?;
    git_sync.auto_commit(&format!("created list '{}'", list.title));
    Ok(HttpResponse::Created().json(list))
}

pub async fn update_list(
    data_dir: web::Data<PathBuf>,
    git_sync: web::Data<GitSync>,
    path: web::Path<String>,
    body: web::Json<UpdateList>,
) -> Result<HttpResponse, AppError> {
    let list = store::update_list(
        &data_dir,
        &path.into_inner(),
        body.title.as_deref(),
        body.position,
    )?;
    git_sync.auto_commit(&format!("updated list '{}'", list.title));
    Ok(HttpResponse::Ok().json(list))
}

pub async fn delete_list(
    data_dir: web::Data<PathBuf>,
    git_sync: web::Data<GitSync>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let id = path.into_inner();
    store::delete_list(&data_dir, &id)?;
    git_sync.auto_commit(&format!("deleted list '{id}'"));
    Ok(HttpResponse::NoContent().finish())
}
