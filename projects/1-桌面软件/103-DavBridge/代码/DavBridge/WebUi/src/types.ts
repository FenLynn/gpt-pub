export type PrimaryAction = 'pause' | 'resume' | 'retry' | 'review' | 'settings' | 'none'
export type RecycleKind = 'observing' | 'review' | 'history'

export interface PhaseStep {
  key: string
  label: string
  state: 'done' | 'active' | 'waiting' | 'warning'
  hint: string
}

export interface QuotaInfo {
  uploadUsed: number
  uploadMax: number
  uploadText: string
  downloadUsed: number
  downloadMax: number
  downloadText: string
  resetText: string
  isSprint: boolean
}

export interface HealthInfo {
  status: 'ok' | 'warning' | 'error' | 'not_checked'
  summary: string
  checkedAt: string
}

export interface RuntimeInfo {
  uptimeText: string
  previousExitText: string
  uncleanExitCount: number
  cleanupText: string
}

export interface InitializationStep {
  key: string
  label: string
  done: boolean
  hint: string
}

export interface ActivityItem {
  time: string
  title: string
  detail: string
  tone: 'info' | 'success' | 'warning'
}

export interface OperationalHealthInfo {
  hours: number
  warningCount: number
  networkWaitCount: number
  pauseCount: number
  completionCount: number
  backlogCount: number
  verifiedCount: number
  windowComplete: boolean
  observationGap: boolean
  observationGapSeconds: number
}

export interface RecycleGroup {
  groupKey: string
  name: string
  firstMissing: string
  lastDecision: string
  sizeText: string
  verifiedText: string
  state: string
  disposition: RecycleKind | 'blocked'
  issue?: string
}

export interface DavBridgeSnapshot {
  version: string
  buildCommit: string
  buildDate: string
  cycleId: string
  configured: boolean
  engineState: string
  routeStatus: string
  routeTone: 'active' | 'wait' | 'warning' | 'complete' | 'idle'
  phases: PhaseStep[]
  verified: number
  total: number
  coverage: number
  coverageText: string
  currentTitle: string
  currentDetail: string
  currentProgress: number | null
  quota: QuotaInfo
  priorityCount: number
  normalCount: number
  humanActionCount: number
  primaryAction: PrimaryAction
  primaryLabel: string
  health: HealthInfo
  runtime: RuntimeInfo
  initialization: InitializationStep[]
  activities: ActivityItem[]
  operationalHealth: OperationalHealthInfo
  recycle: RecycleGroup[]
}
