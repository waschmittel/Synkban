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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// How a board is laid out (ADR-0022). Stored per board, synced with it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoardMode {
    #[default]
    Kanban,
    Notes,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub mode: BoardMode,
    /// Only in `GET /api/boards` (home tiles).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<BoardStats>,
}

/// Home tile summary of a board.
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BoardStats {
    /// Active (non-archived) cards.
    pub cards: usize,
    /// Active cards due before `today` (0 without `today`).
    pub overdue: usize,
    /// Newest file mtime in the board directory, ms since the epoch.
    pub edited_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct BoardsQuery {
    /// The client's local date, `YYYY-MM-DD`: what "overdue" is measured against.
    pub today: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct List {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
    /// Shown as a narrow strip in the board view.
    #[serde(default)]
    pub collapsed: bool,
}

/// The user-editable content of a card — what the change history tracks.
/// Position, list, archive state and timestamps are not content. Attachments
/// are recorded by filename only (the blobs live in sidecar files).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardContent {
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub checklist: Vec<ChecklistItem>,
    #[serde(default)]
    pub attachments: Vec<String>,
}

/// One version of a card's content and when it became current.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub at: String,
    #[serde(flatten)]
    pub content: CardContent,
}

/// `GET /api/cards/:id/history`: the card's content now, plus its recorded
/// versions newest first.
#[derive(Debug, Serialize)]
pub struct CardHistory {
    pub current: CardContent,
    pub entries: Vec<HistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default)]
    pub checklist: Vec<ChecklistItem>,
    /// Last `HISTORY_LIMIT` versions, oldest first. Persisted in the card file
    /// but stripped from API responses (served by `GET /cards/:id/history`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<HistoryEntry>,
}

#[derive(Debug, Serialize)]
pub struct BoardDetail {
    pub id: String,
    pub title: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub labels: Vec<Label>,
    pub mode: BoardMode,
    pub lists: Vec<ListWithCards>,
}

#[derive(Debug, Serialize)]
pub struct ListWithCards {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
    pub collapsed: bool,
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

#[derive(Debug, Serialize)]
pub struct WarningList {
    /// Human-readable data-integrity warnings (e.g. corrupt files the walker
    /// skipped). Empty when everything parsed cleanly.
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoard {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBoard {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub color: Option<Option<String>>,
    pub archived: Option<bool>,
    pub mode: Option<BoardMode>,
}

#[derive(Debug, Deserialize)]
pub struct CreateList {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateList {
    pub title: Option<String>,
    pub position: Option<f64>,
    pub collapsed: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCard {
    pub title: String,
    /// Quick-add tokens (`#label`, `due:`), set without a history entry.
    #[serde(default)]
    pub label_ids: Vec<String>,
    pub due_date: Option<String>,
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
    pub checklist: Option<Vec<ChecklistItem>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLabel {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderLabels {
    pub ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLabel {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    /// Required (true) when the name matches another label: merging is destructive.
    #[serde(default)]
    pub merge: bool,
}

#[derive(Debug, Deserialize)]
pub struct AttachmentQuery {
    pub filename: String,
}

#[derive(Debug, Deserialize)]
pub struct CopyAttachment {
    pub from_card: String,
    pub att_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ReorderBoards {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MirrorStatus {
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_succeeded_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_attempt_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cards_mirrored: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    pub startup_view: String,
    /// "system" | "light" | "dark"
    pub theme: String,
    pub last_board_id: Option<String>,
    /// Effective data dir of the running server (may come from CLI/env).
    pub data_dir: String,
    /// data_dir as stored in synkban.toml, if set.
    pub configured_data_dir: Option<String>,
    pub default_data_dir: String,
    /// Desktop-only readable mirror folder (`None` in Web Mode).
    pub mirror_dir: Option<String>,
    /// Desktop-only readable mirror schedule: "off" | "daily" | "weekly" ("off" in Web Mode).
    pub mirror_schedule: String,
    /// Desktop-only live/persisted readable mirror status (`None` in Web Mode).
    pub mirror_status: Option<MirrorStatus>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettings {
    pub startup_view: Option<String>,
    /// "system" | "light" | "dark"; absent leaves the current value unchanged.
    pub theme: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub last_board_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub data_dir: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub mirror_dir: Option<Option<String>>,
    pub mirror_schedule: Option<String>,
}

/// Partial card update; `None` leaves a field unchanged.
#[derive(Default)]
pub struct CardPatch<'a> {
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub position: Option<f64>,
    pub list_id: Option<&'a str>,
    pub label_ids: Option<&'a [String]>,
    pub archived: Option<bool>,
    /// `Some(None)` clears the due date.
    pub due_date: Option<Option<&'a str>>,
    pub checklist: Option<Vec<ChecklistItem>>,
}
