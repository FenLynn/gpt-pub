use crate::types::{ListSessionsArgs, ProgressEvent, ProjectInfo, ScanResult, SessionPage, SessionPreview, SessionSummary};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
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

#[derive(Debug, Clone)]
struct DbThread {
    id: String,
    rollout_path: String,
    created_at: i64,
    updated_at: i64,
    source: String,
    cwd: String,
    title: String,
    has_user_event: bool,
    archived: bool,
    thread_source: String,
    model: String,
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

fn emit_progress(app: &AppHandle, phase: &str, current: usize, total: usize, percent: f64, message: impl Into<String>) {
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

fn normalize_epoch_ms(v: i64) -> u64 {
    if v <= 0 {
        0
    } else if v < 10_000_000_000 {
        (v as u64).saturating_mul(1000)
    } else {
        v as u64
    }
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

fn value_as_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

/// Modern Codex puts session_meta first. Older or partially rewritten files are
/// tolerated by looking only through a small bounded prefix instead of rejecting
/// the whole rollout because byte zero is not session_meta.
fn read_meta(path: &Path) -> Option<Meta> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file.take(256 * 1024));
    for line in reader.lines().map_while(Result::ok) {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
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
            return None;
        }
        let cwd = payload
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or("(未知目录)")
            .trim()
            .to_string();
        return Some(Meta {
            id,
            cwd,
            created: payload.get("timestamp").and_then(Value::as_str).map(str::to_string),
            source: value_as_text(payload.get("source")),
        });
    }
    None
}

