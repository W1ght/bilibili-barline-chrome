/**
 * 「音乐小节线」组件 —— Web Audio 节拍器。
 *
 * 拍网格按「视频时间」计算（支持变速 / 变拍号）。不在越过拍点之后才发声，
 * 而是每 25ms 预读未来一小段视频时间内的拍点，按播放速度换算成 AudioContext
 * 时间提前排程，因此点击精确到毫秒、不受掉帧影响；标签页在后台时加大预读量。
 * 暂停、跳转、变速时取消已排程但未发声的点击并重新排程。
 */

import { BarConfig, TimeSignatureSegment, nextBeatAt, segmentBeatDuration } from './config'

export interface Beat { time: number; isBar: boolean }

/** 视频时间 (from, to] 内的拍点。 */
export function beatsInWindow(cfg: BarConfig, from: number, to: number, limit = 256): Beat[] {
  const out: Beat[] = []
  let t = from
  while (out.length < limit) {
    const next = nextBeatAt(cfg, t)
    if (!next || next.time > to) break
    if (next.time <= t) { t += 1e-6; continue }
    out.push(next)
    t = next.time
  }
  return out
}

const LOOKAHEAD = 0.12
const HIDDEN_LOOKAHEAD = 1.2
const TICK_MS = 25

type Scheduled = { osc: OscillatorNode; at: number }

export class Metronome {
  private ctx: AudioContext | null = null
  private timer = 0
  private video: HTMLVideoElement | null = null
  private cfg: BarConfig | null = null
  private muted = false
  private volume = 1
  private countInMaxVolume = true
  private countInTimerIds: number[] = []
  private countInOscs: OscillatorNode[] = []
  private scheduled: Scheduled[] = []
  /** 已排程到的视频时间；null 表示需要从当前时间重新开始。 */
  private horizon: number | null = null
  private lastRate = 1
  private reset = () => this.resync()
  private events = ['pause', 'seeking', 'seeked', 'ratechange', 'play', 'emptied']

  constructor(private createContext: () => AudioContext | null = defaultContext) {}

  setVideo(video: HTMLVideoElement | null) {
    for (const name of this.events) this.video?.removeEventListener(name, this.reset)
    this.video = video
    for (const name of this.events) video?.addEventListener(name, this.reset)
    this.resync()
    this.ensureLoop()
  }

  setConfig(cfg: BarConfig | null) {
    this.cfg = cfg
    this.resync()
    this.ensureLoop()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (muted) {
      this.stopLoop()
      this.cancelScheduled()
    } else {
      this.ensureLoop()
    }
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume))
    // 已排程的点击保留原音量，最多 0.12 秒后生效。
  }

  /** 预备拍是否固定用最大音量（忽略静音/音量设置）。 */
  setCountInMaxVolume(value: boolean) {
    this.countInMaxVolume = Boolean(value)
  }

  /** 跳转、暂停或变速后调用：取消未发声的点击，从当前时间重新排程。 */
  resync() {
    this.cancelScheduled()
    this.horizon = null
    if (this.timer) this.pump()
  }

  /** 排程一次（定时器调用；测试可直接调用）。 */
  pump() {
    const video = this.video, cfg = this.cfg, ctx = this.ctx
    if (!video || !cfg || !ctx || this.muted || video.paused || video.ended) {
      if (this.horizon !== null) this.resync()
      return
    }
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return }
    if (ctx.state !== 'running') return
    const rate = video.playbackRate || 1, t = video.currentTime
    if (rate !== this.lastRate) { this.lastRate = rate; this.cancelScheduled(); this.horizon = null }
    const ahead = (typeof document !== 'undefined' && document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD) * rate
    // 视频时间与排程脱节（跳转、卡顿恢复）时，从当前时间重来，避免补发一串点击。
    if (this.horizon === null || t > this.horizon + 0.25 || t < this.horizon - ahead - 0.25) {
      this.cancelScheduled()
      this.horizon = t - 0.005
    }
    const until = t + ahead
    if (until <= this.horizon) return
    const now = ctx.currentTime
    for (const beat of beatsInWindow(cfg, this.horizon, until)) {
      const delay = (beat.time - t) / rate
      if (delay < -0.02) continue
      const osc = this.scheduleClick(beat.isBar, Math.max(0, delay))
      if (osc) this.scheduled.push({ osc, at: now + Math.max(0, delay) })
    }
    this.horizon = until
    this.scheduled = this.scheduled.filter(s => s.at > now - 0.1)
  }

  private ensureLoop() {
    if (this.muted || !this.video || !this.cfg) return
    this.ensureContext()
    if (!this.timer) this.timer = setInterval(() => this.pump(), TICK_MS) as unknown as number
    this.pump()
  }

  private stopLoop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = 0
  }

  private ensureContext() {
    if (!this.ctx) this.ctx = this.createContext()
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  private cancelScheduled() {
    const now = this.ctx?.currentTime ?? 0
    for (const s of this.scheduled) {
      if (s.at > now) {
        try { s.osc.stop() } catch { /* 已停止 */ }
      }
    }
    this.scheduled = []
  }

  /**
   * 排程一个点击：短促的三角波，带音高下滑，听感接近木鱼。
   * 峰值不超过 1，避免削波失真。
   */
  private scheduleClick(accent: boolean, delaySeconds: number, maxVolume = false): OscillatorNode | null {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return null
    if (!maxVolume && (this.muted || this.volume <= 0.001)) return null
    const t0 = ctx.currentTime + delaySeconds
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    const pitch = accent ? 1760 : 1175
    osc.frequency.setValueAtTime(pitch, t0)
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.7, t0 + 0.04)
    const peak = (accent ? 1 : 0.62) * (maxVolume ? 1 : this.volume)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.07)
    return osc
  }

  /**
   * 打一小节的预备拍：拍长按视频播放速度换算（0.5× 练习时预备拍同样放慢）。
   * 每拍回调 onCountBeat(-count … -1)，结束后回调 onComplete；cancelCountIn 可中途停止。
   */
  countIn(segment: TimeSignatureSegment, onCountBeat: (beat: number) => void, onComplete: () => void) {
    this.ensureContext()
    this.cancelCountIn()
    if (!this.ctx) {
      onComplete()
      return
    }
    const rate = this.video?.playbackRate || 1
    const beat = segmentBeatDuration(segment) / rate
    const count = segment.numerator
    for (let i = 0; i < count; i += 1) {
      const osc = this.scheduleClick(i === 0, i * beat, this.countInMaxVolume)
      if (osc) this.countInOscs.push(osc)
      const display = -(count - i)
      if (i === 0) onCountBeat(display)
      else this.countInTimerIds.push(window.setTimeout(() => onCountBeat(display), i * beat * 1000))
    }
    this.countInTimerIds.push(window.setTimeout(() => {
      this.countInTimerIds = []
      this.countInOscs = []
      this.resync()
      onComplete()
    }, count * beat * 1000))
  }

  /** 停止预备拍（清除尚未触发的点击与定时器）。 */
  cancelCountIn() {
    for (const id of this.countInTimerIds) window.clearTimeout(id)
    this.countInTimerIds = []
    for (const osc of this.countInOscs) {
      try { osc.stop() } catch { /* 已停止 */ }
    }
    this.countInOscs = []
  }

  dispose() {
    this.stopLoop()
    this.cancelScheduled()
    this.cancelCountIn()
    this.muted = true
    for (const name of this.events) this.video?.removeEventListener(name, this.reset)
    this.video = null
    this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}

function defaultContext(): AudioContext | null {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AC ? new AC({ latencyHint: 'interactive' }) : null
}
