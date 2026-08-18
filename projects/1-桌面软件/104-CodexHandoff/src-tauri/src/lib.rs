mod codex;
mod exporter;
mod types;

use codex::{Catalog, SessionRecord};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use types::{
    ExportRequest, ExportResult, ListSessionsArgs, PreflightResult, ProjectInfo, ScanResult,
    SessionPage, SessionPreview, SessionSummary,
};

#[derive(Clone, Default)]
struct AppState {
    catalog: Arc<Mutex<Option<Catalog>>>,
    scan_cancel: Arc<AtomicBool>,
    export_cancel: Arc<AtomicBool>,
}

#[tauri::command]
fn default_codex_root() -> String {
    codex::default_codex_root()
}

#[tauri::command]
async fn scan_catalog(
    root: String,
    merge_git_roots: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanResult, String> {
    let app_state = state.inner().clone();
    let root = PathBuf::from(root);
    let app_clone = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        codex::scan_catalog_impl(root, merge_git_roots, &app_clone, &app_state.scan_cancel)
    })
    .await
    .map_err(|e| format!("扫描任务异常结束：{}", e))??;
    let (catalog, scan_result) = result;
    let mut guard = app_state
        .catalog
        .lock()
        .map_err(|_| "内部目录状态锁异常".to_string())?;
    *guard = Some(catalog);
    Ok(scan_result)
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    state.scan_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectInfo>, String> {
    let guard = state
        .catalog
        .lock()
        .map_err(|_| "内部目录状态锁异常".to_string())?;
    let catalog = guard.as_ref().ok_or_else(|| "请先手动扫描 Codex 数据。".to_string())?;
    Ok(catalog.projects.clone())
}

#[tauri::command]
async fn list_sessions(args: ListSessionsArgs, state: State<'_, AppState>) -> Result<SessionPage, String> {
    let catalog = {
        let guard = state
            .catalog
            .lock()
            .map_err(|_| "内部目录状态锁异常".to_string())?;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "请先手动扫描 Codex 数据。".to_string())?
    };
    tauri::async_runtime::spawn_blocking(move || codex::list_sessions_impl(&catalog, &args))
        .await
        .map_err(|e| format!("会话列表任务异常结束：{}", e))?
}

#[tauri::command]
fn export_candidates(args: ListSessionsArgs, state: State<'_, AppState>) -> Result<Vec<SessionSummary>, String> {
    let guard = state
        .catalog
        .lock()
        .map_err(|_| "内部目录状态锁异常".to_string())?;
    let catalog = guard.as_ref().ok_or_else(|| "请先手动扫描 Codex 数据。".to_string())?;
    Ok(codex::export_candidates_impl(catalog, &args))
}

fn find_record_by_path<'a>(catalog: &'a Catalog, path: &str) -> Option<&'a SessionRecord> {
    catalog
        .sessions
        .iter()
        .find(|s| s.path.to_string_lossy().eq_ignore_ascii_case(path))
}

#[tauri::command]
async fn session_preview(path: String, state: State<'_, AppState>) -> Result<SessionPreview, String> {
    let fallback = {
        let guard = state
            .catalog
            .lock()
            .map_err(|_| "内部目录状态锁异常".to_string())?;
        guard
            .as_ref()
            .and_then(|c| find_record_by_path(c, &path))
            .cloned()
    };
    tauri::async_runtime::spawn_blocking(move || codex::preview_impl(Path::new(&path), fallback.as_ref()))
        .await
        .map_err(|e| format!("预览任务异常结束：{}", e))?
}

#[tauri::command]
async fn choose_output_path(suggested: String) -> Result<Option<String>, String> {
    let choice = tauri::async_runtime::spawn_blocking(move || {
        let suggested_path = PathBuf::from(&suggested);
        let mut dialog = rfd::FileDialog::new().add_filter("Markdown", &["md"]);
        if let Some(parent) = suggested_path.parent().filter(|p| p.is_dir()) {
            dialog = dialog.set_directory(parent);
        }
        if let Some(name) = suggested_path.file_name().and_then(|n| n.to_str()) {
            dialog = dialog.set_file_name(name);
        } else {
            dialog = dialog.set_file_name("CODEX-HANDOFF.md");
        }
        dialog.save_file().map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("文件选择器异常结束：{}", e))?;
    Ok(choice)
}

#[tauri::command]
async fn preflight_export(
    sessions: Vec<SessionSummary>,
    include_details: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PreflightResult, String> {
    let state = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        exporter::preflight_impl(&sessions, include_details, &app_clone, &state.export_cancel)
    })
    .await
    .map_err(|e| format!("预检任务异常结束：{}", e))?
}

#[tauri::command]
async fn export_markdown(
    request: ExportRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    let app_state = state.inner().clone();
    let root = {
        let guard = app_state
            .catalog
            .lock()
            .map_err(|_| "内部目录状态锁异常".to_string())?;
        guard
            .as_ref()
            .map(|c| c.root.clone())
            .ok_or_else(|| "请先手动扫描 Codex 数据。".to_string())?
    };
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        exporter::export_impl(&request, &root, &app_clone, &app_state.export_cancel)
    })
    .await
    .map_err(|e| format!("导出任务异常结束：{}", e))?
}

#[tauri::command]
fn cancel_export(state: State<'_, AppState>) {
    state.export_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn open_path(path: String, reveal: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer.exe");
        if reveal {
            cmd.arg(format!("/select,{}", path));
        } else {
            cmd.arg(&path);
        }
        cmd.spawn()
            .map_err(|e| format!("无法打开路径：{}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if reveal {
            cmd.args(["-R", &path]);
        } else {
            cmd.arg(&path);
        }
        cmd.spawn().map_err(|e| format!("无法打开路径：{}", e))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if reveal {
            PathBuf::from(&path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(path)
        } else {
            path
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("无法打开路径：{}", e))?;
        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            default_codex_root,
            scan_catalog,
            cancel_scan,
            list_projects,
            list_sessions,
            export_candidates,
            session_preview,
            choose_output_path,
            preflight_export,
            export_markdown,
            cancel_export,
            open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodexHandoff");
}
