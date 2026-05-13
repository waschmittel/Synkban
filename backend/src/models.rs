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
