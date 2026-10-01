/**
 * 「音乐小节线」组件 —— 触屏左右滑动跳小节。
 *
 * 仅在视频已配置小节线时启用：左右滑动时在视频上显示方向箭头 + 小节数，
 * 松手后按该数量跳转小节。
 *
 * 与「点击暂停」区分：滑动超过阈值距离才视为滑动手势并接管，
 * 点击（几乎不移动）不做任何拦截，让暂停/正常 UI 正常工作。
 * 通过 document 捕获阶段移动监听 stopImmediatePropagation，完全替代默认的
 * 「拖动进度」手势（上滑/下滑音量/亮度不受影响）。
 */

import { addStyle } from '@/core/style'
import { BarConfig, barStartTime, locateBar } from './config'
import swipeStyles from './swipe.scss?inline'
import prevIcon from './prev.svg?raw'
import nextIcon from './next.svg?raw'

let stylesAdded = false
const ensureSwipeStyles = () => {
  if (stylesAdded) {
    return
  }
  stylesAdded = true
  addStyle(swipeStyles, 'barline-swipe')
}

/** 判定为「滑动」的最小位移（像素），小于它视为点击。 */
const SWIPE_THRESHOLD = 12

/** 抑制拖动后 click 事件的时间窗（毫秒）。 */
const CLICK_SUPPRESS_MS = 300

export class BarSwipe {
  private container: HTMLElement
  private onTarget: (time: number) => void
  private getConfig: () => BarConfig | null
  private isActive: () => boolean
  private startX = 0
  private startY = 0
  private curX = 0
  private curY = 0
  private dir: 'horizontal' | 'vertical' | null = null
  private swipeActive = false
  private bars = 0
  private pointerId: number | null = null
  private suppressClick = false
  private suppressTimer = 0
  private overlay: HTMLElement

