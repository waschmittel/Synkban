pub mod errors;
pub mod handlers;
pub mod models;
pub mod store;

use actix_cors::Cors;
use actix_web::dev::Service;
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use include_dir::{include_dir, Dir};
use std::path::PathBuf;
use std::sync::mpsc;

pub fn log_timestamp() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let secs = d.as_secs();
    let time_secs = secs % 86400;
    let h = time_secs / 3600;
    let m = (time_secs % 3600) / 60;
    let s = time_secs % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

/// Returns (authorized, needs_cookie) for desktop-mode token auth.
/// `needs_cookie` is true when authorized via query param but no cookie yet (so middleware must set one).
pub fn check_token_auth(cookie_value: Option<&str>, query_string: &str, token: &str) -> (bool, bool) {
    let has_cookie = cookie_value.map(|v| v == token).unwrap_or(false);
    let has_query = query_string
        .split('&')
        .any(|p| p.strip_prefix("token=").map_or(false, |v| v == token));
    let authorized = has_cookie || has_query;
    let needs_cookie = has_query && !has_cookie;
    (authorized, needs_cookie)
}

/// Registers all `/api/*` routes. Used by both web and desktop server configs and by integration tests.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/api/changes", web::get().to(handlers::boards::check_changes))
        .route("/api/warnings", web::get().to(handlers::boards::get_warnings))
        .route("/api/boards", web::get().to(handlers::boards::list_boards))
        .route("/api/boards", web::post().to(handlers::boards::create_board))
        .route("/api/boards/archive", web::get().to(handlers::boards::list_archived_boards))
        .route("/api/boards/order", web::put().to(handlers::boards::reorder_boards))
        .route("/api/boards/{id}", web::get().to(handlers::boards::get_board))
        .route("/api/boards/{id}", web::put().to(handlers::boards::update_board))
        .route("/api/boards/{id}", web::delete().to(handlers::boards::delete_board))
        .route("/api/boards/{board_id}/archive", web::get().to(handlers::boards::get_archived_cards))
        .route("/api/boards/{board_id}/lists", web::post().to(handlers::lists::create_list))
        .route("/api/lists/{id}", web::put().to(handlers::lists::update_list))
        .route("/api/lists/{id}", web::delete().to(handlers::lists::delete_list))
        .route("/api/boards/{board_id}/labels", web::post().to(handlers::labels::create_label))
        .route("/api/labels/{id}", web::put().to(handlers::labels::update_label))
        .route("/api/labels/{id}", web::delete().to(handlers::labels::delete_label))
        .route("/api/lists/{list_id}/cards", web::post().to(handlers::cards::create_card))
        .route("/api/cards/{id}", web::put().to(handlers::cards::update_card))
        .route("/api/cards/{id}", web::delete().to(handlers::cards::delete_card))
        .route("/api/cards/{card_id}/attachments", web::post().to(handlers::cards::upload_attachment))
        .route("/api/cards/{card_id}/attachments/{att_id}", web::get().to(handlers::cards::download_attachment))
        .route("/api/cards/{card_id}/attachments/{att_id}/thumb", web::get().to(handlers::cards::download_thumbnail))
        .route("/api/cards/{card_id}/attachments/{att_id}", web::delete().to(handlers::cards::delete_attachment));
}

static STATIC_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/static");

async fn serve_embedded(req: HttpRequest) -> HttpResponse {
    let path = req.path().trim_start_matches('/');

    if let Some(file) = STATIC_DIR.get_file(path) {
        // mime_guess has no entry for `.webmanifest`; browsers require the
        // proper type or they reject the PWA manifest.
        let mime = if path.ends_with(".webmanifest") {
            "application/manifest+json".to_string()
        } else {
            mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string()
        };
        return HttpResponse::Ok()
            .content_type(mime)
            .body(file.contents());
    }

    match STATIC_DIR.get_file("index.html") {
        Some(file) => HttpResponse::Ok()
            .content_type("text/html")
            .body(file.contents()),
        None => HttpResponse::NotFound().body("Not found"),
    }
}

/// Run the attachment storage reconcile/GC sweep and log its result. Best-effort:
/// a failure is logged but never blocks startup.
fn reconcile_attachments(data_dir: &std::path::Path) {
    match store::gc::reconcile(data_dir) {
        Ok(actions) => {
            let ops = store::drain_file_ops(data_dir);
            if !ops.is_empty() {
                println!(
                    "[{}] RECONCILE attachments ({} action(s))\n{}",
                    log_timestamp(),
                    actions,
                    ops.join("\n")
                );
            }
        }
        Err(e) => eprintln!("[{}] RECONCILE failed: {e}", log_timestamp()),
    }
}

