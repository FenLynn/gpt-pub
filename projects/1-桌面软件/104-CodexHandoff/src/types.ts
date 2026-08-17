export interface ProjectInfo {
  key: string
  displayPath: string
  sessionCount: number
  lastModified: number
}

export interface SessionSummary {
  id: string
  path: string
  title: string
  cwd: string
  created?: string | null
  modified: number
  size: number
  archived: boolean
  internal: boolean
  lastUserPreview?: string | null
}

export interface SessionPage {
  total: number
  sessions: SessionSummary[]
}

export interface SessionPreview {
  title: string
  cwd: string
  created?: string | null
  modified: number
  size: number
  lastUser: string
}

export interface ScanResult {
  root: string
  projects: ProjectInfo[]
  totalSessions: number
  activeSessions: number
  archivedSessions: number
  internalSessions: number
  namedSessions: number
  elapsedMs: number
  logs: string[]
}

export interface ProgressEvent {
  phase: string
  current: number
  total: number
  percent: number
  message: string
  timestamp: string
}

export interface PreflightResult {
  sessionCount: number
  totalBytes: number
  sensitiveHits: Record<string, number>
  warnings: string[]
}

export interface ExportResult {
  outputPath: string
  sessionCount: number
  messageCount: number
  bytesWritten: number
  elapsedMs: number
}

export interface ListSessionsArgs {
  projectKey: string
  offset: number
  limit: number
  filter: string
  search: string
  includeInternal: boolean
  includeArchived: boolean
}
