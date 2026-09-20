import type { LaserSnapshot, PlotPoint, PlotSeries } from './types'

function gaussian(x: number, center: number, sigma: number) {
  return Math.exp(-0.5 * Math.pow((x - center) / sigma, 2))
}

function powerSeries(index: number, color: string, name: string, unit: string): { name:string; unit:string; value:number; maxValue:number; color:string; points:PlotPoint[] } {
  const points: PlotPoint[] = []
  for (let i = 0; i < 900; i++) {
    const x = -600 + i * 600 / 899
    const elapsed = x + 600
    const rise = 1 - Math.exp(-elapsed / 14)
    const value = index === 0
      ? 18.4 * rise + 0.16 * Math.sin(i * .22) + 0.05 * Math.sin(i * .91)
      : index === 1
        ? 0.32 * rise + 0.012 * Math.sin(i * .31)
        : 87.2 * (1 - Math.exp(-elapsed / 18)) + 0.35 * Math.sin(i * .13)
    points.push({ x, y: Math.max(0, value) })
  }
  const value = points.at(-1)?.y ?? 0
  return { name, unit, value, maxValue: Math.max(...points.map(p => p.y)), color, points }
}

function spectrum(): PlotSeries[] {
  const blue: PlotPoint[] = []
  const orange: PlotPoint[] = []
  for (let i = 0; i < 1200; i++) {
    const x = 1060 + i * 43 / 1199
    const noise = 2.1 * Math.sin(i * .83) + 1.2 * Math.sin(i * .19)
    blue.push({ x, y: -89 + 83 * gaussian(x, 1080.2, .72) + 13 * gaussian(x, 1083.4, 1.1) + noise })
    orange.push({ x, y: -94 + 70 * gaussian(x, 1080.2, .68) + 8 * gaussian(x, 1083.3, 1.05) + .7 * noise })
  }
  return [
    { name: 'OSA1', color: '#075ee6', points: blue },
    { name: 'Ref', color: '#ff7a00', points: orange }
  ]
}

function caustic(): PlotSeries[] {
  const x: PlotPoint[] = []
  const y: PlotPoint[] = []
  for (let i = 0; i < 81; i++) {
    const z = -28 + i * 56 / 80
    x.push({ x: z, y: 20 + 0.165 * Math.pow(z + .4, 2) })
    y.push({ x: z, y: 34 + 0.19 * Math.pow(z - .7, 2) })
  }
  return [
    { name: 'X', color: '#075ee6', points: x, markers: true },
    { name: 'Y', color: '#ff2b20', points: y, markers: true }
  ]
}

function scopeTime(): PlotSeries[] {
  const ch1: PlotPoint[] = []
  const ch2: PlotPoint[] = []
  for (let i = 0; i < 1400; i++) {
    const x = i * 0.24 / 1399
    ch1.push({ x, y: .68 * Math.sin(x * .205) + .06 * Math.sin(x * .61) })
    ch2.push({ x, y: .29 * Math.sin(x * .205 + .9) + .03 * Math.sin(x * .47) })
  }
  return [{ name:'CH1', color:'#075ee6', points:ch1 }, { name:'CH2', color:'#ff7a00', points:ch2 }]
}

function scopeFft(): PlotSeries[] {
  const ch1: PlotPoint[] = []
  const ch2: PlotPoint[] = []
  for (let i = 0; i < 1400; i++) {
    const x = i * 54000 / 1399
    const floor1 = -78 + 2.2 * Math.sin(i * .33)
    const floor2 = -88 + 1.6 * Math.sin(i * .27)
    ch1.push({ x, y: floor1 + 72 * gaussian(x, 7, .43) + 47 * gaussian(x, 14.1, .28) + 34 * gaussian(x, 21.2, .26) + 25 * gaussian(x, 28.3, .24) })
    ch2.push({ x, y: floor2 + 62 * gaussian(x, 7, .47) + 38 * gaussian(x, 14.1, .31) + 29 * gaussian(x, 21.2, .29) + 23 * gaussian(x, 28.3, .27) })
  }
  return [{ name:'CH1', color:'#075ee6', points:ch1 }, { name:'CH2', color:'#ff7a00', points:ch2 }]
}

