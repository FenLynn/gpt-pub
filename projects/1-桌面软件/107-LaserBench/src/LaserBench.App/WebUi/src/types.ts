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
  recording: boolean
  captureSelection: Record<string, boolean>
  config: {
    experimentFolder: string
    autoScreenshot: boolean
    aliases: Record<string,string>
    rootPath: string
  }
  data: {
    experimentFolder: string
    files: { name:string; size:number; modified:string }[]
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
