import type { DavBridgeSnapshot } from './types'

export const mockSnapshot: DavBridgeSnapshot = {
  version: '0.5.4', buildCommit: 'preview', buildDate: '2026-09-13T19:20:00Z', cycleId: '260907', configured: true, engineState: '运行中', routeStatus: '普通迁移中', routeTone: 'active',
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
  operationalHealth: { hours:24, warningCount:1, networkWaitCount:0, pauseCount:1, completionCount:1, backlogCount:2704, verifiedCount:2090, windowComplete:false, observationGap:true, observationGapSeconds:7200 },
  recycle: [],
  data: {
    dataRoot: 'C:\\Users\\User\\AppData\\Roaming\\DavBridge',
    localRoot: 'C:\\Users\\User\\AppData\\Local\\DavBridge',
    bootstrapPath: 'C:\\Users\\User\\AppData\\Local\\DavBridge\\bootstrap.json',
    backupDirectory: 'C:\\Users\\User\\AppData\\Roaming\\DavBridge\\Backups',
    lastBackupText: '09-14 19:10',
    lastBackupPath: 'D:\\Backups\\DavBridge-Backup-20260914-1910.zip',
    hasManualBackup: true,
    presentPersistentCount: 7,
    files: [
      { key:'config', label:'config.json', category:'核心配置', path:'C:\\Users\\User\\AppData\\Roaming\\DavBridge\\config.json', purpose:'连接、额度与运行设置', backupPolicy:'迁移备份', status:'存在 · 2.4 KB', exists:true },
      { key:'state', label:'state.json', category:'迁移账本', path:'C:\\Users\\User\\AppData\\Roaming\\DavBridge\\state.json', purpose:'StrongVerified、迁移断点与额度增量', backupPolicy:'迁移备份', status:'存在 · 4.8 MB', exists:true },
      { key:'reconcile', label:'reconcile.json', category:'对账状态', path:'C:\\Users\\User\\AppData\\Roaming\\DavBridge\\reconcile.json', purpose:'Cycle 对账、回收站观察和删除资格', backupPolicy:'迁移备份', status:'存在 · 36 KB', exists:true },
      { key:'secrets', label:'secrets.dat', category:'凭据', path:'C:\\Users\\User\\AppData\\Roaming\\DavBridge\\secrets.dat', purpose:'Windows DPAPI CurrentUser 保护的 WebDAV 凭据', backupPolicy:'本机可恢复，跨用户可能跳过', status:'存在 · 0.6 KB', exists:true },
      { key:'experience', label:'product-experience.json', category:'体验记录', path:'C:\\Users\\User\\AppData\\Local\\DavBridge\\product-experience.json', purpose:'About 健康、活动和观察连续性', backupPolicy:'迁移备份', status:'存在 · 18 KB', exists:true },
      { key:'window', label:'window.json', category:'本机外观', path:'C:\\Users\\User\\AppData\\Local\\DavBridge\\window.json', purpose:'窗口位置与尺寸', backupPolicy:'不迁移', status:'存在 · 0.2 KB', exists:true },
      { key:'temp', label:'Temp', category:'临时目录', path:'C:\\Users\\User\\AppData\\Local\\DavBridge\\Temp', purpose:'下载和探测临时文件', backupPolicy:'不备份', status:'目录', exists:true }
    ]
  }
}
