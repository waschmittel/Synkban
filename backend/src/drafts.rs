//! Crash safety for the one open card (ADR-0024): its unsaved edits, kept so
//! they reopen after the app closed unexpectedly. Exactly one draft at a time
//! — only one card can be open — in `config_dir()/draft.json`, beside
//! `synkban.toml`, not in the synced data dir; localStorage can't hold it
//! (random desktop port). The content is the client's: the server only
//! stores it.

use std::fs;
use std::io;
use std::path::Path;

const FILE: &str = "draft.json";

fn check_id(id: &str) -> io::Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    ok.then_some(())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid card id"))
}

/// The draft, if any (an unreadable file counts as none).
pub fn get(dir: &Path) -> Option<serde_json::Value> {
    serde_json::from_slice(&fs::read(dir.join(FILE)).ok()?).ok()
}

/// Stores `draft` (an object) for `card_id`, replacing any other card's
/// draft; atomic like `write_json`.
pub fn save(dir: &Path, card_id: &str, mut draft: serde_json::Value) -> io::Result<()> {
    check_id(card_id)?;
    let obj = draft
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "draft must be an object"))?;
    obj.insert("card_id".into(), card_id.into());
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{FILE}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&tmp, serde_json::to_vec(&draft)?)?;
    fs::rename(&tmp, dir.join(FILE)).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Removes the draft if it is `card_id`'s: a card closing never drops
/// another card's draft. Nothing to remove is fine.
pub fn remove(dir: &Path, card_id: &str) -> io::Result<()> {
    check_id(card_id)?;
    if get(dir).is_some_and(|d| d["card_id"] != card_id) {
        return Ok(());
    }
    match fs::remove_file(dir.join(FILE)) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn one_draft_at_a_time() {
        let d = tempfile::TempDir::new().unwrap();
        let dir = d.path().join("cfg");
        assert!(get(&dir).is_none());
        save(
            &dir,
            "abc-1",
            json!({ "board_id": "b", "draft": { "title": "T" } }),
        )
        .unwrap();
        save(
            &dir,
            "abc-1",
            json!({ "board_id": "b", "draft": { "title": "T2" } }),
        )
        .unwrap();
        assert_eq!(get(&dir).unwrap()["draft"]["title"], "T2");
        // Another card replaces it.
        save(&dir, "abc-2", json!({ "board_id": "b" })).unwrap();
        assert_eq!(get(&dir).unwrap()["card_id"], "abc-2");
        // The replaced card closing doesn't drop the current one.
        remove(&dir, "abc-1").unwrap();
        assert_eq!(get(&dir).unwrap()["card_id"], "abc-2");
        remove(&dir, "abc-2").unwrap();
        assert!(get(&dir).is_none());
        remove(&dir, "abc-2").unwrap();
        // Only the draft file: no temp files left behind.
        save(&dir, "abc-3", json!({})).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn rejects_unsafe_ids_and_non_objects_and_ignores_a_corrupt_file() {
        let d = tempfile::TempDir::new().unwrap();
        for id in ["", "../x", "a/b", "a.json", &"x".repeat(65)] {
            assert!(save(d.path(), id, json!({})).is_err(), "{id}");
            assert!(remove(d.path(), id).is_err(), "{id}");
        }
        assert!(save(d.path(), "a", json!([1])).is_err());
        fs::write(d.path().join(FILE), "{").unwrap();
        assert!(get(d.path()).is_none());
        save(d.path(), "ok", json!({})).unwrap();
        assert_eq!(get(d.path()).unwrap()["card_id"], "ok");
    }
}
