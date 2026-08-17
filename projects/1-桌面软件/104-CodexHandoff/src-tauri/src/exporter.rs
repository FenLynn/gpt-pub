use crate::codex::{assistant_text, clean_visible_text, hydrate_summary, is_internal_user_text, truncate_chars, user_text};
use crate::types::{ExportRequest, ExportResult, PreflightResult, ProgressEvent, SessionSummary};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

fn unix_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn emit_progress(app: &AppHandle, phase: &str, current: usize, total: usize, percent: f64, message: impl Into<String>) {
    let _ = app.emit("export-progress", ProgressEvent {
        phase: phase.to_string(), current, total, percent, message: message.into(), timestamp: unix_ms().to_string(),
    });
}

fn count_occurrences(haystack: &str, needle: &str) -> usize {
    if needle.is_empty() { 0 } else { haystack.match_indices(needle).count() }
}

pub fn preflight_impl(sessions: &[SessionSummary], app: &AppHandle, cancel: &AtomicBool) -> Result<PreflightResult, String> {
    cancel.store(false, Ordering::SeqCst);
    let mut total_bytes = 0u64;
    let mut hits: BTreeMap<String, usize> = BTreeMap::new();
    let patterns = [
        ("API Key", "api_key"),
        ("Access Token", "access_token"),
        ("Refresh Token", "refresh_token"),
        ("Password", "password"),
        ("Authorization", "authorization"),
        ("Bearer Token", "bearer "),
        ("OpenAI-style Key", "sk-"),
    ];
    for (i, session) in sessions.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) { return Err("export_cancelled".to_string()); }
        total_bytes = total_bytes.saturating_add(session.size);
        let file = fs::File::open(&session.path).map_err(|e| format!("预检无法读取 {}：{}", session.title, e))?;
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let lower = line.to_ascii_lowercase();
            for (label, needle) in patterns {
                let count = count_occurrences(&lower, needle);
                if count > 0 { *hits.entry(label.to_string()).or_insert(0) += count; }
            }
        }
        let pct = 100.0 * (i + 1) as f64 / sessions.len().max(1) as f64;
        emit_progress(app, "preflight", i + 1, sessions.len(), pct, format!("敏感信息预检 {}/{}：{}", i + 1, sessions.len(), session.title));
    }
    let mut warnings = Vec::new();
    if !hits.is_empty() { warnings.push("检测到疑似凭据或认证字段，请确认 Markdown 的保存位置与后续 Git 操作安全。".to_string()); }
    Ok(PreflightResult { session_count: sessions.len(), total_bytes, sensitive_hits: hits, warnings })
}

fn normalize_compare(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}

fn is_under(child: &Path, parent: &Path) -> bool {
    let c = normalize_compare(child);
    let p = normalize_compare(parent);
    c == p || c.starts_with(&(p + "\\"))
}

fn validate_target(target: &Path, codex_root: &Path) -> Result<(), String> {
    if target.as_os_str().is_empty() { return Err("输出路径为空。".to_string()); }
    if is_under(target, codex_root) { return Err("安全保护：禁止向 Codex 原始数据目录写入任何文件。".to_string()); }
    if let Some(home) = dirs::home_dir() {
        if is_under(target, &home.join(".gemini")) { return Err("安全保护：禁止向 Antigravity / Gemini 原始数据目录写入导出文件。".to_string()); }
    }
    if target.exists() { return Err("目标文件已经存在。程序默认不覆盖，请选择新的文件名。".to_string()); }
    let parent = target.parent().ok_or_else(|| "输出路径缺少父目录。".to_string())?;
    if !parent.is_dir() { return Err(format!("输出目录不存在：{}", parent.display())); }
    Ok(())
}

fn escape_table(text: &str) -> String { text.replace('|', "\\|").replace('\n', " ").replace('\r', " ") }
fn safe_title(text: &str) -> String {
    let cleaned = clean_visible_text(text);
    if cleaned.trim().is_empty() { "(未命名会话)".to_string() } else { cleaned }
}

fn create_temp_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target.parent().ok_or_else(|| "输出路径无父目录".to_string())?;
    let file_name = target.file_name().and_then(|x| x.to_str()).unwrap_or("CODEX-HANDOFF.md");
    let pid = std::process::id();
    for n in 0..1000u32 {
        let candidate = parent.join(format!(".{}.tmp.{}.{}", file_name, pid, n));
        if !candidate.exists() { return Ok(candidate); }
    }
    Err("无法创建唯一临时文件名。".to_string())
}

