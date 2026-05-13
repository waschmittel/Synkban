use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{interval, Duration};

use crate::errors::AppError;
use crate::models::{GitSyncConfig, SyncStatus};

struct GitSyncInner {
    data_dir: PathBuf,
    config: GitSyncConfig,
    status: SyncStatus,
    bg_handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct GitSync {
    inner: Arc<Mutex<GitSyncInner>>,
}

async fn run_git(data_dir: &PathBuf, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(data_dir)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("failed to run git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn now_timestamp() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    let mut y = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
        let year_days: i64 = if leap { 366 } else { 365 };
        if remaining_days < year_days {
            break;
        }
        remaining_days -= year_days;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    let mut m = 0usize;
    for &md in &month_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        m += 1;
    }

    format!(
        "{y:04}-{:02}-{:02} {hours:02}:{minutes:02}:{seconds:02}",
        m + 1,
        remaining_days + 1
    )
}

fn config_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(".git-sync-config.json")
}

fn load_config(data_dir: &PathBuf) -> GitSyncConfig {
    let path = config_path(data_dir);
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => GitSyncConfig::default(),
    }
}

fn save_config(data_dir: &PathBuf, config: &GitSyncConfig) -> Result<(), AppError> {
    let path = config_path(data_dir);
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| AppError::Git(format!("serialize config: {e}")))?;
    std::fs::write(&path, json)?;
    Ok(())
}

async fn git_init(data_dir: &PathBuf, config: &GitSyncConfig) -> Result<(), String> {
    let git_dir = data_dir.join(".git");
    if !git_dir.exists() {
        run_git(data_dir, &["init"]).await?;
    }

    run_git(
        data_dir,
        &["config", "user.name", &config.author_name],
    )
    .await?;
    run_git(
        data_dir,
        &["config", "user.email", &config.author_email],
    )
    .await?;

    if !config.remote_url.is_empty() {
        let result = run_git(data_dir, &["remote", "add", "origin", &config.remote_url]).await;
        if result.is_err() {
            run_git(
                data_dir,
                &["remote", "set-url", "origin", &config.remote_url],
            )
            .await?;
        }
    }

    Ok(())
}

async fn git_add_commit(data_dir: &PathBuf, message: &str) -> Result<bool, String> {
    run_git(data_dir, &["add", "-A"]).await?;

    let diff = run_git(data_dir, &["diff", "--cached", "--quiet"]).await;
    if diff.is_ok() {
        return Ok(false);
    }

    run_git(data_dir, &["commit", "-m", message]).await?;
    Ok(true)
}

async fn git_push(data_dir: &PathBuf, branch: &str) -> Result<(), String> {
    run_git(data_dir, &["push", "-u", "origin", branch]).await?;
    Ok(())
}

async fn git_pull(data_dir: &PathBuf, branch: &str) -> Result<(), String> {
    let has_remote = run_git(data_dir, &["remote"]).await;
    if has_remote.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
        return Ok(());
    }

    run_git(data_dir, &["fetch", "origin"]).await?;

    let remote_ref = format!("origin/{branch}");
    let has_remote_branch = run_git(data_dir, &["rev-parse", "--verify", &remote_ref]).await;
    if has_remote_branch.is_err() {
        return Ok(());
    }

    run_git(
        data_dir,
        &["pull", "--strategy-option=theirs", "origin", branch],
    )
    .await?;
    Ok(())
}

async fn has_pending_changes(data_dir: &PathBuf) -> bool {
    run_git(data_dir, &["status", "--porcelain"])
        .await
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

fn spawn_bg_sync(inner: Arc<Mutex<GitSyncInner>>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let interval_secs = {
            let guard = inner.lock().await;
            guard.config.sync_interval_secs
        };
        let mut tick = interval(Duration::from_secs(interval_secs));
        tick.tick().await;

        loop {
            tick.tick().await;

            let (enabled, data_dir, branch, remote_url) = {
                let guard = inner.lock().await;
                (
                    guard.config.enabled,
                    guard.data_dir.clone(),
                    guard.config.branch.clone(),
                    guard.config.remote_url.clone(),
                )
            };

            if !enabled {
                break;
            }

            if remote_url.is_empty() {
                continue;
            }

            if let Err(e) = git_pull(&data_dir, &branch).await {
                let mut guard = inner.lock().await;
                guard.status.error = Some(format!("pull: {e}"));
                continue;
            }
            {
                let mut guard = inner.lock().await;
                guard.status.last_pull = Some(now_timestamp());
            }

            if let Err(e) = git_push(&data_dir, &branch).await {
                let mut guard = inner.lock().await;
                guard.status.error = Some(format!("push: {e}"));
                continue;
            }
            {
                let mut guard = inner.lock().await;
                guard.status.last_push = Some(now_timestamp());
                guard.status.error = None;
            }
        }
    })
}

