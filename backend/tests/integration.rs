//! HTTP-level integration tests for the Synkban backend.
//! Covers error paths that store-level tests can't exercise (400/413 wiring,
//! token middleware, header capture, query parsing).

use actix_web::{
    cookie::Cookie, dev::Service, dev::ServiceResponse, http::StatusCode, test, web, App,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;

fn data_app_data(dir: &Path) -> web::Data<PathBuf> {
    web::Data::new(dir.to_path_buf())
}

fn read_json_body(body: actix_web::web::Bytes) -> Value {
    serde_json::from_slice(&body).expect("response is valid JSON")
}

/// Build a minimal App with all routes (no middleware) for handler-level tests.
macro_rules! make_app {
    ($data_dir:expr) => {
        App::new()
            .app_data(data_app_data($data_dir))
            .app_data(web::PayloadConfig::new(52 * 1024 * 1024))
            .configure(synkban::configure_routes)
    };
}

/// Build an App with the desktop-mode token middleware in front of all routes.
macro_rules! make_token_app {
    ($data_dir:expr, $token:expr) => {{
        let token_arc = Arc::new($token.to_string());
        let token_for_closure = token_arc.clone();
        App::new()
            .wrap_fn(move |req, srv| {
                let token = token_for_closure.clone();
                let cookie_value = req.cookie("synkban_token").map(|c| c.value().to_string());
                let query = req.query_string().to_string();
                let (authorized, needs_cookie) =
                    synkban::check_token_auth(cookie_value.as_deref(), &query, token.as_str());
                let fut = srv.call(req);
                async move {
                    if !authorized {
                        return Err(actix_web::error::ErrorForbidden(""));
                    }
                    let mut res: ServiceResponse = fut.await?;
                    if needs_cookie {
                        res.response_mut().headers_mut().append(
                            actix_web::http::header::SET_COOKIE,
                            format!("synkban_token={}; Path=/; HttpOnly; SameSite=Strict", token)
                                .parse()
                                .unwrap(),
                        );
                    }
                    Ok(res)
                }
            })
            .app_data(data_app_data($data_dir))
            .configure(synkban::configure_routes)
    }};
}

/// Posts JSON, asserts success, returns parsed response body.
macro_rules! post_json {
    ($app:expr, $uri:expr, $body:expr) => {{
        let req = test::TestRequest::post()
            .uri($uri)
            .set_json($body)
            .to_request();
        let resp = test::call_service(&$app, req).await;
        assert!(
            resp.status().is_success(),
            "POST {} failed: status={}",
            $uri,
            resp.status()
        );
        let bytes = test::read_body(resp).await;
        read_json_body(bytes)
    }};
}

/// Seeds a board + list + card, returning (board_id, list_id, card_id).
macro_rules! seed_board_list_card {
    ($app:expr) => {{
        let board: Value = post_json!($app, "/api/boards", json!({ "title": "B" }));
        let bid = board["id"].as_str().unwrap().to_string();
        let list: Value = post_json!($app, &format!("/api/boards/{}/lists", bid), json!({ "title": "L" }));
        let lid = list["id"].as_str().unwrap().to_string();
        let card: Value = post_json!($app, &format!("/api/lists/{}/cards", lid), json!({ "title": "C" }));
        let cid = card["id"].as_str().unwrap().to_string();
        (bid, lid, cid)
    }};
}

// -- due_date validation (400 path) --

#[actix_web::test]
async fn update_card_invalid_due_date_returns_400() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "due_date": "2024/13/45" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = read_json_body(test::read_body(resp).await);
    assert!(json["error"].as_str().unwrap().contains("YYYY-MM-DD"));
}

#[actix_web::test]
async fn update_card_valid_due_date_returns_200() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "due_date": "2025-06-15" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = read_json_body(test::read_body(resp).await);
    assert_eq!(json["due_date"], "2025-06-15");
}

