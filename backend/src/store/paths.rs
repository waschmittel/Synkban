//! Filesystem path helpers. No I/O — only path construction.

use std::path::{Path, PathBuf};

pub(crate) fn boards_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("boards")
}

pub(crate) fn board_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    boards_dir(data_dir).join(board_id)
}

pub(crate) fn lists_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("lists")
}

pub(crate) fn list_dir(data_dir: &Path, board_id: &str, list_id: &str) -> PathBuf {
    lists_dir(data_dir, board_id).join(list_id)
}

pub(crate) fn cards_dir(data_dir: &Path, board_id: &str, list_id: &str) -> PathBuf {
    list_dir(data_dir, board_id, list_id).join("cards")
}

pub(crate) fn attachment_dir(data_dir: &Path, board_id: &str, card_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("attachments").join(card_id)
}

pub(crate) fn archived_cards_dir(data_dir: &Path, board_id: &str) -> PathBuf {
    board_dir(data_dir, board_id).join("archived_cards")
}
