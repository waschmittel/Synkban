use actix_web::{web, HttpResponse};
use std::path::{Path, PathBuf};

use crate::config;
use crate::errors::AppError;
use crate::models::{SettingsResponse, UpdateSettings};
use crate::{log_timestamp, mirror, store, DesktopMode, MirrorWake};

/// last_board_id self-heals: an id that no longer resolves to an active board
/// (deleted or archived) is reported as absent, so the startup redirect can
/// never point at a dead board.
fn settings_response(data_dir: &Path, cfg: &config::Config, is_desktop: bool) -> SettingsResponse {
    let last_board_id = cfg.last_board_id.clone().filter(|id| {
        store::list_boards(data_dir)
            .map(|boards| boards.iter().any(|b| b.id == *id))
            .unwrap_or(false)
    });
    SettingsResponse {
        startup_view: cfg
            .startup_view
            .clone()
            .unwrap_or_else(|| "overview".into()),
        theme: cfg.theme.clone().unwrap_or_else(|| "system".into()),
        last_board_id,
        data_dir: data_dir.display().to_string(),
        configured_data_dir: cfg.data_dir.clone(),
        default_data_dir: config::default_data_dir().display().to_string(),
        mirror_dir: if is_desktop {
            cfg.mirror_dir.clone()
        } else {
            None
        },
        mirror_schedule: if is_desktop {
            cfg.mirror_schedule.clone().unwrap_or_else(|| "off".into())
        } else {
            "off".into()
        },
        mirror_status: if is_desktop {
            Some(mirror::load_status())
        } else {
            None
        },
    }
}

pub async fn get_settings(
    data_dir: web::Data<PathBuf>,
    desktop_mode: Option<web::Data<DesktopMode>>,
) -> Result<HttpResponse, AppError> {
    let is_desktop = desktop_mode.as_ref().is_some_and(|d| d.0);
    let cfg = config::load();
    Ok(HttpResponse::Ok().json(settings_response(&data_dir, &cfg, is_desktop)))
}

pub async fn update_settings(
    data_dir: web::Data<PathBuf>,
    desktop_mode: Option<web::Data<DesktopMode>>,
    mirror_wake: Option<web::Data<MirrorWake>>,
    body: web::Json<UpdateSettings>,
) -> Result<HttpResponse, AppError> {
    let is_desktop = desktop_mode.as_ref().is_some_and(|d| d.0);

    if let Some(view) = &body.startup_view {
        if view != "overview" && view != "last" {
            return Err(AppError::BadRequest(format!(
                "startup_view must be \"overview\" or \"last\", got \"{view}\""
            )));
        }
    }
    if let Some(theme) = &body.theme {
        if theme != "system" && theme != "light" && theme != "dark" {
            return Err(AppError::BadRequest(format!(
                "theme must be \"system\", \"light\", or \"dark\", got \"{theme}\""
            )));
        }
    }
    if let Some(Some(dir)) = &body.data_dir {
        if dir.trim().is_empty() {
            return Err(AppError::BadRequest("data_dir must not be empty".into()));
        }
    }

    let touches_mirror = body.mirror_dir.is_some() || body.mirror_schedule.is_some();
    let mut normalized_mirror_dir: Option<Option<String>> = None;
    let mut next_mirror_schedule: Option<String> = None;

    if touches_mirror {
        if !is_desktop {
            return Err(AppError::BadRequest(
                "Readable mirror is only configurable in Desktop Mode; use `synkban export <dir>` on a server".into(),
            ));
        }
        if let Some(sched) = &body.mirror_schedule {
            if sched != "off" && sched != "daily" && sched != "weekly" {
                return Err(AppError::BadRequest(format!(
                    "mirror_schedule must be \"off\", \"daily\", or \"weekly\", got \"{sched}\""
                )));
            }
        }
        if let Some(Some(raw)) = &body.mirror_dir {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(AppError::BadRequest("mirror_dir must not be empty".into()));
            }
            mirror::validate_mirror_dir(Path::new(trimmed), &data_dir, &config::config_dir())?;
            normalized_mirror_dir = Some(Some(trimmed.to_string()));
        } else if let Some(None) = &body.mirror_dir {
            normalized_mirror_dir = Some(None);
        }

        let current = config::load();
        let resulting_dir = match &normalized_mirror_dir {
            Some(v) => v.as_deref(),
            None => current.mirror_dir.as_deref(),
        };
        let resulting_sched = body
            .mirror_schedule
            .as_deref()
            .or(current.mirror_schedule.as_deref())
            .unwrap_or("off");

        if resulting_dir.is_none() && resulting_sched != "off" {
            if body.mirror_dir == Some(None) && body.mirror_schedule.is_none() {
                next_mirror_schedule = Some("off".into());
            } else {
                return Err(AppError::BadRequest(
                    "Choose a mirror folder before enabling a schedule".into(),
                ));
            }
        } else if let Some(sched) = &body.mirror_schedule {
            next_mirror_schedule = Some(sched.clone());
        }
    }

    let mut mirror_dir_changed = false;
    let cfg = config::update(|c| {
        if let Some(view) = body.startup_view.clone() {
            c.startup_view = Some(view);
        }
        if let Some(theme) = body.theme.clone() {
            c.theme = Some(theme);
        }
        if let Some(id) = body.last_board_id.clone() {
            c.last_board_id = id;
        }
        if let Some(dir) = body.data_dir.clone() {
            c.data_dir = dir.map(|d| d.trim().to_string());
        }
        if let Some(mdir) = normalized_mirror_dir.clone() {
            if c.mirror_dir != mdir {
                mirror_dir_changed = true;
            }
            c.mirror_dir = mdir;
        }
        if let Some(sched) = next_mirror_schedule.clone() {
            c.mirror_schedule = if sched == "off" { None } else { Some(sched) };
        }
    })?;

    if mirror_dir_changed {
        mirror::reset_status();
    }
    if touches_mirror {
        if let Some(w) = mirror_wake {
            w.notify();
        }
    }

    println!(
        "[{}] UPDATE settings\n    wrote {}",
        log_timestamp(),
        config::config_path().display()
    );
    Ok(HttpResponse::Ok().json(settings_response(&data_dir, &cfg, is_desktop)))
}