#[actix_web::test]
async fn update_card_null_due_date_clears_it() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "due_date": "2025-06-15" }))
        .to_request();
    test::call_service(&app, req).await;

    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "due_date": null }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = read_json_body(test::read_body(resp).await);
    assert!(json["due_date"].is_null());
}

// -- Attachment size limit (413 path) --

#[actix_web::test]
async fn upload_attachment_oversize_returns_413() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let oversize = vec![0u8; 50 * 1024 * 1024 + 1]; // 50 MB + 1 byte
    let req = test::TestRequest::post()
        .uri(&format!("/api/cards/{}/attachments?filename=big.bin", cid))
        .insert_header(("content-type", "application/octet-stream"))
        .set_payload(oversize)
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let json = read_json_body(test::read_body(resp).await);
    assert!(json["error"].as_str().unwrap().contains("50 MB"));
}

#[actix_web::test]
async fn upload_attachment_at_limit_succeeds() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let at_limit = vec![0u8; 50 * 1024 * 1024];
    let req = test::TestRequest::post()
        .uri(&format!("/api/cards/{}/attachments?filename=ok.bin", cid))
        .insert_header(("content-type", "application/octet-stream"))
        .set_payload(at_limit)
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[actix_web::test]
async fn upload_attachment_captures_content_type_and_filename() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::post()
        .uri(&format!(
            "/api/cards/{}/attachments?filename=my%20doc.pdf",
            cid
        ))
        .insert_header(("content-type", "application/pdf"))
        .set_payload(b"PDF-DATA".to_vec())
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = read_json_body(test::read_body(resp).await);
    assert_eq!(json["filename"], "my doc.pdf");
    assert_eq!(json["content_type"], "application/pdf");
    assert_eq!(json["size"], 8);
}

#[actix_web::test]
async fn upload_attachment_defaults_content_type_when_header_missing() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::post()
        .uri(&format!("/api/cards/{}/attachments?filename=raw.bin", cid))
        .set_payload(b"DATA".to_vec())
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = read_json_body(test::read_body(resp).await);
    assert_eq!(json["content_type"], "application/octet-stream");
}

// -- Other error paths through HTTP layer --

#[actix_web::test]
async fn delete_unarchived_board_returns_400() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let board: Value = post_json!(app, "/api/boards", json!({ "title": "B" }));
    let bid = board["id"].as_str().unwrap();

    let req = test::TestRequest::delete()
        .uri(&format!("/api/boards/{}", bid))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn delete_unarchived_card_returns_400() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::delete()
        .uri(&format!("/api/cards/{}", cid))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn get_missing_board_returns_404() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;

    let req = test::TestRequest::get()
        .uri("/api/boards/nonexistent")
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let json = read_json_body(test::read_body(resp).await);
    assert!(json["error"].as_str().is_some());
}

#[actix_web::test]
async fn restore_orphaned_card_without_list_id_returns_400() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, lid, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::delete()
        .uri(&format!("/api/lists/{}", lid))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "archived": false }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// -- Change detection --

#[actix_web::test]
async fn changes_endpoint_returns_mtime() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;

    let req = test::TestRequest::get().uri("/api/changes").to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = read_json_body(test::read_body(resp).await);
    assert_eq!(json["mtime"], 0);
    assert!(json["boards"].is_object());
    assert_eq!(json["boards"].as_object().unwrap().len(), 0);

    let _: Value = post_json!(app, "/api/boards", json!({ "title": "B" }));
    let req = test::TestRequest::get().uri("/api/changes").to_request();
    let resp = test::call_service(&app, req).await;
    let json = read_json_body(test::read_body(resp).await);
    assert!(json["mtime"].as_u64().unwrap() > 0);
    // Per-board map should now contain one entry whose mtime equals the global.
    let boards_obj = json["boards"].as_object().unwrap();
    assert_eq!(boards_obj.len(), 1);
    let per_board = boards_obj.values().next().unwrap().as_u64().unwrap();
    assert_eq!(per_board, json["mtime"].as_u64().unwrap());
}

