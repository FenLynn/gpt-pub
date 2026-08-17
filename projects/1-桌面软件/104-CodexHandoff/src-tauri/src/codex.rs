use crate::types::{ListSessionsArgs, ProgressEvent, ProjectInfo, ScanResult, SessionPage, SessionPreview, SessionSummary};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone)]
pub struct SessionRecord {
    pub id: String,
    pub path: PathBuf,
    pub title: String,
    pub cwd: String,
    pub project_key: String,
    pub project_display: String,
    pub created: Option<String>,
    pub modified: u64,
    pub size: u64,
    pub archived: bool,
    pub internal: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Catalog {
    pub root: PathBuf,
    pub sessions: Vec<SessionRecord>,
    pub projects: Vec<ProjectInfo>,
}

#[derive(Debug, Clone, Copy, Default)]
struct ThreadFlags { internal: bool, archived: bool }

#[derive(Debug, Default)]
struct ThreadFlagsIndex {
    by_id: HashMap<String, ThreadFlags>,
    by_path: HashMap<String, ThreadFlags>,
}

#[derive(Debug)]
struct Meta { id: String, cwd: String, created: Option<String> }

pub fn default_codex_root() -> String {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".codex").to_string_lossy().to_string()
}

fn unix_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn emit_progress(app: &AppHandle, phase: &str, current: usize, total: usize, percent: f64, message: impl Into<String>) {
    let _ = app.emit("scan-progress", ProgressEvent {
        phase: phase.to_string(), current, total, percent, message: message.into(), timestamp: unix_ms().to_string(),
    });
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn collect_jsonl(dir: &Path, archived: bool, out: &mut Vec<(PathBuf, bool)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, archived, out);
        } else if path.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("jsonl")).unwrap_or(false) {
            out.push((path, archived));
        }
    }
}

fn read_meta(path: &Path) -> Option<Meta> {
    let file = fs::File::open(path).ok()?;
    let mut first = String::new();
    BufReader::new(file).read_line(&mut first).ok()?;
    let v: Value = serde_json::from_str(first.trim()).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("session_meta") { return None; }
    let payload = v.get("payload")?;
    let id = payload.get("id").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if id.is_empty() { return None; }
    let cwd = payload.get("cwd").and_then(Value::as_str).unwrap_or("(未知目录)").trim().to_string();
    Some(Meta {
        id,
        cwd,
        created: payload.get("timestamp").and_then(Value::as_str).map(str::to_string),
    })
}

fn load_title_index(root: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(file) = fs::File::open(root.join("session_index.jsonl")) else { return map };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = v.get("id").and_then(Value::as_str) else { continue };
        let Some(name) = v.get("thread_name").and_then(Value::as_str) else { continue };
        let name = name.trim();
        if !id.trim().is_empty() && !name.is_empty() { map.insert(id.to_string(), name.to_string()); }
    }
    map
}

fn find_state_db(root: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let number = name.strip_prefix("state_").and_then(|s| s.strip_suffix(".sqlite")).and_then(|s| s.parse::<u64>().ok());
        if let Some(number) = number {
            if best.as_ref().map(|(n, _)| number > *n).unwrap_or(true) { best = Some((number, entry.path())); }
        }
    }
    best.map(|(_, path)| path)
}

