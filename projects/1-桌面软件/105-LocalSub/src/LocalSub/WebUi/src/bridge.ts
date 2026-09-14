export type PageKey = "home" | "live" | "batch" | "models" | "settings" | "docs" | "about";

export interface LiveModelOption {
  id: string;
  name: string;
}

export interface ModelCatalogItem {
  id: string;
  name: string;
  purpose: string;
  languages: string;
  sizeText: string;
  realtimeScore: number;
  accuracyScore: number;
  valueScore: number;
  recommended: boolean;
  liveCapable: boolean;
  batchCapable: boolean;
  isComponent: boolean;
  installed: boolean;
  hasLocalData: boolean;
  needsRepair: boolean;
  liveSelected: boolean;
  batchSelected: boolean;
}

export interface LocalSubSnapshot {
  app: {
    productVersion: string;
    activePage: PageKey;
    busy: boolean;
    lastError: string | null;
  };
  core: {
    state: "stopped" | "starting" | "ready" | "busy" | "failed";
    pid: number | null;
    generation: number;
    currentOperation: string | null;
    lastError: string | null;
  };
  live: {
    state: "idle" | "starting" | "running" | "stopping" | "failed";
    sourceId: "potplayer" | "allAudio";
    source: string;
    modelId: string;
    modelName: string;
    availableModels: LiveModelOption[];
    level: number;
    status: string;
    currentText: string;
    previousText: string;
    lastError: string | null;
    canStart: boolean;
  };
  batch: {
    queued: number;
    completed: number;
    state: "idle" | "analyzing" | "transcribing" | "failed";
    status: string;
    selectedId: string;
    selectedName: string;
    queue: Array<{ id: string; name: string; state: string; analyzed: boolean; transcribed: boolean; segments: number; realTimeFactor: number | null; missing: boolean; retryable: boolean }>;
    media: null | { durationMs: number; sampleRate: number; channels: number; decoderName: string; waveform: number[] };
    transcript: Array<{ startMs: number; endMs: number; text: string; keywords: string[] }>;
    result: null | { durationMs: number; processingMs: number; decoderName: string; realTimeFactor: number; segments: number };
    progress: { percent: number | null; stage: string; detail: string };
    canAnalyze: boolean;
    canTranscribe: boolean;
    canRetry: boolean;
    canTranscribeAll: boolean;
    canRemove: boolean;
    canClear: boolean;
    canExport: boolean;
    canExportAll: boolean;
    canCancel: boolean;
    batchModelId: string;
    batchModelName: string;
    keywords: string;
    outputDirectoryName: string;
    outputDirectoryCustom: boolean;
    restored: boolean;
    lastError: string | null;
  };
  models: {
    catalog: ModelCatalogItem[];
    catalogCount: number;
    installedCount: number;
    liveModelId: string;
    liveModelName: string;
    batchModelId: string;
    batchModelName: string;
    status: string;
    operation: {
      state: "idle" | "running" | "failed";
      kind: "download" | "repair" | "delete" | null;
      modelId: string;
      modelName: string;
      stage: string;
      percent: number | null;
      detail: string;
      isIndeterminate: boolean;
      lastError: string | null;
      canCancel: boolean;
    };
  };
  settings: {
    audioSource: string;
    audioSourceId: "potplayer" | "allAudio";
    resourceProfile: "Eco" | "Auto" | "MaxPerformance";
    minimizeToTray: boolean;
    startWithWindows: boolean;
    startupRegistered: boolean;
    silentStartup: boolean;
    autoStartLive: boolean;
    showLiveLevelHistory: boolean;
    subtitleAutoSize: boolean;
    subtitleFontSize: number;
    subtitleAutoScalePercent: number;
    subtitleBottomOffset: number;
    subtitleMaxWidthPercent: number;
    subtitleBackground: "None" | "Light" | "Dark";
    subtitleBackgroundOpacity: number;
    subtitleDisplaySeconds: number;
    subtitleCurrentColor: string;
    subtitlePreviousColor: string;
    subtitlePreviousScalePercent: number;
    subtitlePreviousOpacity: number;
    subtitleOutlineColor: string;
    subtitleOutlineWidth: number;
    subtitleShadowOpacity: number;
  };
  system: {
    potPlayerDetected: boolean;
    autoStartPending: boolean;
    autoStartStatus: string;
  };
}