#[actix_web::test]
async fn changes_endpoint_per_board_isolates_quiet_boards() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;

    let b1: Value = post_json!(app, "/api/boards", json!({ "title": "B1" }));
    let b2: Value = post_json!(app, "/api/boards", json!({ "title": "B2" }));
    let b1_id = b1["id"].as_str().unwrap();
    let b2_id = b2["id"].as_str().unwrap();

    // Sleep briefly so mtimes can diverge at ms resolution.
    std::thread::sleep(std::time::Duration::from_millis(20));

    let req = test::TestRequest::get().uri("/api/changes").to_request();
    let resp = test::call_service(&app, req).await;
    let before = read_json_body(test::read_body(resp).await);
    let b1_before = before["boards"][b1_id].as_u64().unwrap();
    let b2_before = before["boards"][b2_id].as_u64().unwrap();

    // Wait briefly, then mutate only b1.
    std::thread::sleep(std::time::Duration::from_millis(20));
    let _: Value = post_json!(
        app,
        &format!("/api/boards/{b1_id}/lists"),
        json!({ "title": "L" })
    );

    let req = test::TestRequest::get().uri("/api/changes").to_request();
    let resp = test::call_service(&app, req).await;
    let after = read_json_body(test::read_body(resp).await);
    let b1_after = after["boards"][b1_id].as_u64().unwrap();
    let b2_after = after["boards"][b2_id].as_u64().unwrap();

    assert!(
        b1_after > b1_before,
        "b1 mtime should advance when b1 changes"
    );
    assert_eq!(
        b2_after, b2_before,
        "b2 mtime should NOT change when b1 changes"
    );
}

// -- Token middleware (desktop mode) --

/// Asserts that calling `req` against `app` produces a 403. The middleware returns
/// `Err(ErrorForbidden)` which test::call_service would treat as a panic — we use
/// try_call_service and verify the error's status code instead.
macro_rules! assert_forbidden {
    ($app:expr, $req:expr) => {{
        match test::try_call_service(&$app, $req).await {
            Ok(resp) => panic!("expected 403, got {}", resp.status()),
            Err(e) => {
                let status = e.as_response_error().status_code();
                assert_eq!(
                    status,
                    StatusCode::FORBIDDEN,
                    "expected 403, got {}",
                    status
                );
            }
        }
    }};
}

#[actix_web::test]
async fn token_middleware_rejects_missing_token() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_token_app!(&dir_path, "my-secret-token")).await;

    let req = test::TestRequest::get().uri("/api/boards").to_request();
    assert_forbidden!(app, req);
}

#[actix_web::test]
async fn token_middleware_accepts_valid_query_and_sets_cookie() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let token = "my-secret-token";
    let app = test::init_service(make_token_app!(&dir_path, token)).await;

    let req = test::TestRequest::get()
        .uri(&format!("/api/boards?token={}", token))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let set_cookie = resp
        .headers()
        .get(actix_web::http::header::SET_COOKIE)
        .expect("Set-Cookie header present")
        .to_str()
        .unwrap();
    assert!(set_cookie.contains("synkban_token=my-secret-token"));
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Strict"));
}

#[actix_web::test]
async fn token_middleware_accepts_cookie_no_new_cookie_set() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let token = "my-secret-token";
    let app = test::init_service(make_token_app!(&dir_path, token)).await;

    let req = test::TestRequest::get()
        .uri("/api/boards")
        .cookie(Cookie::new("synkban_token", token))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp
        .headers()
        .get(actix_web::http::header::SET_COOKIE)
        .is_none());
}

#[actix_web::test]
async fn token_middleware_rejects_wrong_token() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_token_app!(&dir_path, "right-token")).await;

    let req = test::TestRequest::get()
        .uri("/api/boards?token=wrong")
        .to_request();
    assert_forbidden!(app, req);
}

