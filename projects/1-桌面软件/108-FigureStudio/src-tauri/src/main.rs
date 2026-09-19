use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::Path,
    process::Command,
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct WatchState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileIdentity {
    size: u64,
    modified_ms: u128,
    canonical_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedFileChange {
    watch_id: String,
    path: String,
}

#[tauri::command]
fn read_linked_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn file_identity(path: String) -> Result<FileIdentity, String> {
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?;

    Ok(FileIdentity {
        size: metadata.len(),
        modified_ms: modified.as_millis(),
        canonical_path: canonical.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn start_linked_watch(
    app: AppHandle,
    state: State<WatchState>,
    watch_id: String,
    path: String,
) -> Result<(), String> {
    let event_watch_id = watch_id.clone();
    let event_path = path.clone();
    let event_app = app.clone();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if result.is_ok() {
            let _ = event_app.emit(
                "figurestudio://linked-file-changed",
                LinkedFileChange {
                    watch_id: event_watch_id.clone(),
                    path: event_path.clone(),
                },
            );
        }
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "watch state lock poisoned".to_string())?;

    watchers.insert(watch_id, watcher);
    Ok(())
}

#[tauri::command]
fn stop_linked_watch(state: State<WatchState>, watch_id: String) -> Result<(), String> {
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "watch state lock poisoned".to_string())?;
    watchers.remove(&watch_id);
    Ok(())
}

#[tauri::command]
fn run_publication_renderer(
    python_executable: String,
    renderer_script: String,
    job_path: String,
    output_path: String,
) -> Result<String, String> {
    let output = Command::new(&python_executable)
        .arg(&renderer_script)
        .arg("--job")
        .arg(&job_path)
        .arg("--out")
        .arg(&output_path)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            read_linked_text,
            file_identity,
            start_linked_watch,
            stop_linked_watch,
            run_publication_renderer
        ])
        .run(tauri::generate_context!())
        .expect("error while running FigureStudio");
}
