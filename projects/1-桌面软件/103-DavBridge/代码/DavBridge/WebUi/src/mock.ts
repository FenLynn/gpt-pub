import type { DavBridgeSnapshot } from './types'

export const mockSnapshot: DavBridgeSnapshot = {
  version: '0.4.12', buildCommit: 'preview', buildDate: '2026-09-12T16:20:00Z', cycleId: '260907', configured: true, engineState: '运行中', routeStatus: '普通迁移中', routeTone: 'active',
  phases: [
    { key: 'audit', label: '源端对账', state: 'done', hint: '本周期源端清单已经完成核对' },
    { key: 'repair', label: '变化修复', state: 'done', hint: '历史 StrongVerified 变化项已经处理' },
    { key: 'migration', label: '普通迁移', state: 'active', hint: '普通稳定队列正在处理' }
  ],
  verified: 2090, total: 6949, coverage: 0.301, coverageText: '2090 / 6949 已校准',
  currentTitle: 'BZR4PLGF.zip', currentDetail: '当前正在处理普通迁移任务。', currentProgress: 0.63,
  quota: { uploadUsed: 820000000, uploadMax: 1000000000, uploadText: '820.0 MB / 1.0 GB', downloadUsed: 781100000, downloadMax: 3000000000, downloadText: '781.1 MB / 3.0 GB', resetText: '2026-10-07 · 09:00 后探测', isSprint: false },
  priorityCount: 0, normalCount: 2704, humanActionCount: 0, primaryAction: 'pause', primaryLabel: '暂停',
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
