use actix_web::{web, HttpResponse};

use crate::errors::AppError;
use crate::git_sync::GitSync;
use crate::models::GitSyncConfig;

pub async fn get_status(git_sync: web::Data<GitSync>) -> Result<HttpResponse, AppError> {
    let status = git_sync.get_status().await;
    Ok(HttpResponse::Ok().json(status))
}

pub async fn get_config(git_sync: web::Data<GitSync>) -> Result<HttpResponse, AppError> {
    let config = git_sync.get_config().await;
    Ok(HttpResponse::Ok().json(config))
}

pub async fn update_config(
    git_sync: web::Data<GitSync>,
    body: web::Json<GitSyncConfig>,
) -> Result<HttpResponse, AppError> {
    let config = git_sync.update_config(body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(config))
}

pub async fn sync_now(git_sync: web::Data<GitSync>) -> Result<HttpResponse, AppError> {
    let status = git_sync.sync_now().await?;
    Ok(HttpResponse::Ok().json(status))
}
