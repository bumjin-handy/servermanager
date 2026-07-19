use crate::models::RemoteFileEntry;
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Virtual root that lists all local drives / mount points.
pub const COMPUTER_ROOT: &str = "";

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

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
                    path: root,
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
            path: path_string(&entry.path()),
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

/// Returns parent path. Drive roots (`C:\` / `C:/`) become the virtual computer root (`""`).
pub fn parent_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');

    if trimmed.is_empty() {
        return COMPUTER_ROOT.to_string();
    }

    #[cfg(windows)]
    {
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
            let s = path_string(parent);
            if s.is_empty() {
                COMPUTER_ROOT.to_string()
            } else if cfg!(windows) {
                let t = s.trim_end_matches(['\\', '/']);
                if t.len() == 2 && t.as_bytes().get(1) == Some(&b':') {
                    format!("{}\\", t)
                } else {
                    s
                }
            } else {
                s
            }
        }
        None => COMPUTER_ROOT.to_string(),
    }
}

/// Open a local path in an external editor. `editor`: `cursor` | `vscode` | `editplus`
pub fn open_with_editor(path: &Path, editor: &str) -> Result<()> {
    if !path.exists() {
        bail!("경로가 없습니다: {}", path.display());
    }

    let candidates = editor_candidates(editor)?;
    let mut last_err = None;
    for program in candidates {
        match spawn_detached(&program, path) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }

    bail!(
        "{} 실행 실패: {}",
        editor_label(editor),
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "실행 파일을 찾을 수 없습니다".into())
    )
}

fn editor_label(editor: &str) -> &'static str {
    match editor {
        "cursor" => "Cursor",
        "vscode" => "VS Code",
        "editplus" => "EditPlus",
        _ => "에디터",
    }
}

fn editor_candidates(editor: &str) -> Result<Vec<PathBuf>> {
    let mut list = Vec::new();
    match editor {
        "cursor" => {
            list.push(PathBuf::from("cursor"));
            if let Some(local) = dirs::data_local_dir() {
                list.push(
                    local
                        .join("Programs")
                        .join("cursor")
                        .join("resources")
                        .join("app")
                        .join("bin")
                        .join(if cfg!(windows) { "cursor.cmd" } else { "cursor" }),
                );
            }
        }
        "vscode" => {
            list.push(PathBuf::from("code"));
            if let Some(local) = dirs::data_local_dir() {
                list.push(
                    local
                        .join("Programs")
                        .join("Microsoft VS Code")
                        .join("bin")
                        .join(if cfg!(windows) { "code.cmd" } else { "code" }),
                );
            }
            #[cfg(windows)]
            {
                list.push(PathBuf::from(
                    r"C:\Program Files\Microsoft VS Code\bin\code.cmd",
                ));
            }
        }
        "editplus" => {
            list.push(PathBuf::from("editplus"));
            #[cfg(windows)]
            {
                list.push(PathBuf::from(r"C:\Program Files\EditPlus\editplus.exe"));
                list.push(PathBuf::from(r"C:\Program Files (x86)\EditPlus\editplus.exe"));
                if let Some(local) = dirs::data_local_dir() {
                    list.push(local.join("Programs").join("EditPlus").join("editplus.exe"));
                }
            }
        }
        _ => bail!("지원하지 않는 에디터입니다: {editor}"),
    }
    Ok(list)
}

fn spawn_detached(program: &Path, path: &Path) -> Result<()> {
    // PATH에만 있는 이름(cursor/code)은 exists()가 false여도 시도한다.
    let is_bare_name = program.components().count() == 1;
    if !is_bare_name && !program.exists() {
        bail!("없음: {}", program.display());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // .cmd 런처(cursor/code)는 cmd start로 띄워야 안정적이다.
        Command::new("cmd")
            .args(["/C", "start", "", "/B"])
            .arg(program)
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .with_context(|| format!("실행 실패: {}", program.display()))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        Command::new(program)
            .arg(path)
            .spawn()
            .with_context(|| format!("실행 실패: {}", program.display()))?;
        Ok(())
    }
}
