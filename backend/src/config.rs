//! App-level configuration file: `~/.config/synkban/synkban.toml`.
//!
//! Holds the configured data directory plus UI settings that must persist
//! server-side: the desktop shell serves the UI from a random port on every
//! launch, and browser localStorage is scoped per origin (scheme+host+port),
//! so nothing stored client-side survives a desktop restart.
//!
//! The config dir is overridable via `SYNKBAN_CONFIG_DIR` (used by the e2e
//! harness to keep tests away from the real user config).

use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
    /// "overview" (default) | "last"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_view: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_board_id: Option<String>,
    /// "system" (default) | "light" | "dark"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}

/// Serializes read-modify-write cycles from concurrent PUT /api/settings.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_dir() -> PathBuf {
    std::env::var_os("SYNKBAN_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".config").join("synkban"))
}

pub fn config_path() -> PathBuf {
    config_dir().join("synkban.toml")
}

pub fn default_data_dir() -> PathBuf {
    config_dir().join("data")
}

/// Missing or unreadable file yields the default config — the file only
/// exists once a setting has been changed.
pub fn load() -> Config {
    match std::fs::read_to_string(config_path()) {
        Ok(text) => toml::from_str(&text).unwrap_or_else(|e| {
            eprintln!(
                "warning: {} is not valid TOML ({e}); using defaults",
                config_path().display()
            );
            Config::default()
        }),
        Err(_) => Config::default(),
    }
}

fn save(config: &Config) -> io::Result<()> {
    let text = toml::to_string_pretty(config)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    std::fs::create_dir_all(config_dir())?;
    std::fs::write(config_path(), text)
}

/// Atomically load, mutate, and persist the config. Returns the saved state.
pub fn update(mutate: impl FnOnce(&mut Config)) -> io::Result<Config> {
    let _guard = CONFIG_LOCK.lock().unwrap();
    let mut config = load();
    mutate(&mut config);
    save(&config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_toml() {
        let config = Config {
            data_dir: Some("/tmp/x".into()),
            startup_view: Some("last".into()),
            last_board_id: None,
            theme: Some("dark".into()),
        };
        let text = toml::to_string_pretty(&config).unwrap();
        let parsed: Config = toml::from_str(&text).unwrap();
        assert_eq!(parsed.data_dir.as_deref(), Some("/tmp/x"));
        assert_eq!(parsed.startup_view.as_deref(), Some("last"));
        assert_eq!(parsed.theme.as_deref(), Some("dark"));
        assert!(parsed.last_board_id.is_none());
        assert!(!text.contains("last_board_id"));
    }

    #[test]
    fn empty_file_is_default() {
        let parsed: Config = toml::from_str("").unwrap();
        assert!(parsed.data_dir.is_none());
        assert!(parsed.startup_view.is_none());
    }
}
