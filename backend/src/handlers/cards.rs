use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::git_sync::GitSync;
use crate::models::*;
use crate::store;

pub async fn create_card(
    data_dir: web::Data<PathBuf>,
    git_sync: web::Data<GitSync>,
    path: web::Path<String>,
    body: web::Json<CreateCard>,
) -> Result<HttpResponse, AppError> {
    let card = store::create_card(&data_dir, &path.into_inner(), &body.title)?;
    git_sync.auto_commit(&format!("created card '{}'", card.title));
    Ok(HttpResponse::Created().json(card))
}

pub async fn update_card(
    data_dir: web::Data<PathBuf>,
    git_sync: web::Data<GitSync>,
    path: web::Path<String>,
    body: web::Json<UpdateCard>,
) -> Result<HttpResponse, AppError> {
    let card = store::update_card(
        &data_dir,
        &path.into_inner(),
        body.title.as_deref(),
        body.description.as_deref(),
        body.position,
        body.list_id.as_deref(),
    )?;
    git_sync.auto_commit(&format!("updated card '{}'", card.title));
    Ok(HttpResponse::Ok().json(card))
}

pub async fn delete_card(
    data_dir: web::Data<PathBuf>,
    git_sync: web::Data<GitSync>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    let id = path.into_inner();
    store::delete_card(&data_dir, &id)?;
    git_sync.auto_commit(&format!("deleted card '{id}'"));
    Ok(HttpResponse::NoContent().finish())
}