export function createDemoSnapshot(): LaserSnapshot {
  const p1 = powerSeries(0, '#075ee6', 'out', 'kW')
  const p2 = powerSeries(1, '#ff8200', 'back', 'kW')
  const p3 = powerSeries(2, '#08a84f', 'eta', '%')
  return {
    version: '0.5.3', mode: 'SIM', timestamp: new Date().toISOString(), label: '13A', capturing: false, captureState:'idle', lastCaptureMessage:'尚未执行采集', lastCaptureAt:null, recording: false,
    captureSelection: { power: true, spectrum: true, beam: true, scope: false },
    config: {
      experimentFolder: '', autoScreenshot: false,
      aliases: { power1:'out', power2:'back', math1:'eta', osa1:'osa1', beam:'beam', scope1:'ch1', scope2:'ch2' },
      rootPath: 'D:\\LaserBench', powerWindow:600, osaStart:1060, osaStop:1100, scopeTimeSpan:0.24, scopeFftMax:50, scopeCh1:true, scopeCh2:true, dashboardPower1:true, dashboardPower2:true, dashboardMath1:true,
      powerActiveTrace:0, powerAverageSamples:1, powerOffset:0, powerScale:1, powerNormalize:false, powerNormalizeValue:1, powerDensity:false, powerAreaCm2:1, powerPassFail:false, powerLow:0, powerHigh:20,
      power1DisplayUnit:'kW', power2DisplayUnit:'kW', math1DisplayUnit:'%', power1AxisMin:0, power1AxisMax:0, power2AxisMin:0, power2AxisMax:0, math1AxisMin:0, math1AxisMax:100,
      osaResolution:0.05, osaSensitivity:'MID', osaAverage:1, osaRefLevel:0, osaDbPerDiv:10, osaShowRef:true, osaSweepMode:'REPEAT', osaMarkerPeak:true,
      osaSamplePoints:1001, osaVideoBandwidthHz:1000, osaTraceMode:'WRITE', osaSmoothingPoints:1, osaWavelengthOffsetNm:0, osaWavelengthReference:'AIR', osaAutoPeakSearch:true, osaPeakThresholdDb:3,
      beamRunMode:'AUTO', beamWidthMethod:'D4SIGMA', beamAutoOutlier:true, beamShowX:true, beamShowY:true,
      scopeVoltsDiv:0.25, scopeOffset:0, scopeCoupling:'DC', scopeActiveChannel:1,
      scopeCh1VoltsDiv:0.25, scopeCh1Offset:0, scopeCh1Coupling:'DC', scopeCh2VoltsDiv:0.25, scopeCh2Offset:0, scopeCh2Coupling:'DC',
      scopeTriggerSource:'CH1', scopeTriggerLevel:0, scopeTriggerSlope:'RISING', scopeAcquisition:'SAMPLE', scopeAverage:16,
      powerInterfaceEnabled:false, powerInterfaceEndpoint:'AUTO',
      spectrumInterfaceEnabled:false, spectrumInterfaceEndpoint:'TCPIP::AUTO',
      beamInterfaceEnabled:false, beamInterfaceEndpoint:'AUTO',
      scopeInterfaceEnabled:false, scopeInterfaceEndpoint:'TCPIP::AUTO'
    },
    interfaces: [
      { kind:'power', driverId:'ophir-juno-lmmeasurement', deviceName:'Ophir Juno', vendorSoftware:'Ophir StarLab / OphirLMMeasurement', interfaceName:'USB + COM Automation', enabled:false, dataPlaneReady:false, endpoint:'AUTO', state:'disabled', message:'真实接口未启用。', identity:'', lastSampleAt:null, failureCount:0 },
      { kind:'spectrum', driverId:'yokogawa-aq6370d', deviceName:'Yokogawa AQ6370D', vendorSoftware:'Yokogawa', interfaceName:'Ethernet TCP/SCPI :10001', enabled:false, dataPlaneReady:false, endpoint:'TCPIP::AUTO', state:'disabled', message:'真实接口未启用。', identity:'', lastSampleAt:null, failureCount:0 },
      { kind:'beam', driverId:'spiricon-beamsquared-sp920', deviceName:'Ophir Spiricon SP920 / BeamSquared', vendorSoftware:'Ophir BeamSquared', interfaceName:'.NET Framework automation bridge', enabled:false, dataPlaneReady:false, endpoint:'AUTO', state:'disabled', message:'真实接口未启用。', identity:'', lastSampleAt:null, failureCount:0 },
      { kind:'scope', driverId:'tektronix-mso44', deviceName:'Tektronix MSO44', vendorSoftware:'Tektronix', interfaceName:'Ethernet raw TCP/SCPI :4000', enabled:false, dataPlaneReady:false, endpoint:'TCPIP::AUTO', state:'disabled', message:'真实接口未启用。', identity:'', lastSampleAt:null, failureCount:0 }
    ],
    data: { experimentFolder: new Date().toISOString().slice(0,10), fileCount:0, files: [], pictureCount: 0, videoCount: 0 },
    devices: [
      { alias:'out', kind:'power', status:'online' }, { alias:'back', kind:'power', status:'online' },
      { alias:'osa1', kind:'spectrum', status:'online' }, { alias:'beam', kind:'beam', status:'online' },
      { alias:'scope', kind:'scope', status:'offline' }
    ],
    power: { traces:[p1,p2,p3] },
    spectrum: { centerWavelength:1080.21, linewidth3Db:2.03, linewidthRms:2.18, power:3.2, traces:spectrum() },
    beam: { z:0, attenuation:30, m2x:1.08, m2y:1.12, m2mean:1.10, spotWidthX:118, spotWidthY:130, caustic:caustic() },
    scope: { sampleRate:2500000, time:scopeTime(), fft:scopeFft() }
  }
}