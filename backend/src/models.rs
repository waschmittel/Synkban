use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub content_type: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub title: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
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
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BoardDetail {
    pub id: String,
    pub title: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub labels: Vec<Label>,
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

#[derive(Debug, Serialize)]
pub struct ChangeCheck {
    pub mtime: u64,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoard {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBoard {
    pub title: String,
    pub color: Option<String>,
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
    pub label_ids: Option<Vec<String>>,
    pub archived: Option<bool>,
    #[serde(default)]
    pub due_date: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLabel {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLabel {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct AttachmentQuery {
    pub filename: String,
}
