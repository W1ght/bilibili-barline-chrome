import { identity } from './chrome-adapter'
import { fitBarMarks } from './beat-markers'
import { LoopController, LoopSpan } from './loop'
/**
 * 「音乐小节线」组件入口。
 *
 * 依赖的框架 API：
 * - defineComponentMetadata / defineOptionsMetadata 来自 `@/components/define`
 * - videoChange 来自 `@/core/observer`
 * - addControlBarButton 来自 `@/components/video/video-control-bar`
 * - playerAgent 来自 `@/components/video/player-agent`
 */

import {
  defineComponentMetadata,
  defineOptionsMetadata,
  OptionsOfMetadata,
} from '@/components/define'
import { videoChange } from '@/core/observer'
import { addControlBarButton, updateControlBar } from '@/components/video/video-control-bar'
import type { VideoControlBarItem } from '@/components/video/video-control-bar'
import { addComponentListener, removeComponentListener } from '@/core/settings'
import type { ComponentSettings } from '@/core/settings/types'
import { playerAgent } from '@/components/video/player-agent'
import { getActiveElement, isTyping, playerReady } from '@/core/utils'
import { addData } from '@/plugins/data'
import { playerUrls } from '@/core/utils/urls'
import { Toast } from '@/core/toast'
import { select, hasVideo } from '@/core/spin-query'
import {
  BarConfig,
  DEFAULT_CONFIG,
  TimeSignatureSegment,
  barStartTime,
  beatNumberAt,
  deleteConfig,
  firstBeatForDownbeatAt,
  initStore,
  loadConfig,
  locateBar,
  saveConfig,
  formatBpm,
  formatTime,
  touchOpened,
} from './config'
import { Metronome } from './metronome'
import { BarSwipe } from './swipe'
import { SegmentMarkerOverlay, ensureStyles } from './ui'
import pencilIcon from './pencil.svg?raw'
import metronomeOnIcon from './metronome.svg?raw'
import metronomeOffIcon from './metronome-off.svg?raw'
import prevIcon from './prev.svg?raw'
import nextIcon from './next.svg?raw'
import firstIcon from './first.svg?raw'
import loopOffIcon from './loop-off.svg?raw'
import loopPendingIcon from './loop-pending.svg?raw'
import loopOnIcon from './loop-on.svg?raw'

const options = defineOptionsMetadata({
  configs: {
    defaultValue: '{}',
    displayName: '小节线配置',
    hidden: true,
  },
  hideBarNavButtons: {
    displayName: '隐藏上下小节按钮',
    defaultValue: false,
  },
  loopDisableCountIn: {
    displayName: '循环段禁用预备拍',
    defaultValue: false,
  },
  countInMaxVolume: {
    displayName: '预备拍使用最大音量',
    defaultValue: true,
  },
  promptMetronomeVolume: {
    displayName: '弹窗设置节拍器音量',
    defaultValue: false,
  },
  arrowKeys: {
    displayName: '方向键跳小节',
    defaultValue: 'plain' as 'plain' | 'shift' | 'off',
  },
  loopSpeedStep: {
    displayName: '循环每遍加速（比例）',
    defaultValue: 0,
  },
  loopSpeedTarget: {
    displayName: '循环加速目标速度',
    defaultValue: 1,
  },
})
export type BarLineOptions = OptionsOfMetadata<typeof options>

const BODY_CLASS = 'barline-active'
const CONFIGURED_CLASS = 'barline-configured'
const METRONOME_CLASS = 'barline-metronome-on'
const METRONOME_SELECTOR = '.be-video-control-bar-extend [data-name="barLineMetronome"]'

let enabled = false
let metronome: Metronome | null = null
let overlay: SegmentMarkerOverlay | null = null
let metronomeButton: VideoControlBarItem | null = null
let loopButton: VideoControlBarItem | null = null
let currentVideo: HTMLVideoElement | null = null
let currentConfig: BarConfig | null = null
let currentKey = ''
let syncToken = 0
let playCleanup: (() => void) | null = null
let countInBeat: number | null = null
let beatDisplayRaf = 0
let lastBeatIcon = ''
let volumeTooltip: { tippy: { destroy: () => void } } | null = null
let volumeSliderRefresh: (() => void) | null = null
let barSwipe: BarSwipe | null = null
let settingsRef: ComponentSettings<BarLineOptions>['options'] | null = null
let listenerHandlers: Array<() => void> | null = null

