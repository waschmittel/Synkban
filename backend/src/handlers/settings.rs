use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::config;
use crate::errors::AppError;
use crate::log_timestamp;
use crate::models::{SettingsResponse, UpdateSettings};
use crate::store;

/// last_board_id self-heals: an id that no longer resolves to an active board
/// (deleted or archived) is reported as absent, so the startup redirect can
/// never point at a dead board.
fn settings_response(data_dir: &std::path::Path, cfg: &config::Config) -> SettingsResponse {
    let last_board_id = cfg.last_board_id.clone().filter(|id| {
        store::list_boards(data_dir)
            .map(|boards| boards.iter().any(|b| b.id == *id))
            .unwrap_or(false)
    });
    SettingsResponse {
        startup_view: cfg.startup_view.clone().unwrap_or_else(|| "overview".into()),
        last_board_id,
        data_dir: data_dir.display().to_string(),
        configured_data_dir: cfg.data_dir.clone(),
        default_data_dir: config::default_data_dir().display().to_string(),
    }
}

pub async fn get_settings(data_dir: web::Data<PathBuf>) -> Result<HttpResponse, AppError> {
    let cfg = config::load();
    Ok(HttpResponse::Ok().json(settings_response(&data_dir, &cfg)))
}

pub async fn update_settings(
    data_dir: web::Data<PathBuf>,
    body: web::Json<UpdateSettings>,
) -> Result<HttpResponse, AppError> {
    if let Some(view) = &body.startup_view {
        if view != "overview" && view != "last" {
            return Err(AppError::BadRequest(format!(
                "startup_view must be \"overview\" or \"last\", got \"{view}\""
            )));
        }
    }
    if let Some(Some(dir)) = &body.data_dir {
        if dir.trim().is_empty() {
            return Err(AppError::BadRequest("data_dir must not be empty".into()));
        }
    }

    let cfg = config::update(|c| {
        if let Some(view) = body.startup_view.clone() {
            c.startup_view = Some(view);
        }
        if let Some(id) = body.last_board_id.clone() {
            c.last_board_id = id;
        }
        if let Some(dir) = body.data_dir.clone() {
            c.data_dir = dir.map(|d| d.trim().to_string());
        }
    })?;

    println!(
        "[{}] UPDATE settings\n    wrote {}",
        log_timestamp(),
        config::config_path().display()
    );
    Ok(HttpResponse::Ok().json(settings_response(&data_dir, &cfg)))
}
