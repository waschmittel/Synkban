//! HTTP-level integration tests for the Synkban backend.
//! Covers error paths that store-level tests can't exercise (400/413 wiring,
//! token middleware, header capture, query parsing).

use actix_web::{cookie::Cookie, dev::Service, dev::ServiceResponse, http::StatusCode, test, web, App};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::TempDir;

fn data_app_data(dir: &PathBuf) -> web::Data<PathBuf> {
    web::Data::new(dir.clone())
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
                let (authorized, needs_cookie) = synkban::check_token_auth(
                    cookie_value.as_deref(),
                    &query,
                    token.as_str(),
                );
                let fut = srv.call(req);
                async move {
                    if !authorized {
                        return Err(actix_web::error::ErrorForbidden(""));
                    }
                    let mut res: ServiceResponse = fut.await?;
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
            .app_data(data_app_data($data_dir))
            .configure(synkban::configure_routes)
    }};
}

/// Posts JSON, asserts success, returns parsed response body.
macro_rules! post_json {
    ($app:expr, $uri:expr, $body:expr) => {{
        let req = test::TestRequest::post().uri($uri).set_json($body).to_request();
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

    let req = test::TestRequest::put().uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "due_date": "2025-06-15" })).to_request();
    test::call_service(&app, req).await;

    let req = test::TestRequest::put().uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "due_date": null })).to_request();
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
        .uri(&format!("/api/cards/{}/attachments?filename=my%20doc.pdf", cid))
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

    let req = test::TestRequest::delete().uri(&format!("/api/boards/{}", bid)).to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn delete_unarchived_card_returns_400() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;
    let (_, _, cid) = seed_board_list_card!(app);

    let req = test::TestRequest::delete().uri(&format!("/api/cards/{}", cid)).to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn get_missing_board_returns_404() {
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path().to_path_buf();
    let app = test::init_service(make_app!(&dir_path)).await;

    let req = test::TestRequest::get().uri("/api/boards/nonexistent").to_request();
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

    let req = test::TestRequest::delete().uri(&format!("/api/lists/{}", lid)).to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = test::TestRequest::put().uri(&format!("/api/cards/{}", cid))
        .set_json(json!({ "archived": false })).to_request();
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

    let _: Value = post_json!(app, "/api/boards", json!({ "title": "B" }));
    let req = test::TestRequest::get().uri("/api/changes").to_request();
    let resp = test::call_service(&app, req).await;
    let json = read_json_body(test::read_body(resp).await);
    assert!(json["mtime"].as_u64().unwrap() > 0);
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
                assert_eq!(status, StatusCode::FORBIDDEN, "expected 403, got {}", status);
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
    assert!(resp.headers().get(actix_web::http::header::SET_COOKIE).is_none());
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