const isLoopCountInDisabled = () => Boolean(settingsRef?.loopDisableCountIn)

// 默认开启：settingsRef 尚未就绪时按开启处理。
const isCountInMaxVolume = () => settingsRef?.countInMaxVolume !== false

const beatIconName = (n: number) => (n >= 0 ? `barline-beat-${n}` : `barline-beat-neg${-n}`)

const beatIconSvg = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text x="12" y="16.5" font-size="15" font-weight="600" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" fill="currentColor">${n}</text></svg>`

const tickBeatDisplay = () => {
  beatDisplayRaf = 0
  if (!enabled) {
    return
  }
  let icon: string
  if (countInBeat !== null) {
    icon = beatIconName(countInBeat)
  } else if (currentConfig?.metronomeMuted) {
    icon = 'barline-metronome-off'
  } else if (currentVideo) {
    // 播放中显示第几拍；暂停或还没到第一拍时显示节拍器图标。
    if (currentConfig && currentVideo.paused === false) {
      const beat = beatNumberAt(currentConfig, currentVideo.currentTime)
      icon = beat !== null ? beatIconName(beat) : 'barline-metronome-on'
    } else {
      icon = 'barline-metronome-on'
    }
  } else {
    icon = 'barline-metronome-off'
  }
  if (metronomeButton && icon !== lastBeatIcon) {
    metronomeButton.icon = icon
    lastBeatIcon = icon
    // 拍号数字需逐拍刷新，不能等控制栏的定时挂载。
    updateControlBar()
  }
  beatDisplayRaf = requestAnimationFrame(tickBeatDisplay)
}

const startBeatDisplay = () => {
  if (beatDisplayRaf) {
    return
  }
  lastBeatIcon = ''
  beatDisplayRaf = requestAnimationFrame(tickBeatDisplay)
}

const stopBeatDisplay = () => {
  if (beatDisplayRaf) {
    cancelAnimationFrame(beatDisplayRaf)
    beatDisplayRaf = 0
  }
  lastBeatIcon = ''
}

const setBodyState = (configured: boolean, unmuted: boolean) => {
  document.body.classList.toggle(CONFIGURED_CLASS, configured)
  document.body.classList.toggle(METRONOME_CLASS, unmuted)
}

const updateLoopIcon = () => {
  if (!loopButton) {
    return
  }
  if (loop.state === 'pending') {
    loopButton.icon = 'barline-loop-pending'
    loopButton.displayName = '设置循环终点（Alt+L）'
  } else if (loop.state === 'looping') {
    loopButton.icon = 'barline-loop-on'
    loopButton.displayName = '关闭循环（Alt+L）'
  } else {
    loopButton.icon = 'barline-loop-off'
    loopButton.displayName = '设置循环起点（Alt+L）'
  }
  updateControlBar()
}

let markerToast: { dismiss?: () => void } | null = null
function notice(message: string, title = '小节线') {
  markerToast?.dismiss?.()
  markerToast = Toast.info(message, title)
}

const loop = new LoopController({
  video: () => currentVideo,
  config: () => currentConfig,
  countIn: (segment, done) => runCountIn(segment, done),
  cancelCountIn: () => {
    metronome?.cancelCountIn()
    countInBeat = null
  },
  countInDisabled: () => isLoopCountInDisabled(),
  speed: () => ({
    step: Math.max(0, Math.min(0.5, Number(settingsRef?.loopSpeedStep) || 0)),
    target: Math.max(0.25, Math.min(4, Number(settingsRef?.loopSpeedTarget) || 1)),
  }),
  resync: () => metronome?.resync(),
  notify: message => notice(message, '循环'),
  changed: () => {
    updateLoopIcon()
    overlay?.redraw()
    const state = loopState()
    for (const fn of loopListeners) fn(state)
  },
})
const resetLoop = () => loop.reset()
const toggleLoop = () => loop.toggle()