fn load_thread_flags(root: &Path, logs: &mut Vec<String>) -> ThreadFlagsIndex {
    let Some(db) = find_state_db(root) else {
        logs.push("未发现 state_N.sqlite，跳过内部会话辅助标记。".to_string());
        return ThreadFlagsIndex::default();
    };
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(&db, flags) {
        Ok(conn) => conn,
        Err(err) => {
            logs.push(format!("只读打开 {} 失败：{}，继续使用 JSONL。", db.display(), err));
            return ThreadFlagsIndex::default();
        }
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(150));
    let mut stmt = match conn.prepare("SELECT id, rollout_path, archived, has_user_event, source, thread_source, model FROM threads") {
        Ok(stmt) => stmt,
        Err(err) => {
            logs.push(format!("threads 表结构不兼容：{}，继续使用 JSONL。", err));
            return ThreadFlagsIndex::default();
        }
    };
    let rows = match stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let rollout_path: String = row.get(1).unwrap_or_default();
        let archived: i64 = row.get(2).unwrap_or(0);
        let _has_user_event: i64 = row.get(3).unwrap_or(0);
        let source: String = row.get(4).unwrap_or_default();
        let thread_source: Option<String> = row.get(5).unwrap_or_default();
        let model: Option<String> = row.get(6).unwrap_or_default();
        let source_lc = source.to_ascii_lowercase();
        let thread_source_lc = thread_source.unwrap_or_default().to_ascii_lowercase();
        let model_lc = model.unwrap_or_default().to_ascii_lowercase();
        let internal = thread_source_lc == "subagent" || source_lc.contains("guardian") || model_lc == "codex-auto-review";
        Ok((id, rollout_path, ThreadFlags { internal, archived: archived != 0 }))
    }) {
        Ok(rows) => rows,
        Err(err) => {
            logs.push(format!("读取 threads 失败：{}，继续使用 JSONL。", err));
            return ThreadFlagsIndex::default();
        }
    };
    let mut index = ThreadFlagsIndex::default();
    for row in rows.flatten() {
        index.by_id.insert(row.0.clone(), row.2);
        if !row.1.is_empty() { index.by_path.insert(normalize_path_key(Path::new(&row.1)), row.2); }
    }
    logs.push(format!("只读状态索引已加载：{} 条线程标记。", index.by_id.len()));
    index
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}
fn normalize_project_key(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}

fn find_git_root(cwd: &str) -> Option<String> {
    if cwd.starts_with("\\\\") { return None; }
    let mut current = PathBuf::from(cwd);
    if !current.is_absolute() { return None; }
    for _ in 0..18 {
        if current.join(".git").exists() { return Some(current.to_string_lossy().to_string()); }
        if !current.pop() { break; }
    }
    None
}

fn thread_flags_for(path: &Path, meta: &Meta, archived_path: bool, index: &ThreadFlagsIndex) -> ThreadFlags {
    let mut flags = index.by_id.get(&meta.id).or_else(|| index.by_path.get(&normalize_path_key(path))).copied().unwrap_or_default();
    if archived_path { flags.archived = true; }
    flags
}