impl GitSync {
    pub fn new(data_dir: PathBuf) -> Self {
        let config = load_config(&data_dir);
        let initialized = data_dir.join(".git").exists();

        let inner = GitSyncInner {
            data_dir,
            config: config.clone(),
            status: SyncStatus {
                enabled: config.enabled,
                initialized,
                last_commit: None,
                last_push: None,
                last_pull: None,
                pending_changes: false,
                error: None,
            },
            bg_handle: None,
        };

        let sync = GitSync {
            inner: Arc::new(Mutex::new(inner)),
        };

        if config.enabled {
            let inner = sync.inner.clone();
            tokio::spawn(async move {
                let handle = spawn_bg_sync(inner.clone());
                let mut guard = inner.lock().await;
                guard.bg_handle = Some(handle);
            });
        }

        sync
    }

    pub async fn get_config(&self) -> GitSyncConfig {
        self.inner.lock().await.config.clone()
    }

    pub async fn get_status(&self) -> SyncStatus {
        let mut guard = self.inner.lock().await;
        guard.status.pending_changes = has_pending_changes(&guard.data_dir).await;
        guard.status.initialized = guard.data_dir.join(".git").exists();
        guard.status.clone()
    }

    pub async fn update_config(&self, config: GitSyncConfig) -> Result<GitSyncConfig, AppError> {
        let mut guard = self.inner.lock().await;

        save_config(&guard.data_dir, &config)?;

        let was_enabled = guard.config.enabled;

        if config.enabled && !was_enabled {
            if let Err(e) = git_init(&guard.data_dir, &config).await {
                guard.status.error = Some(format!("init: {e}"));
                guard.config = config.clone();
                guard.status.enabled = config.enabled;
                return Ok(config);
            }
            guard.status.initialized = true;
            guard.status.error = None;
        }

        if config.enabled && !config.remote_url.is_empty() {
            if !config.remote_url.is_empty() {
                let result = run_git(
                    &guard.data_dir,
                    &["remote", "set-url", "origin", &config.remote_url],
                )
                .await;
                if result.is_err() {
                    let _ = run_git(
                        &guard.data_dir,
                        &["remote", "add", "origin", &config.remote_url],
                    )
                    .await;
                }
            }
            run_git(
                &guard.data_dir,
                &["config", "user.name", &config.author_name],
            )
            .await
            .ok();
            run_git(
                &guard.data_dir,
                &["config", "user.email", &config.author_email],
            )
            .await
            .ok();
        }

        if let Some(handle) = guard.bg_handle.take() {
            handle.abort();
        }

        guard.config = config.clone();
        guard.status.enabled = config.enabled;

        if config.enabled {
            let handle = spawn_bg_sync(self.inner.clone());
            guard.bg_handle = Some(handle);
        }

        Ok(config)
    }

    pub async fn sync_now(&self) -> Result<SyncStatus, AppError> {
        let (data_dir, branch, enabled) = {
            let guard = self.inner.lock().await;
            (
                guard.data_dir.clone(),
                guard.config.branch.clone(),
                guard.config.enabled,
            )
        };

        if !enabled {
            return Ok(self.get_status().await);
        }

        if let Err(e) = git_add_commit(&data_dir, "manual sync").await {
            let mut guard = self.inner.lock().await;
            guard.status.error = Some(format!("commit: {e}"));
            return Ok(guard.status.clone());
        }

        if let Err(e) = git_pull(&data_dir, &branch).await {
            let mut guard = self.inner.lock().await;
            guard.status.error = Some(format!("pull: {e}"));
            return Ok(guard.status.clone());
        }
        {
            let mut guard = self.inner.lock().await;
            guard.status.last_pull = Some(now_timestamp());
        }

        if let Err(e) = git_push(&data_dir, &branch).await {
            let mut guard = self.inner.lock().await;
            guard.status.error = Some(format!("push: {e}"));
            return Ok(guard.status.clone());
        }

        let mut guard = self.inner.lock().await;
        guard.status.last_push = Some(now_timestamp());
        guard.status.last_commit = Some(now_timestamp());
        guard.status.error = None;
        Ok(guard.status.clone())
    }

    pub fn auto_commit(&self, message: &str) {
        let inner = self.inner.clone();
        let message = message.to_string();

        tokio::spawn(async move {
            let (enabled, data_dir, branch, has_remote) = {
                let guard = inner.lock().await;
                (
                    guard.config.enabled,
                    guard.data_dir.clone(),
                    guard.config.branch.clone(),
                    !guard.config.remote_url.is_empty(),
                )
            };

            if !enabled {
                return;
            }

            let commit_msg = format!("auto: {message}");
            match git_add_commit(&data_dir, &commit_msg).await {
                Ok(true) => {
                    let mut guard = inner.lock().await;
                    guard.status.last_commit = Some(now_timestamp());
                    guard.status.error = None;
                }
                Ok(false) => {}
                Err(e) => {
                    let mut guard = inner.lock().await;
                    guard.status.error = Some(format!("commit: {e}"));
                    return;
                }
            }

            if has_remote {
                if let Err(e) = git_push(&data_dir, &branch).await {
                    let mut guard = inner.lock().await;
                    guard.status.error = Some(format!("push: {e}"));
                } else {
                    let mut guard = inner.lock().await;
                    guard.status.last_push = Some(now_timestamp());
                }
            }
        });
    }
}