/** 段落练习：循环一段或几段（不相接时依次跳过去）。 */
export interface LoopInfo { active: boolean; label: string; spans: LoopSpan[] }
const loopListeners = new Set<(state: LoopInfo) => void>()
const loopState = (): LoopInfo => ({ active: loop.state === 'looping' && Boolean(loop.spans), label: loop.label, spans: loop.spans ? loop.spans.map(s => ({ ...s })) : [] })
export function loopSpans(spans: LoopSpan[], label: string) {
  if (!currentVideo) { notice('视频尚未就绪，请稍后重试。', '循环'); return }
  loop.playSpans(spans, label)
}
export function stopLoop() { if (loop.state !== 'off') { loop.reset(); notice('已关闭循环', '循环') } }
export function onLoopState(fn: (state: LoopInfo) => void) {
  loopListeners.add(fn)
  fn(loopState())
  return () => { loopListeners.delete(fn) }
}

const clearUiState = () => {
  metronome?.cancelCountIn()
  overlay?.destroy()
  overlay = null
  playCleanup?.()
  playCleanup = null
  countInBeat = null
  resetLoop()
  setBodyState(false, false)
}

/**
 * Bar configuration of the current video as observable state, so the panel can
 * embed the settings instead of opening a modal. `source` tells listeners who
 * changed it; the embedded editor ignores its own 'editor' echoes.
 */
export type BarStateSource = 'init' | 'load' | 'editor' | 'markers' | 'auto' | 'volume' | 'delete'
export interface BarState { video: HTMLVideoElement | null; key: string; config: BarConfig | null }
const barListeners = new Set<(state: BarState, source: BarStateSource) => void>()
const emitBarState = (source: BarStateSource) => {
  const state = { video: currentVideo, key: currentKey, config: currentConfig }
  barListeners.forEach(fn => fn(state, source))
}
export function onBarState(fn: (state: BarState, source: BarStateSource) => void) {
  barListeners.add(fn)
  fn({ video: currentVideo, key: currentKey, config: currentConfig }, 'init')
  return () => { barListeners.delete(fn) }
}
/** Live edits from the embedded settings: applied and saved at once. */
export function previewConfig(draft: BarConfig) {
  if (!currentKey) return
  applyDraft(draft, 'editor')
}
/** 「临时关闭节拍器」：只实时静音/恢复，不写入配置。 */
export function tempMuteMetronome(muted: boolean) {
  metronome?.setMuted(muted || (currentConfig?.metronomeMuted ?? true))
}
export function deleteCurrentConfig() {
  if (currentKey) deleteConfig(currentKey)
  currentConfig = null
  metronome?.setConfig(null)
  metronome?.setMuted(true)
  overlay?.setDraft(null)
  overlay?.setConfig(null)
  resetLoop()
  setBodyState(false, false)
  emitBarState('delete')
}
function applyDraft(draft: BarConfig, source: BarStateSource = 'auto') {
  currentConfig = draft
  if (currentKey) saveConfig(currentKey, {
    ...draft,
    videoTitle: document.title.replace(/_哔哩哔哩.*$/, ''),
    aid: draft.aid || identity.aid,
    bvid: draft.bvid || identity.bvid,
  })
  metronome?.setConfig(draft)
  metronome?.setMuted(draft.metronomeMuted)
  metronome?.setVolume(draft.metronomeVolume)
  overlay?.setConfig(draft)
  setBodyState(true, !draft.metronomeMuted)
  volumeSliderRefresh?.()
  emitBarState(source)
}

