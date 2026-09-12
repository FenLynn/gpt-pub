export type PageKey = "live" | "batch" | "models" | "settings" | "docs";

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
    state: string;
    status: string;
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
      kind: "download" | "delete" | null;
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
    resourceProfile: string;
    subtitleAutoSize: boolean;
    subtitleFontSize: number;
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
    liveSelected: false,
    batchSelected: false
  }
];

const fallback: LocalSubSnapshot = {
  app: { productVersion: "0.1.5", activePage: "live", busy: false, lastError: null },
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
  batch: { queued: 0, state: "idle", status: "拖入媒体后开始后台转写" },
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
  settings: { audioSource: "PotPlayer", resourceProfile: "Auto", subtitleAutoSize: true, subtitleFontSize: 28 }
};

const previewPage = new URLSearchParams(window.location.search).get("page");
let fallbackPage: PageKey =
  previewPage === "batch" || previewPage === "models" || previewPage === "settings" || previewPage === "docs"
    ? previewPage
    : "live";
let fallbackLive = { ...fallback.live };
let fallbackModels = { ...fallback.models, catalog: fallback.models.catalog.map(x => ({ ...x })) };
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
const snapshotSubscribers = new Set<(snapshot: LocalSubSnapshot) => void>();

function hasNativeBridge(): boolean {
  return Boolean(window.chrome?.webview);
}

function emitSnapshot(snapshot: LocalSubSnapshot) {
  for (const subscriber of snapshotSubscribers) {
    try { subscriber(snapshot); } catch { }
  }
}

function nativeMessageHandler(event: MessageEvent) {
  const message = event.data as BridgeResponse<unknown> | BridgeEvent<unknown>;
  if (!message || typeof message !== "object") return;

  if (message.kind === "event") {
    if (message.event === "app.snapshot") emitSnapshot(message.payload as LocalSubSnapshot);
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
    models: { ...fallbackModels, catalog: fallbackModels.catalog.map(x => ({ ...x })) }
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
    if (method === "model.download") {
      const modelId = typeof params.modelId === "string" ? params.modelId : "";
      const model = fallbackModels.catalog.find(x => x.id === modelId);
      if (!model) throw new Error("模型 catalog 中不存在该模型。");
      fallbackModels = {
        ...fallbackModels,
        catalog: fallbackModels.catalog.map(x => x.id === modelId ? { ...x, installed: true } : x),
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
        catalog: fallbackModels.catalog.map(x => x.id === modelId ? { ...x, installed: false } : x),
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
      method === "live.start" ||
      method === "live.stop" ||
      method === "model.list" ||
      method === "model.select" ||
      method === "model.download" ||
      method === "model.cancel" ||
      method === "model.delete"
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

export function disposeBridge() {
  if (hasNativeBridge()) window.chrome!.webview!.removeEventListener("message", nativeMessageHandler);
  pending.clear();
  snapshotSubscribers.clear();
}
