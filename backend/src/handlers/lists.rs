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
    let list = store::create_list(&data_dir, &path.into_inner(), &body.title)?;
    Ok(HttpResponse::Created().json(list))
}

pub async fn update_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateList>,
) -> Result<HttpResponse, AppError> {
    let list = store::update_list(
        &data_dir,
        &path.into_inner(),
        body.title.as_deref(),
        body.position,
    )?;
    Ok(HttpResponse::Ok().json(list))
}

pub async fn delete_list(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    store::delete_list(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}
