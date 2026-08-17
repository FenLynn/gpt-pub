import { invoke } from '@tauri-apps/api/core'
import type {
  ExportResult,
  ListSessionsArgs,
  PreflightResult,
  ProjectInfo,
  ScanResult,
  SessionPage,
  SessionPreview,
  SessionSummary,
} from './types'

export const defaultCodexRoot = () => invoke<string>('default_codex_root')

export const scanCatalog = (root: string, mergeGitRoots: boolean) =>
  invoke<ScanResult>('scan_catalog', { root, mergeGitRoots })

export const cancelScan = () => invoke<void>('cancel_scan')
export const listProjects = () => invoke<ProjectInfo[]>('list_projects')

export const listSessions = (args: ListSessionsArgs) =>
  invoke<SessionPage>('list_sessions', { args })

export const exportCandidates = (args: Omit<ListSessionsArgs, 'offset' | 'limit'>) =>
  invoke<SessionSummary[]>('export_candidates', { args })

export const sessionPreview = (path: string) =>
  invoke<SessionPreview>('session_preview', { path })

export const chooseOutputPath = (suggested: string) =>
  invoke<string | null>('choose_output_path', { suggested })

export const preflightExport = (sessions: SessionSummary[]) =>
  invoke<PreflightResult>('preflight_export', { sessions })

export const exportMarkdown = (payload: {
  sessions: SessionSummary[]
  projectPath: string
  targetPath: string
  includeTools: boolean
  maxToolChars: number
}) => invoke<ExportResult>('export_markdown', { request: payload })

export const cancelExport = () => invoke<void>('cancel_export')
export const openPath = (path: string, reveal = false) => invoke<void>('open_path', { path, reveal })