type BridgeResponse<T> = {
  kind?: "response";
  id: string;
  ok: boolean;
  result?: T;
  error?: string | null;
};

type BridgeEvent<T> = {
  kind: "event";
  event: string;
  payload: T;
};

const fallbackCatalog: ModelCatalogItem[] = [
  {
    id: "streaming-zipformer-zh-large-int8",
    name: "Zipformer Large 中文 INT8",
    purpose: "推荐实时：中文，实机效果较 Paraformer 更好",
    languages: "中",
    sizeText: "约 160 MB",
    realtimeScore: 8,
    accuracyScore: 8,
    valueScore: 9,
    recommended: true,
    liveCapable: true,
    batchCapable: false,
    isComponent: false,
    installed: true,
    hasLocalData: true,
    needsRepair: false,
    liveSelected: true,
    batchSelected: false
  },
  {
    id: "sensevoice-small-int8",
    name: "SenseVoice Small INT8",
    purpose: "推荐后台/模拟实时：中英，轻量、稳定",
    languages: "中/英",
    sizeText: "约 230 MB",
    realtimeScore: 6,
    accuracyScore: 8,
    valueScore: 9,
    recommended: true,
    liveCapable: true,
    batchCapable: true,
    isComponent: false,
    installed: true,
    hasLocalData: true,
    needsRepair: false,
    liveSelected: false,
    batchSelected: true
  },
  {
    id: "offline-zipformer-ctc-zh-int8",
    name: "Zipformer CTC Offline 中文 INT8",
    purpose: "推荐后台：中文，高准确、高性价比",
    languages: "中",
    sizeText: "约 350 MB",
    realtimeScore: 4,
    accuracyScore: 9,
    valueScore: 9,
    recommended: true,
    liveCapable: false,
    batchCapable: true,
    isComponent: false,
    installed: false,
    hasLocalData: false,
    needsRepair: false,
    liveSelected: false,
    batchSelected: false
  },
  {
    id: "silero-vad",
    name: "Silero VAD",
    purpose: "语音段检测组件，不是 ASR 模型",
    languages: "通用",
    sizeText: "约 2 MB",
    realtimeScore: 0,
    accuracyScore: 0,
    valueScore: 0,
    recommended: true,
    liveCapable: false,
    batchCapable: false,
    isComponent: true,
    installed: true,
    hasLocalData: true,
    needsRepair: false,
    liveSelected: false,
    batchSelected: false
  }
];