fn load_title_index(root: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(file) = fs::File::open(root.join("session_index.jsonl")) else { return map };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = v.get("id").and_then(Value::as_str) else { continue };
        let Some(name) = v.get("thread_name").and_then(Value::as_str) else { continue };
        let name = name.trim();
        if !id.trim().is_empty() && !name.is_empty() {
            // session_index is append-only; the newest name wins.
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
    best.map(|(_, path)| path)
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

fn load_db_threads(root: &Path, logs: &mut Vec<String>) -> Vec<DbThread> {
    let Some(db) = find_state_db(root) else {
        logs.push("未发现 state_N.sqlite，将完全使用 rollout JSONL 建立索引。".to_string());
        return Vec::new();
    };
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(&db, flags) {
        Ok(conn) => conn,
        Err(err) => {
            logs.push(format!("只读打开 {} 失败：{}，改用 JSONL 兜底。", db.display(), err));
            return Vec::new();
        }
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(500));
    let columns = table_columns(&conn, "threads");
    if !columns.contains("id") {
        logs.push("state 数据库不存在可用 threads.id，改用 JSONL 兜底。".to_string());
        return Vec::new();
    }

    let sql = format!(
        "SELECT id, {}, {}, {}, {}, {}, {}, {}, {}, {}, {} FROM threads",
        sql_col(&columns, "rollout_path", "''"),
        sql_col(&columns, "created_at", "0"),
        sql_col(&columns, "updated_at", "0"),
        sql_col(&columns, "source", "''"),
        sql_col(&columns, "cwd", "''"),
        sql_col(&columns, "title", "''"),
        sql_col(&columns, "has_user_event", "1"),
        sql_col(&columns, "archived", "0"),
        sql_col(&columns, "thread_source", "''"),
        sql_col(&columns, "model", "''")
    );

    let mut stmt = match conn.prepare(&sql) {
        Ok(stmt) => stmt,
        Err(err) => {
            logs.push(format!("读取 threads 表失败：{}，改用 JSONL 兜底。", err));
            return Vec::new();
        }
    };
    let rows = match stmt.query_map([], |row| {
        Ok(DbThread {
            id: row.get::<_, String>(0).unwrap_or_default(),
            rollout_path: row.get::<_, String>(1).unwrap_or_default(),
            created_at: row.get::<_, i64>(2).unwrap_or(0),
            updated_at: row.get::<_, i64>(3).unwrap_or(0),
            source: row.get::<_, String>(4).unwrap_or_default(),
            cwd: row.get::<_, String>(5).unwrap_or_default(),
            title: row.get::<_, String>(6).unwrap_or_default(),
            has_user_event: row.get::<_, i64>(7).unwrap_or(1) != 0,
            archived: row.get::<_, i64>(8).unwrap_or(0) != 0,
            thread_source: row.get::<_, String>(9).unwrap_or_default(),
            model: row.get::<_, String>(10).unwrap_or_default(),
        })
    }) {
        Ok(rows) => rows,
        Err(err) => {
            logs.push(format!("查询 threads 失败：{}，改用 JSONL 兜底。", err));
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for row in rows.flatten() {
        if !row.id.trim().is_empty() {
            out.push(row);
        }
    }
    logs.push(format!("Codex state 主索引：{} 条 thread。", out.len()));
    out
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn normalize_project_key(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
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
            return Some(current.to_string_lossy().to_string());
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn source_is_internal(source: &str, thread_source: &str, model: &str) -> bool {
    let source = source.to_ascii_lowercase();
    let thread_source = thread_source.to_ascii_lowercase();
    let model = model.to_ascii_lowercase();
    thread_source.contains("subagent")
        || source.contains("subagent")
        || source.contains("guardian")
        || model == "codex-auto-review"
}

fn resolve_rollout_path(root: &Path, raw: &str) -> PathBuf {
    let p = PathBuf::from(raw.trim());
    if p.is_absolute() {
        p
    } else if raw.trim().is_empty() {
        PathBuf::new()
    } else {
        root.join(p)
    }
}

fn choose_file_for_db<'a>(
    root: &Path,
    db: &DbThread,
    files: &'a [FileEntry],
    by_path: &HashMap<String, usize>,
    by_id: &HashMap<String, Vec<usize>>,
) -> Option<&'a FileEntry> {
    let declared = resolve_rollout_path(root, &db.rollout_path);
    if !declared.as_os_str().is_empty() {
        if let Some(idx) = by_path.get(&normalize_path_key(&declared)) {
            return files.get(*idx);
        }
    }
    let candidates = by_id.get(&db.id)?;
    candidates
        .iter()
        .filter_map(|idx| files.get(*idx))
        .max_by_key(|f| ((f.archived_path == db.archived) as u8, f.modified))
}

fn detect_user_event(path: &Path) -> bool {
    if let Ok(file) = fs::File::open(path) {
        let reader = BufReader::new(file.take(1024 * 1024));
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let Some(text) = user_text(&v) {
                    if !is_internal_user_text(&text) {
                        return true;
                    }
                }
            }
        }
    }
    if let Ok((_, user)) = scan_tail(path, 1024 * 1024) {
        return user.is_some();
    }
    false
}

pub fn scan_catalog_impl(root: PathBuf, merge_git_roots: bool, app: &AppHandle, cancel: &AtomicBool) -> Result<(Catalog, ScanResult), String> {
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
    emit_progress(app, "database", 0, 0, 3.0, "阶段 1/5：读取 Codex state 主索引");
    let db_threads = load_db_threads(&root, &mut logs);
    if cancel.load(Ordering::SeqCst) {
        return Err("scan_cancelled".to_string());
    }

    emit_progress(app, "files", 0, 0, 10.0, "阶段 2/5：枚举活动与归档 rollout 文件");
    let mut raw_files = Vec::new();
    collect_jsonl(&sessions_dir, false, &mut raw_files);
    collect_jsonl(&root.join("archived_sessions"), true, &mut raw_files);
    raw_files.sort_by_key(|(p, _)| p.clone());
    logs.push(format!("磁盘 rollout：{} 个 JSONL，其中 sessions 与 archived_sessions 均纳入。", raw_files.len()));

    emit_progress(app, "metadata", 0, raw_files.len(), 16.0, "阶段 3/5：仅读取 rollout 小范围头部元数据");
    let mut files = Vec::new();
    let mut unreadable_rollouts = 0usize;
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
            unreadable_rollouts += 1;
        }
        if i % 100 == 0 || i + 1 == raw_files.len() {
            let pct = 16.0 + 32.0 * ((i + 1) as f64 / raw_files.len().max(1) as f64);
            emit_progress(app, "metadata", i + 1, raw_files.len(), pct, format!("读取 rollout 元数据 {}/{}", i + 1, raw_files.len()));
        }
    }
    if unreadable_rollouts > 0 {
        logs.push(format!("有 {} 个 JSONL 在 256 KB 头部范围内未找到 session_meta，已保留为诊断计数。", unreadable_rollouts));
    }

    let titles = load_title_index(&root);
    logs.push(format!("session_index.jsonl：{} 个有效 thread_name。", titles.len()));

    let mut by_path: HashMap<String, usize> = HashMap::new();
    let mut by_id: HashMap<String, Vec<usize>> = HashMap::new();
    for (idx, file) in files.iter().enumerate() {
        by_path.insert(normalize_path_key(&file.path), idx);
        by_id.entry(file.meta.id.clone()).or_default().push(idx);
    }

    emit_progress(app, "merge", 0, db_threads.len().max(files.len()), 52.0, "阶段 4/5：以 thread ID 合并 state 主索引与 JSONL 兜底");
    let mut sessions_by_id: HashMap<String, SessionRecord> = HashMap::new();
    let mut git_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut db_body_matches = 0usize;
    let mut db_missing_bodies = 0usize;

    for (i, db) in db_threads.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("scan_cancelled".to_string());
        }
        let file = choose_file_for_db(&root, db, &files, &by_path, &by_id);
        let declared = resolve_rollout_path(&root, &db.rollout_path);
        let path = file
            .map(|f| f.path.clone())
            .unwrap_or_else(|| if !declared.as_os_str().is_empty() { declared } else { root.join("missing-rollout").join(format!("{}.jsonl", db.id)) });
        let body_exists = file.is_some() || path.is_file();
        if body_exists { db_body_matches += 1; } else { db_missing_bodies += 1; }

        let cwd = if !db.cwd.trim().is_empty() {
            db.cwd.trim().to_string()
        } else {
            file.map(|f| f.meta.cwd.clone()).unwrap_or_else(|| "(未知目录)".to_string())
        };
        let display_project = if merge_git_roots {
            let key = normalize_project_key(&cwd);
            git_cache
                .entry(key)
                .or_insert_with(|| find_git_root(&cwd))
                .clone()
                .unwrap_or_else(|| cwd.clone())
        } else {
            cwd.clone()
        };
        let title = titles
            .get(&db.id)
            .cloned()
            .or_else(|| (!db.title.trim().is_empty()).then(|| db.title.trim().to_string()))
            .unwrap_or_else(|| "(未命名会话)".to_string());
        let source = if !db.source.trim().is_empty() {
            db.source.clone()
        } else {
            file.map(|f| f.meta.source.clone()).unwrap_or_default()
        };
        let archived = db.archived || file.map(|f| f.archived_path).unwrap_or(false);
        let internal = source_is_internal(&source, &db.thread_source, &db.model);
        let modified = normalize_epoch_ms(db.updated_at).max(file.map(|f| f.modified).unwrap_or(0));
        let size = file.map(|f| f.size).or_else(|| fs::metadata(&path).ok().map(|m| m.len())).unwrap_or(0);
        let created = file
            .and_then(|f| f.meta.created.clone())
            .or_else(|| (db.created_at > 0).then(|| normalize_epoch_ms(db.created_at).to_string()));

        sessions_by_id.insert(
            db.id.clone(),
            SessionRecord {
                id: db.id.clone(),
                path,
                title,
                cwd,
                project_key: normalize_project_key(&display_project),
                project_display: display_project,
                created,
                modified,
                size,
                archived,
                internal,
                has_user_event: db.has_user_event,
                body_exists,
                source,
            },
        );
        if i % 100 == 0 || i + 1 == db_threads.len() {
            let pct = 52.0 + 20.0 * ((i + 1) as f64 / db_threads.len().max(1) as f64);
            emit_progress(app, "merge", i + 1, db_threads.len(), pct, format!("合并 state thread {}/{}", i + 1, db_threads.len()));
        }
    }

    let mut orphan_sessions = 0usize;
    let mut seen_orphan_ids = HashSet::new();
    for file in &files {
        if sessions_by_id.contains_key(&file.meta.id) || !seen_orphan_ids.insert(file.meta.id.clone()) {
            continue;
        }
        orphan_sessions += 1;
        let cwd = file.meta.cwd.clone();
        let display_project = if merge_git_roots {
            let key = normalize_project_key(&cwd);
            git_cache
                .entry(key)
                .or_insert_with(|| find_git_root(&cwd))
                .clone()
                .unwrap_or_else(|| cwd.clone())
        } else {
            cwd.clone()
        };
        let title = titles.get(&file.meta.id).cloned().unwrap_or_else(|| "(未命名会话)".to_string());
        let source = file.meta.source.clone();
        let internal = source_is_internal(&source, "", "");
        let has_user_event = detect_user_event(&file.path);
        sessions_by_id.insert(
            file.meta.id.clone(),
            SessionRecord {
                id: file.meta.id.clone(),
                path: file.path.clone(),
                title,
                cwd,
                project_key: normalize_project_key(&display_project),
                project_display: display_project,
                created: file.meta.created.clone(),
                modified: file.modified,
                size: file.size,
                archived: file.archived_path,
                internal,
                has_user_event,
                body_exists: true,
                source,
            },
        );
    }

    logs.push(format!("state ↔ rollout 正文匹配：{}，state 中正文缺失：{}，JSONL 孤立兜底：{}。", db_body_matches, db_missing_bodies, orphan_sessions));

    emit_progress(app, "projects", sessions_by_id.len(), sessions_by_id.len(), 86.0, "阶段 5/5：按有效用户对话整理项目与归档计数");
    let mut sessions: Vec<SessionRecord> = sessions_by_id.into_values().collect();
    sessions.sort_by_key(|s| Reverse(s.modified));

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
        if s.archived { entry.archived_count += 1; } else { entry.active_count += 1; }
        if !s.body_exists { entry.missing_body_count += 1; }
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
    let named_sessions = sessions.iter().filter(valid).filter(|s| s.title != "(未命名会话)").count();
    let missing_body_sessions = sessions.iter().filter(valid).filter(|s| !s.body_exists).count();

    logs.push(format!("统计口径：原始 thread {}；有效用户对话 {}，其中活动 {}、归档 {}；内部 {}；无用户事件 {}。", raw_threads, total_sessions, active_sessions, archived_sessions, internal_sessions, non_user_sessions));
    logs.push(format!("项目 {} 个；有效对话中正文缺失 {}；命名对话 {}。", projects.len(), missing_body_sessions, named_sessions));
    emit_progress(app, "done", total_sessions, total_sessions, 100.0, "扫描完成");

    let elapsed_ms = started.elapsed().as_millis();
    let catalog = Catalog { root: root.clone(), sessions, projects: projects.clone() };
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
    if args.filter == "archived" {
        if !s.archived {
            return false;
        }
    } else if args.filter == "active" {
        if s.archived {
            return false;
        }
    } else if s.archived && !args.include_archived {
        return false;
    }
    let age_limit = match args.filter.as_str() {
        "7d" => Some(7u64 * 24 * 60 * 60 * 1000),
        "30d" => Some(30u64 * 24 * 60 * 60 * 1000),
        _ => None,
    };
    if let Some(limit) = age_limit {
        if now_ms.saturating_sub(s.modified) > limit {
            return false;
        }
    }
    let q = args.search.trim().to_ascii_lowercase();
    if !q.is_empty()
        && !s.title.to_ascii_lowercase().contains(&q)
        && !s.cwd.to_ascii_lowercase().contains(&q)
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
        // Current page remains cheap. Clicking one row uses the larger preview window.
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
    let file = fs::File::open(path).map_err(|e| format!("读取会话失败：{}", e))?;
    let reader = BufReader::new(file.take(cap as u64));
    let mut thread_name = String::new();
    let mut first_user = String::new();
    for line in reader.lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
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

