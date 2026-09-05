use crate::types::{
    ListSessionsArgs, ProgressEvent, ProjectInfo, ScanResult, SessionPage, SessionPreview,
    SessionSummary,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
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
    pub has_user_event: bool,
    pub body_exists: bool,
    pub source: String,
}

#[derive(Debug, Clone, Default)]
pub struct Catalog {
    pub root: PathBuf,
    pub sessions: Vec<SessionRecord>,
    pub projects: Vec<ProjectInfo>,
}

#[derive(Debug, Clone)]
struct Meta {
    id: String,
    cwd: String,
    created: Option<String>,
    source: String,
}

#[derive(Debug, Clone)]
struct FileEntry {
    path: PathBuf,
    archived_path: bool,
    meta: Meta,
    modified: u64,
    size: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct ThreadFlags {
    archived: bool,
    internal: bool,
    has_user_event: bool,
}

#[derive(Debug, Clone, Default)]
struct DbIndex {
    by_id: HashMap<String, ThreadFlags>,
    by_path: HashMap<String, ThreadFlags>,
    ids: HashSet<String>,
    user_visible_ids: HashSet<String>,
}

pub fn default_codex_root() -> String {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
        .to_string_lossy()
        .to_string()
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn emit_progress(
    app: &AppHandle,
    phase: &str,
    current: usize,
    total: usize,
    percent: f64,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "scan-progress",
        ProgressEvent {
            phase: phase.to_string(),
            current,
            total,
            percent,
            message: message.into(),
            timestamp: unix_ms().to_string(),
        },
    );
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn collect_jsonl(dir: &Path, archived: bool, out: &mut Vec<(PathBuf, bool)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, archived, out);
        } else if path
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false)
        {
            out.push((path, archived));
        }
    }
}

fn strip_windows_extended_prefix(raw: &str) -> String {
    let mut s = raw.trim().replace('/', "\\");
    if let Some(rest) = s.strip_prefix("\\\\?\\UNC\\") {
        s = format!("\\\\{}", rest);
    } else if let Some(rest) = s.strip_prefix("\\\\?\\") {
        s = rest.to_string();
    } else if let Some(rest) = s.strip_prefix("\\??\\") {
        s = rest.to_string();
    }
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

fn normalize_project_key(raw: &str) -> String {
    strip_windows_extended_prefix(raw).to_ascii_lowercase()
}

fn normalize_path_key(path: &Path) -> String {
    normalize_project_key(&path.to_string_lossy())
}

fn clean_project_display(raw: &str) -> String {
    let s = strip_windows_extended_prefix(raw);
    if s.trim().is_empty() {
        "(未知目录)".to_string()
    } else {
        s
    }
}

fn read_bounded_lossy(path: &Path, cap: usize) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("读取文件失败：{}", e))?;
    let mut bytes = Vec::with_capacity(cap.min(1024 * 1024));
    file.by_ref()
        .take(cap as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取文件失败：{}", e))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn value_as_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn read_meta(path: &Path) -> Option<Meta> {
    let text = read_bounded_lossy(path, 256 * 1024).ok()?;
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }
        let payload = v.get("payload")?;
        let id = payload
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let cwd = clean_project_display(
            payload
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or("(未知目录)"),
        );
        return Some(Meta {
            id,
            cwd,
            created: payload
                .get("timestamp")
                .and_then(Value::as_str)
                .map(str::to_string),
            source: value_as_text(payload.get("source")),
        });
    }
    None
}

fn load_title_index(root: &Path) -> HashMap<String, String> {
    let path = root.join("session_index.jsonl");
    let Ok(text) = read_bounded_lossy(&path, usize::MAX / 4) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(id) = v.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(name) = v.get("thread_name").and_then(Value::as_str) else {
            continue;
        };
        let name = name.trim();
        if !id.trim().is_empty() && !name.is_empty() {
            map.insert(id.to_string(), name.to_string());
        }
    }
    map
}

