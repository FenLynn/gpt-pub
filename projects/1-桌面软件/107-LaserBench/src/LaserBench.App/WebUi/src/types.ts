export interface PlotPoint { x: number; y: number }
export interface PlotSeries { name: string; color: string; axis?: 'left' | 'right'; points: PlotPoint[]; markers?: boolean }
export interface MetricTrace { name: string; unit: string; value: number; maxValue: number; color: string; points: PlotPoint[] }
export interface DeviceState { alias: string; kind: string; status: 'online' | 'busy' | 'error' | 'offline' }

export interface LaserSnapshot {
  version: string
  mode: 'SIM' | 'HW'
  timestamp: string
  label: string
  capturing: boolean
  captureState: 'idle'|'starting'|'running'|'stopping'|'error'
  lastCaptureMessage: string
  lastCaptureAt?: string | null
  recording: boolean
  captureSelection: Record<string, boolean>
  config: {
    experimentFolder: string
    autoScreenshot: boolean
    aliases: Record<string,string>
    rootPath: string
    powerWindow: number
    osaStart: number
    osaStop: number
    scopeTimeSpan: number
    scopeFftMax: number
    scopeCh1: boolean
    scopeCh2: boolean
    dashboardPower1: boolean
    dashboardPower2: boolean
    dashboardMath1: boolean
    powerActiveTrace: number
    powerAverageSamples: number
    powerOffset: number
    powerScale: number
    powerNormalize: boolean
    powerNormalizeValue: number
    powerDensity: boolean
    powerAreaCm2: number
    powerPassFail: boolean
    powerLow: number
    powerHigh: number
    osaResolution: number
    osaSensitivity: string
    osaAverage: number
    osaRefLevel: number
    osaDbPerDiv: number
    osaShowRef: boolean
    osaSweepMode: string
    osaMarkerPeak: boolean
    beamRunMode: string
    beamWidthMethod: string
    beamAutoOutlier: boolean
    beamShowX: boolean
    beamShowY: boolean
    scopeVoltsDiv: number
    scopeOffset: number
    scopeCoupling: string
    scopeTriggerSource: string
    scopeTriggerLevel: number
    scopeTriggerSlope: string
    scopeAcquisition: string
    scopeAverage: number
  }
  data: {
    experimentFolder: string
    fileCount: number
    files: { name:string; size:number; modified:string; extension:string; group:string }[]
    pictureCount: number
    videoCount: number
  }
  devices: DeviceState[]
  power: { traces: MetricTrace[] }
  spectrum: {
    centerWavelength: number
    linewidth3Db: number
    linewidthRms: number
    power: number
    traces: PlotSeries[]
  }
  beam: {
    z: number
    attenuation: number
    m2x: number
    m2y: number
    m2mean: number
    spotWidthX: number
    spotWidthY: number
    caustic: PlotSeries[]
  }
  scope: {
    time: PlotSeries[]
    fft: PlotSeries[]
  }
}