const fallback: LocalSubSnapshot = {
  app: { productVersion: "0.1.24", activePage: "home", busy: false, lastError: null },
  core: { state: "ready", pid: 24816, generation: 2, currentOperation: null, lastError: null },
  live: {
    state: "idle",
    sourceId: "potplayer",
    source: "PotPlayer",
    modelId: "streaming-zipformer-zh-large-int8",
    modelName: "Streaming Zipformer Large",
    availableModels: [
      { id: "streaming-zipformer-zh-large-int8", name: "Streaming Zipformer Large" },
      { id: "streaming-paraformer-zh-en", name: "Streaming Paraformer" }
    ],
    level: 0.18,
    status: "等待开始",
    currentText: "",
    previousText: "",
    lastError: null,
    canStart: true
  },
  batch: {
    queued: 2,
    completed: 1,
    state: "idle",
    status: "已完成 1 / 2",
    selectedId: "demo-1",
    selectedName: "lecture-demo.mp4",
    queue: [
      { id: "demo-1", name: "lecture-demo.mp4", state: "完成 5 段", analyzed: true, transcribed: true, segments: 5, realTimeFactor: 0.316, missing: false, retryable: false },
      { id: "demo-2", name: "interview-demo.m4a", state: "等待分析", analyzed: false, transcribed: false, segments: 0, realTimeFactor: null, missing: false, retryable: false }
    ],
    media: {
      durationMs: 257000,
      sampleRate: 16000,
      channels: 1,
      decoderName: "FFmpeg",
      waveform: Array.from({ length: 180 }, (_, i) => Math.min(1, 0.08 + Math.abs(Math.sin(i * 0.27)) * (0.35 + 0.45 * Math.abs(Math.sin(i * 0.07)))))
    },
    transcript: [
      { startMs: 800, endMs: 5300, text: "这是后台转写工作区的结果预览。", keywords: [] },
      { startMs: 6100, endMs: 11200, text: "媒体分析和识别任务由独立 Core 执行。", keywords: [] },
      { startMs: 12500, endMs: 18400, text: "界面在长时间转写过程中仍然保持响应。", keywords: [] },
      { startMs: 19500, endMs: 24700, text: "完成后的结构化记录会自动保存。", keywords: [] },
      { startMs: 26000, endMs: 31500, text: "队列中的其他媒体可以继续顺序处理。", keywords: [] }
    ],
    result: { durationMs: 257000, processingMs: 81300, decoderName: "FFmpeg", realTimeFactor: 0.316, segments: 5 },
    progress: { percent: 100, stage: "转写完成", detail: "已自动保存结构化记录" },
    canAnalyze: true,
    canTranscribe: true,
    canRetry: false,
    canTranscribeAll: true,
    canRemove: true,
    canClear: true,
    canExport: true,
    canExportAll: true,
    canCancel: false,
    batchModelId: "sensevoice-small-int8",
    batchModelName: "SenseVoice Small INT8",
    keywords: "",
    outputDirectoryName: "LocalSub / Transcripts",
    outputDirectoryCustom: false,
    restored: true,
    lastError: null
  },
  models: {
    catalog: fallbackCatalog,
    catalogCount: fallbackCatalog.length,
    installedCount: fallbackCatalog.filter(x => x.installed).length,
    liveModelId: "streaming-zipformer-zh-large-int8",
    liveModelName: "Zipformer Large 中文 INT8",
    batchModelId: "sensevoice-small-int8",
    batchModelName: "SenseVoice Small INT8",
    status: "3 / 4 已安装",
    operation: {
      state: "idle",
      kind: null,
      modelId: "",
      modelName: "",
      stage: "就绪",
      percent: null,
      detail: "模型重任务由 LocalSub.Core 执行",
      isIndeterminate: false,
      lastError: null,
      canCancel: false
    }
  },
  settings: {
    audioSource: "PotPlayer",
    audioSourceId: "potplayer",
    resourceProfile: "Auto",
    minimizeToTray: true,
    startWithWindows: false,
    startupRegistered: false,
    silentStartup: false,
    autoStartLive: false,
    showLiveLevelHistory: true,
    subtitleAutoSize: true,
    subtitleFontSize: 28,
    subtitleAutoScalePercent: 100,
    subtitleBottomOffset: 24,
    subtitleMaxWidthPercent: 90,
    subtitleBackground: "None",
    subtitleBackgroundOpacity: 24,
    subtitleDisplaySeconds: 3,
    subtitleCurrentColor: "#FFFFFF",
    subtitlePreviousColor: "#D8D8D8",
    subtitlePreviousScalePercent: 66,
    subtitlePreviousOpacity: 72,
    subtitleOutlineColor: "#000000",
    subtitleOutlineWidth: 1.5,
    subtitleShadowOpacity: 55
  },
  system: { potPlayerDetected: true, autoStartPending: false, autoStartStatus: "" }
};

const previewPage = new URLSearchParams(window.location.search).get("page");
let fallbackPage: PageKey =
  previewPage === "home" || previewPage === "live" || previewPage === "batch" || previewPage === "models" || previewPage === "settings" || previewPage === "docs" || previewPage === "about"
    ? previewPage
    : "home";