fn find_state_db(root: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let number = name
            .strip_prefix("state_")
            .and_then(|s| s.strip_suffix(".sqlite"))
            .and_then(|s| s.parse::<u64>().ok());
        if let Some(number) = number {
            if best.as_ref().map(|(n, _)| number > *n).unwrap_or(true) {
                best = Some((number, entry.path()));
            }
        }
    }
    best.map(|(_, p)| p)
}

fn table_columns(conn: &Connection, table: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let sql = format!("PRAGMA table_info({})", table);
    if let Ok(mut stmt) = conn.prepare(&sql) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
            for name in rows.flatten() {
                out.insert(name);
            }
        }
    }
    out
}

fn sql_col(columns: &HashSet<String>, name: &str, fallback: &str) -> String {
    if columns.contains(name) {
        name.to_string()
    } else {
        fallback.to_string()
    }
}

fn source_is_internal(source: &str, thread_source: &str, model: &str) -> bool {
    let source = source.to_ascii_lowercase();
    let thread_source = thread_source.to_ascii_lowercase();
    let model = model.to_ascii_lowercase();
    thread_source == "subagent"
        || source.contains("subagent")
        || source.contains("guardian")
        || model == "codex-auto-review"
}

fn load_db_index(root: &Path, logs: &mut Vec<String>) -> DbIndex {
    let Some(db) = find_state_db(root) else {
        logs.push("未发现 state_N.sqlite，使用 rollout 自身信息。".to_string());
        return DbIndex::default();
    };
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(&db, flags) {
        Ok(conn) => conn,
        Err(err) => {
            logs.push(format!("只读打开 {} 失败：{}，使用 rollout 兜底。", db.display(), err));
            return DbIndex::default();
        }
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(500));
    let columns = table_columns(&conn, "threads");
    if !columns.contains("id") {
        logs.push("state 数据库没有可用 threads.id，使用 rollout 兜底。".to_string());
        return DbIndex::default();
    }
    let sql = format!(
        "SELECT id, {}, {}, {}, {}, {}, {} FROM threads",
        sql_col(&columns, "rollout_path", "''"),
        sql_col(&columns, "archived", "0"),
        sql_col(&columns, "has_user_event", "1"),
        sql_col(&columns, "source", "''"),
        sql_col(&columns, "thread_source", "''"),
        sql_col(&columns, "model", "''")
    );
    let mut stmt = match conn.prepare(&sql) {
        Ok(stmt) => stmt,
        Err(err) => {
            logs.push(format!("读取 threads 表失败：{}，使用 rollout 兜底。", err));
            return DbIndex::default();
        }
    };
    let rows = match stmt.query_map([], |row| {
        let id: String = row.get(0).unwrap_or_default();
        let rollout_path: String = row.get(1).unwrap_or_default();
        let archived = row.get::<_, i64>(2).unwrap_or(0) != 0;
        let has_user_event = row.get::<_, i64>(3).unwrap_or(1) != 0;
        let source: String = row.get(4).unwrap_or_default();
        let thread_source: String = row.get(5).unwrap_or_default();
        let model: String = row.get(6).unwrap_or_default();
        let internal = source_is_internal(&source, &thread_source, &model);
        Ok((id, rollout_path, ThreadFlags { archived, internal, has_user_event }))
    }) {
        Ok(rows) => rows,
        Err(err) => {
            logs.push(format!("查询 threads 失败：{}，使用 rollout 兜底。", err));
            return DbIndex::default();
        }
    };
    let mut index = DbIndex::default();
    for row in rows.flatten() {
        let (id, path, flags) = row;
        if id.trim().is_empty() {
            continue;
        }
        if flags.has_user_event && !flags.internal {
            index.user_visible_ids.insert(id.clone());
        }
        index.ids.insert(id.clone());
        index.by_id.insert(id, flags);
        if !path.trim().is_empty() {
            index
                .by_path
                .insert(normalize_project_key(&path), flags);
        }
    }
    logs.push(format!(
        "Codex state：{} 条 thread，其中用户可见候选 {} 条。",
        index.ids.len(),
        index.user_visible_ids.len()
    ));
    index
}

