export type PrimaryAction = 'pause' | 'resume' | 'review' | 'none'
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
  recycle: RecycleGroup[]
}
