use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::errors::AppError;
use crate::{mirror, DesktopMode};

pub async fn run_now(
    data_dir: web::Data<PathBuf>,
    desktop_mode: Option<web::Data<DesktopMode>>,
) -> Result<HttpResponse, AppError> {
    if !desktop_mode.as_ref().is_some_and(|d| d.0) {
        return Err(AppError::BadRequest(
            "Readable mirror is only available in Desktop Mode; use `synkban export <dir>` on a server".into(),
        ));
    }
    let dd = data_dir.get_ref().clone();
    let status = tokio::task::spawn_blocking(move || mirror::run_configured_mirror(&dd))
        .await
        .map_err(|e| AppError::Io(std::io::Error::other(e)))??;
    Ok(HttpResponse::Ok().json(status))
}