fn flags_for_file(entry: &FileEntry, db: &DbIndex) -> Option<ThreadFlags> {
    db.by_id
        .get(&entry.meta.id)
        .copied()
        .or_else(|| db.by_path.get(&normalize_path_key(&entry.path)).copied())
}

fn find_git_root(cwd: &str) -> Option<String> {
    if cwd.starts_with("\\\\") {
        return None;
    }
    let mut current = PathBuf::from(cwd);
    if !current.is_absolute() {
        return None;
    }
    for _ in 0..18 {
        if current.join(".git").exists() {
            return Some(clean_project_display(&current.to_string_lossy()));
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn choose_best_file<'a>(items: &'a [&FileEntry], flags: Option<ThreadFlags>) -> Option<&'a FileEntry> {
    let prefer_archived = flags.map(|f| f.archived);
    items.iter().copied().max_by_key(|f| {
        let archive_match = prefer_archived
            .map(|wanted| wanted == f.archived_path)
            .unwrap_or(true);
        (archive_match as u8, f.modified)
    })
}

fn parse_tail_bytes(bytes: &[u8], started_mid_file: bool) -> String {
    let slice = if started_mid_file {
        match bytes.iter().position(|b| *b == b'\n') {
            Some(pos) if pos + 1 < bytes.len() => &bytes[pos + 1..],
            _ => &[],
        }
    } else {
        bytes
    };
    String::from_utf8_lossy(slice).into_owned()
}

fn scan_tail(path: &Path, cap: usize) -> Result<(Option<String>, Option<String>), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("读取会话失败：{}", e))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(cap as u64);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("读取会话尾部失败：{}", e))?;
    let mut bytes = Vec::with_capacity((len.saturating_sub(start) as usize).min(cap));
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("读取会话尾部失败：{}", e))?;
    let text = parse_tail_bytes(&bytes, start > 0);
    let mut latest_name = None;
    let mut latest_user = None;
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(name) = thread_name_update(&v) {
            latest_name = Some(name);
        }
        if let Some(user) = user_text(&v) {
            if !is_internal_user_text(&user) {
                latest_user = Some(user);
            }
        }
    }
    Ok((latest_name, latest_user))
}

fn detect_user_event(path: &Path) -> bool {
    if let Ok(text) = read_bounded_lossy(path, 1024 * 1024) {
        for line in text.lines() {
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let Some(user) = user_text(&v) {
                if !is_internal_user_text(&user) {
                    return true;
                }
            }
        }
    }
    scan_tail(path, 1024 * 1024)
        .ok()
        .and_then(|(_, user)| user)
        .is_some()
}

