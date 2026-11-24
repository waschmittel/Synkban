//! Canonical path validation and cross-OS attachment filename resolution
//! for the Readable Mirror (ADR-0035).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::errors::AppError;
use crate::models::Attachment;

const WINDOWS_RESERVED_STEMS: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Resolves `path` to an absolute canonical path even when its trailing
/// directories do not exist yet (walks up to the deepest existing ancestor,
/// canonicalizes it so symlinks and Windows `\\?\` prefixes match, then
/// re-attaches remaining non-traversal components).
pub fn resolve_canonical(path: &Path) -> io::Result<PathBuf> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };

    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut probe = abs.as_path();
    let base = loop {
        if probe.exists() {
            break std::fs::canonicalize(probe)?;
        }
        let Some(name) = probe.file_name() else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("no existing ancestor for {}", abs.display()),
            ));
        };
        tail.push(name.to_os_string());
        probe = probe.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("no existing parent for {}", abs.display()),
            )
        })?;
    };

    let mut tail_rel = PathBuf::new();
    for seg in tail.into_iter().rev() {
        tail_rel.push(seg);
    }

    let mut normalized_tail: Vec<std::ffi::OsString> = Vec::new();
    for comp in tail_rel.components() {
        match comp {
            Component::CurDir => {}
            Component::Normal(s) => normalized_tail.push(s.to_os_string()),
            Component::ParentDir => {
                if normalized_tail.pop().is_none() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "mirror path must not traverse above an existing ancestor",
                    ));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "unexpected root component in relative tail",
                ));
            }
        }
    }

    let mut out = base;
    for seg in normalized_tail {
        out.push(seg);
    }
    Ok(out)
}

/// Validates that `mirror_dir` is safe to write and prune:
/// - non-empty and not a filesystem root
/// - does not equal, contain, or live inside `data_dir` or `config_dir`
/// - if it already exists without `.synkban-mirror.json`, must be a directory
///   without pre-existing `README.md`, `index.html`, `style.css`, or `boards/`
pub fn validate_mirror_dir(
    mirror_dir: &Path,
    data_dir: &Path,
    config_dir: &Path,
) -> Result<PathBuf, AppError> {
    if mirror_dir.as_os_str().is_empty() || mirror_dir.to_str().is_some_and(|s| s.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "Mirror folder path must not be empty".into(),
        ));
    }

    let mirror_canon = resolve_canonical(mirror_dir)
        .map_err(|e| AppError::BadRequest(format!("Invalid mirror folder: {e}")))?;
    let data_canon = resolve_canonical(data_dir)
        .map_err(|e| AppError::BadRequest(format!("Invalid data folder: {e}")))?;
    let config_canon = resolve_canonical(config_dir)
        .map_err(|e| AppError::BadRequest(format!("Invalid config folder: {e}")))?;

    if mirror_canon.parent().is_none() {
        return Err(AppError::BadRequest(
            "Mirror folder cannot be the filesystem root".into(),
        ));
    }
    if mirror_canon.starts_with(&data_canon) || data_canon.starts_with(&mirror_canon) {
        return Err(AppError::BadRequest(
            "Mirror folder must not be the same as or overlap the data folder".into(),
        ));
    }
    if mirror_canon.starts_with(&config_canon) || config_canon.starts_with(&mirror_canon) {
        return Err(AppError::BadRequest(
            "Mirror folder must not be the same as or overlap the config folder".into(),
        ));
    }

    if mirror_canon.exists() {
        if !mirror_canon.is_dir() {
            return Err(AppError::BadRequest(
                "Mirror path is a file, not a folder".into(),
            ));
        }
        if !mirror_canon.join(".synkban-mirror.json").exists() {
            for reserved in ["README.md", "index.html", "style.css", "boards"] {
                if mirror_canon.join(reserved).exists() {
                    return Err(AppError::BadRequest(
                        "Chosen folder already contains files (index.html, README.md, style.css, or boards/) without a Synkban mirror manifest; pick an empty folder or an existing Synkban mirror".into(),
                    ));
                }
            }
        }
    }

    Ok(mirror_canon)
}

/// True when `name` can be stored verbatim across macOS, Linux, and Windows:
/// `1..=64` ASCII bytes, `[A-Za-z0-9._-]` only, alphanumeric first and last
/// byte, no `..`, and stem before the first `.` is not a Windows device name.
pub fn is_simple_filename(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    if !bytes[0].is_ascii_alphanumeric() || !bytes[bytes.len() - 1].is_ascii_alphanumeric() {
        return false;
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'_' || *b == b'-')
    {
        return false;
    }
    if name.contains("..") {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    !WINDOWS_RESERVED_STEMS.contains(&stem.as_str())
}

fn valid_ext_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg.len() <= 10
        && seg.bytes().all(|b| b.is_ascii_alphanumeric())
        && seg.bytes().any(|b| b.is_ascii_alphabetic())
}