#[actix_web::test]
async fn token_middleware_rejects_wrong_cookie() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_token_app!(&dir_path, "right-token")).await;

    let req = test::TestRequest::get()
        .uri("/api/boards")
        .cookie(Cookie::new("synkban_token", "wrong-token"))
        .to_request();
    assert_forbidden!(app, req);
}

// -- PDF export --

#[actix_web::test]
async fn export_card_pdf_returns_download_with_embedded_image() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "title": "Größe/Test", "due_date": "2026-12-24" }))
        .to_request();
    test::call_service(&app, req).await;

    let mut png = std::io::Cursor::new(Vec::new());
    image::RgbImage::from_pixel(64, 48, image::Rgb([200, 40, 40]))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let req = test::TestRequest::post()
        .uri(&format!("/api/cards/{}/attachments?filename=red.png", cid))
        .insert_header(("content-type", "image/png"))
        .set_payload(png.into_inner())
        .to_request();
    assert_eq!(
        test::call_service(&app, req).await.status(),
        StatusCode::CREATED
    );

    let req = test::TestRequest::get()
        .uri(&format!("/api/cards/{}/pdf", cid))
        .to_request();
    let resp = test::call_service(&app, req).await;
    let status = resp.status();
    if status != StatusCode::OK {
        panic!(
            "{status}: {}",
            String::from_utf8_lossy(&test::read_body(resp).await)
        );
    }
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "application/pdf"
    );
    let disposition = resp
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        disposition.starts_with("attachment; filename=\"Gr__e_Test.pdf\""),
        "{disposition}"
    );
    assert!(
        disposition.contains("filename*=UTF-8''Gr%C3%B6%C3%9Fe_Test.pdf"),
        "{disposition}"
    );
    let body = test::read_body(resp).await;
    if let Ok(out) = std::env::var("PDF_TEST_OUT_HTTP") {
        std::fs::write(out, &body).unwrap();
    }
    assert!(body.starts_with(b"%PDF-"));
}

#[actix_web::test]
async fn export_card_pdf_unknown_card_is_404() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let req = test::TestRequest::get()
        .uri("/api/cards/nope/pdf")
        .to_request();
    assert_eq!(
        test::call_service(&app, req).await.status(),
        StatusCode::NOT_FOUND
    );
}

// -- board mode (ADR-0022) --

