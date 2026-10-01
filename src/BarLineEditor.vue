<template>
  <div class="barline-editor" :class="{embedded}">
    <section class="ble-card" aria-label="小节定速">
      <div class="ble-card-head">
        <h3>小节定速</h3>
        <span class="bl-muted">底部「起点」<kbd>Alt+1</kbd>／「下一节」<kbd>Alt+2</kbd> 效果相同</span>
      </div>
      <p class="bl-note">在一个小节开头点「起点」，之后每到下一小节开头点「下一节」。标得越多越准，漏点一个小节也会自动补上。</p>
      <div class="ble-marker-bar">
        <button class="ble-play" @click="toggleMarkerPlayback" :title="videoPaused?'播放':'暂停'">{{ videoPaused ? '▶' : '❚❚' }}</button>
        <span class="ble-clock">{{ formatTime(markerCurrentTime) }}</span>
        <button class="primary" @click="markStart">起点</button>
        <button class="primary" :disabled="!marks.length" @click="markNext">下一节{{ marks.length > 1 ? ` · ${marks.length - 1}` : '' }}</button>
        <button class="ghost" :disabled="!marks.length" @click="clearMarks">清空</button>
      </div>
      <div v-if="marks.length" class="ble-marks">
        <span v-for="(time, i) in marks" :key="i" class="ble-mark">{{ i === 0 ? '起点' : '+' + i }} <b>{{ formatTime(time) }}</b><button class="sp-icon small" :aria-label="'删除标记 '+formatTime(time)" @click="removeMark(i)">×</button></span>
      </div>
      <div class="bl-row">
        <span class="bl-input-group">
          <input aria-label="手动添加小节起点" v-model="manualMark" placeholder="m:ss.mmm 或秒数" @keydown.enter="addManualMark" />
          <button @click="addManualMark" :disabled="!manualMark.trim()">添加</button>
        </span>
        <span v-if="fit" :class="['bl-tag', fit.maxError <= 0.04 ? 'ok' : 'warn']">{{ fitSummary }}</span>
      </div>
      <p v-if="markerMessage" :class="['bl-note', markerError ? 'warn' : '']" role="status">{{ markerMessage }}</p>
    </section>

    <section class="ble-card" aria-label="速度与拍号">
      <div class="ble-card-head">
        <h3>速度与拍号</h3>
        <span class="bl-muted">点表头可批量修改整列</span>
      </div>
      <div class="ble-table" role="table">
        <div class="ble-tr ble-th" role="row">
          <span role="columnheader">#</span>
          <button class="ghost small" role="columnheader" title="批量修改所有段落的 BPM" @click="batchEdit('bpm')">BPM ✎</button>
          <button class="ghost small" role="columnheader" title="批量修改所有段落的拍号" @click="batchEdit('numerator')">拍号 ✎</button>
          <span role="columnheader">生效位置</span>
          <span></span>
        </div>
        <div class="ble-tbody">
          <div v-for="(segment, index) in segments" :key="index" class="ble-tr" role="row">
            <span class="ble-index">{{ index + 1 }}</span>
            <input aria-label="BPM" type="number" :min="BPM_MIN" :max="BPM_MAX" step="1" :value="segment.bpm" @input="onBpmInput(index, $event)" @change="onBpmChange(index, $event)" />
            <span class="bl-input-group">
              <input aria-label="每小节拍数" type="number" :min="NUMERATOR_MIN" :max="NUMERATOR_MAX" step="1" :value="segment.numerator" @input="onNumeratorInput(index, $event)" @change="onNumeratorChange(index, $event)" />
              <b>/</b>
              <select aria-label="拍号分母" :value="segment.denominator" @change="onDenominatorChange(index, $event)">
                <option v-for="d in DENOMINATORS" :key="d" :value="d">{{ d }}</option>
              </select>
            </span>
            <span v-if="index === 0" class="bl-input-group" title="第一小节第一拍的视频时间">
              <b>第一拍</b>
              <input aria-label="第一拍时间" class="ble-time" :value="formatTime(segment.firstBeatTime ?? 0)" placeholder="m:ss.mmm" @change="onFirstBeatChange($event)" />
              <button title="提前一拍" aria-label="提前一拍" @click="nudgeFirstBeat(-1)">‹</button>
              <button title="推后一拍" aria-label="推后一拍" @click="nudgeFirstBeat(1)">›</button>
            </span>
            <span v-else class="bl-input-group">
              <b>第</b>
              <input aria-label="从第几小节开始" type="number" min="2" step="1" :value="segment.startBar ?? 2" @input="onStartBarInput(index, $event)" @change="onStartBarChange(index, $event)" />
              <b>小节起</b>
            </span>
            <button v-if="index !== 0" class="sp-icon small" title="删除这一段" aria-label="删除这一段" @click="removeSegment(index)">×</button>
            <span v-else></span>
          </div>
        </div>
      </div>
      <button class="ble-add" @click="addSegment">＋ 从当前小节起变速 / 变拍号</button>
    </section>

    <section class="ble-card ble-tap" aria-label="打拍子">
      <button class="ble-tap-btn" :disabled="videoPaused" @click="tap()">
        <span>打拍子</span>
        <small>{{ videoPaused ? '先播放视频' : '跟着音乐连续点击' }}</small>
      </button>
      <div class="ble-tap-value">
        <b :class="{ active: tapValue }">{{ tapValue || '—' }}</b><span>BPM</span>
      </div>
      <div class="ble-tap-side">
        <div class="bl-row">
          <button class="small" :disabled="!tapValue" @click="applyTap">应用到第 1 段</button>
          <button class="small ghost" :disabled="!tapValue" @click="copyTapBpm">{{ copied ? '已复制' : '复制' }}</button>
          <button class="small ghost" :disabled="!tapValue" @click="clearTap">清空</button>
        </div>
        <label class="bl-check"><input v-model="snapFirstBeat" type="checkbox" /><span>第一拍吸附到点击的拍子</span></label>
        <label class="bl-check"><input v-model="tempMetronomeOff" type="checkbox" /><span>临时关闭节拍器</span></label>
      </div>
    </section>

    <div class="ble-actions">
      <button v-if="hasConfig" class="ghost danger" @click="deleteAll">删除此视频的配置</button>
      <span class="sp-push"></span>
      <span class="bl-muted">{{ hasConfig ? 
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import { BarFit, fitBarMarks } from './beat-markers'
import {
  BarConfig,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_SEGMENT,
  DENOMINATORS,
  NUMERATOR_MAX,
  NUMERATOR_MIN,
  TimeSignatureSegment,
  clamp,
  formatTime,
  locateBar,
  normalizeConfig,
  parseTime,
  segmentBeatDuration,
} from './config'

export default Vue.extend({
  name: 'BarLineEditor',
  props: {
    video: { type: Object, required: true },
    initial: { type: Object, required: true },
    hasConfig: { type: Boolean, default: false },
    onDelete: { type: Function, required: true },
    onPreview: { type: Function, required: true },
    onTempMute: { type: Function, required: true },
    /** Shown inside the panel instead of a dialog. */
    embedded: { type: Boolean, default: false },
    /** Bumped by the panel when the config changed elsewhere (control bar, auto alignment, volume). */
    revision: { type: Number, default: 0 },
  },
  data() {
    const normalized = normalizeConfig(this.initial as BarConfig)
    return {
      segments: normalized.segments.map(s => ({ ...s })) as TimeSignatureSegment[],
      metronomeMuted: normalized.metronomeMuted,
      metronomeVolume: normalized.metronomeVolume,
      // 校准来源随配置保留；修改 BPM 等参数后 normalizeConfig 会自动判定失效。
      tempoSource: normalized.tempoSource,
      manualCalibration: normalized.manualCalibration,
      tapTimes: [] as number[],
      tapValue: 0,
      copied: false,
      snapFirstBeat: false,
      tempMetronomeOff: false,
      videoPaused: true,
      marks: [] as number[],
      manualMark: '',
      fit: null as BarFit | null,
      markerCurrentTime: (this.video as HTMLVideoElement).currentTime,
      markerMessage: '',
      markerError: false,
      syncing: false,
      videoListeners: null as ((this: HTMLVideoElement, ev: Event) => void) | null,
      BPM_MIN,
      BPM_MAX,
      NUMERATOR_MIN,
      NUMERATOR_MAX,
      DENOMINATORS,
    }
  },
  computed: {
    draft(): BarConfig {
      return normalizeConfig({
        segments: this.segments,
        metronomeMuted: this.metronomeMuted,
        metronomeVolume: this.metronomeVolume,
        tempoSource: this.tempoSource,
        manualCalibration: this.manualCalibration,
      })
    },
    fitSummary(): string {
      const f = this.fit
      if (!f) return ''
      return f.bars > 1
        ? `${f.bpm.toFixed(2)} BPM · ${f.bars} 小节平均 · 最大偏差 ${Math.round(f.maxError * 1000)} ms`
        : `${f.bpm.toFixed(2)} BPM · 再标几个小节更准`
    },
  },
  watch: {
    segments: {
      deep: true,
      handler() {
        if (!this.syncing) this.onPreview(this.draft)
      },
    },
    revision() {
      // Reload values changed elsewhere, keeping marks and tap state.
      const next = normalizeConfig(this.initial as BarConfig)
      this.syncing = true
      this.segments = next.segments.map(s => ({ ...s }))
      this.metronomeMuted = next.metronomeMuted
      this.metronomeVolume = next.metronomeVolume
      this.tempoSource = next.tempoSource
      this.manualCalibration = next.manualCalibration
      this.$nextTick(() => { this.syncing = false })
    },
    tempMetronomeOff(value: boolean) {
      // 仅实时静音/恢复，不写入配置。
      this.onTempMute(value)
    },
  },
  mounted() {
    if (!this.embedded) document.addEventListener('keydown', this.onKeydown, true)
    const video = this.video as HTMLVideoElement
    this.videoPaused = video.paused
    const update = () => {
      this.videoPaused = video.paused
      this.markerCurrentTime = video.currentTime
    }
    for (const name of ['play', 'pause', 'timeupdate', 'seeked']) video.addEventListener(name, update)
    this.videoListeners = update
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.onKeydown, true)
    const video = this.video as HTMLVideoElement
    if (this.videoListeners) {
      for (const name of ['play', 'pause', 'timeupdate', 'seeked']) video.removeEventListener(name, this.videoListeners)
    }
  },
  methods: {
    formatTime,
    async toggleMarkerPlayback() {
      const video = this.video as HTMLVideoElement
      if (!video.paused) { video.pause(); return }
      try { await video.play() } catch {
        this.markerError = true
        this.markerMessage = '无法播放视频，请关闭面板，在播放器中完成加载后重试。'
      }
    },
    markStart() {
      const time = (this.video as HTMLVideoElement).currentTime
      if (!Number.isFinite(time)) return
      this.marks = [time]
      this.fit = null
      this.markerError = false
      this.markerMessage = '已记录起点。到下一小节开头点「下一节」。'
    },
    markNext() {
      this.addMark((this.video as HTMLVideoElement).currentTime)
    },
    addManualMark() {
      const time = parseTime(this.manualMark)
      if (!Number.isFinite(time)) {
        this.markerError = true
        this.markerMessage = '时间格式应为秒数或 m:ss.mmm'
        return
      }
      this.manualMark = ''
      this.addMark(time)
    },
    addMark(time: number) {
      const marks = [...this.marks, time].sort((a, b) => a - b)
      if (marks.length < 2) {
        this.marks = marks
        this.markerMessage = '已记录起点，再添加至少一个小节起点。'
        return
      }
      this.applyMarks(marks)
    },
    removeMark(index: number) {
      const marks = this.marks.filter((_, i) => i !== index)
      if (marks.length >= 2) this.applyMarks(marks)
      else { this.marks = marks; this.fit = null; this.markerMessage = '' }
    },
    clearMarks() {
      this.marks = []
      this.fit = null
      this.markerMessage = ''
    },
    applyMarks(marks: number[]) {
      try {
        const segment = this.segments[0]
        const fit = fitBarMarks(marks, segment.numerator, segment.denominator)
        this.marks = marks
        this.fit = fit
        segment.bpm = fit.bpm
        segment.firstBeatTime = fit.firstBeatTime
        this.tempoSource = 'manual-bars'
        this.manualCalibration = { time: fit.firstBeatTime, bpm: fit.bpm, numerator: segment.numerator, denominator: segment.denominator }
        this.metronomeMuted = false
        if (this.metronomeVolume <= 0) this.metronomeVolume = 0.1
        this.tempMetronomeOff = false
        this.onPreview(this.draft)
        this.markerError = false
        this.markerMessage = this.segments.length > 1 ? '已应用到第 1 段，后续变速段保持原设置。' : ''
      } catch (error) {
        this.markerError = true
        this.markerMessage = (error as Error).message
      }
    },
    onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        this.$emit('dialog-close')
      }
    },
    onBpmInput(index: number, e: Event) {
      const value = Number((e.target as HTMLInputElement).value)
      if (Number.isFinite(value) && value >= BPM_MIN && value <= BPM_MAX) {
        this.segments[index].bpm = value
      }
    },
    onBpmChange(index: number, e: Event) {
      const input = e.target as HTMLInputElement
      this.segments[index].bpm = clamp(Number(input.value) || DEFAULT_SEGMENT.bpm, BPM_MIN, BPM_MAX)
      input.value = String(this.segments[index].bpm)
    },
    onNumeratorInput(index: number, e: Event) {
      const value = Math.round(Number((e.target as HTMLInputElement).value))
      if (Number.isFinite(value) && value >= NUMERATOR_MIN && value <= NUMERATOR_MAX) {
        this.segments[index].numerator = value
      }
    },
    onNumeratorChange(index: number, e: Event) {
      const input = e.target as HTMLInputElement
      this.segments[index].numerator = clamp(Math.round(Number(input.value) || DEFAULT_SEGMENT.numerator), NUMERATOR_MIN, NUMERATOR_MAX)
      input.value = String(this.segments[index].numerator)
    },
    onDenominatorChange(index: number, e: Event) {
      const value = Number((e.target as HTMLSelectElement).value)
      this.segments[index].denominator = (DENOMINATORS as readonly number[]).includes(value) ? value : DEFAULT_SEGMENT.denominator
    },
    onFirstBeatChange(e: Event) {
      const input = e.target as HTMLInputElement
      const parsed = parseTime(input.value)
      if (!Number.isNaN(parsed)) {
        this.segments[0].firstBeatTime = Math.max(0, parsed)
      }
      // 失焦后统一还原为规范格式，输入过程中不打断。
      input.value = formatTime(this.segments[0].firstBeatTime ?? 0)
    },
    nudgeFirstBeat(direction: number) {
      const beat = segmentBeatDuration(this.segments[0])
      this.segments[0].firstBeatTime = Math.max(0, (this.segments[0].firstBeatTime ?? 0) + direction * beat)
    },
    onStartBarInput(index: number, e: Event) {
      const value = Math.round(Number((e.target as HTMLInputElement).value))
      if (Number.isFinite(value) && value >= 2) {
        this.segments[index].startBar = value
      }
    },
    onStartBarChange(index: number, e: Event) {
      const input = e.target as HTMLInputElement
      this.segments[index].startBar = Math.max(2, Math.round(Number(input.value) || 2))
      input.value = String(this.segments[index].startBar)
    },
    batchEdit(mode: 'bpm' | 'numerator') {
      const label = mode === 'bpm' ? 'BPM' : '拍号（如 3/4 或 6/8）'
      const value = prompt(`输入新的${label}，将应用到所有段落：`)
      if (value === null) {
        return
      }
      if (mode === 'bpm') {
        const num = Number(value)
        if (!Number.isFinite(num)) return
        const v = clamp(num, BPM_MIN, BPM_MAX)
        this.segments.forEach(s => { s.bpm = v })
        return
      }
      const [n, d] = value.split(/[/／]/).map(Number)
      if (!Number.isFinite(n)) return
      const numerator = clamp(Math.round(n), NUMERATOR_MIN, NUMERATOR_MAX)
      const denominator = (DENOMINATORS as readonly number[]).includes(d) ? d : undefined
      this.segments.forEach(s => {
        s.numerator = numerator
        if (denominator) s.denominator = denominator
      })
    },
    addSegment() {
      const video = this.video as HTMLVideoElement
      const loc = locateBar(this.draft, video.currentTime)
      const curBar = loc ? Math.max(2, loc.bar) : 2
      const last = this.segments[this.segments.length - 1] ?? DEFAULT_SEGMENT
      const startBar = Math.max(curBar, (last?.startBar ?? 1) + 1)
      this.segments.push({
        bpm: last?.bpm ?? DEFAULT_SEGMENT.bpm,
        numerator: last?.numerator ?? DEFAULT_SEGMENT.numerator,
        denominator: last?.denominator ?? DEFAULT_SEGMENT.denominator,
        startBar,
      })
    },
    removeSegment(index: number) {
      this.segments.splice(index, 1)
    },
    tap() {
      const video = this.video as HTMLVideoElement
      if (video.paused) {
        return
      }
      const now = video.currentTime
      if (this.tapTimes.length > 0 && now - this.tapTimes[this.tapTimes.length - 1] > 3) {
        this.tapTimes.length = 0
      }
      this.tapTimes.push(now)
      if (this.tapTimes.length < 2) {
        return
      }
      const intervals: number[] = []
      for (let i = 1; i < this.tapTimes.length; i += 1) {
        intervals.push(this.tapTimes[i] - this.tapTimes[i - 1])
      }
      const sorted = [...intervals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const valid = intervals.filter(d => d > median * 0.5 && d < median * 1.5)
      if (valid.length === 0) {
        this.tapTimes.length = 0
        return
      }
      const avg = valid.reduce((sum, d) => sum + d, 0) / valid.length
      this.tapValue = clamp(Math.round(60 / avg), BPM_MIN, BPM_MAX)
    },
    applyTap() {
      if (!this.tapValue || !this.segments[0]) return
      const segment = this.segments[0]
      segment.bpm = this.tapValue
      // 「吸附到拍子」：把第一拍对齐到点击的拍子网格。
      if (this.snapFirstBeat && this.tapTimes.length) {
        const bd = segmentBeatDuration(segment)
        segment.firstBeatTime = ((this.tapTimes[0] % bd) + bd) % bd
      }
    },
    async copyTapBpm() {
      if (!this.tapValue) {
        return
      }
      try { await navigator.clipboard.writeText(String(this.tapValue)) } catch { return }
      this.copied = true
      window.setTimeout(() => {
        this.copied = false
      }, 1200)
    },
    clearTap() {
      this.tapTimes.length = 0
      this.tapValue = 0
    },
    /** Called when the panel closes: undo 「临时关闭节拍器」. */
    resetTemp() {
      this.tempMetronomeOff = false
    },
    cancel() {
      this.$emit('dialog-close')
    },
    deleteAll() {
      if (!confirm('删除这个视频的全部小节线配置？')) return
      this.onDelete()
      this.$emit('dialog-close')
    },
  },
})
</script>