pub fn scan_catalog_impl(
    root: PathBuf,
    merge_git_roots: bool,
    app: &AppHandle,
    cancel: &AtomicBool,
) -> Result<(Catalog, ScanResult), String> {
    let started = Instant::now();
    cancel.store(false, Ordering::SeqCst);
    if !root.is_dir() {
        return Err(format!("Codex 数据目录不存在：{}", root.display()));
    }
    let sessions_dir = root.join("sessions");
    if !sessions_dir.is_dir() {
        return Err(format!("未找到 Codex sessions 目录：{}", sessions_dir.display()));
    }

    let mut logs = vec![format!("扫描根目录：{}", root.display())];
    emit_progress(app, "database", 0, 0, 5.0, "阶段 1/4：读取 Codex 状态标记");
    let db = load_db_index(&root, &mut logs);

    emit_progress(app, "files", 0, 0, 12.0, "阶段 2/4：枚举活动与归档 rollout");
    let mut raw_files = Vec::new();
    collect_jsonl(&sessions_dir, false, &mut raw_files);
    collect_jsonl(&root.join("archived_sessions"), true, &mut raw_files);
    logs.push(format!("磁盘 rollout：{} 个 JSONL，活动与归档均纳入。", raw_files.len()));

    emit_progress(app, "metadata", 0, raw_files.len(), 18.0, "阶段 3/4：读取 rollout session_meta");
    let mut files = Vec::new();
    let mut unreadable = 0usize;
    for (i, (path, archived_path)) in raw_files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("scan_cancelled".to_string());
        }
        if let Some(meta) = read_meta(path) {
            files.push(FileEntry {
                path: path.clone(),
                archived_path: *archived_path,
                meta,
                modified: modified_ms(path),
                size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            });
        } else {
            unreadable += 1;
        }
        if i % 100 == 0 || i + 1 == raw_files.len() {
            let pct = 18.0 + 42.0 * ((i + 1) as f64 / raw_files.len().max(1) as f64);
            emit_progress(
                app,
                "metadata",
                i + 1,
                raw_files.len(),
                pct,
                format!("读取 rollout 元数据 {}/{}", i + 1, raw_files.len()),
            );
        }
    }
    if unreadable > 0 {
        logs.push(format!("{} 个 JSONL 未在有限头部找到 session_meta。", unreadable));
    }

    let titles = load_title_index(&root);
    logs.push(format!("session_index.jsonl：{} 个标题。", titles.len()));

    let mut files_by_id: HashMap<String, Vec<&FileEntry>> = HashMap::new();
    for file in &files {
        files_by_id.entry(file.meta.id.clone()).or_default().push(file);
    }

    emit_progress(app, "catalog", 0, files_by_id.len(), 64.0, "阶段 4/4：按 Codex 会话 ID 去重并整理项目");
    let mut sessions = Vec::with_capacity(files_by_id.len());
    let mut git_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut orphan_sessions = 0usize;

    for (i, (id, candidates)) in files_by_id.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("scan_cancelled".to_string());
        }
        let flags = db.by_id.get(id).copied();
        let Some(file) = choose_best_file(candidates, flags) else {
            continue;
        };
        if flags.is_none() {
            orphan_sessions += 1;
        }

        // Project identity always follows rollout session_meta.cwd. SQLite cwd may
        // be normalized or updated later and can merge unrelated workspaces.
        let cwd = clean_project_display(&file.meta.cwd);
        let project_display = if merge_git_roots {
            let key = normalize_project_key(&cwd);
            git_cache
                .entry(key)
                .or_insert_with(|| find_git_root(&cwd))
                .clone()
                .unwrap_or_else(|| cwd.clone())
        } else {
            cwd.clone()
        };
        let thread_flags = flags.unwrap_or_else(|| ThreadFlags {
            archived: file.archived_path,
            internal: source_is_internal(&file.meta.source, "", ""),
            has_user_event: detect_user_event(&file.path),
        });
        let archived = thread_flags.archived || file.archived_path;
        let title = titles
            .get(id)
            .cloned()
            .unwrap_or_else(|| "(未命名会话)".to_string());

        sessions.push(SessionRecord {
            id: id.clone(),
            path: file.path.clone(),
            title,
            cwd,
            project_key: normalize_project_key(&project_display),
            project_display,
            created: file.meta.created.clone(),
            modified: file.modified,
            size: file.size,
            archived,
            internal: thread_flags.internal,
            has_user_event: thread_flags.has_user_event,
            body_exists: true,
            source: file.meta.source.clone(),
        });

        if i % 100 == 0 || i + 1 == files_by_id.len() {
            let pct = 64.0 + 30.0 * ((i + 1) as f64 / files_by_id.len().max(1) as f64);
            emit_progress(
                app,
                "catalog",
                i + 1,
                files_by_id.len(),
                pct,
                format!("整理会话 {}/{}", i + 1, files_by_id.len()),
            );
        }
    }

    sessions.sort_by_key(|s| Reverse(s.modified));
    let session_ids: HashSet<String> = sessions.iter().map(|s| s.id.clone()).collect();
    let missing_body_sessions = db
        .user_visible_ids
        .iter()
        .filter(|id| !session_ids.contains(*id))
        .count();

    let mut project_map: HashMap<String, ProjectInfo> = HashMap::new();
    for s in &sessions {
        if !s.has_user_event || s.internal {
            continue;
        }
        let entry = project_map.entry(s.project_key.clone()).or_insert(ProjectInfo {
            key: s.project_key.clone(),
            display_path: s.project_display.clone(),
            session_count: 0,
            active_count: 0,
            archived_count: 0,
            missing_body_count: 0,
            last_modified: 0,
        });
        entry.session_count += 1;
        if s.archived {
            entry.archived_count += 1;
        } else {
            entry.active_count += 1;
        }
        entry.last_modified = entry.last_modified.max(s.modified);
    }
    let mut projects: Vec<ProjectInfo> = project_map.into_values().collect();
    projects.sort_by_key(|p| Reverse(p.last_modified));

    let raw_threads = sessions.len();
    let internal_sessions = sessions.iter().filter(|s| s.internal).count();
    let non_user_sessions = sessions.iter().filter(|s| !s.has_user_event).count();
    let valid = |s: &&SessionRecord| s.has_user_event && !s.internal;
    let total_sessions = sessions.iter().filter(valid).count();
    let active_sessions = sessions.iter().filter(valid).filter(|s| !s.archived).count();
    let archived_sessions = sessions.iter().filter(valid).filter(|s| s.archived).count();
    let named_sessions = sessions
        .iter()
        .filter(valid)
        .filter(|s| s.title != "(未命名会话)")
        .count();

    logs.push(format!(
        "会话口径：rollout 去重后 {}；有效用户对话 {}，活动 {}、归档 {}；内部 {}；无用户事件 {}。",
        raw_threads, total_sessions, active_sessions, archived_sessions, internal_sessions, non_user_sessions
    ));
    logs.push(format!(
        "项目 {} 个；state 中另有 {} 个用户 thread 未找到 rollout 正文；JSONL 无 state 标记 {} 个。",
        projects.len(), missing_body_sessions, orphan_sessions
    ));
    emit_progress(app, "done", total_sessions, total_sessions, 100.0, "扫描完成");

    let elapsed_ms = started.elapsed().as_millis();
    let catalog = Catalog {
        root: root.clone(),
        sessions,
        projects: projects.clone(),
    };
    let result = ScanResult {
        root: root.to_string_lossy().to_string(),
        projects,
        total_sessions,
        active_sessions,
        archived_sessions,
        raw_threads,
        internal_sessions,
        non_user_sessions,
        named_sessions,
        missing_body_sessions,
        orphan_sessions,
        elapsed_ms,
        logs,
    };
    Ok((catalog, result))
}

