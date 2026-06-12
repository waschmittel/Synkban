use serde::{Deserialize, Deserializer, Serialize};

/// Distinguishes "field absent" (None) from "field is null" (Some(None)) during deserialization.
/// Plain `Option<Option<T>>` collapses both to None, so we wrap the inner Option in Some(_) here.
fn deserialize_double_option<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub done: bool,
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
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub position: f64,
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
    /// Plain-text view of `description`, computed server-side from the ProseMirror
    /// doc JSON. Used by the frontend filter so it doesn't have to substring-match
    /// the raw JSON (where node type names like "paragraph" would false-match).
    #[serde(default)]
    pub description_text: String,
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
    #[serde(default)]
    pub checklist: Vec<ChecklistItem>,
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
    /// Per-board mtimes so clients can refetch only the board they're viewing
    /// when another board changes. Same total work as the global `mtime`,
    /// just bucketed.
    pub boards: std::collections::HashMap<String, u64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoard {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBoard {
    pub title: Option<String>,
    pub color: Option<String>,
    pub archived: Option<bool>,
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
    #[serde(default, deserialize_with = "deserialize_double_option")]
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
pub struct CreateChecklistItem {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChecklistItem {
    pub text: Option<String>,
    pub done: Option<bool>,
    pub pos: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct SetChecklistAll {
    pub done: bool,
}

#[derive(Debug, Deserialize)]
pub struct AttachmentQuery {
    pub filename: String,
}

#[derive(Debug, Deserialize)]
pub struct ReorderBoards {
    pub ids: Vec<String>,
}
