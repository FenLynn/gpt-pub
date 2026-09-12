import type { DavBridgeSnapshot } from './types'

export const mockSnapshot: DavBridgeSnapshot = {
  version: '0.4.7', buildCommit: 'preview', buildDate: '2026-09-11T10:50:00Z', cycleId: '260907', configured: true, engineState: '等待额度', routeStatus: '等待下一周期', routeTone: 'wait',
  phases: [
    { key: 'audit', label: '源端对账', state: 'done', hint: '本周期源端清单已经完成核对' },
    { key: 'repair', label: '变化修复', state: 'done', hint: '历史 StrongVerified 变化项已经处理' },
    { key: 'migration', label: '等待周期', state: 'waiting', hint: '当前安全额度不足，等待下一周期继续' }
  ],
  verified: 2090, total: 6949, coverage: 0.301, coverageText: '2090 / 6949 已校准',
  currentTitle: '等待下一周期', currentDetail: '坚果云当前安全额度不足，账本与断点保持不变。', currentProgress: null,
  quota: { uploadUsed: 794100000, uploadMax: 1000000000, uploadText: '794.1 MB / 1.0 GB', downloadUsed: 781100000, downloadMax: 3000000000, downloadText: '781.1 MB / 3.0 GB', resetText: '2026-10-07 · 09:00 后探测', isSprint: false },
  priorityCount: 0, normalCount: 2704, humanActionCount: 0, primaryAction: 'none', primaryLabel: '',
  health: { status: 'ok', summary: '运行依赖、Data 目录与状态文件正常', checkedAt: '09-11 18:50' },
  runtime: { uptimeText: '已运行 2 小时 18 分', previousExitText: '上次正常退出', uncleanExitCount: 0, cleanupText: '无中断残留' },
  initialization: [
    { key:'connection', label:'连接', done:true, hint:'源端与目标端连接诊断已通过' },
    { key:'scan', label:'扫描', done:true, hint:'迁移就绪扫描已通过' },
    { key:'quota', label:'流量', done:true, hint:'流量已校准' },
    { key:'first', label:'首组', done:true, hint:'首组真实强校验已通过' },
    { key:'existing', label:'既有副本', done:true, hint:'既有副本 NO-WRITE 验证已通过' }
  ],
  activities: [
    { time:'09-11 18:48', title:'等待下一周期', detail:'当前额度不足，账本与断点保持不变。', tone:'info' },
    { time:'09-11 18:42', title:'运行环境自检', detail:'运行依赖与本机 Data 状态正常。', tone:'success' },
    { time:'09-11 18:41', title:'应用启动', detail:'本机配置、账本与运行状态已载入。', tone:'info' }
  ],
  recycle: []
}
