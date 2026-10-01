/**
 * 「音乐小节线」—— 小节循环。
 *
 * 终点检测按视频帧（requestVideoFrameCallback）进行，接近终点时用定时器卡准时刻，
 * 不再依赖约 4 次/秒的 timeupdate，避免每遍多播出下一小节的开头。
 * 可选「每遍加速」：每循环一遍提速一定百分比直到目标速度，退出循环时恢复原速度。
 */
import { BarConfig, TimeSignatureSegment, barStartTime, locateBar, segmentAt } from './config'

export type LoopState = 'off' | 'pending' | 'looping'
export interface LoopSpeed { step: number; target: number }
export interface LoopHost {
  video(): HTMLVideoElement | null
  config(): BarConfig | null
  countIn(segment: TimeSignatureSegment, done: () => void): void
  cancelCountIn(): void
  countInDisabled(): boolean
  speed(): LoopSpeed
  resync(): void
  notify(message: string): void
  changed(): void
}

/** 第 round 遍（从 0 开始）的播放速度。 */
export function loopRate(base: number, speed: LoopSpeed, round: number): number {
  if (!(speed.step > 0) || !(speed.target > base)) return base
  return Math.min(speed.target, Number((base * (1 + speed.step) ** round).toFixed(3)))
}

export class LoopController {
  state: LoopState = 'off'
  start: number | null = null
  end: number | null = null
  startBar: number | null = null
  endBar: number | null = null
  round = 0
  private baseRate: number | null = null
  private frameId = 0
  private timer = 0
  private exact = 0
  private wrapping = false
  private watched: HTMLVideoElement | null = null

  constructor(private host: LoopHost) {}

  /** 依次：设起点 → 设终点并开始循环 → 关闭。 */
  toggle() {
    const video = this.host.video(), cfg = this.host.config()
    if (!video || !cfg) return
    const loc = locateBar(cfg, video.currentTime)
    const barStart = loc ? loc.startTime : barStartTime(cfg, 1) ?? 0
    const barNumber = loc ? loc.bar : 1
    if (this.state === 'off') {
      this.start = barStart
      this.startBar = barNumber
      this.state = 'pending'
      this.host.notify(`循环起点：第 ${barNumber} 小节。到终点小节再点一次。`)
    } else if (this.state === 'pending') {
      // 起点、终点所在的小节都包含在内；同一小节点两次即循环这一小节。
      const lo = Math.min(barNumber, this.startBar!), hi = Math.max(barNumber, this.startBar!)
      const start = barStartTime(cfg, lo), end = barStartTime(cfg, hi + 1)
      if (start === null || end === null) { this.host.notify('超出节拍时间线，请检查小节线配置。'); return }
      this.start = start
      this.startBar = lo
      this.end = end
      this.endBar = hi + 1
      this.state = 'looping'
      this.round = 0
      this.baseRate = video.playbackRate
      this.watch(video)
      this.host.notify(`循环第 ${lo}${hi > lo ? '–' + hi : ''} 小节${this.speedLabel()}`)
      this.restart(video, !video.paused)
    } else {
      this.reset()
      this.host.notify('已关闭循环')
      return
    }
    this.host.changed()
  }

  reset() {
    this.unwatch()
    this.host.cancelCountIn()
    const video = this.host.video()
    if (video && this.baseRate !== null && this.state === 'looping') video.playbackRate = this.baseRate
    this.baseRate = null
    this.state = 'off'
    this.start = this.end = this.startBar = this.endBar = null
    this.round = 0
    this.wrapping = false
    this.host.changed()
  }

  private speedLabel() {
    const s = this.host.speed()
    return s.step > 0 && this.baseRate !== null && s.target > this.baseRate
      ? `，每遍加速 ${Math.round(s.step * 100)}% 至 ${s.target}×`
      : ''
  }

  private restart(video: HTMLVideoElement, play: boolean) {
    const cfg = this.host.config()
    if (this.start === null || !cfg) return
    this.wrapping = true
    video.pause()
    video.currentTime = this.start
    this.host.resync()
    const resume = () => {
      this.wrapping = false
      if (play) void video.play().catch(() => {})
    }
    const segment = segmentAt(cfg, this.start)
    if (play && segment && !this.host.countInDisabled()) this.host.countIn(segment, resume)
    else resume()
  }

  private wrap(video: HTMLVideoElement) {
    if (this.wrapping || this.state !== 'looping') return
    this.round += 1
    if (this.baseRate !== null) {
      const rate = loopRate(this.baseRate, this.host.speed(), this.round)
      if (rate !== video.playbackRate) {
        video.playbackRate = rate
        this.host.notify(`第 ${this.round + 1} 遍 · ${rate.toFixed(2)}×`)
      }
    }
    this.restart(video, true)
  }

  private check = () => {
    const video = this.watched
    if (!video || this.state !== 'looping' || this.end === null || this.wrapping || video.paused) return
    const left = (this.end - video.currentTime) / (video.playbackRate || 1)
    if (left <= 0.004) { this.wrap(video); return }
    // 最后一小段用定时器卡准终点，而不是等下一帧。
    if (left < 0.06 && !this.exact) {
      this.exact = window.setTimeout(() => { this.exact = 0; this.check() }, Math.max(0, left * 1000 - 2))
    }
  }

  private watch(video: HTMLVideoElement) {
    this.unwatch()
    this.watched = video
    const onFrame = () => {
      this.check()
      if (this.watched === video && video.requestVideoFrameCallback) this.frameId = video.requestVideoFrameCallback(onFrame)
    }
    if (video.requestVideoFrameCallback) this.frameId = video.requestVideoFrameCallback(onFrame)
    this.timer = window.setInterval(this.check, 30)
  }

  private unwatch() {
    if (this.watched && this.frameId) this.watched.cancelVideoFrameCallback(this.frameId)
    clearInterval(this.timer)
    clearTimeout(this.exact)
    this.frameId = this.timer = this.exact = 0
    this.watched = null
  }
}