fn is_compound_pair(inner: &str, outer: &str) -> bool {
    matches!(
        outer,
        "gz" | "bz2" | "xz" | "zst" | "lz4" | "br" | "z" | "lz" | "lzma" | "gpg" | "asc" | "sig"
    ) || matches!(
        (inner, outer),
        ("d", "ts")
            | ("d", "mts")
            | ("d", "cts")
            | ("min", "js")
            | ("min", "css")
            | ("drawio", "png")
            | ("drawio", "svg")
            | ("excalidraw", "png")
            | ("excalidraw", "svg")
            | ("tar", "7z")
    )
}

fn ext_from_content_type(content_type: &str) -> &'static str {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "image/png" => ".png",
        "image/jpeg" | "image/jpg" => ".jpg",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/svg+xml" => ".svg",
        "image/bmp" => ".bmp",
        "image/avif" => ".avif",
        "application/pdf" => ".pdf",
        "text/plain" => ".txt",
        "text/markdown" => ".md",
        "text/csv" => ".csv",
        "text/html" => ".html",
        "application/json" => ".json",
        "application/zip" => ".zip",
        "application/gzip" | "application/x-gzip" => ".gz",
        _ => "",
    }
}

/// Extracts a safe lowercase extension (preserving compound extensions like
/// `.tar.gz`, `.sql.zst`, `.d.ts`, `.drawio.svg`) for fallback `<att-id>.<ext>`
/// naming, falling back to `content_type` when the filename has none.
pub fn extract_fallback_ext(filename: &str, content_type: &str) -> String {
    let parts: Vec<&str> = filename.split('.').collect();
    if parts.len() >= 2 && !parts[0].is_empty() {
        let last = parts[parts.len() - 1].to_ascii_lowercase();
        if valid_ext_segment(&last) {
            if parts.len() >= 3 {
                let prev = parts[parts.len() - 2].to_ascii_lowercase();
                if valid_ext_segment(&prev) && is_compound_pair(&prev, &last) {
                    return format!(".{prev}.{last}");
                }
            }
            return format!(".{last}");
        }
    }
    ext_from_content_type(content_type).to_string()
}