pub async fn run_server(host: &str, port: u16, data_dir: &str) -> std::io::Result<()> {
    let data_dir = PathBuf::from(data_dir);
    std::fs::create_dir_all(&data_dir)?;
    reconcile_attachments(&data_dir);

    let bind = format!("{host}:{port}");
    println!("Server running at http://{bind}");
    println!("Data directory: {}", data_dir.display());

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(data_dir.clone()))
            .app_data(web::PayloadConfig::new(52 * 1024 * 1024))
            .configure(configure_routes)
            .default_service(web::get().to(serve_embedded))
    })
    .bind(&bind)?
    .run()
    .await
}

pub async fn run_desktop_server(
    data_dir: &str,
    token: &str,
    port_tx: mpsc::Sender<u16>,
) -> std::io::Result<()> {
    let data_dir = PathBuf::from(data_dir);
    std::fs::create_dir_all(&data_dir)?;
    reconcile_attachments(&data_dir);
    let token = token.to_string();
    let data_dir_display = data_dir.display().to_string();

    let server = HttpServer::new(move || {
        let token = token.clone();
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap_fn(move |req, srv| {
                let token = token.clone();
                let cookie_value = req.cookie("synkban_token").map(|c| c.value().to_string());
                let query = req.query_string().to_string();
                let (authorized, needs_cookie) = check_token_auth(
                    cookie_value.as_deref(),
                    &query,
                    &token,
                );
                let fut = srv.call(req);
                async move {
                    if !authorized {
                        return Err(actix_web::error::ErrorForbidden(""));
                    }
                    let mut res = fut.await?;
                    if needs_cookie {
                        res.response_mut().headers_mut().append(
                            actix_web::http::header::SET_COOKIE,
                            format!(
                                "synkban_token={}; Path=/; HttpOnly; SameSite=Strict",
                                token
                            )
                            .parse()
                            .unwrap(),
                        );
                    }
                    Ok(res)
                }
            })
            .wrap(cors)
            .app_data(web::Data::new(data_dir.clone()))
            .app_data(web::PayloadConfig::new(52 * 1024 * 1024))
            .configure(configure_routes)
            .default_service(web::get().to(serve_embedded))
    })
    .bind("127.0.0.1:0")?;

    let port = server.addrs()[0].port();
    println!("Desktop server at http://127.0.0.1:{port} (token-protected)");
    println!("Data directory: {data_dir_display}");
    port_tx.send(port).ok();

    server.run().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_timestamp_format() {
        let ts = log_timestamp();
        assert_eq!(ts.len(), 8);
        assert_eq!(&ts[2..3], ":");
        assert_eq!(&ts[5..6], ":");
        let h: u32 = ts[0..2].parse().unwrap();
        let m: u32 = ts[3..5].parse().unwrap();
        let s: u32 = ts[6..8].parse().unwrap();
        assert!(h < 24);
        assert!(m < 60);
        assert!(s < 60);
    }

    #[test]
    fn token_auth_cookie_only() {
        let (auth, needs) = check_token_auth(Some("tok123"), "", "tok123");
        assert!(auth);
        assert!(!needs);
    }

    #[test]
    fn token_auth_query_only() {
        let (auth, needs) = check_token_auth(None, "token=tok123", "tok123");
        assert!(auth);
        assert!(needs);
    }

    #[test]
    fn token_auth_query_with_other_params() {
        let (auth, needs) = check_token_auth(None, "foo=bar&token=tok123&baz=qux", "tok123");
        assert!(auth);
        assert!(needs);
    }

    #[test]
    fn token_auth_both_cookie_and_query() {
        let (auth, needs) = check_token_auth(Some("tok123"), "token=tok123", "tok123");
        assert!(auth);
        assert!(!needs);
    }

    #[test]
    fn token_auth_wrong_cookie() {
        let (auth, needs) = check_token_auth(Some("wrong"), "", "tok123");
        assert!(!auth);
        assert!(!needs);
    }

    #[test]
    fn token_auth_wrong_query() {
        let (auth, needs) = check_token_auth(None, "token=wrong", "tok123");
        assert!(!auth);
        assert!(!needs);
    }

    #[test]
    fn token_auth_no_credentials() {
        let (auth, needs) = check_token_auth(None, "", "tok123");
        assert!(!auth);
        assert!(!needs);
    }

    #[test]
    fn token_auth_empty_query_string() {
        let (auth, needs) = check_token_auth(None, "foo=bar", "tok123");
        assert!(!auth);
        assert!(!needs);
    }

    #[test]
    fn token_auth_substring_not_a_match() {
        // ensure token=tok12 doesn't match token=tok123 prefix
        let (auth, _) = check_token_auth(None, "token=tok12", "tok123");
        assert!(!auth);
    }
}
