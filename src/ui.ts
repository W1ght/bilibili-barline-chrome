/**
 * 「音乐小节线」组件 —— UI：拍号位置标记覆盖层。
 * 控制栏按钮由 `addControlBarButton` 注入（见 index.ts），编辑弹窗为 Vue 组件（BarLineEditor.vue），
 * 这里通过 body class 控制控制栏按钮的显隐与节拍器高亮状态。
 * 样式见 styles.scss。
 */

import { addStyle } from '@/core/style'
import { BarConfig, barStartTime, buildTimeline } from './config'
import styles from './styles.scss?inline'

let stylesAdded = false
export const ensureStyles = () => {
  if (stylesAdded) {
    return
  }
  stylesAdded = true
  addStyle(styles, 'barline-core')
}

/** 进度条上的拍号位置标记覆盖层 */
export class SegmentMarkerOverlay {
  private cfg: BarConfig | null = null
  private draft: BarConfig | null = null
  private overlayEl: HTMLElement
  private resizeObserver: ResizeObserver | null = null
  private onMeta = () => this.redraw()

  constructor(
    private progress: HTMLElement,
    private video: HTMLVideoElement,
    private getLoopBars: () => { start: number | null; end: number | null },
  ) {
    ensureStyles()
    const cs = getComputedStyle(progress)
    if (!cs.position || cs.position === 'static') {
      progress.style.position = 'relative'
    }
    this.overlayEl = document.createElement('div')
    this.overlayEl.className = 'barline-overlay'
    progress.append(this.overlayEl)
    this.resizeObserver = new ResizeObserver(() => this.redraw())
    this.resizeObserver.observe(progress)
    video.addEventListener('loadedmetadata', this.onMeta)
    video.addEventListener('durationchange', this.onMeta)
    this.redraw()
  }

  setConfig(cfg: BarConfig | null) {
    this.cfg = cfg
    this.redraw()
  }

  setDraft(draft: BarConfig | null) {
    this.draft = draft
    this.redraw()
  }

  redraw() {
    this.overlayEl.textContent = ''
    const cfg = this.draft ?? this.cfg
    if (!cfg) {
      return
    }
    const { duration } = this.video
    if (!Number.isFinite(duration) || duration <= 0) {
      return
    }

    const drawMarker = (time: number, labelText: string, color: string) => {
      if (time < 0 || time > duration) {
        return
      }
      const marker = document.createElement('div')
      marker.style.cssText = [
        'position:absolute',
        'top:0',
        'bottom:0',
        `left:${(time / duration) * 100}%`,
        'width:12px',
        'transform:translateX(-50%)',
      ].join(';')
      const line = document.createElement('div')
      line.style.cssText = [
        'position:absolute',
        'left:50%',
        'transform:translateX(-50%)',
        'top:0',
        'bottom:0',
        'width:2px',
        `background:${color}`,
      ].join(';')
      marker.append(line)
      if (labelText) {
        const label = document.createElement('span')
        label.className = 'barline-marker-label'
        label.style.left = '50%'
        label.style.color = color
        label.textContent = labelText
        marker.append(label)
      }
      this.overlayEl.append(marker)
    }

    // 拍号标记（蓝色）：只显示相对上一段变化的部分。
    const infos = buildTimeline(cfg)
    for (let i = 0; i < infos.length; i += 1) {
      const info = infos[i]
      const prev = i > 0 ? infos[i - 1].segment : null
      const parts: string[] = []
      if (!prev || info.segment.bpm !== prev.bpm) {
        parts.push(String(info.segment.bpm))
      }
      if (
        !prev ||
        info.segment.numerator !== prev.numerator ||
        info.segment.denominator !== prev.denominator
      ) {
        parts.push(`${info.segment.numerator}/${info.segment.denominator}`)
      }
      drawMarker(info.startTime, parts.join('·'), '#ffffff')
    }

    // 循环标记（橙色，只显示小节序号）。
    const { start, end } = this.getLoopBars()
    if (start !== null) {
      const time = barStartTime(cfg, start)
      if (time !== null) {
        drawMarker(time, String(start), '#ff8a3d')
      }
    }
    if (end !== null) {
      const time = barStartTime(cfg, end)
      const from = start !== null ? barStartTime(cfg, start) : null
      if (time !== null) {
        // 循环区间整体高亮；终点标签显示包含在内的最后一个小节。
        if (from !== null && time > from) {
          const band = document.createElement('div')
          band.className = 'barline-loop-band'
          band.style.left = `${(from / duration) * 100}%`
          band.style.width = `${((Math.min(time, duration) - from) / duration) * 100}%`
          this.overlayEl.append(band)
        }
        drawMarker(time, String(end - 1), '#ff8a3d')
      }
    }
  }

  destroy() {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.video.removeEventListener('loadedmetadata', this.onMeta)
    this.video.removeEventListener('durationchange', this.onMeta)
    this.overlayEl.remove()
  }
}

