use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::models::*;
use crate::store;

pub async fn create_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
    body: web::Json<CreateCard>,
) -> Result<HttpResponse, AppError> {
    let card = store::create_card(&data_dir, &path.into_inner(), &body.title)?;
    Ok(HttpResponse::Created().json(card))
}

pub async fn update_card(
    data_dir: web::Data<PathBuf>,
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
        body.label_ids.as_deref(),
    )?;
    Ok(HttpResponse::Ok().json(card))
}

pub async fn delete_card(
    data_dir: web::Data<PathBuf>,
    path: web::Path<String>,
) -> Result<HttpResponse, AppError> {
    store::delete_card(&data_dir, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}
