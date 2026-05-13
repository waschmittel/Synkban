use actix_web::{HttpResponse, ResponseError};
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    Io(std::io::Error),
    TooLarge,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::NotFound(msg) => write!(f, "Not found: {msg}"),
            AppError::Io(e) => write!(f, "IO error: {e}"),
            AppError::TooLarge => write!(f, "Payload too large"),
        }
    }
}

impl ResponseError for AppError {
    fn error_response(&self) -> HttpResponse {
        match self {
            AppError::NotFound(msg) => {
                HttpResponse::NotFound().json(serde_json::json!({"error": msg}))
            }
            AppError::Io(e) => {
                HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
            }
            AppError::TooLarge => {
                HttpResponse::PayloadTooLarge()
                    .json(serde_json::json!({"error": "File too large (max 50 MB)"}))
            }
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}