#[actix_web::test]
async fn board_mode_round_trips_and_defaults_to_kanban() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, _, _) = seed_board_list_card!(app);

    let get = |app_uri: String| test::TestRequest::get().uri(&app_uri).to_request();
    let resp = test::call_service(&app, get(format!("/api/boards/{bid}"))).await;
    assert_eq!(
        read_json_body(test::read_body(resp).await)["mode"],
        "kanban"
    );

    let req = test::TestRequest::put()
        .uri(&format!("/api/boards/{bid}"))
        .set_json(json!({ "mode": "notes" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(read_json_body(test::read_body(resp).await)["mode"], "notes");

    let resp = test::call_service(&app, get(format!("/api/boards/{bid}"))).await;
    assert_eq!(read_json_body(test::read_body(resp).await)["mode"], "notes");
    let resp = test::call_service(&app, get("/api/boards".into())).await;
    assert_eq!(
        read_json_body(test::read_body(resp).await)[0]["mode"],
        "notes"
    );
}

#[actix_web::test]
async fn board_mode_rejects_unknown_value() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, _, _) = seed_board_list_card!(app);

    let req = test::TestRequest::put()
        .uri(&format!("/api/boards/{bid}"))
        .set_json(json!({ "mode": "grid" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// -- quick-add, label merge, list collapse, board stats --

#[actix_web::test]
async fn create_card_with_labels_and_due_date() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, lid, _) = seed_board_list_card!(app);
    let label: Value = post_json!(
        app,
        &format!("/api/boards/{bid}/labels"),
        json!({ "name": "Bug" })
    );
    let card: Value = post_json!(
        app,
        &format!("/api/lists/{lid}/cards"),
        json!({ "title": "Quick", "label_ids": [label["id"]], "due_date": "2026-12-01" })
    );
    assert_eq!(card["label_ids"], json!([label["id"]]));
    assert_eq!(card["due_date"], "2026-12-01");
    let req = test::TestRequest::post()
        .uri(&format!("/api/lists/{lid}/cards"))
        .set_json(json!({ "title": "Bad", "due_date": "12/01/2026" }))
        .to_request();
    assert_eq!(
        test::call_service(&app, req).await.status(),
        StatusCode::BAD_REQUEST
    );
}

#[actix_web::test]
async fn creating_a_same_named_label_reuses_it_and_renaming_onto_one_merges() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, _, cid) = seed_board_list_card!(app);
    let uri = format!("/api/boards/{bid}/labels");
    let create = |name: &str| {
        test::TestRequest::post()
            .uri(&uri)
            .set_json(json!({ "name": name }))
            .to_request()
    };
    let resp = test::call_service(&app, create("In Progress")).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let keep = read_json_body(test::read_body(resp).await);
    let resp = test::call_service(&app, create("in-progress")).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        read_json_body(test::read_body(resp).await)["id"],
        keep["id"]
    );

    let gone: Value = post_json!(app, &uri, json!({ "name": "Doing" }));
    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{cid}"))
        .set_json(json!({ "label_ids": [gone["id"]] }))
        .to_request();
    test::call_service(&app, req).await;
    let rename = |merge: Option<bool>| {
        let mut body = json!({ "name": "IN PROGRESS" });
        if let Some(m) = merge {
            body["merge"] = json!(m);
        }
        test::TestRequest::put()
            .uri(&format!("/api/labels/{}", gone["id"].as_str().unwrap()))
            .set_json(body)
            .to_request()
    };
    // Destructive: refused unless asked for explicitly.
    for flag in [None, Some(false)] {
        let resp = test::call_service(&app, rename(flag)).await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }
    let req = rename(Some(true));
    let merged = read_json_body(test::read_body(test::call_service(&app, req).await).await);
    assert_eq!(merged["id"], keep["id"]);
    assert_eq!(merged["name"], "IN PROGRESS");
    let req = test::TestRequest::get()
        .uri(&format!("/api/boards/{bid}"))
        .to_request();
    let board = read_json_body(test::read_body(test::call_service(&app, req).await).await);
    assert_eq!(board["labels"].as_array().unwrap().len(), 1);
    assert_eq!(
        board["lists"][0]["cards"][0]["label_ids"],
        json!([keep["id"]])
    );
}

#[actix_web::test]
async fn list_collapsed_round_trips() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, lid, _) = seed_board_list_card!(app);
    let req = test::TestRequest::put()
        .uri(&format!("/api/lists/{lid}"))
        .set_json(json!({ "collapsed": true }))
        .to_request();
    let list = read_json_body(test::read_body(test::call_service(&app, req).await).await);
    assert_eq!(list["collapsed"], true);
    let req = test::TestRequest::get()
        .uri(&format!("/api/boards/{bid}"))
        .to_request();
    let board = read_json_body(test::read_body(test::call_service(&app, req).await).await);
    assert_eq!(board["lists"][0]["collapsed"], true);
}