pub fn scan_catalog_impl(root: PathBuf, merge_git_roots: bool, app: &AppHandle, cancel: &AtomicBool) -> Result<(Catalog, ScanResult), String> {
    let started = Instant::now();
    cancel.store(false, Ordering::SeqCst);
    if !root.is_dir() { return Err(format!("Codex 数据目录不存在：{}", root.display())); }
    let sessions_dir = root.join("sessions");
    if !sessions_dir.is_dir() { return Err(format!("未找到 Codex sessions 目录：{}", sessions_dir.display())); }

    let mut logs = vec![format!("扫描根目录：{}", root.display())];
    emit_progress(app, "enumerate", 0, 0, 2.0, "阶段 1/4：枚举 Codex 会话文件");
    let mut files = Vec::new();
    collect_jsonl(&sessions_dir, false, &mut files);
    collect_jsonl(&root.join("archived_sessions"), true, &mut files);
    files.sort_by_key(|(p, _)| p.clone());
    logs.push(format!("发现 {} 个 JSONL 文件。", files.len()));
    if cancel.load(Ordering::SeqCst) { return Err("scan_cancelled".to_string()); }

    emit_progress(app, "metadata", 0, files.len(), 8.0, "阶段 2/4：读取标题索引与只读状态标记");
    let titles = load_title_index(&root);
    logs.push(format!("session_index.jsonl 提供 {} 个有效标题。", titles.len()));
    let flags = load_thread_flags(&root, &mut logs);
    if cancel.load(Ordering::SeqCst) { return Err("scan_cancelled".to_string()); }

    emit_progress(app, "index", 0, files.len(), 12.0, "阶段 3/4：仅读取每个会话首行 session_meta");
    let mut sessions = Vec::with_capacity(files.len());
    let mut skipped = 0usize;
    let mut git_cache: HashMap<String, Option<String>> = HashMap::new();
    for (i, (path, archived_path)) in files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) { return Err("scan_cancelled".to_string()); }
        let Some(meta) = read_meta(path) else { skipped += 1; continue; };
        let state_flags = thread_flags_for(path, &meta, *archived_path, &flags);
        let display_project = if merge_git_roots {
            let key = normalize_project_key(&meta.cwd);
            git_cache.entry(key).or_insert_with(|| find_git_root(&meta.cwd)).clone().unwrap_or_else(|| meta.cwd.clone())
        } else { meta.cwd.clone() };
        let project_key = normalize_project_key(&display_project);
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let modified = modified_ms(path);
        let title = titles.get(&meta.id).cloned().unwrap_or_else(|| "(未命名会话)".to_string());
        sessions.push(SessionRecord {
            id: meta.id, path: path.clone(), title, cwd: meta.cwd, project_key, project_display: display_project,
            created: meta.created, modified, size, archived: state_flags.archived, internal: state_flags.internal,
        });
        if i % 100 == 0 || i + 1 == files.len() {
            let percent = 12.0 + 76.0 * ((i + 1) as f64 / files.len().max(1) as f64);
            emit_progress(app, "index", i + 1, files.len(), percent, format!("建立会话索引 {}/{}", i + 1, files.len()));
        }
    }

    emit_progress(app, "projects", sessions.len(), sessions.len(), 92.0, "阶段 4/4：整理项目与会话计数");
    let mut project_map: HashMap<String, ProjectInfo> = HashMap::new();
    for s in &sessions {
        let entry = project_map.entry(s.project_key.clone()).or_insert(ProjectInfo {
            key: s.project_key.clone(), display_path: s.project_display.clone(), session_count: 0, last_modified: 0,
        });
        if !s.internal && !s.archived { entry.session_count += 1; }
        entry.last_modified = entry.last_modified.max(s.modified);
    }
    let mut projects: Vec<ProjectInfo> = project_map.into_values().collect();
    projects.sort_by_key(|p| Reverse(p.last_modified));
    sessions.sort_by_key(|s| Reverse(s.modified));

    let total_sessions = sessions.len();
    let archived_sessions = sessions.iter().filter(|s| s.archived).count();
    let internal_sessions = sessions.iter().filter(|s| s.internal).count();
    let active_sessions = sessions.iter().filter(|s| !s.archived).count();
    let named_sessions = sessions.iter().filter(|s| s.title != "(未命名会话)").count();
    if skipped > 0 { logs.push(format!("跳过 {} 个没有有效 session_meta 首行的 JSONL。", skipped)); }
    logs.push(format!("整理完成：{} 个会话，{} 个项目。", total_sessions, projects.len()));
    emit_progress(app, "done", total_sessions, total_sessions, 100.0, "扫描完成");

    let elapsed_ms = started.elapsed().as_millis();
    let catalog = Catalog { root: root.clone(), sessions, projects: projects.clone() };
    let result = ScanResult {
        root: root.to_string_lossy().to_string(), projects, total_sessions, active_sessions, archived_sessions,
        internal_sessions, named_sessions, elapsed_ms, logs,
    };
    Ok((catalog, result))
}

fn matches_filter(s: &SessionRecord, args: &ListSessionsArgs, now_ms: u64) -> bool {
    if s.project_key != args.project_key { return false; }
    if s.internal && !args.include_internal { return false; }
    if args.filter == "archived" {
        if !s.archived { return false; }
    } else if s.archived && !args.include_archived { return false; }
    let age_limit = match args.filter.as_str() {
        "7d" => Some(7u64 * 24 * 60 * 60 * 1000),
        "30d" => Some(30u64 * 24 * 60 * 60 * 1000),
        _ => None,
    };
    if let Some(limit) = age_limit {
        if now_ms.saturating_sub(s.modified) > limit { return false; }
    }
    let q = args.search.trim().to_ascii_lowercase();
    if !q.is_empty() && !s.title.to_ascii_lowercase().contains(&q) && !s.cwd.to_ascii_lowercase().contains(&q) { return false; }
    true
}

