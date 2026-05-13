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
    let label = store::create_label(&data_dir, &path.into_inner(), &body.name)?;
    Ok(HttpResponse::Created().json(label))
}

pub async fn update_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<UpdateLabel>,
) -> Result<HttpResponse, AppError> {
    let label = store::update_label_by_id(&data_dir, &path.into_inner(), &body.name)?;
    Ok(HttpResponse::Ok().json(label))
}

pub async fn delete_label(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    store::delete_label_by_id(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}
