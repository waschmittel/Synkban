//! Inline image references in a description (ADR-0020): `image` nodes whose
//! `attrs.att` names an attachment of the same card. Dangling ones are
//! dropped on write, so stored references stay valid.

use std::collections::HashSet;

use serde_json::Value;

/// Attachment ids the description references inline. Ids that are not a safe
/// path segment (hand-edited or synced files) are skipped, since callers join
/// them onto the attachment dir.
pub(crate) fn referenced_ids(description: &str) -> HashSet<String> {
    fn walk(node: &Value, out: &mut HashSet<String>) {
        if node.get("type").and_then(Value::as_str) == Some("image") {
            if let Some(a) = node
                .pointer("/attrs/att")
                .and_then(Value::as_str)
                .filter(|a| crate::store::paths::check_id(a).is_ok())
            {
                out.insert(a.to_string());
            }
        }
        for c in node
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            walk(c, out);
        }
    }
    let mut out = HashSet::new();
    if description.contains("\"image\"") {
        if let Ok(doc) = serde_json::from_str::<Value>(description) {
            walk(&doc, &mut out);
        }
    }
    out
}

/// `description` without the image nodes whose attachment isn't in `keep`;
/// `None` when nothing was removed (or it is not a JSON document).
pub(crate) fn prune_image_refs(description: &str, keep: &HashSet<String>) -> Option<String> {
    if !description.contains("\"image\"") {
        return None;
    }
    let mut doc: Value = serde_json::from_str(description).ok()?;
    prune(&mut doc, keep).then(|| doc.to_string())
}

fn prune(node: &mut Value, keep: &HashSet<String>) -> bool {
    let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) else {
        return false;
    };
    let before = children.len();
    children.retain(|c| {
        c.get("type").and_then(Value::as_str) != Some("image")
            || c.pointer("/attrs/att")
                .and_then(Value::as_str)
                .is_some_and(|a| keep.contains(a))
    });
    let mut changed = children.len() != before;
    for c in children.iter_mut() {
        changed |= prune(c, keep);
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keep(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    const DOC: &str = r#"{"type":"doc","content":[
        {"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"image","attrs":{"att":"x","alt":"x.png"}}]},
        {"type":"bullet_list","content":[{"type":"list_item","content":[{"type":"paragraph","content":[
            {"type":"image","attrs":{"att":"y","alt":"y.png"}}]}]}]}]}"#;

    #[test]
    fn keeps_valid_references_untouched() {
        assert_eq!(prune_image_refs(DOC, &keep(&["x", "y"])), None);
    }

    #[test]
    fn drops_dangling_references_at_any_depth() {
        let out = prune_image_refs(DOC, &keep(&["x"])).unwrap();
        assert!(out.contains("\"att\":\"x\"") && !out.contains("\"att\":\"y\""));
        let out = prune_image_refs(DOC, &keep(&[])).unwrap();
        assert!(!out.contains("\"image\""));
        assert!(out.contains("\"text\":\"a\""));
    }

    #[test]
    fn drops_images_without_an_attachment_id() {
        let doc = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{}}]}]}"#;
        assert!(prune_image_refs(doc, &keep(&["x"])).is_some());
    }

    #[test]
    fn lists_referenced_ids() {
        assert_eq!(referenced_ids(DOC), keep(&["x", "y"]));
        assert!(referenced_ids("plain").is_empty());
    }

    #[test]
    fn skips_unsafe_referenced_ids() {
        for bad in ["../../secret", "/etc/passwd", "a\\\\b", "C:x", ""] {
            let doc = format!(
                r#"{{"type":"doc","content":[{{"type":"image","attrs":{{"att":"{bad}"}}}},{{"type":"image","attrs":{{"att":"ok-1"}}}}]}}"#
            );
            assert_eq!(referenced_ids(&doc), keep(&["ok-1"]), "{bad}");
        }
    }

    #[test]
    fn ignores_plain_text_and_garbage() {
        assert_eq!(prune_image_refs("an \"image\" in text", &keep(&[])), None);
        assert_eq!(prune_image_refs("", &keep(&[])), None);
    }
}