fn to_summary(s: &SessionRecord) -> SessionSummary {
    SessionSummary {
        id: s.id.clone(), path: s.path.to_string_lossy().to_string(), title: s.title.clone(), cwd: s.cwd.clone(),
        created: s.created.clone(), modified: s.modified, size: s.size, archived: s.archived, internal: s.internal,
        last_user_preview: None,
    }
}

pub fn list_sessions_impl(catalog: &Catalog, args: &ListSessionsArgs) -> Result<SessionPage, String> {
    let now_ms = unix_ms() as u64;
    let matched: Vec<&SessionRecord> = catalog.sessions.iter().filter(|s| matches_filter(s, args, now_ms)).collect();
    let total = matched.len();
    let mut sessions = Vec::new();
    for s in matched.into_iter().skip(args.offset).take(args.limit) {
        let mut summary = to_summary(s);
        hydrate_summary(&mut summary, 2 * 1024 * 1024)?;
        sessions.push(summary);
    }
    Ok(SessionPage { total, sessions })
}

pub fn export_candidates_impl(catalog: &Catalog, args: &ListSessionsArgs) -> Vec<SessionSummary> {
    let now_ms = unix_ms() as u64;
    catalog.sessions.iter().filter(|s| matches_filter(s, args, now_ms)).map(to_summary).collect()
}

pub fn preview_impl(path: &Path, fallback: Option<&SessionRecord>) -> Result<SessionPreview, String> {
    let mut summary = if let Some(s) = fallback { to_summary(s) } else {
        let meta = read_meta(path).ok_or_else(|| "无法读取 session_meta".to_string())?;
        SessionSummary {
            id: meta.id, path: path.to_string_lossy().to_string(), title: "(未命名会话)".to_string(), cwd: meta.cwd,
            created: meta.created, modified: modified_ms(path), size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            archived: false, internal: false, last_user_preview: None,
        }
    };
    hydrate_summary(&mut summary, 8 * 1024 * 1024)?;
    Ok(SessionPreview {
        title: summary.title, cwd: summary.cwd, created: summary.created, modified: summary.modified,
        size: summary.size, last_user: summary.last_user_preview.unwrap_or_default(),
    })
}

pub fn hydrate_summary(summary: &mut SessionSummary, tail_cap: usize) -> Result<(), String> {
    let path = Path::new(&summary.path);
    if summary.title == "(未命名会话)" {
        if let Some((name, first_user)) = scan_head_for_title(path, 1024 * 1024)? {
            if !name.is_empty() { summary.title = name; }
            else if !first_user.is_empty() { summary.title = truncate_chars(&clean_title(&first_user), 90); }
        }
    }
    let (thread_name, last_user) = scan_tail(path, tail_cap)?;
    if let Some(name) = thread_name { if !name.trim().is_empty() { summary.title = name; } }
    if let Some(last_user) = last_user { summary.last_user_preview = Some(truncate_chars(&clean_visible_text(&last_user), 180)); }
    Ok(())
}

fn scan_head_for_title(path: &Path, cap: usize) -> Result<Option<(String, String)>, String> {
    let file = fs::File::open(path).map_err(|e| format!("读取会话失败：{}", e))?;
    let reader = BufReader::new(file.take(cap as u64));
    let mut thread_name = String::new();
    let mut first_user = String::new();
    for line in reader.lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(name) = thread_name_update(&v) { thread_name = name; }
        if first_user.is_empty() {
            if let Some(text) = user_text(&v) { if !is_internal_user_text(&text) { first_user = text; } }
        }
        if !thread_name.is_empty() && !first_user.is_empty() { break; }
    }
    if thread_name.is_empty() && first_user.is_empty() { Ok(None) } else { Ok(Some((thread_name, first_user))) }
}