let fallbackLive = { ...fallback.live };
let fallbackBatch: LocalSubSnapshot["batch"] = {
  ...fallback.batch,
  queue: fallback.batch.queue.map(x => ({ ...x })),
  media: fallback.batch.media ? { ...fallback.batch.media, waveform: [...fallback.batch.media.waveform] } : null,
  transcript: fallback.batch.transcript.map(x => ({ ...x, keywords: [...x.keywords] })),
  progress: { ...fallback.batch.progress }
};
let fallbackModels = { ...fallback.models, catalog: fallback.models.catalog.map(x => ({ ...x })) };
let fallbackSettings = { ...fallback.settings };
let fallbackSystem = { ...fallback.system };
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
const snapshotSubscribers = new Set<(snapshot: LocalSubSnapshot) => void>();
const liveLevelSubscribers = new Set<(value: number) => void>();

function hasNativeBridge(): boolean {
  return Boolean(window.chrome?.webview);
}

function emitSnapshot(snapshot: LocalSubSnapshot) {
  for (const subscriber of snapshotSubscribers) {
    try { subscriber(snapshot); } catch { }
  }
}

function emitLiveLevel(value: number) {
  const level = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  for (const subscriber of liveLevelSubscribers) {
    try { subscriber(level); } catch { }
  }
}

function nativeMessageHandler(event: MessageEvent) {
  let message = event.data as BridgeResponse<unknown> | BridgeEvent<unknown> | string;
  if (typeof message === "string") {
    try { message = JSON.parse(message) as BridgeResponse<unknown> | BridgeEvent<unknown>; }
    catch { return; }
  }
  if (!message || typeof message !== "object") return;

  if (message.kind === "event") {
    if (message.event === "app.snapshot") emitSnapshot(message.payload as LocalSubSnapshot);
    if (message.event === "live.level") {
      const payload = message.payload as { value?: number };
      emitLiveLevel(typeof payload?.value === "number" ? payload.value : 0);
    }
    return;
  }

  const response = message as BridgeResponse<unknown>;
  if (typeof response.id !== "string") return;
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.ok) request.resolve(response.result);
  else request.reject(new Error(response.error || "LocalSub bridge request failed"));
}

if (hasNativeBridge()) {
  window.chrome!.webview!.addEventListener("message", nativeMessageHandler);
}

function fallbackSnapshot(): LocalSubSnapshot {
  return {
    ...fallback,
    app: { ...fallback.app, activePage: fallbackPage, busy: fallbackLive.state === "starting" || fallbackLive.state === "stopping" },
    live: { ...fallbackLive },
    batch: {
      ...fallbackBatch,
      queue: fallbackBatch.queue.map(x => ({ ...x })),
      media: fallbackBatch.media ? { ...fallbackBatch.media, waveform: [...fallbackBatch.media.waveform] } : null,
      transcript: fallbackBatch.transcript.map(x => ({ ...x, keywords: [...x.keywords] })),
      progress: { ...fallbackBatch.progress }
    },
    models: { ...fallbackModels, catalog: fallbackModels.catalog.map(x => ({ ...x })) },
    settings: { ...fallbackSettings },
    system: { ...fallbackSystem }
  };
}