let barMark: { key: string; times: number[] } | null = null
export function suspendForScoreAnalysis() {
  resetLoop();metronome?.setMuted(true)
  return ()=>metronome?.setMuted(currentConfig?.metronomeMuted??true)
}
export function getPracticeConfig():BarConfig|null {
  if(!currentConfig)return null
  const config=structuredClone(currentConfig),m=config.manualCalibration,s=config.segments[0]
  if(!m||config.segments.length!==1||m.time!==s.firstBeatTime||m.bpm!==s.bpm||m.numerator!==s.numerator||m.denominator!==s.denominator)delete config.tempoSource
  return config
}
export function applyAnalyzedTempo(bpm:number,firstBeatTime:number,numerator:number,denominator:number,bars:number[]=[]) {
  if(!currentVideo||!currentKey)throw new Error('视频配置尚未就绪，请稍后重试。')
  if(!Number.isFinite(bpm)||bpm<30||bpm>360||!Number.isFinite(firstBeatTime)||firstBeatTime<0)throw new Error('分析结果无效')
  const draft=structuredClone(currentConfig||DEFAULT_CONFIG)
  draft.tempoSource='auto';delete draft.manualCalibration
  draft.segments=[{bpm,numerator,denominator,firstBeatTime}]
  // Verified visual bar crossings preserve local tempo instead of accumulating global drift.
  if(bars.length>=3){
    const segments=bars.slice(0,-1).map((time,i)=>({bpm:60*numerator*4/denominator/(bars[i+1]-time),numerator,denominator,...(i===0?{firstBeatTime:time}:{startBar:i+1})}))
    if(segments.every(s=>s.bpm>=30&&s.bpm<=360))draft.segments=segments
  }
  draft.metronomeMuted=false;if(draft.metronomeVolume<=0)draft.metronomeVolume=.1
  resetLoop();applyDraft(draft)
}
/** Replace the tempo map with segments derived from the score's bar lines (see bar-align.ts). */
export function applyBarGrid(segments:TimeSignatureSegment[]) {
  if(!currentVideo||!currentKey)throw new Error('视频配置尚未就绪，请稍后重试。')
  if(!segments.length||segments.some(s=>!Number.isFinite(s.bpm)||s.bpm<30||s.bpm>360))throw new Error('小节网格无效')
  const draft=structuredClone(currentConfig||DEFAULT_CONFIG)
  draft.tempoSource='auto';delete draft.manualCalibration
  draft.segments=segments.map(s=>({...s}))
  draft.metronomeMuted=false;if(draft.metronomeVolume<=0)draft.metronomeVolume=.1
  resetLoop();applyDraft(draft)
}
const markerNotice = (message: string) => notice(message, '小节定速')
/** 「起点」后可连续点「下一节」，每多一个小节都会用全部标记重新拟合，误差越来越小。 */
export function markBarStart() {
  if (!currentVideo || !currentKey) { markerNotice('视频尚未就绪，请稍后重试。'); return }
  barMark = { key: currentKey, times: [currentVideo.currentTime] }
  markerNotice(`已记录起点 ${formatTime(barMark.times[0])}。在后面每个小节开头点「下一节」，标得越多越准。`)
}
export function markNextBar() {
  if (!currentVideo || !currentKey) return
  if (!barMark || barMark.key !== currentKey) { markerNotice('请先点击「起点」标记一个小节的开始。'); return }
  const draft = structuredClone(currentConfig || DEFAULT_CONFIG)
  const segment = draft.segments[0]
  const times = [...barMark.times, currentVideo.currentTime]
  try {
    const fit = fitBarMarks(times, segment.numerator, segment.denominator)
    barMark.times = times
    segment.bpm = fit.bpm
    segment.firstBeatTime = fit.firstBeatTime
    draft.tempoSource = 'manual-bars'
    draft.manualCalibration = { time: fit.firstBeatTime, bpm: fit.bpm, numerator: segment.numerator, denominator: segment.denominator }
    draft.metronomeMuted = false
    if (draft.metronomeVolume <= 0) draft.metronomeVolume = 0.1
    resetLoop()
    applyDraft(draft, 'markers')
    const error = fit.bars > 1 ? `，${fit.bars} 小节平均，最大偏差 ${Math.round(fit.maxError * 1000)} ms` : '，继续点「下一节」可提高精度'
    markerNotice(`${formatBpm(fit.bpm)} BPM（${segment.numerator}/${segment.denominator}）${error}。节拍器已开启。`)
  } catch (error) { markerNotice((error as Error).message) }
}
/** 「重拍对齐此处」：保持 BPM 与拍号，平移小节网格，让当前播放位置成为某小节的第一拍。 */
export function alignDownbeatHere() {
  if (!currentVideo || !currentKey) { markerNotice('视频尚未就绪，请稍后重试。'); return }
  const draft = structuredClone(currentConfig || DEFAULT_CONFIG)
  const firstBeatTime = firstBeatForDownbeatAt(draft, currentVideo.currentTime)
  draft.segments[0].firstBeatTime = firstBeatTime
  if (!currentConfig) {
    draft.metronomeMuted = false
    if (draft.metronomeVolume <= 0) draft.metronomeVolume = 0.1
  }
  resetLoop()
  applyDraft(draft, 'markers')
  markerNotice(`重拍已对齐到 ${formatTime(currentVideo.currentTime)}（第一拍 ${formatTime(firstBeatTime)}）。`)
}
const applyVolume = (volume: number) => {
  if (currentConfig) {
    currentConfig.metronomeVolume = volume
    currentConfig.metronomeMuted = volume <= 0
  }
  metronome?.setVolume(volume)
  metronome?.setMuted(volume <= 0)
  setBodyState(Boolean(currentConfig), volume > 0)
}