fn matches_filter(s: &SessionRecord, args: &ListSessionsArgs, now_ms: u64) -> bool {
    if s.project_key != args.project_key {
        return false;
    }
    if (!s.has_user_event || s.internal) && !args.include_internal {
        return false;
    }
    match args.filter.as_str() {
        "archived" if !s.archived => return false,
        "active" if s.archived => return false,
        _ => {}
    }
    if args.filter != "archived" && s.archived && !args.include_archived {
        return false;
    }
    if args.filter == "7d" && now_ms.saturating_sub(s.modified) > 7 * 24 * 60 * 60 * 1000 {
        return false;
    }
    if args.filter == "30d" && now_ms.saturating_sub(s.modified) > 30 * 24 * 60 * 60 * 1000 {
        return false;
    }
    let query = args.search.trim().to_ascii_lowercase();
    if !query.is_empty()
        && !s.title.to_ascii_lowercase().contains(&query)
        && !s.cwd.to_ascii_lowercase().contains(&query)
    {
        return false;
    }
    true
}

fn to_summary(s: &SessionRecord) -> SessionSummary {
    SessionSummary {
        id: s.id.clone(),
        path: s.path.to_string_lossy().to_string(),
        title: s.title.clone(),
        cwd: s.cwd.clone(),
        created: s.created.clone(),
        modified: s.modified,
        size: s.size,
        archived: s.archived,
        internal: s.internal,
        has_user_event: s.has_user_event,
        body_exists: s.body_exists,
        source: s.source.clone(),
        last_user_preview: None,
    }
}