export async function invoke<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!hasNativeBridge()) {
    if (method === "app.navigate" && typeof params.page === "string") fallbackPage = params.page as PageKey;
    if (method === "live.start") {
      const sourceId = params.source === "allAudio" ? "allAudio" : "potplayer";
      const modelId = typeof params.modelId === "string" ? params.modelId : fallbackLive.modelId;
      const model = fallbackLive.availableModels.find(x => x.id === modelId) ?? fallbackLive.availableModels[0];
      fallbackLive = {
        ...fallbackLive,
        state: "running",
        sourceId,
        source: sourceId === "allAudio" ? "所有音频" : "PotPlayer",
        modelId: model?.id ?? "",
        modelName: model?.name ?? "未选择模型",
        level: 0.42,
        status: "实时识别中",
        currentText: "这是实时字幕预览",
        previousText: "上一句字幕预览",
        lastError: null
      };
    }
    if (method === "live.stop") {
      fallbackLive = {
        ...fallbackLive,
        state: "idle",
        level: 0,
        status: "已停止",
        currentText: "",
        previousText: "",
        lastError: null
      };
    }
    if (method === "batch.pickFiles") {
      if (fallbackBatch.queue.length === 0) {
        fallbackBatch = {
          ...fallbackBatch,
          queued: 1,
          selectedId: "demo-1",
          selectedName: "lecture-demo.mp4",
          completed: 0,
          queue: [{ id: "demo-1", name: "lecture-demo.mp4", state: "等待分析", analyzed: false, transcribed: false, segments: 0, realTimeFactor: null, missing: false, retryable: false }],
          status: "已添加 1 个媒体文件",
          transcript: [],
          result: null,
          media: null,
          canExport: false
        };
      }
    }
    if (method === "batch.analyze") {
      const id = typeof params.id === "string" ? params.id : fallbackBatch.selectedId || fallbackBatch.queue[0]?.id || "";
      const selected = fallbackBatch.queue.find(x => x.id === id) ?? fallbackBatch.queue[0];
      if (selected) {
        fallbackBatch = {
          ...fallbackBatch,
          state: "idle",
          status: "声音轨道已就绪",
          selectedId: selected.id,
          selectedName: selected.name,
          queue: fallbackBatch.queue.map(x => x.id === selected.id ? { ...x, analyzed: true, state: x.transcribed ? x.state : "波形就绪", missing: false } : x),
          media: {
            durationMs: 257000,
            sampleRate: 16000,
            channels: 1,
            decoderName: "FFmpeg",
            waveform: Array.from({ length: 180 }, (_, i) => Math.min(1, 0.08 + Math.abs(Math.sin(i * 0.27)) * (0.35 + 0.45 * Math.abs(Math.sin(i * 0.07)))))
          },
          progress: { percent: 100, stage: "分析完成", detail: selected.name },
          canAnalyze: true,
          canTranscribe: true,
          canTranscribeAll: true,
          canRemove: true,
          canClear: true,
          canExport: true,
          canCancel: false,
          lastError: null
        };
      }
    }
    if (method === "batch.transcribe") {
      const id = typeof params.id === "string" ? params.id : fallbackBatch.selectedId;
      const selected = fallbackBatch.queue.find(x => x.id === id) ?? fallbackBatch.queue[0];
      const words = Array.isArray(params.keywords)
        ? (params.keywords as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      if (selected) {
        fallbackBatch = {
          ...fallbackBatch,
          state: "idle",
          status: "已完成 5 段转写",
          selectedId: selected.id,
          selectedName: selected.name,
          completed: Math.max(fallbackBatch.completed, fallbackBatch.queue.some(x => x.id === selected.id && x.transcribed) ? fallbackBatch.completed : fallbackBatch.completed + 1),
          queue: fallbackBatch.queue.map(x => x.id === selected.id ? { ...x, analyzed: true, transcribed: true, state: "完成 5 段", segments: 5, realTimeFactor: 0.316, missing: false, retryable: false } : x),
          transcript: [
            { startMs: 800, endMs: 5300, text: "这是后台转写工作区的结果预览。", keywords: words.filter(k => "这是后台转写工作区的结果预览。".includes(k)) },
            { startMs: 6100, endMs: 11200, text: "媒体分析和识别任务由独立 Core 执行。", keywords: words.filter(k => "媒体分析和识别任务由独立 Core 执行。".includes(k)) },
            { startMs: 12500, endMs: 18400, text: "界面在长时间转写过程中仍然保持响应。", keywords: words.filter(k => "界面在长时间转写过程中仍然保持响应。".includes(k)) },
            { startMs: 19500, endMs: 24700, text: "完成后的结构化记录会自动保存。", keywords: words.filter(k => "完成后的结构化记录会自动保存。".includes(k)) },
            { startMs: 26000, endMs: 31500, text: "下一步可以继续处理队列中的其他媒体。", keywords: words.filter(k => "下一步可以继续处理队列中的其他媒体。".includes(k)) }
          ],
          result: { durationMs: 257000, processingMs: 81300, decoderName: "FFmpeg", realTimeFactor: 0.316, segments: 5 },
          progress: { percent: 100, stage: "转写完成", detail: "RTF 0.32" },
          canAnalyze: true,
          canTranscribe: true,
          canRetry: false,
          canExportAll: true,
          canCancel: false,
          lastError: null
        };
      }
    }
    if (method === "batch.transcribeAll") {
      fallbackBatch = {
        ...fallbackBatch,
        completed: fallbackBatch.queue.length,
        state: "idle",
        status: "队列已全部完成",
        queue: fallbackBatch.queue.map((x, i) => ({
          ...x,
          analyzed: true,
          transcribed: true,
          state: i === 0 ? "完成 5 段" : "完成 4 段",
          segments: i === 0 ? 5 : 4,
          realTimeFactor: i === 0 ? 0.316 : 0.352,
          missing: false,
          retryable: false
        })),
        progress: { percent: 100, stage: "队列转写完成", detail: "已自动保存全部结构化记录" },
        canAnalyze: true,
        canTranscribe: true,
        canTranscribeAll: true,
        canRemove: true,
        canClear: true,
        canExport: true,
        canExportAll: true,
        canRetry: false,
        canCancel: false,
        lastError: null
      };
    }
    if (method === "batch.retry") {
      const id = typeof params.id === "string" ? params.id : fallbackBatch.selectedId;
      const selected = fallbackBatch.queue.find(x => x.id === id) ?? fallbackBatch.queue[0];
      if (selected) {
        fallbackBatch = {
          ...fallbackBatch,
          state: "idle",
          status: "重试完成",
          selectedId: selected.id,
          selectedName: selected.name,
          completed: Math.max(fallbackBatch.completed, fallbackBatch.queue.some(x => x.id === selected.id && x.transcribed) ? fallbackBatch.completed : fallbackBatch.completed + 1),
          queue: fallbackBatch.queue.map(x => x.id === selected.id ? { ...x, analyzed: true, transcribed: true, state: "完成 5 段", segments: 5, realTimeFactor: 0.316, missing: false, retryable: false } : x),
          progress: { percent: 100, stage: "重试完成", detail: "结果已恢复并自动保存" },
          canRetry: false,
          canExport: true,
          canExportAll: true,
          lastError: null
        };
      }
    }
    if (method === "batch.pickOutputDirectory") {
      fallbackBatch = {
        ...fallbackBatch,
        outputDirectoryName: "字幕输出",
        outputDirectoryCustom: true,
        status: "输出目录已更新"
      };
    }
    if (method === "batch.export") {
      const format = typeof params.format === "string" ? params.format.toUpperCase() : "SRT";
      fallbackBatch = {
        ...fallbackBatch,
        status: format + " 已导出",
        progress: { percent: 100, stage: "导出完成", detail: "lecture-demo." + format.toLowerCase() }
      };
    }
    if (method === "batch.exportAll") {
      fallbackBatch = {
        ...fallbackBatch,
        status: "整队结果已导出",
        progress: { percent: 100, stage: "批量导出完成", detail: "TXT / SRT / VTT" }
      };
    }
    if (method === "batch.openOutputDirectory") {
      fallbackBatch = { ...fallbackBatch, status: "已打开输出目录" };
    }

    if (method === "batch.remove") {
      const id = typeof params.id === "string" ? params.id : fallbackBatch.selectedId;
      const nextQueue = fallbackBatch.queue.filter(x => x.id !== id);
      const nextSelected = nextQueue[0] ?? null;
      fallbackBatch = {
        ...fallbackBatch,
        queued: nextQueue.length,
        completed: nextQueue.filter(x => x.transcribed).length,
        queue: nextQueue,
        selectedId: nextSelected?.id ?? "",
        selectedName: nextSelected?.name ?? "",
        transcript: nextSelected?.transcribed ? fallbackBatch.transcript : [],
        result: nextSelected?.transcribed ? fallbackBatch.result : null,
        media: nextSelected?.analyzed ? fallbackBatch.media : null,
        status: nextQueue.length ? "队列已更新" : "队列已清空",
        canAnalyze: Boolean(nextSelected),
        canTranscribe: Boolean(nextSelected),
        canTranscribeAll: nextQueue.length > 0,
        canRemove: Boolean(nextSelected),
        canClear: nextQueue.length > 0,
        canExport: Boolean(nextSelected?.transcribed),
        canExportAll: nextQueue.some(x => x.transcribed),
        canRetry: Boolean(nextSelected?.retryable)
      };
    }
    if (method === "batch.clear") {
      fallbackBatch = {
        ...fallbackBatch,
        queued: 0,
        completed: 0,
        selectedId: "",
        selectedName: "",
        queue: [],
        media: null,
        transcript: [],
        result: null,
        status: "队列已清空",
        progress: { percent: null, stage: "待命", detail: "" },
        canAnalyze: false,
        canTranscribe: false,
        canTranscribeAll: false,
        canRemove: false,
        canClear: false,
        canExport: false,
        canExportAll: false,
        canRetry: false,
        canCancel: false
      };
    }
    if (method === "batch.exportTxt") {
      fallbackBatch = {
        ...fallbackBatch,
        status: fallbackBatch.result ? "TXT 已导出" : fallbackBatch.status,
        progress: fallbackBatch.result ? { percent: 100, stage: "导出完成", detail: "lecture-demo.txt" } : fallbackBatch.progress
      };
    }

    if (method === "batch.cancel") {
      fallbackBatch = {
        ...fallbackBatch,
        state: "idle",
        status: "后台任务已取消",
        progress: { ...fallbackBatch.progress, stage: "已取消" },
        canCancel: false,
        canAnalyze: Boolean(fallbackBatch.selectedId),
        canTranscribe: Boolean(fallbackBatch.selectedId)
      };
    }
    if (method === "model.repair") {
      const modelId = typeof params.modelId === "string" ? params.modelId : "";
      const model = fallbackModels.catalog.find(x => x.id === modelId);
      if (!model) throw new Error("模型 catalog 中不存在该模型。");
      fallbackModels = {
        ...fallbackModels,
        catalog: fallbackModels.catalog.map(x => x.id === modelId ? { ...x, installed: true, hasLocalData: true, needsRepair: false } : x),
        installedCount: fallbackModels.catalog.filter(x => x.installed || x.id === modelId).length,
        operation: {
          state: "idle",
          kind: null,
          modelId,
          modelName: model.name,
          stage: "修复完成",
          percent: 100,
          detail: model.name + " 已修复并通过关键文件检查",
          isIndeterminate: false,
          lastError: null,
          canCancel: false
        }
      };
    }
    if (method === "model.download") {
      const modelId = typeof params.modelId === "string" ? params.modelId : "";
      const model = fallbackModels.catalog.find(x => x.id === modelId);
      if (!model) throw new Error("模型 catalog 中不存在该模型。");
      fallbackModels = {
        ...fallbackModels,
        catalog: fallbackModels.catalog.map(x => x.id === modelId ? { ...x, installed: true, hasLocalData: true, needsRepair: false } : x),
        installedCount: fallbackModels.catalog.filter(x => x.installed || x.id === modelId).length,
        operation: {
          state: "idle",
          kind: null,
          modelId,
          modelName: model.name,
          stage: "已完成",
          percent: 100,
          detail: model.name + " 已安装并通过关键文件检查",
          isIndeterminate: false,
          lastError: null,
          canCancel: false
        }
      };
    }
    if (method === "model.delete") {
      const modelId = typeof params.modelId === "string" ? params.modelId : "";
      const model = fallbackModels.catalog.find(x => x.id === modelId);
      if (!model) throw new Error("模型 catalog 中不存在该模型。");
      fallbackModels = {
        ...fallbackModels,
        catalog: fallbackModels.catalog.map(x => x.id === modelId ? { ...x, installed: false, hasLocalData: false, needsRepair: false } : x),
        installedCount: fallbackModels.catalog.filter(x => x.installed && x.id !== modelId).length,
        operation: {
          state: "idle",
          kind: null,
          modelId,
          modelName: model.name,
          stage: "已删除",
          percent: 100,
          detail: model.name + " 已从本地模型目录清理",
          isIndeterminate: false,
          lastError: null,
          canCancel: false
        }
      };
    }
    if (method === "model.cancel") {
      fallbackModels = {
        ...fallbackModels,
        operation: { ...fallbackModels.operation, state: "idle", kind: null, stage: "已取消", canCancel: false }
      };
    }
    if (method === "settings.update") {
      fallbackSettings = { ...fallbackSettings, ...params } as typeof fallbackSettings;
      if (typeof params.audioSource === "string") {
        const sourceId = params.audioSource === "allAudio" ? "allAudio" : "potplayer";
        fallbackLive = {
          ...fallbackLive,
          sourceId,
          source: sourceId === "allAudio" ? "所有音频" : "PotPlayer"
        };
      }
    }
    if (method === "settings.previewSubtitle") {
      // Browser preview has no native overlay. The settings snapshot still round-trips.
    }
    if (method === "model.select") {
      const target = params.target === "batch" ? "batch" : params.target === "live" ? "live" : "";
      const modelId = typeof params.modelId === "string" ? params.modelId : "";
      const model = fallbackModels.catalog.find(x => x.id === modelId);
      if (!target) throw new Error("不支持的模型默认用途。");
      if (!model) throw new Error("模型 catalog 中不存在该模型。");
      if (!model.installed) throw new Error("该模型尚未安装。");
      if (target === "live" && !model.liveCapable) throw new Error("该模型不支持实时字幕。");
      if (target === "batch" && !model.batchCapable) throw new Error("该模型不支持后台转写。");

      fallbackModels = {
        ...fallbackModels,
        liveModelId: target === "live" ? model.id : fallbackModels.liveModelId,
        liveModelName: target === "live" ? model.name : fallbackModels.liveModelName,
        batchModelId: target === "batch" ? model.id : fallbackModels.batchModelId,
        batchModelName: target === "batch" ? model.name : fallbackModels.batchModelName,
        catalog: fallbackModels.catalog.map(x => ({
          ...x,
          liveSelected: target === "live" ? x.id === model.id : x.liveSelected,
          batchSelected: target === "batch" ? x.id === model.id : x.batchSelected
        }))
      };
      if (target === "live") {
        fallbackLive = {
          ...fallbackLive,
          modelId: model.id,
          modelName: model.name
        };
      }
    }
    if (
      method === "app.getSnapshot" ||
      method === "app.navigate" ||
      method === "settings.update" ||
      method === "settings.previewSubtitle" ||
      method === "live.start" ||
      method === "live.stop" ||
      method === "model.list" ||
      method === "model.select" ||
      method === "model.download" ||
      method === "model.repair" ||
      method === "model.cancel" ||
      method === "model.delete" ||
      method === "batch.pickFiles" ||
      method === "batch.analyze" ||
      method === "batch.transcribe" ||
      method === "batch.transcribeAll" ||
      method === "batch.retry" ||
      method === "batch.pickOutputDirectory" ||
      method === "batch.export" ||
      method === "batch.exportAll" ||
      method === "batch.openOutputDirectory" ||
      method === "batch.remove" ||
      method === "batch.clear" ||
      method === "batch.exportTxt" ||
      method === "batch.cancel"
    ) {
      const snapshot = fallbackSnapshot();
      emitSnapshot(snapshot);
      return snapshot as T;
    }
    throw new Error("Browser preview does not implement " + method);
  }

  const id = "web-" + Date.now() + "-" + ++sequence;
  const result = new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: value => resolve(value as T),
      reject
    });
  });
  window.chrome!.webview!.postMessage({ id, method, params });
  return result;
}

export function subscribeSnapshot(callback: (snapshot: LocalSubSnapshot) => void): () => void {
  snapshotSubscribers.add(callback);
  return () => snapshotSubscribers.delete(callback);
}

export function subscribeLiveLevel(callback: (value: number) => void): () => void {
  liveLevelSubscribers.add(callback);
  return () => liveLevelSubscribers.delete(callback);
}

export function reportLiveLevelAck(value: number): void {
  if (!hasNativeBridge()) return;
  const level = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  window.chrome!.webview!.postMessage({
    id: "meter-ack-" + Date.now() + "-" + ++sequence,
    method: "diagnostics.liveLevelAck",
    params: { value: level }
  });
}

export function disposeBridge() {
  if (hasNativeBridge()) window.chrome!.webview!.removeEventListener("message", nativeMessageHandler);
  pending.clear();
  snapshotSubscribers.clear();
  liveLevelSubscribers.clear();
}
