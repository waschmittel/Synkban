pub mod errors;
pub mod handlers;
pub mod models;
pub mod store;

#[cfg(feature = "desktop")]
pub mod desktop;

use actix_cors::Cors;
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use include_dir::{include_dir, Dir};
use std::path::PathBuf;

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

static STATIC_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/static");

async fn serve_embedded(req: HttpRequest) -> HttpResponse {
    let path = req.path().trim_start_matches('/');

    if let Some(file) = STATIC_DIR.get_file(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return HttpResponse::Ok()
            .content_type(mime.as_ref())
            .body(file.contents());
    }

    match STATIC_DIR.get_file("index.html") {
        Some(file) => HttpResponse::Ok()
            .content_type("text/html")
            .body(file.contents()),
        None => HttpResponse::NotFound().body("Not found"),
    }
}

pub async fn run_server(host: &str, port: u16, data_dir: &str) -> std::io::Result<()> {
    let data_dir = PathBuf::from(data_dir);
    std::fs::create_dir_all(&data_dir)?;

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
            .route("/api/changes", web::get().to(handlers::boards::check_changes))
            .route("/api/boards", web::get().to(handlers::boards::list_boards))
            .route("/api/boards", web::post().to(handlers::boards::create_board))
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
            .route("/api/cards/{card_id}/attachments/{att_id}", web::delete().to(handlers::cards::delete_attachment))
            .default_service(web::get().to(serve_embedded))
    })
    .bind(&bind)?
    .run()
    .await
}