/// Assigns deterministic, cross-OS-safe, collision-free filenames under
/// `attachments/` for every attachment on a card, preserving simple unique
/// filenames verbatim and falling back to `<att-id><ext>` otherwise.
pub fn assign_attachment_filenames(attachments: &[Attachment]) -> BTreeMap<String, String> {
    let mut ordered: Vec<&Attachment> = attachments.iter().collect();
    ordered.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut fallbacks: HashMap<&str, String> = HashMap::with_capacity(ordered.len());
    let mut reserved_fallbacks_lower: HashSet<String> = HashSet::with_capacity(ordered.len());
    for att in &ordered {
        let ext = extract_fallback_ext(&att.filename, &att.content_type);
        let fb = format!("{}{}", att.id, ext);
        reserved_fallbacks_lower.insert(fb.to_ascii_lowercase());
        fallbacks.insert(att.id.as_str(), fb);
    }

    let mut claimed_lower: HashSet<String> = HashSet::with_capacity(ordered.len());
    let mut out = BTreeMap::new();
    for att in ordered {
        let cand_low = att.filename.to_ascii_lowercase();
        let chosen = if is_simple_filename(&att.filename)
            && !claimed_lower.contains(&cand_low)
            && !reserved_fallbacks_lower.contains(&cand_low)
        {
            att.filename.clone()
        } else {
            fallbacks[att.id.as_str()].clone()
        };
        claimed_lower.insert(chosen.to_ascii_lowercase());
        out.insert(att.id.clone(), chosen);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn att(id: &str, filename: &str, content_type: &str, created_at: &str) -> Attachment {
        Attachment {
            id: id.into(),
            filename: filename.into(),
            size: 10,
            content_type: content_type.into(),
            created_at: created_at.into(),
        }
    }

    #[test]
    fn simple_filename_rules() {
        assert!(is_simple_filename("budget-2026.pdf"));
        assert!(is_simple_filename("release-1.0.tar.gz"));
        assert!(is_simple_filename("a"));
        assert!(is_simple_filename(&"x".repeat(64)));

        assert!(!is_simple_filename(""));
        assert!(!is_simple_filename(&"x".repeat(65)));
        assert!(!is_simple_filename("my file.pdf"));
        assert!(!is_simple_filename("report(1).pdf"));
        assert!(!is_simple_filename(".env"));
        assert!(!is_simple_filename("-flag.txt"));
        assert!(!is_simple_filename("trailing."));
        assert!(!is_simple_filename("a..b.txt"));
        assert!(!is_simple_filename("CON.txt"));
        assert!(!is_simple_filename("aux.tar.gz"));
        assert!(!is_simple_filename("LPT9.log"));
        assert!(!is_simple_filename("café.png"));
    }

    #[test]
    fn fallback_extension_handles_multi_dot_and_versions() {
        assert_eq!(
            extract_fallback_ext("Backup (Nov 2026).tar.gz", "application/gzip"),
            ".tar.gz"
        );
        assert_eq!(
            extract_fallback_ext("db (prod).sql.zst", "application/octet-stream"),
            ".sql.zst"
        );
        assert_eq!(
            extract_fallback_ext("architecture (v2).drawio.svg", "image/svg+xml"),
            ".drawio.svg"
        );
        assert_eq!(
            extract_fallback_ext("types (public).d.ts", "text/plain"),
            ".d.ts"
        );
        // Version numbers are NOT compound extensions
        assert_eq!(
            extract_fallback_ext("01. Project Spec v2.1.pdf", "application/pdf"),
            ".pdf"
        );
        assert_eq!(extract_fallback_ext("pasted image", "image/png"), ".png");
        assert_eq!(extract_fallback_ext(".hidden", "text/plain"), ".txt");
        assert_eq!(extract_fallback_ext("blob", "application/octet-stream"), "");
    }

    #[test]
    fn attachment_filenames_handle_case_collisions_and_fallbacks() {
        let list = vec![
            att("id-2", "Diagram.png", "image/png", "2026-01-02 00:00:00"),
            att("id-1", "diagram.png", "image/png", "2026-01-01 00:00:00"),
            att(
                "id-3",
                "Q4 Release (final).tar.gz",
                "application/gzip",
                "2026-01-03 00:00:00",
            ),
            att(
                "id-4",
                "aux.tar.gz",
                "application/gzip",
                "2026-01-04 00:00:00",
            ),
        ];
        let map = assign_attachment_filenames(&list);
        assert_eq!(map["id-1"], "diagram.png");
        assert_eq!(map["id-2"], "id-2.png");
        assert_eq!(map["id-3"], "id-3.tar.gz");
        assert_eq!(map["id-4"], "id-4.tar.gz");
    }

    #[test]
    fn validate_mirror_dir_rejects_overlaps_and_non_empty_unmanifested() {
        let base = TempDir::new().unwrap();
        let data = base.path().join("data");
        let cfg = base.path().join("config");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&cfg).unwrap();

        // Overlap with data_dir (same, child, parent)
        assert!(validate_mirror_dir(&data, &data, &cfg).is_err());
        assert!(validate_mirror_dir(&data.join("mirror"), &data, &cfg).is_err());
        assert!(validate_mirror_dir(base.path(), &data, &cfg).is_err());

        // Overlap with config_dir
        assert!(validate_mirror_dir(&cfg, &data, &cfg).is_err());
        assert!(validate_mirror_dir(&cfg.join("sub"), &data, &cfg).is_err());

        // Non-empty without manifest colliding on index.html
        let foreign = base.path().join("foreign");
        std::fs::create_dir_all(&foreign).unwrap();
        std::fs::write(foreign.join("index.html"), b"<html></html>").unwrap();
        assert!(validate_mirror_dir(&foreign, &data, &cfg).is_err());

        // Valid empty or not-yet-created dir
        let valid = base.path().join("mirror/nested");
        assert!(validate_mirror_dir(&valid, &data, &cfg).is_ok());

        // Existing folder with non-conflicting user file is allowed
        let with_notes = base.path().join("with_notes");
        std::fs::create_dir_all(&with_notes).unwrap();
        std::fs::write(with_notes.join("notes.txt"), b"keep me").unwrap();
        assert!(validate_mirror_dir(&with_notes, &data, &cfg).is_ok());

        // Existing folder with manifest is allowed even if index.html exists
        std::fs::write(foreign.join(".synkban-mirror.json"), b"{}").unwrap();
        assert!(validate_mirror_dir(&foreign, &data, &cfg).is_ok());
    }
}
