use actix_web::{web, HttpResponse};

use crate::{config, drafts};

/// `SYNKBAN_DRAFTS=0` turns drafts off (stored nowhere, none returned): the
/// e2e servers shared by parallel specs, where one test's leftover draft
/// would redirect another's start (ADR-0018). Off is never the default.
fn enabled() -> bool {
    std::env::var_os("SYNKBAN_DRAFTS").is_none_or(|v| v != "0")
}

fn bad(e: std::io::Error) -> actix_web::Error {
    if e.kind() == std::io::ErrorKind::InvalidInput {
        actix_web::error::ErrorBadRequest(e)
    } else {
        actix_web::error::ErrorInternalServerError(e)
    }
}

/// The single draft, or `null`. Draft requests aren't logged (sent while typing).
pub async fn get_draft() -> HttpResponse {
    HttpResponse::Ok().json(
        enabled()
            .then(|| drafts::get(&config::config_dir()))
            .flatten(),
    )
}

pub async fn save_draft(
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> actix_web::Result<HttpResponse> {
    if enabled() {
        drafts::save(&config::config_dir(), &path, body.into_inner()).map_err(bad)?;
    }
    Ok(HttpResponse::NoContent().finish())
}

pub async fn delete_draft(path: web::Path<String>) -> actix_web::Result<HttpResponse> {
    if enabled() {
        drafts::remove(&config::config_dir(), &path).map_err(bad)?;
    }
    Ok(HttpResponse::NoContent().finish())
}