fn scan_tail(path: &Path, cap: usize) -> Result<(Option<String>, Option<String>), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("读取会话失败：{}", e))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(cap as u64);
    file.seek(SeekFrom::Start(start)).map_err(|e| format!("读取会话尾部失败：{}", e))?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).map_err(|e| format!("读取会话尾部失败：{}", e))?;
    if start > 0 { if let Some(pos) = buf.find('\n') { buf.drain(..=pos); } }
    let mut latest_name = None;
    let mut latest_user = None;
    for line in buf.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if let Some(name) = thread_name_update(&v) { latest_name = Some(name); }
        if let Some(text) = user_text(&v) { if !is_internal_user_text(&text) { latest_user = Some(text); } }
    }
    Ok((latest_name, latest_user))
}

pub fn user_text(v: &Value) -> Option<String> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let payload = v.get("payload")?;
    let pt = payload.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("event_msg", "user_message") => payload.get("message").and_then(Value::as_str).map(str::to_string),
        ("event_msg", "item_completed") if payload.get("item").and_then(|i| i.get("type")).and_then(Value::as_str) == Some("UserMessage") => content_text(payload.get("item").and_then(|i| i.get("content"))),
        ("response_item", "message") if payload.get("role").and_then(Value::as_str) == Some("user") => content_text(payload.get("content")),
        _ => None,
    }
}

pub fn assistant_text(v: &Value) -> Option<String> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let payload = v.get("payload")?;
    let pt = payload.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("event_msg", "agent_message") => payload.get("message").and_then(Value::as_str).map(str::to_string),
        ("event_msg", "item_completed") if payload.get("item").and_then(|i| i.get("type")).and_then(Value::as_str) == Some("AgentMessage") => {
            content_text(payload.get("item").and_then(|i| i.get("content")))
                .or_else(|| payload.get("item").and_then(|i| i.get("text")).and_then(Value::as_str).map(str::to_string))
        }
        ("response_item", "message") if payload.get("role").and_then(Value::as_str) == Some("assistant") => content_text(payload.get("content")),
        _ => None,
    }
}

fn content_text(content: Option<&Value>) -> Option<String> {
    let arr = content?.as_array()?;
    let parts: Vec<&str> = arr.iter().filter_map(|b| {
        let kind = b.get("type").and_then(Value::as_str).unwrap_or_default();
        if matches!(kind, "input_text" | "text" | "Text" | "output_text") { b.get("text").and_then(Value::as_str) } else { None }
    }).filter(|s| !s.trim().is_empty()).collect();
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

pub fn thread_name_update(v: &Value) -> Option<String> {
    let payload = v.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("thread_name_updated") { return None; }
    payload.get("thread_name").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn is_internal_user_text(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("# AGENTS.md instructions") || t.starts_with("<skills_instructions>") || t.starts_with("<environment_context>")
        || t.starts_with("<system-reminder>") || t.starts_with("<turn_aborted>") || t.starts_with("<developer>") || t.starts_with("<system>")
}

pub fn clean_visible_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if is_internal_user_text(trimmed) { return String::new(); }
    let mut end = trimmed.len();
    for marker in ["\n<environment_context>", "\n# AGENTS.md instructions", "\n<skills_instructions>", "\n<system-reminder>"] {
        if let Some(pos) = trimmed.find(marker) { end = end.min(pos); }
    }
    trimmed[..end].trim().to_string()
}

fn clean_title(text: &str) -> String {
    let text = clean_visible_text(text);
    text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default().to_string()
}

pub fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max { text.to_string() } else {
        let mut s: String = text.chars().take(max).collect(); s.push('…'); s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_event_user_message() {
        let v = json!({"type":"event_msg","payload":{"type":"user_message","message":"hello"}});
        assert_eq!(user_text(&v).as_deref(), Some("hello"));
    }

    #[test]
    fn rejects_internal_prompt_as_visible_user() {
        assert!(is_internal_user_text("# AGENTS.md instructions\nabc"));
        assert!(is_internal_user_text("<environment_context>abc"));
        assert!(!is_internal_user_text("please fix the UI"));
    }

    #[test]
    fn parses_thread_name_update() {
        let v = json!({"payload":{"type":"thread_name_updated","thread_name":"My session"}});
        assert_eq!(thread_name_update(&v).as_deref(), Some("My session"));
    }
}