pub fn list_sessions_impl(catalog: &Catalog, args: &ListSessionsArgs) -> Result<SessionPage, String> {
    let now_ms = unix_ms() as u64;
    let matched: Vec<&SessionRecord> = catalog
        .sessions
        .iter()
        .filter(|s| matches_filter(s, args, now_ms))
        .collect();
    let total = matched.len();
    let mut sessions = Vec::new();
    for s in matched.into_iter().skip(args.offset).take(args.limit) {
        let mut summary = to_summary(s);
        hydrate_summary(&mut summary, 256 * 1024)?;
        sessions.push(summary);
    }
    Ok(SessionPage { total, sessions })
}

pub fn export_candidates_impl(catalog: &Catalog, args: &ListSessionsArgs) -> Vec<SessionSummary> {
    let now_ms = unix_ms() as u64;
    catalog
        .sessions
        .iter()
        .filter(|s| matches_filter(s, args, now_ms))
        .filter(|s| s.body_exists)
        .map(to_summary)
        .collect()
}

pub fn preview_impl(path: &Path, fallback: Option<&SessionRecord>) -> Result<SessionPreview, String> {
    let mut summary = if let Some(s) = fallback {
        to_summary(s)
    } else {
        let meta = read_meta(path).ok_or_else(|| "无法读取 session_meta".to_string())?;
        SessionSummary {
            id: meta.id,
            path: path.to_string_lossy().to_string(),
            title: "(未命名会话)".to_string(),
            cwd: meta.cwd,
            created: meta.created,
            modified: modified_ms(path),
            size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            archived: false,
            internal: false,
            has_user_event: true,
            body_exists: path.is_file(),
            source: meta.source,
            last_user_preview: None,
        }
    };
    if summary.body_exists {
        hydrate_summary(&mut summary, 8 * 1024 * 1024)?;
    }
    Ok(SessionPreview {
        title: summary.title,
        cwd: summary.cwd,
        created: summary.created,
        modified: summary.modified,
        size: summary.size,
        last_user: summary.last_user_preview.unwrap_or_default(),
    })
}

pub fn hydrate_summary(summary: &mut SessionSummary, tail_cap: usize) -> Result<(), String> {
    if !summary.body_exists {
        return Ok(());
    }
    let path = Path::new(&summary.path);
    if summary.title == "(未命名会话)" {
        if let Some((name, first_user)) = scan_head_for_title(path, 1024 * 1024)? {
            if !name.is_empty() {
                summary.title = name;
            } else if !first_user.is_empty() {
                summary.title = truncate_chars(&clean_title(&first_user), 90);
            }
        }
    }
    let (thread_name, last_user) = scan_tail(path, tail_cap)?;
    if let Some(name) = thread_name {
        if !name.trim().is_empty() {
            summary.title = name;
        }
    }
    if let Some(last_user) = last_user {
        summary.last_user_preview = Some(truncate_chars(&clean_visible_text(&last_user), 180));
    }
    Ok(())
}

