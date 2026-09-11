export type PageKey = "live" | "batch" | "models" | "settings" | "docs";

export interface LiveModelOption {
  id: string;
  name: string;
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
    catalogCount: number;
    installedCount: number;
    status: string;
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

const fallback: LocalSubSnapshot = {
  app: { productVersion: "0.1.1", activePage: "live", busy: false, lastError: null },
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
  models: { catalogCount: 12, installedCount: 4, status: "模型目录可用" },
  settings: { audioSource: "PotPlayer", resourceProfile: "Auto", subtitleAutoSize: true, subtitleFontSize: 28 }
};

const previewPage = new URLSearchParams(window.location.search).get("page");
let fallbackPage: PageKey = previewPage === "docs" ? "docs" : "live";
let fallbackLive = { ...fallback.live };
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
    live: { ...fallbackLive }
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
    if (method === "app.getSnapshot" || method === "app.navigate" || method === "live.start" || method === "live.stop") {
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
