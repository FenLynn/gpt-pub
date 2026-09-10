import type { DavBridgeSnapshot } from './types'

export const mockSnapshot: DavBridgeSnapshot = {
  version: '0.4.3', cycleId: '260907', configured: true, engineState: '运行中', routeStatus: '普通迁移中', routeTone: 'active',
  phases: [
    { key: 'audit', label: '源端对账', state: 'done', hint: '本周期源端清单已经完成核对' },
    { key: 'repair', label: '变化修复', state: 'done', hint: '历史 StrongVerified 变化项已经处理' },
    { key: 'migration', label: '普通迁移', state: 'active', hint: '正在处理普通迁移任务池' }
  ],
  verified: 1542, total: 6949, coverage: 0.2219, coverageText: '1,542 / 6,949 已核准',
  currentTitle: '9DTRKEAU.zip', currentDetail: '正在上传目标文件', currentProgress: 0.05,
  quota: { uploadUsed: 35500000, uploadMax: 1000000000, uploadText: '35.5 MB / 1.00 GB', downloadUsed: 17700000, downloadMax: 3000000000, downloadText: '17.7 MB / 3.00 GB', resetText: '2026-10-07 · 09:00 后探测', isSprint: false },
  priorityCount: 0, normalCount: 2704, humanActionCount: 0, primaryAction: 'pause', primaryLabel: '暂停', recycle: []
}