fn content_text(content: Option<&Value>) -> Option<String> {
    let arr = content?.as_array()?;
    let parts: Vec<&str> = arr.iter().filter_map(|b| {
        let kind = b.get("type").and_then(Value::as_str).unwrap_or_default();
        if matches!(kind, "input_text" | "text" | "Text" | "output_text") { b.get("text").and_then(Value::as_str) } else { None }
    }).filter(|s| !s.trim().is_empty()).collect();
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

fn write_message<W: Write>(w: &mut W, role: &str, text: &str) -> std::io::Result<()> {
    let text = clean_visible_text(text);
    if text.is_empty() { return Ok(()); }
    writeln!(w, "### {}", role)?; writeln!(w)?; writeln!(w, "{}", text)?; writeln!(w)?; Ok(())
}

fn tool_call_from(v: &Value) -> Option<(String, String)> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let p = v.get("payload")?;
    let pt = p.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("response_item", "function_call") => Some((
            p.get("name").and_then(Value::as_str).unwrap_or("tool").to_string(),
            p.get("arguments").map(|v| if let Value::String(s) = v { s.clone() } else { v.to_string() }).unwrap_or_default(),
        )),
        ("response_item", "custom_tool_call") => Some((
            p.get("name").and_then(Value::as_str).unwrap_or("tool").to_string(),
            p.get("input").map(|v| if let Value::String(s) = v { s.clone() } else { v.to_string() }).unwrap_or_default(),
        )),
        ("event_msg", "exec_command_begin") => Some((
            "shell".to_string(),
            p.get("command").or_else(|| p.get("cmd")).map(|v| if let Value::String(s) = v { s.clone() } else { v.to_string() }).unwrap_or_default(),
        )),
        _ => None,
    }
}

fn tool_result_from(v: &Value) -> Option<String> {
    let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
    let p = v.get("payload")?;
    let pt = p.get("type").and_then(Value::as_str).unwrap_or_default();
    match (t, pt) {
        ("response_item", "function_call_output") | ("response_item", "custom_tool_call_output") => p.get("output").map(|v| if let Value::String(s) = v { s.clone() } else { v.to_string() }),
        ("event_msg", "exec_command_end") => p.get("output").or_else(|| p.get("aggregated_output")).map(|v| if let Value::String(s) = v { s.clone() } else { v.to_string() }),
        _ => None,
    }
}

fn write_tool_call<W: Write>(w: &mut W, name: &str, args: &str, max_chars: usize) -> std::io::Result<()> {
    writeln!(w, "<details>")?;
    writeln!(w, "<summary>工具调用：{}</summary>", name.replace('<', "&lt;").replace('>', "&gt;"))?;
    writeln!(w)?; writeln!(w, "```json")?; writeln!(w, "{}", truncate_chars(args, max_chars))?; writeln!(w, "```")?; writeln!(w)?; writeln!(w, "</details>")?; writeln!(w)?; Ok(())
}

fn write_tool_result<W: Write>(w: &mut W, result: &str, max_chars: usize) -> std::io::Result<()> {
    writeln!(w, "<details>")?; writeln!(w, "<summary>工具结果</summary>")?; writeln!(w)?;
    writeln!(w, "```text")?; writeln!(w, "{}", truncate_chars(result, max_chars))?; writeln!(w, "```")?; writeln!(w)?; writeln!(w, "</details>")?; writeln!(w)?; Ok(())
}

fn render_session<W: Write>(w: &mut W, session: &SessionSummary, include_tools: bool, max_tool_chars: usize, cancel: &AtomicBool) -> Result<usize, String> {
    let file = fs::File::open(&session.path).map_err(|e| format!("无法读取会话 {}：{}", session.title, e))?;
    let mut message_count = 0usize;
    let mut last_user = String::new();
    let mut last_assistant = String::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if cancel.load(Ordering::SeqCst) { return Err("export_cancelled".to_string()); }
        if line.trim().is_empty() { continue; }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(text) = user_text(&v) {
            let text = clean_visible_text(&text);
            if !text.is_empty() && !is_internal_user_text(&text) && text != last_user {
                write_message(w, "User", &text).map_err(|e| e.to_string())?;
                last_user = text; message_count += 1;
            }
            continue;
        }
        if let Some(text) = assistant_text(&v) {
            let text = clean_visible_text(&text);
            if !text.is_empty() && text != last_assistant {
                write_message(w, "Codex", &text).map_err(|e| e.to_string())?;
                last_assistant = text; message_count += 1;
            }
            continue;
        }
        if include_tools {
            if let Some((name, args)) = tool_call_from(&v) { write_tool_call(w, &name, &args, max_tool_chars).map_err(|e| e.to_string())?; continue; }
            if let Some(result) = tool_result_from(&v) { write_tool_result(w, &result, max_tool_chars).map_err(|e| e.to_string())?; continue; }
        }
        let payload = v.get("payload");
        if v.get("type").and_then(Value::as_str) == Some("event_msg") && payload.and_then(|p| p.get("type")).and_then(Value::as_str) == Some("item_completed") {
            if let Some(item) = payload.and_then(|p| p.get("item")) {
                if item.get("type").and_then(Value::as_str) == Some("AgentMessage") {
                    if let Some(text) = item.get("text").and_then(Value::as_str).map(str::to_string).or_else(|| content_text(item.get("content"))) {
                        let text = clean_visible_text(&text);
                        if !text.is_empty() && text != last_assistant {
                            write_message(w, "Codex", &text).map_err(|e| e.to_string())?;
                            last_assistant = text; message_count += 1;
                        }
                    }
                }
            }
        }
    }
    Ok(message_count)
}

