//! Read-only workspace snapshot for the Readable Mirror exporter (ADR-0035).

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;

use crate::errors::AppError;
use crate::models::{BoardMode, Card, Label};
use crate::store::{attachments, io, walk};

#[derive(Debug, Clone)]
pub struct MirrorSnapshot {
    pub active_boards: Vec<MirrorBoard>,
    pub archived_boards: Vec<MirrorBoard>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct MirrorBoard {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub color: Option<String>,
    pub archived: bool,
    pub archived_at: Option<String>,
    pub position: f64,
    pub mode: BoardMode,
    pub labels: Vec<Label>,
    pub lists: Vec<MirrorList>,
    pub archived_cards: Vec<MirrorArchivedCard>,
}

#[derive(Debug, Clone)]
pub struct MirrorList {
    pub id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone)]
pub struct MirrorArchivedCard {
    pub card: Card,
    pub origin_list_title: Option<String>,
}

fn cmp_pos(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

/// Gather every board (active and archived), list, active card, archived card,
/// and attachment metadata from `data_dir` in deterministic UI order, along
/// with any corrupt-file warnings encountered while walking the tree.
pub fn snapshot_for_mirror(data_dir: &Path) -> Result<MirrorSnapshot, AppError> {
    let _ = io::drain_warnings();

    let board_files = walk::board_files(data_dir)?;
    let mut active_boards = Vec::new();
    let mut archived_boards = Vec::new();

    for bf in board_files {
        let mut raw_lists = walk::lists(data_dir, &bf.id)?;
        raw_lists.sort_by(|a, b| {
            cmp_pos(a.position, b.position)
                .then_with(|| a.created_at.cmp(&b.created_at))
                .then_with(|| a.id.cmp(&b.id))
        });

        let list_titles: HashMap<String, String> = raw_lists
            .iter()
            .map(|l| (l.id.clone(), l.title.clone()))
            .collect();

        let mut lists = Vec::with_capacity(raw_lists.len());
        let mut archived_cards = Vec::new();

        for list in raw_lists {
            let mut active = Vec::new();
            for mut card in walk::cards(data_dir, &bf.id, &list.id)? {
                card.attachments = attachments::load_attachments(data_dir, &bf.id, &card.id);
                if card.archived {
                    let origin_list_title = list_titles.get(&card.list_id).cloned();
                    archived_cards.push(MirrorArchivedCard {
                        card,
                        origin_list_title,
                    });
                } else {
                    active.push(card);
                }
            }
            active.sort_by(|a, b| {
                cmp_pos(a.position, b.position)
                    .then_with(|| a.created_at.cmp(&b.created_at))
                    .then_with(|| a.id.cmp(&b.id))
            });
            lists.push(MirrorList {
                id: list.id,
                title: list.title,
                position: list.position,
                created_at: list.created_at,
                cards: active,
            });
        }

        for mut card in walk::orphaned_cards(data_dir, &bf.id)? {
            card.attachments = attachments::load_attachments(data_dir, &bf.id, &card.id);
            archived_cards.push(MirrorArchivedCard {
                card,
                origin_list_title: None,
            });
        }

        archived_cards.sort_by(|a, b| {
            let ka = a.card.archived_at.as_deref().unwrap_or(&a.card.created_at);
            let kb = b.card.archived_at.as_deref().unwrap_or(&b.card.created_at);
            kb.cmp(ka).then_with(|| a.card.id.cmp(&b.card.id))
        });

        // Catch corrupt attachment sidecars even if not loaded via a card dir.
        walk::scan_attachment_sidecars(data_dir, &bf.id);

        let board = MirrorBoard {
            id: bf.id,
            title: bf.title,
            created_at: bf.created_at,
            color: bf.color,
            archived: bf.archived,
            archived_at: bf.archived_at,
            position: bf.position,
            mode: bf.mode,
            labels: bf.labels,
            lists,
            archived_cards,
        };
        if board.archived {
            archived_boards.push(board);
        } else {
            active_boards.push(board);
        }
    }

    active_boards.sort_by(|a, b| {
        cmp_pos(a.position, b.position)
            .then_with(|| b.created_at.cmp(&a.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    archived_boards.sort_by(|a, b| {
        let ka = a.archived_at.as_deref().unwrap_or(&a.created_at);
        let kb = b.archived_at.as_deref().unwrap_or(&b.created_at);
        kb.cmp(ka).then_with(|| a.id.cmp(&b.id))
    });

    let mut warnings = io::drain_warnings();
    warnings.sort();
    warnings.dedup();

    Ok(MirrorSnapshot {
        active_boards,
        archived_boards,
        warnings,
    })
}
