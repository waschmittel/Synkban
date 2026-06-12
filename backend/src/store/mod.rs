//! File-based storage. Each entity lives in its own submodule; this module
//! is just a flat re-export so handlers can keep calling `store::create_card`
//! etc. without caring about the internal layout.

pub mod attachments;
pub mod boards;
pub mod card_index;
pub mod cards;
pub mod checklist;
pub mod io;
pub mod labels;
pub mod lists;
pub mod paths;

pub use attachments::{create_attachment, delete_attachment, get_attachment_data, get_thumbnail_data};
pub use boards::{
    create_board, delete_board, get_board, list_archived_boards, list_boards, reorder_boards,
    update_board,
};
pub use cards::{create_card, delete_card, get_archived_cards, update_card};
pub use checklist::{
    create_checklist_item, delete_checklist_item, set_checklist_all, update_checklist_item,
};
pub use io::{audit_op, drain_file_ops, get_latest_mtime, get_per_board_mtimes};
pub use labels::{create_label, delete_label, delete_label_by_id, update_label, update_label_by_id};
pub use lists::{create_list, delete_list, update_list};