const persistVolume = (volume: number) => {
  if (currentConfig && currentKey) {
    currentConfig.metronomeVolume = volume
    currentConfig.metronomeMuted = volume <= 0
    saveConfig(currentKey, currentConfig)
    emitBarState('volume')
  }
}

const toggleMute = () => {
  if (!currentConfig || !currentKey) {
    return
  }
  // 「弹窗设置节拍器音量」开启时：用 prompt 设置音量（0-100），不再切换静音。
  if (settingsRef?.promptMetronomeVolume) {
    const current = Math.round((currentConfig.metronomeVolume ?? 1) * 100)
    const input = prompt('设置节拍器音量 (0-100)', String(current))
    if (input === null) {
      return
    }
    const n = Number(input)
    if (Number.isNaN(n)) {
      return
    }
    const clamped = Math.min(100, Math.max(0, n))
    const volume = clamped / 100
    currentConfig = { ...currentConfig, metronomeVolume: volume, metronomeMuted: volume <= 0 }
    saveConfig(currentKey, currentConfig)
    metronome?.setVolume(volume)
    metronome?.setMuted(volume <= 0)
    setBodyState(true, volume > 0)
    volumeSliderRefresh?.()
    emitBarState('volume')
    return
  }
  const willMute = !currentConfig.metronomeMuted
  let volume = currentConfig.metronomeVolume
  // 取消静音时，若之前音量被手动调为 0，则恢复到 10，避免取消静音后仍然无声。
  if (!willMute && volume <= 0) {
    volume = 0.1
  }
  currentConfig = { ...currentConfig, metronomeMuted: willMute, metronomeVolume: volume }
  saveConfig(currentKey, currentConfig)
  metronome?.setMuted(willMute)
  metronome?.setVolume(volume)
  setBodyState(true, !willMute)
  volumeSliderRefresh?.()
  emitBarState('volume')
}