#[actix_web::test]
async fn board_list_carries_stats_measured_against_the_client_date() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, lid, _) = seed_board_list_card!(app);
    post_json!(
        app,
        &format!("/api/lists/{lid}/cards"),
        json!({ "title": "Late", "due_date": "2026-11-10" })
    );
    let get = |uri: &str| test::TestRequest::get().uri(uri).to_request();
    let boards = read_json_body(
        test::read_body(test::call_service(&app, get("/api/boards?today=2026-11-17")).await).await,
    );
    let stats = &boards[0]["stats"];
    assert_eq!(boards[0]["id"], bid);
    assert_eq!(
        (stats["cards"].as_u64(), stats["overdue"].as_u64()),
        (Some(2), Some(1))
    );
    assert!(stats["edited_at"].as_u64().unwrap() > 0);
    let boards =
        read_json_body(test::read_body(test::call_service(&app, get("/api/boards")).await).await);
    assert_eq!(boards[0]["stats"]["overdue"], 0);
    // Single-board responses don't carry stats.
    let board = read_json_body(
        test::read_body(test::call_service(&app, get(&format!("/api/boards/{bid}"))).await).await,
    );
    assert!(board.get("stats").is_none());
}

// -- Description ProseMirror schema validation (400 path) --

#[actix_web::test]
async fn update_card_validates_description_schema() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    for invalid in [
        "raw plain text".to_string(),
        json!({ "type": "doc" }).to_string(),
        json!({ "type": "doc", "content": [{ "type": "horizontal_rule" }] }).to_string(),
        json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "marks": [{ "type": "link", "attrs": { "href": "javascript:alert(1)" } }],
                    "text": "xss"
                }]
            }]
        })
        .to_string(),
    ] {
        let req = test::TestRequest::put()
            .uri(&format!("/api/cards/{cid}"))
            .set_json(json!({ "description": invalid }))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{invalid}");
    }

    let valid = json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{
                "type": "text",
                "marks": [{ "type": "link", "attrs": { "href": "https://example.com" } }],
                "text": "ok"
            }]
        }]
    })
    .to_string();
    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{cid}"))
        .set_json(json!({ "description": valid }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = read_json_body(test::read_body(resp).await);
    assert_eq!(body["description_text"], "ok");

    // Empty string clears the description.
    let req = test::TestRequest::put()
        .uri(&format!("/api/cards/{cid}"))
        .set_json(json!({ "description": "" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[actix_web::test]
async fn rejects_empty_titles_invalid_colors_dates_checklists_filenames_and_ids() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (bid, lid, cid) = seed_board_list_card!(app);
    let label: Value = post_json!(
        app,
        &format!("/api/boards/{bid}/labels"),
        json!({ "name": "Valid" })
    );
    let label_id = label["id"].as_str().unwrap();

    // Empty / whitespace-only titles and names -> 400.
    for empty in ["", "   "] {
        for (method, uri, body) in [
            ("POST", "/api/boards".to_string(), json!({ "title": empty })),
            (
                "PUT",
                format!("/api/boards/{bid}"),
                json!({ "title": empty }),
            ),
            (
                "POST",
                format!("/api/boards/{bid}/lists"),
                json!({ "title": empty }),
            ),
            (
                "PUT",
                format!("/api/lists/{lid}"),
                json!({ "title": empty }),
            ),
            (
                "POST",
                format!("/api/lists/{lid}/cards"),
                json!({ "title": empty }),
            ),
            (
                "PUT",
                format!("/api/cards/{cid}"),
                json!({ "title": empty }),
            ),
            (
                "POST",
                format!("/api/boards/{bid}/labels"),
                json!({ "name": empty }),
            ),
            (
                "PUT",
                format!("/api/labels/{label_id}"),
                json!({ "name": empty }),
            ),
        ] {
            let req = match method {
                "POST" => test::TestRequest::post().uri(&uri).set_json(body),
                _ => test::TestRequest::put().uri(&uri).set_json(body),
            }
            .to_request();
            let resp = test::call_service(&app, req).await;
            assert_eq!(
                resp.status(),
                StatusCode::BAD_REQUEST,
                "{method} {uri} {empty:?}"
            );
        }
    }

    // Board color validation + null reset.
    for bad_color in ["red", "#12345", "#1234567", "#gggggg", ""] {
        let req = test::TestRequest::put()
            .uri(&format!("/api/boards/{bid}"))
            .set_json(json!({ "color": bad_color }))
            .to_request();
        assert_eq!(
            test::call_service(&app, req).await.status(),
            StatusCode::BAD_REQUEST,
            "{bad_color}"
        );
    }
    let req = test::TestRequest::put()
        .uri(&format!("/api/boards/{bid}"))
        .set_json(json!({ "color": "#112233" }))
        .to_request();
    let updated = read_json_body(test::read_body(test::call_service(&app, req).await).await);
    assert_eq!(updated["color"], "#112233");

    let req = test::TestRequest::put()
        .uri(&format!("/api/boards/{bid}"))
        .set_json(json!({ "color": null }))
        .to_request();
    let cleared = read_json_body(test::read_body(test::call_service(&app, req).await).await);
    assert!(cleared.get("color").is_none());

    // Calendar date validation on due_date and ?today=.
    for bad_date in ["2025-02-29", "2026-02-30", "2026-04-31"] {
        let req = test::TestRequest::put()
            .uri(&format!("/api/cards/{cid}"))
            .set_json(json!({ "due_date": bad_date }))
            .to_request();
        assert_eq!(
            test::call_service(&app, req).await.status(),
            StatusCode::BAD_REQUEST
        );
        let req = test::TestRequest::get()
            .uri(&format!("/api/boards?today={bad_date}"))
            .to_request();
        assert_eq!(
            test::call_service(&app, req).await.status(),
            StatusCode::BAD_REQUEST
        );
    }

    // Card creation prunes unknown label_ids and deduplicates valid ones.
    let created: Value = post_json!(
        app,
        &format!("/api/lists/{lid}/cards"),
        json!({ "title": "Pruned", "label_ids": [label_id, "unknown-id", label_id] })
    );
    assert_eq!(created["label_ids"], json!([label_id]));

    // Checklist validation (empty id/text or duplicate ids).
    for bad_checklist in [
        json!([{ "id": "", "text": "step", "done": false }]),
        json!([{ "id": "1", "text": "   ", "done": false }]),
        json!([
            { "id": "dup", "text": "a", "done": false },
            { "id": "dup", "text": "b", "done": true }
        ]),
    ] {
        let req = test::TestRequest::put()
            .uri(&format!("/api/cards/{cid}"))
            .set_json(json!({ "checklist": bad_checklist }))
            .to_request();
        assert_eq!(
            test::call_service(&app, req).await.status(),
            StatusCode::BAD_REQUEST
        );
    }

    // Attachment filename validation and safe Content-Disposition.
    let req = test::TestRequest::post()
        .uri(&format!("/api/cards/{cid}/attachments?filename=%20%20"))
        .set_payload(b"x".to_vec())
        .to_request();
    assert_eq!(
        test::call_service(&app, req).await.status(),
        StatusCode::BAD_REQUEST
    );

    let req = test::TestRequest::post()
        .uri(&format!(
            "/api/cards/{cid}/attachments?filename=sub/quote%22file.txt"
        ))
        .insert_header(("content-type", "text/plain"))
        .set_payload(b"x".to_vec())
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let att = read_json_body(test::read_body(resp).await);
    assert_eq!(att["filename"], "quote\"file.txt");
    let att_id = att["id"].as_str().unwrap();

    let req = test::TestRequest::get()
        .uri(&format!("/api/cards/{cid}/attachments/{att_id}"))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let cd = resp
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cd.contains("filename=\"quote_file.txt\""));
    assert!(cd.contains("filename*=UTF-8''quote%22file.txt"));

    // Unsafe IDs rejected with 400.
    for uri in [
        "/api/boards/bad.id".to_string(),
        format!("/api/cards/{cid}/attachments/bad.id"),
    ] {
        let req = test::TestRequest::get().uri(&uri).to_request();
        assert_eq!(
            test::call_service(&app, req).await.status(),
            StatusCode::BAD_REQUEST,
            "{uri}"
        );
    }
}