  private onPointerDown = (e: PointerEvent) => this.startGesture(e)
  private onPointerMove = (e: PointerEvent) => this.moveGesture(e, e.clientX, e.clientY)
  private onPointerUp = (e: PointerEvent) => this.endGesture(e)
  private onClick = (e: MouseEvent) => {
    // 拖动结束后浏览器会补发一次 click，拦截它以免触发放大/暂停等交互。
    if (this.suppressClick) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  constructor(
    container: HTMLElement,
    opts: {
      getConfig: () => BarConfig | null
      isActive: () => boolean
      onTarget: (time: number) => void
    },
  ) {
    this.container = container
    this.getConfig = opts.getConfig
    this.isActive = opts.isActive
    this.onTarget = opts.onTarget
    ensureSwipeStyles()
    this.overlay = document.createElement('div')
    this.overlay.className = 'barline-swipe-overlay'
    this.overlay.innerHTML =
      '<div class="barline-swipe-arrow"></div><div class="barline-swipe-count"></div>'
    const cs = getComputedStyle(container)
    if (!cs.position || cs.position === 'static') {
      container.style.position = 'relative'
    }
    container.appendChild(this.overlay)
    this.overlay.style.display = 'none'
  }

  private startGesture(e: PointerEvent) {
    if (!this.isActive() || this.swipeActive || this.pointerId !== null) {
      return
    }
    // 只在主指针（第一个触点/主鼠标键）开始。
    if (e.isPrimary && (e.pointerType === 'mouse' ? e.button === 0 : true)) {
      this.pointerId = e.pointerId
      this.startX = e.clientX
      this.startY = e.clientY
      this.curX = e.clientX
      this.curY = e.clientY
      this.dir = null
      this.swipeActive = false // 未越过阈值前视为点击
    }
  }

  private moveGesture(e: PointerEvent, clientX: number, clientY: number) {
    // 仅处理我们启动的指针。
    if (this.pointerId === null || e.pointerId !== this.pointerId) {
      return
    }
    this.curX = clientX
    this.curY = clientY
    if (!this.swipeActive) {
      // 未越过阈值前不拦截（允许点击暂停 / 正常交互）。
      const dx = Math.abs(this.curX - this.startX)
      const dy = Math.abs(this.curY - this.startY)
      if (Math.max(dx, dy) < SWIPE_THRESHOLD) {
        return
      }
      // 越过阈值，开始接管。
      this.swipeActive = true
      this.dir = dx > dy ? 'horizontal' : 'vertical'
      if (this.dir !== 'horizontal') {
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      this.updateBars()
      return
    }
    if (this.dir !== 'horizontal') {
      return
    }
    e.preventDefault()
    e.stopImmediatePropagation()
    this.updateBars()
  }

  private updateBars() {
    const cfg = this.getConfig()
    const video = this.container.querySelector('video') as HTMLVideoElement | null
    if (!cfg || !video) {
      return
    }
    const dx = this.curX - this.startX
    const width = Math.max(1, this.container.clientWidth)
    // 每滑过约 1/18 屏宽跳 1 小节（约为 1/3），至少 1 小节。
    const count = Math.max(1, Math.round((Math.abs(dx) / width) * 18))
    const backward = dx < 0
    this.bars = backward ? -count : count
    this.showOverlay(backward, Math.abs(this.bars))
  }

  private showOverlay(backward: boolean, count: number) {
    const arrow = this.overlay.querySelector('.barline-swipe-arrow') as HTMLElement
    const countEl = this.overlay.querySelector('.barline-swipe-count') as HTMLElement
    arrow.innerHTML = backward ? prevIcon : nextIcon
    countEl.textContent = String(count)
    this.overlay.style.display = 'flex'
  }

  private hideOverlay() {
    this.overlay.style.display = 'none'
  }

  private endGesture(e: PointerEvent) {
    if (this.pointerId === null || e.pointerId !== this.pointerId) {
      return
    }
    const wasSwipe = this.swipeActive
    this.pointerId = null
    this.swipeActive = false
    if (!wasSwipe || this.dir !== 'horizontal') {
      // 从未越过阈值：就是一次点击，什么都不做（暂停等正常逻辑生效）。
      this.cleanupGesture()
      return
    }
    // 抑制拖动后随后的 click，避免 B 站把它当成点击而切换暂停/进入放大等。
    if (this.suppressTimer) {
      window.clearTimeout(this.suppressTimer)
    }
    this.suppressClick = true
    this.suppressTimer = window.setTimeout(() => {
      this.suppressClick = false
      this.suppressTimer = 0
    }, CLICK_SUPPRESS_MS)
    // 若原本在播放则保持播放，若原本暂停则跳转后保持暂停。
    e.preventDefault()
    e.stopImmediatePropagation()
    const cfg = this.getConfig()
    const video = this.container.querySelector('video') as HTMLVideoElement | null
    if (cfg && video && this.bars !== 0) {
      const t = video.currentTime
      const loc = locateBar(cfg, t)
      const currentBar = loc ? loc.bar : 1
      const targetBar = Math.max(1, currentBar + this.bars)
      const time = barStartTime(cfg, targetBar)
      if (time !== null) {
        this.onTarget(time)
      }
    }
    this.hideOverlay()
    this.cleanupGesture()
  }

  private cleanupGesture() {
    this.dir = null
    this.bars = 0
  }

  attach() {
    // 起点只监听视频容器，避免点击控制栏/其它区域被干扰。
    this.container.addEventListener('pointerdown', this.onPointerDown)
    // 移动/抬起用 document 捕获，便于在滑动时覆盖 B 站拖动进度。
    document.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: false })
    document.addEventListener('pointerup', this.onPointerUp, { capture: true })
    document.addEventListener('pointercancel', this.onPointerUp, { capture: true })
    document.addEventListener('click', this.onClick, { capture: true })
  }

  destroy() {
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    document.removeEventListener('pointermove', this.onPointerMove, {
      capture: true,
      passive: false,
    } as EventListenerOptions)
    document.removeEventListener('pointerup', this.onPointerUp, { capture: true })
    document.removeEventListener('pointercancel', this.onPointerUp, { capture: true })
    document.removeEventListener('click', this.onClick, { capture: true })
    if (this.suppressTimer) {
      window.clearTimeout(this.suppressTimer)
    }
    this.overlay.remove()
  }
}


