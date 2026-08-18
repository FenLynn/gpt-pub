import type { DavBridgeSnapshot } from './types'

export const mockSnapshot: DavBridgeSnapshot = {
  version: '0.4.0', cycleId: '260907', configured: true, engineState: '等待额度', routeStatus: '等待下一周期', routeTone: 'wait',
  phases: [
    { key: 'audit', label: '源端对账', state: 'done', hint: '本周期源端清单已经完成核对' },
    { key: 'repair', label: '变化修复', state: 'done', hint: '历史 StrongVerified 变化项已经处理' },
    { key: 'migration', label: '普通迁移', state: 'waiting', hint: '等待下一额度周期继续普通任务' }
  ],
  verified: 1526, total: 6933, coverage: 0.2201, coverageText: '1,526 / 6,933 已核准',
  currentTitle: '等待下一周期', currentDetail: '坚果云上传安全额度不足，账本与断点已经保存', currentProgress: null,
  quota: { uploadUsed: 946600000, uploadMax: 1000000000, uploadText: '946.6 MB / 1.00 GB', downloadUsed: 2090000000, downloadMax: 3000000000, downloadText: '2.09 GB / 3.00 GB', resetText: '2026-09-07 · 09:00 后探测', isSprint: false },
  priorityCount: 0, normalCount: 2704, humanActionCount: 0, primaryAction: 'pause', primaryLabel: '暂停', recycle: []
}