const buildVolumeSlider = (): { el: HTMLElement; refresh: () => void } => {
  const el = document.createElement('div')
  el.className = 'barline-volume-vertical'
  const number = document.createElement('div')
  number.className = 'barline-volume-number'
  const track = document.createElement('div')
  track.className = 'barline-volume-track'
  const fill = document.createElement('div')
  fill.className = 'barline-volume-fill'
  const thumb = document.createElement('div')
  thumb.className = 'barline-volume-thumb'
  track.append(fill, thumb)
  el.append(number, track)

  const setFill = (value: number) => {
    number.textContent = String(value)
    fill.style.height = `${value}%`
    thumb.style.bottom = `${value}%`
  }
  const volumeFromY = (clientY: number) => {
    const rect = track.getBoundingClientRect()
    const ratio = 1 - (clientY - rect.top) / rect.height
    return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  }
  const refresh = () => {
    const muted =
      !currentConfig ||
      Boolean(currentConfig?.metronomeMuted) ||
      (currentConfig?.metronomeVolume ?? 1) <= 0
    const value = muted ? 0 : Math.round((currentConfig?.metronomeVolume ?? 1) * 100)
    setFill(value)
  }

  track.addEventListener('mousedown', e => {
    const commit = (clientY: number) => {
      const v = volumeFromY(clientY)
      setFill(v)
      applyVolume(v / 100)
    }
    commit(e.clientY)
    const onMove = (ev: MouseEvent) => commit(ev.clientY)
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      persistVolume(currentConfig?.metronomeVolume ?? 1)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  refresh()
  return { el, refresh }
}

const setupVolumeTooltip = async () => {
  if (volumeTooltip) {
    return
  }
  const btn = await select<HTMLElement>(METRONOME_SELECTOR)
  if (!btn) {
    return
  }
  const { el, refresh } = buildVolumeSlider()
  volumeSliderRefresh = refresh
  volumeTooltip = Toast.mini(el, btn, {
    trigger: 'mouseenter focus',
    hideOnClick: false,
    interactive: true,
    placement: 'top',
    arrow: false,
    onShow: () => refresh(),
    onShown: () => refresh(),
  })
}

/** 根据「弹窗设置节拍器音量」设置，切换节拍器按钮名称与 hover 滑块。 */
const applyMetronomeButtonState = () => {
  const promptMode = Boolean(settingsRef?.promptMetronomeVolume)
  if (metronomeButton) {
    // 开启弹窗设置：按钮名「节拍器」；关闭：空名（hover 滑块）。
    metronomeButton.displayName = promptMode ? '节拍器' : ''
  }
  if (promptMode) {
    // 弹窗设置开启：不显示 hover 滑块。
    volumeTooltip?.tippy.destroy()
    volumeTooltip = null
    volumeSliderRefresh = null
  } else {
    // 弹窗设置关闭：显示 hover 滑块。
    setupVolumeTooltip()
  }
}

const seekToBar = (direction: -1 | 1) => {
  if (!currentConfig || !currentVideo) {
    return
  }
  const t = currentVideo.currentTime
  const loc = locateBar(currentConfig, t)
  if (direction > 0) {
    if (!loc) {
      const first = barStartTime(currentConfig, 1)
      if (first !== null) {
        currentVideo.currentTime = first
      }
      return
    }
    const next = barStartTime(currentConfig, loc.bar + 1)
    if (next !== null) {
      currentVideo.currentTime = next
    }
  } else if (!loc) {
    currentVideo.currentTime = 0
  } else {
    // 始终回退一整小节
    const prevBar = loc.bar - 1
    currentVideo.currentTime = prevBar >= 1 ? barStartTime(currentConfig, prevBar) ?? 0 : 0
  }
}

const runCountIn = (segment: TimeSignatureSegment, onComplete: () => void) => {
  if (!metronome) {
    onComplete()
    return
  }
  metronome.setCountInMaxVolume(isCountInMaxVolume())
  metronome.countIn(
    segment,
    beat => {
      countInBeat = beat
    },
    () => {
      countInBeat = null
      onComplete()
    },
  )
}

const jumpWithCountIn = (time: number, segment: TimeSignatureSegment) => {
  if (!currentVideo) {
    return
  }
  const wasPlaying = !currentVideo.paused
  currentVideo.pause()
  currentVideo.currentTime = time
  if (wasPlaying) {
    runCountIn(segment, () => {
      currentVideo?.play()
    })
  }
}

const jumpToFirstBeat = () => {
  if (!currentConfig || !currentConfig.segments.length) {
    return
  }
  const first = currentConfig.segments[0]
  jumpWithCountIn(first.firstBeatTime ?? 0, first)
}

const shouldIgnoreKey = () => {
  if (isTyping()) {
    return true
  }
  const active = getActiveElement()
  if (!active || active === document.body) {
    return false
  }
  if (active instanceof HTMLMediaElement) {
    return false
  }
  if (active instanceof HTMLDivElement && active.classList.contains('bpx-player-ctrl-btn')) {
    return false
  }
  if (active instanceof HTMLInputElement && active.classList.contains('bui')) {
    return false
  }
  return true
}

/** Alt 组合键不与 B 站播放器快捷键冲突（按 code 识别，不受输入法影响）。 */
const altShortcuts: Record<string, () => void> = {
  Digit1: () => markBarStart(),
  Digit2: () => markNextBar(),
  Digit3: () => alignDownbeatHere(),
  KeyL: () => toggleLoop(),
  KeyM: () => toggleMute(),
}

const onKeydown = (e: KeyboardEvent) => {
  if (!enabled || !currentVideo) {
    return
  }
  // Alt 快捷键在本插件面板的按钮上（例如刚点过谱行的 ⟳）也要生效；只有正在输入时忽略。
  const isAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && Boolean(altShortcuts[e.code])
  const inPanel = Boolean((getActiveElement() as Element | null)?.closest?.('.barline-ui'))
  if (isTyping() || (!(isAlt && inPanel) && shouldIgnoreKey())) {
    return
  }
  if (isAlt) {
    e.preventDefault()
    e.stopImmediatePropagation()
    altShortcuts[e.code]()
    return
  }
  if (!currentConfig || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) {
    return
  }
  // 「方向键跳小节」：plain 直接用方向键；shift 需按住 Shift，普通方向键仍归 B 站快进快退；off 关闭。
  const mode = settingsRef?.arrowKeys ?? 'plain'
  if (mode === 'off' || (mode === 'shift') !== e.shiftKey) {
    return
  }
  e.preventDefault()
  e.stopImmediatePropagation()
  seekToBar(e.key === 'ArrowRight' ? 1 : -1)
}

const sync = async (id: { aid?: string; cid?: string }) => {
  barMark = null
  if (!enabled) {
    return
  }
  // 兜底：确保样式已注入（编辑弹窗、音量滑块、进度条标记都依赖它）。
  ensureStyles()
  resetLoop()
  const token = ++syncToken
  const video = (await playerAgent.query.video.element()) as HTMLVideoElement | null
  if (!enabled || token !== syncToken) {
    return
  }
  currentVideo = video
  currentKey = id.cid || id.aid || ''
  currentConfig = currentKey ? loadConfig(currentKey) : null
  if (currentKey && currentConfig) {
    // 记录「最后打开时间」。
    touchOpened(currentKey)
  }

  metronome?.setVideo(video)
  metronome?.setConfig(currentConfig)
  // 无配置时也保持静音（不发声），符合「节拍器默认静音」。
  metronome?.setMuted(Boolean(!currentConfig || currentConfig?.metronomeMuted))
  metronome?.setVolume(currentConfig?.metronomeVolume ?? 1)
  volumeSliderRefresh?.()

  // 用户在预备拍期间手动恢复播放时，立即停止预备拍，改为跟随视频进度。
  playCleanup?.()
  playCleanup = null
  if (video) {
    const handler = () => {
      if (countInBeat !== null && metronome) {
        metronome.cancelCountIn()
        countInBeat = null
        // 手动恢复播放后，重新对齐下一拍，保证节拍器继续发声。
        metronome.resync()
      }
    }
    video.addEventListener('play', handler)
    playCleanup = () => video.removeEventListener('play', handler)
  }

  overlay?.destroy()
  overlay = null
  barSwipe?.destroy()
  barSwipe = null
  if (video) {
    const progress = await playerAgent.query.control.progress()
    if (!enabled || token !== syncToken) {
      return
    }
    if (progress) {
      overlay = new SegmentMarkerOverlay(progress, video, () => ({
        start: loop.startBar,
        end: loop.endBar,
        spans: loop.spans ?? [],
      }))
      overlay.setConfig(currentConfig)
    }
    const container = playerAgent.query.video.container.sync()
    if (container) {
      // 触屏左右滑动跳小节：仅在已配置小节的视频生效。
      barSwipe = new BarSwipe(container, {
        getConfig: () => currentConfig,
        isActive: () => enabled && Boolean(currentConfig),
        onTarget: time => {
          if (currentVideo) {
            const wasPaused = currentVideo.paused
            currentVideo.currentTime = time
            // 若原本暂停，跳转后保持暂停；若原本播放则不受影响。
            if (wasPaused && !currentVideo.paused) {
              currentVideo.pause()
            }
          }
        },
      })
      barSwipe.attach()
    }
  }
  setBodyState(Boolean(currentConfig), !currentConfig?.metronomeMuted)
  emitBarState('load')
}

/** 注册设置监听，重新开启组件时也会重新注册。 */
const setupSettingsListeners = () => {
  listenerHandlers?.forEach(remove => remove())
  listenerHandlers = []

  // 监听「隐藏上下小节按钮」设置，动态隐藏/显示上一小节/下一小节按钮。
  const onHideBarNavChanged: Parameters<typeof addComponentListener>[1] = value => {
    document.body.classList.toggle('barline-hide-bar-nav', Boolean(value))
  }
  addComponentListener('barline.hideBarNavButtons', onHideBarNavChanged, true)
  listenerHandlers.push(() =>
    removeComponentListener('barline.hideBarNavButtons', onHideBarNavChanged),
  )

  // 监听「弹窗设置节拍器音量」，切换按钮名称与 hover 滑块。
  const onPromptVolumeChanged: Parameters<typeof addComponentListener>[1] = () => {
    applyMetronomeButtonState()
  }
  addComponentListener('barline.promptMetronomeVolume', onPromptVolumeChanged, true)
  listenerHandlers.push(() =>
    removeComponentListener('barline.promptMetronomeVolume', onPromptVolumeChanged),
  )
}

const entry = async ({ settings }: { settings: ComponentSettings<BarLineOptions> }) => {

  settingsRef = settings.options
  enabled = true
  document.body.classList.add(BODY_CLASS)
  ensureStyles()
  addData('ui.icons', (icons: Record<string, string>) => {
    if (!icons['barline-pencil']) {
      icons['barline-pencil'] = pencilIcon
    }
    icons['barline-metronome-on'] = metronomeOnIcon
    icons['barline-metronome-off'] = metronomeOffIcon
    icons['barline-prev'] = prevIcon
    icons['barline-next'] = nextIcon
    icons['barline-first'] = firstIcon
    icons['barline-loop-off'] = loopOffIcon
    icons['barline-loop-pending'] = loopPendingIcon
    icons['barline-loop-on'] = loopOnIcon
    for (let i = 1; i <= 32; i += 1) {
      icons[`barline-beat-${i}`] = beatIconSvg(i)
      icons[`barline-beat-neg${i}`] = beatIconSvg(-i)
    }
  })
  await playerReady()
  metronome = new Metronome()
  metronomeButton = {
    name: 'barLineMetronome',
    displayName: '',
    icon: 'barline-metronome-off',
    order: 2,
    action: toggleMute,
  }
  addControlBarButton(metronomeButton)
  addControlBarButton({
    name: 'barLineFirst',
    displayName: '跳到第一拍',
    icon: 'barline-first',
    order: 3,
    action: jumpToFirstBeat,
  })
  addControlBarButton({
    name: 'barLinePrev',
    displayName: '上一小节（←）',
    icon: 'barline-prev',
    order: 4,
    action: () => seekToBar(-1),
  })
  addControlBarButton({
    name: 'barLineNext',
    displayName: '下一小节（→）',
    icon: 'barline-next',
    order: 5,
    action: () => seekToBar(1),
  })
  loopButton = {
    name: 'barLineLoop',
    displayName: '设置循环起点（Alt+L）',
    icon: 'barline-loop-off',
    order: 6,
    action: toggleLoop,
  }
  addControlBarButton(loopButton)
  window.addEventListener('keydown', onKeydown, true)
  startBeatDisplay()
  setupSettingsListeners()
  await videoChange(sync)
}

const reload = () => {
  enabled = true
  document.body.classList.add(BODY_CLASS)
  window.addEventListener('keydown', onKeydown, true)
  setupSettingsListeners()
  if (!metronome) {
    metronome = new Metronome()
  }
  startBeatDisplay()
  sync({ aid: identity.aid, cid: identity.cid })
}

const unload = () => {
  enabled = false
  stopBeatDisplay()
  clearUiState()
  document.body.classList.remove(BODY_CLASS, 'barline-hide-bar-nav')
  window.removeEventListener('keydown', onKeydown, true)
  barSwipe?.destroy()
  barSwipe = null
  listenerHandlers?.forEach(remove => remove())
  listenerHandlers = null
  volumeTooltip?.tippy.destroy()
  volumeTooltip = null
  volumeSliderRefresh = null
  settingsRef = null
  metronome?.dispose()
  metronome = null
  currentVideo = null
  currentConfig = null
  currentKey = ''
  syncToken += 1
}

export const component = defineComponentMetadata({
  name: 'barline',
  displayName: '音乐小节线',
  author: {
    name: 'sh311',
    link: 'https://gitee.com/m1ku666',
  },
  tags: [],
  options,
  entry,
  reload,
  unload,
  urlInclude: playerUrls,
})



