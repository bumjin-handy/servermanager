use crate::models::RemoteFileEntry;
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Virtual root that lists all local drives / mount points.
pub const COMPUTER_ROOT: &str = "";

pub fn home_dir() -> Result<PathBuf> {
    dirs::home_dir().context("로컬 홈 디렉터리를 찾을 수 없습니다")
}

pub fn ensure_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).with_context(|| format!("디렉터리 생성 실패: {}", path.display()))
}

pub fn list_drives() -> Result<Vec<RemoteFileEntry>> {
    #[cfg(windows)]
    {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            let path = PathBuf::from(&root);
            if path.exists() {
                drives.push(RemoteFileEntry {
                    name: format!("{}:", letter as char),
                    path: format!("{}:/", letter as char),
                    is_dir: true,
                    size: 0,
                });
            }
        }
        if drives.is_empty() {
            bail!("사용 가능한 로컬 드라이브를 찾지 못했습니다");
        }
        Ok(drives)
    }
    #[cfg(not(windows))]
    {
        Ok(vec![RemoteFileEntry {
            name: "/",
            path: "/".to_string(),
            is_dir: true,
            size: 0,
        }])
    }
}

pub fn list_dir(path: &Path) -> Result<Vec<RemoteFileEntry>> {
    let raw = path.to_string_lossy();
    if raw.is_empty() {
        return list_drives();
    }

    if !path.exists() {
        bail!("경로가 없습니다: {}", path.display());
    }
    if !path.is_dir() {
        bail!("디렉터리가 아닙니다: {}", path.display());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(path).with_context(|| format!("읽기 실패: {}", path.display()))? {
        let entry = entry.context("디렉터리 항목 읽기 실패")?;
        let meta = entry.metadata().context("메타데이터 읽기 실패")?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        entries.push(RemoteFileEntry {
            name,
            path: entry.path().to_string_lossy().replace('\\', "/"),
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

/// Returns parent path. Drive roots (`C:/`) become the virtual computer root (`""`).
pub fn parent_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');

    if trimmed.is_empty() {
        return COMPUTER_ROOT.to_string();
    }

    #[cfg(windows)]
    {
        // `C:` or `C:/`
        if trimmed.len() == 2 && trimmed.as_bytes()[1] == b':' {
            return COMPUTER_ROOT.to_string();
        }
    }

    let p = PathBuf::from(if cfg!(windows) {
        normalized.replace('/', "\\")
    } else {
        normalized.clone()
    });

    match p.parent() {
        Some(parent) => {
            let s = parent.to_string_lossy().replace('\\', "/");
            if s.is_empty() {
                COMPUTER_ROOT.to_string()
            } else if cfg!(windows) && s.ends_with(':') {
                format!("{s}/")
            } else {
                s
            }
        }
        None => COMPUTER_ROOT.to_string(),
    }
}
