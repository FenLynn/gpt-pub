use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub key: String,
    pub display_path: String,
    pub session_count: usize,
    pub active_count: usize,
    pub archived_count: usize,
    pub missing_body_count: usize,
    pub last_modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub cwd: String,
    pub created: Option<String>,
    pub modified: u64,
    pub size: u64,
    pub archived: bool,
    pub internal: bool,
    pub has_user_event: bool,
    pub body_exists: bool,
    pub source: String,
    pub last_user_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub total: usize,
    pub sessions: Vec<SessionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPreview {
    pub title: String,
    pub cwd: String,
    pub created: Option<String>,
    pub modified: u64,
    pub size: u64,
    pub last_user: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: String,
    pub projects: Vec<ProjectInfo>,
    /// Valid user conversations, active + archived, excluding internal threads.
    pub total_sessions: usize,
    pub active_sessions: usize,
    pub archived_sessions: usize,
    /// Raw discovered thread records before the user-conversation filter.
    pub raw_threads: usize,
    pub internal_sessions: usize,
    pub non_user_sessions: usize,
    pub named_sessions: usize,
    pub missing_body_sessions: usize,
    pub orphan_sessions: usize,
    pub elapsed_ms: u128,
    pub logs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub percent: f64,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsArgs {
    pub project_key: String,
    pub offset: usize,
    pub limit: usize,
    pub filter: String,
    pub search: String,
    pub include_internal: bool,
    pub include_archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    pub session_count: usize,
    pub total_bytes: u64,
    pub sensitive_hits: std::collections::BTreeMap<String, usize>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub sessions: Vec<SessionSummary>,
    pub project_path: String,
    pub target_path: String,
    pub include_tools: bool,
    pub max_tool_chars: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub session_count: usize,
    pub message_count: usize,
    pub bytes_written: u64,
    pub elapsed_ms: u128,
}