pub fn export_impl(request: &ExportRequest, codex_root: &Path, app: &AppHandle, cancel: &AtomicBool) -> Result<ExportResult, String> {
    let started = Instant::now();
    cancel.store(false, Ordering::SeqCst);
    if request.sessions.is_empty() { return Err("没有可导出的会话。".to_string()); }
    let target = PathBuf::from(&request.target_path);
    validate_target(&target, codex_root)?;
    let temp = create_temp_path(&target)?;
    let file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| format!("创建临时输出文件失败：{}", e))?;
    let mut writer = BufWriter::new(file);

    let write_result = (|| -> Result<(usize, usize), String> {
        writeln!(writer, "# Codex Project Handoff").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        writeln!(writer, "> 本文件由 CodexHandoff 以只读方式从 Codex 本地会话生成。历史讨论用于恢复上下文，当前代码与仓库实际状态应作为最终事实依据。").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        writeln!(writer, "## 导出信息").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        writeln!(writer, "- Project: `{}`", request.project_path.replace('`', "'")).map_err(|e| e.to_string())?;
        writeln!(writer, "- Exported by: CodexHandoff v1.0.0 alpha 1").map_err(|e| e.to_string())?;
        writeln!(writer, "- Sessions: {}", request.sessions.len()).map_err(|e| e.to_string())?;
        writeln!(writer, "- Tool details: {}", if request.include_tools { "included" } else { "omitted" }).map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        writeln!(writer, "## 对话索引").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        writeln!(writer, "| # | Codex 对话名称 | 最后一条用户输入 | 最后活动 |").map_err(|e| e.to_string())?;
        writeln!(writer, "|---:|---|---|---|").map_err(|e| e.to_string())?;

        let mut hydrated = Vec::with_capacity(request.sessions.len());
        for (i, original) in request.sessions.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) { return Err("export_cancelled".to_string()); }
            let mut s = original.clone();
            let _ = hydrate_summary(&mut s, 8 * 1024 * 1024);
            writeln!(writer, "| {} | {} | {} | {} |", i + 1, escape_table(&safe_title(&s.title)), escape_table(s.last_user_preview.as_deref().unwrap_or("")), s.modified).map_err(|e| e.to_string())?;
            hydrated.push(s);
        }
        writeln!(writer).map_err(|e| e.to_string())?; writeln!(writer, "---").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;

        let mut message_count = 0usize;
        for (i, session) in hydrated.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) { return Err("export_cancelled".to_string()); }
            let pct = 5.0 + 90.0 * (i as f64 / hydrated.len().max(1) as f64);
            emit_progress(app, "export", i, hydrated.len(), pct, format!("正在导出 {}/{}：{}", i + 1, hydrated.len(), session.title));
            writeln!(writer, "# Conversation {}", i + 1).map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
            writeln!(writer, "## {}", safe_title(&session.title)).map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
            writeln!(writer, "- Thread ID: `{}`", session.id).map_err(|e| e.to_string())?;
            writeln!(writer, "- Workspace: `{}`", session.cwd.replace('`', "'")).map_err(|e| e.to_string())?;
            if let Some(created) = &session.created { writeln!(writer, "- Created: {}", created).map_err(|e| e.to_string())?; }
            writeln!(writer, "- Archived: {}", session.archived).map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
            message_count += render_session(&mut writer, session, request.include_tools, request.max_tool_chars, cancel)?;
            writeln!(writer, "---").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        }

        writeln!(writer, "# Antigravity 接续说明").map_err(|e| e.to_string())?; writeln!(writer).map_err(|e| e.to_string())?;
        writeln!(writer, "在 Antigravity CLI 中，将本文件放在项目工作区后，可使用 `@CODEX-HANDOFF.md` 载入。建议先核对当前代码与仓库实际状态，再以本文件恢复历史上下文并继续开发。").map_err(|e| e.to_string())?;
        writeln!(writer).map_err(|e| e.to_string())?; writeln!(writer, "# End of Codex History").map_err(|e| e.to_string())?;
        Ok((hydrated.len(), message_count))
    })();

    let (_rendered_sessions, message_count) = match write_result {
        Ok(v) => v,
        Err(err) => { drop(writer); let _ = fs::remove_file(&temp); return Err(err); }
    };
    writer.flush().map_err(|e| format!("刷新导出文件失败：{}", e))?;
    writer.get_ref().sync_all().map_err(|e| format!("同步导出文件失败：{}", e))?;
    drop(writer);
    if cancel.load(Ordering::SeqCst) { let _ = fs::remove_file(&temp); return Err("export_cancelled".to_string()); }
    fs::rename(&temp, &target).map_err(|e| { let _ = fs::remove_file(&temp); format!("完成临时文件但原子改名失败：{}", e) })?;
    emit_progress(app, "done", request.sessions.len(), request.sessions.len(), 100.0, "导出完成");
    let bytes_written = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    Ok(ExportResult { output_path: target.to_string_lossy().to_string(), session_count: request.sessions.len(), message_count, bytes_written, elapsed_ms: started.elapsed().as_millis() })
}
