import type { DavBridgeSnapshot } from './types'

export const mockSnapshot: DavBridgeSnapshot = {
  version: '0.4.3', cycleId: '260907', configured: true, engineState: '等待额度', routeStatus: '等待下一周期', routeTone: 'wait',
  phases: [
    { key: 'audit', label: '源端对账', state: 'done', hint: '本周期源端清单已经完成核对' },
    { key: 'repair', label: '变化修复', state: 'done', hint: '历史 StrongVerified 变化项已经处理' },
    { key: 'migration', label: '等待周期', state: 'waiting', hint: '当前安全额度不足，等待下一周期继续' }
  ],
  verified: 2090, total: 6949, coverage: 0.301, coverageText: '2090 / 6949 已校准',
  currentTitle: '等待下一周期', currentDetail: '坚果云当前安全额度不足，账本与断点保持不变。', currentProgress: null,
  quota: { uploadUsed: 794100000, uploadMax: 1000000000, uploadText: '794.1 MB / 1.0 GB', downloadUsed: 781100000, downloadMax: 3000000000, downloadText: '781.1 MB / 3.0 GB', resetText: '2026-10-07 · 09:00 后探测', isSprint: false },
  priorityCount: 0, normalCount: 2704, humanActionCount: 0, primaryAction: 'pause', primaryLabel: '暂停', recycle: []
}
