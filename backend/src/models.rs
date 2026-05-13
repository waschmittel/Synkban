use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct List {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub description: String,
    pub position: f64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct BoardDetail {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub lists: Vec<ListWithCards>,
}

#[derive(Debug, Serialize)]
pub struct ListWithCards {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
    pub cards: Vec<Card>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoard {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBoard {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateList {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateList {
    pub title: Option<String>,
    pub position: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCard {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCard {
    pub title: Option<String>,
    pub description: Option<String>,
    pub position: Option<f64>,
    pub list_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSyncConfig {
    pub enabled: bool,
    pub remote_url: String,
    pub branch: String,
    pub sync_interval_secs: u64,
    pub author_name: String,
    pub author_email: String,
}

impl Default for GitSyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            remote_url: String::new(),
            branch: "main".to_string(),
            sync_interval_secs: 30,
            author_name: "Trello Clone".to_string(),
            author_email: "tc@localhost".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub enabled: bool,
    pub initialized: bool,
    pub last_commit: Option<String>,
    pub last_push: Option<String>,
    pub last_pull: Option<String>,
    pub pending_changes: bool,
    pub error: Option<String>,
}