fn scan_head_for_title(path: &Path, cap: usize) -> Result<Option<(String, String)>, String> {
    let text = read_bounded_lossy(path, cap)?;
    let mut thread_name = String::new();
    let mut first_user = String::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(name) = thread_name_update(&v) {
            thread_name = name;
        }
        if first_user.is_empty() {
            if let Some(text) = user_text(&v) {
                if !is_internal_user_text(&text) {
                    first_user = text;
                }
            }
        }
        if !thread_name.is_empty() && !first_user.is_empty() {
            break;
        }
    }
    if thread_name.is_empty() && first_user.is_empty() {
        Ok(None)
    } else {
        Ok(Some((thread_name, first_user)))
    }
}

pub fn user_text(v: &Value) -> Option<String> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let payload = v.get("payload")?;
    let pt = payload.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("event_msg", "user_message") => payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string),
        ("event_msg", "item_completed")
            if payload
                .get("item")
                .and_then(|i| i.get("type"))
                .and_then(Value::as_str)
                == Some("UserMessage") =>
        {
            content_text(payload.get("item").and_then(|i| i.get("content")))
        }
        ("response_item", "message") if payload.get("role").and_then(Value::as_str) == Some("user") => {
            content_text(payload.get("content"))
        }
        _ => None,
    }
}

pub fn assistant_text(v: &Value) -> Option<String> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let payload = v.get("payload")?;
    let pt = payload.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("event_msg", "agent_message") => payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string),
        ("event_msg", "item_completed")
            if payload
                .get("item")
                .and_then(|i| i.get("type"))
                .and_then(Value::as_str)
                == Some("AgentMessage") =>
        {
            content_text(payload.get("item").and_then(|i| i.get("content"))).or_else(|| {
                payload
                    .get("item")
                    .and_then(|i| i.get("text"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        }
        ("response_item", "message")
            if payload.get("role").and_then(Value::as_str) == Some("assistant") =>
        {
            content_text(payload.get("content"))
        }
        _ => None,
    }
}

fn content_text(content: Option<&Value>) -> Option<String> {
    let arr = content?.as_array()?;
    let parts: Vec<&str> = arr
        .iter()
        .filter_map(|b| {
            let kind = b.get("type").and_then(Value::as_str).unwrap_or_default();
            if matches!(kind, "input_text" | "text" | "Text" | "output_text") {
                b.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .filter(|s| !s.trim().is_empty())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

pub fn thread_name_update(v: &Value) -> Option<String> {
    let payload = v.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("thread_name_updated") {
        return None;
    }
    payload
        .get("thread_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn is_internal_user_text(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("# AGENTS.md instructions")
        || t.starts_with("<skills_instructions>")
        || t.starts_with("<environment_context>")
        || t.starts_with("<system-reminder>")
        || t.starts_with("<turn_aborted>")
        || t.starts_with("<developer>")
        || t.starts_with("<system>")
}

pub fn clean_visible_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if is_internal_user_text(trimmed) {
        return String::new();
    }
    let mut end = trimmed.len();
    for marker in [
        "\n<environment_context>",
        "\n# AGENTS.md instructions",
        "\n<skills_instructions>",
        "\n<system-reminder>",
    ] {
        if let Some(pos) = trimmed.find(marker) {
            end = end.min(pos);
        }
    }
    trimmed[..end].trim().to_string()
}

fn clean_title(text: &str) -> String {
    let text = clean_visible_text(text);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string()
}

pub fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let mut s: String = text.chars().take(max).collect();
        s.push('…');
        s
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

    #[test]
    fn normalizes_windows_extended_paths() {
        assert_eq!(clean_project_display(r"\\?\D:\research\"), r"D:\research");
        assert_eq!(clean_project_display(r"\\?\UNC\server\share\x"), r"\\server\share\x");
        assert_eq!(normalize_project_key(r"D:/Research/"), r"d:\research");
    }

    #[test]
    fn tail_decode_tolerates_split_utf8_character() {
        let bytes = [0xAD, 0xA0, b'\n', b'{', b'}', b'\n'];
        assert_eq!(parse_tail_bytes(&bytes, true), "{}\n");
    }
}