fn scan_tail(path: &Path, cap: usize) -> Result<(Option<String>, Option<String>), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("读取会话失败：{}", e))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(cap as u64);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("读取会话尾部失败：{}", e))?;
    let mut buf = String::new();
    file.read_to_string(&mut buf)
        .map_err(|e| format!("读取会话尾部失败：{}", e))?;
    if start > 0 {
        if let Some(pos) = buf.find('\n') {
            buf.drain(..=pos);
        }
    }
    let mut latest_name = None;
    let mut latest_user = None;
    for line in buf.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if let Some(name) = thread_name_update(&v) {
            latest_name = Some(name);
        }
        if let Some(text) = user_text(&v) {
            if !is_internal_user_text(&text) {
                latest_user = Some(text);
            }
        }
    }
    Ok((latest_name, latest_user))
}

pub fn user_text(v: &Value) -> Option<String> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let payload = v.get("payload")?;
    let pt = payload.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("event_msg", "user_message") => payload.get("message").and_then(Value::as_str).map(str::to_string),
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
        ("event_msg", "agent_message") => payload.get("message").and_then(Value::as_str).map(str::to_string),
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
        ("response_item", "message") if payload.get("role").and_then(Value::as_str) == Some("assistant") => {
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
    fn normalizes_seconds_and_milliseconds() {
        assert_eq!(normalize_epoch_ms(1_700_000_000), 1_700_000_000_000);
        assert_eq!(normalize_epoch_ms(1_700_000_000_000), 1_700_000_000_000);
    }

    #[test]
    fn flags_known_internal_sources() {
        assert!(source_is_internal("guardian", "", ""));
        assert!(source_is_internal("cli", "subagent", ""));
        assert!(!source_is_internal("cli", "", "gpt-5"));
    }
}
