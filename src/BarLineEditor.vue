<template>
  <div class="barline-editor" :class="{embedded}">
    <section class="ble-hero" aria-label="当前节拍">
      <span class="ble-hero-bpm">
        <button class="ghost small ble-nudge" title="减慢 0.1 BPM（Shift 点击减 1）" aria-label="减慢 BPM" @click="nudgeBpm(-1, $event)">−</button>
        <label title="四分音符每分钟拍数，精确到 0.1">
          <input aria-label="BPM" type="number" :min="BPM_MIN" :max="BPM_MAX" step="0.1" :value="roundBpm(segments[0].bpm)" @input="onBpmInput(0, $event)" @change="onBpmChange(0, $event)" />
        </label>
        <button class="ghost small ble-nudge" title="加快 0.1 BPM（Shift 点击加 1）" aria-label="加快 BPM" @click="nudgeBpm(1, $event)">＋</button>
        <span>BPM</span>
      </span>
      <span class="bl-input-group ble-hero-meter" title="拍号">
        <input aria-label="每小节拍数" type="number" :min="NUMERATOR_MIN" :max="NUMERATOR_MAX" step="1" :value="segments[0].numerator" @input="onNumeratorInput(0, $event)" @change="onNumeratorChange(0, $event)" />
        <b>/</b>
        <select aria-label="拍号分母" :value="segments[0].denominator" @change="onDenominatorChange(0, $event)">
          <option v-for="d in DENOMINATORS" :key="d" :value="d">{{ d }}</option>
        </select>
      </span>
      <span :class="['bl-tag', sourceTag.kind]">{{ sourceTag.text }}</span>
      <span class="sp-push"></span>
      <span v-if="hasConfig" class="ble-first" title="第一小节第一拍的位置；节拍器重拍不对时用 ‹ › 挪一拍，或在重拍处点「此处为重拍」">
        第一拍 <b>{{ formatTime(segments[0].firstBeatTime ?? 0) }}</b>
        <button class="ghost small" aria-label="提前一拍" @click="nudgeFirstBeat(-1)">‹</button>
        <button class="ghost small" aria-label="推后一拍" @click="nudgeFirstBeat(1)">›</button>
        <button class="ghost small ble-here" title="保持 BPM 和拍号，平移小节网格，让当前播放位置成为重拍（Alt+3）" @click="alignDownbeatHere">此处为重拍</button>
      </span>
    </section>

    <section v-if="allSources.length" class="ble-card ble-sources" aria-label="应用速度">
      <div class="ble-card-head">
        <h3>应用速度</h3>
        <span class="bl-muted">选一个来源，写入节拍器</span>
      </div>
      <label v-for="s in allSources" :key="s.id" class="ble-source" :class="{active: activeSource && activeSource.id === s.id}">
        <input type="radio" name="ble-source" :value="s.id" :checked="activeSource && activeSource.id === s.id" @change="selectedSource = s.id" />
        <span class="ble-source-name">{{ s.label }}</span>
        <b>{{ formatBpm(s.bpm) }}</b><small>BPM</small>
        <span :class="['ble-source-detail', s.warn ? 'warn' : '']">{{ s.detail }}</span>
      </label>
      <slot name="source-notes"></slot>
      <div class="bl-row">
        <span class="bl-muted">{{ activeSource && activeSource.hint }}</span>
        <span class="sp-push"></span>
        <button class="primary" :disabled="!activeSource || activeSource.disabled" @click="applySource">应用到节拍器</button>
      </div>
    </section>

    <slot name="auto"></slot>

    <section class="ble-card" aria-label="手动打点">
      <div class="ble-card-head">
        <h3>{{ hasConfig ? '打点校准' : '手动打点' }}</h3>
        <span class="bl-muted"><kbd>Alt+1</kbd> 起点 · <kbd>Alt+2</kbd> 下一节</span>
      </div>
      <p v-if="!marks.length" class="bl-note">播放到某小节开头点「起点」，之后每到下一小节开头点「下一节」。点得越多越准，BPM 和节拍器自动设好。</p>
      <div class="ble-marker-bar">
        <button class="ble-play" @click="toggleMarkerPlayback" :title="videoPaused?'播放':'暂停'">{{ videoPaused ? '▶' : '❚❚' }}</button>
        <span class="ble-clock">{{ formatTime(markerCurrentTime) }}</span>
        <button :class="marks.length ? '' : 'primary'" @click="markStart">起点</button>
        <button :class="marks.length ? 'primary' : ''" :disabled="!marks.length" @click="markNext">下一节{{ marks.length > 1 ? ` · ${marks.length - 1}` : '' }}</button>
        <button v-if="marks.length" class="ghost" @click="clearMarks">清空</button>
      </div>
      <div v-if="fit" class="bl-row"><span :class="['bl-tag', fit.maxError <= 0.04 ? 'ok' : 'warn']">{{ fitSummary }}</span></div>
      <p v-if="markerMessage" :class="['bl-note', markerError ? 'warn' : '']" role="status">{{ markerMessage }}</p>
    </section>

    <details class="ble-more">
      <summary>更多：变速分段、打拍子、按时间输入</summary>

      <section class="ble-sub" aria-label="变速分段">
        <h4>变速／变拍号</h4>
        <div v-if="segments.length > 1" class="ble-table" role="table">
          <div v-for="(segment, index) in segments.slice(1)" :key="index + 1" class="ble-tr" role="row">
            <span class="bl-input-group">
              <b>第</b>
              <input aria-label="从第几小节开始" type="number" min="2" step="1" :value="segment.startBar ?? 2" @input="onStartBarInput(index + 1, $event)" @change="onStartBarChange(index + 1, $event)" />
              <b>小节起</b>
            </span>
            <span class="bl-input-group">
              <input aria-label="BPM" type="number" :min="BPM_MIN" :max="BPM_MAX" step="0.1" :value="roundBpm(segment.bpm)" @input="onBpmInput(index + 1, $event)" @change="onBpmChange(index + 1, $event)" />
              <b>BPM</b>
            </span>
            <span class="bl-input-group">
              <input aria-label="每小节拍数" type="number" :min="NUMERATOR_MIN" :max="NUMERATOR_MAX" step="1" :value="segment.numerator" @input="onNumeratorInput(index + 1, $event)" @change="onNumeratorChange(index + 1, $event)" />
              <b>/</b>
              <select aria-label="拍号分母" :value="segment.denominator" @change="onDenominatorChange(index + 1, $event)">
                <option v-for="d in DENOMINATORS" :key="d" :value="d">{{ d }}</option>
              </select>
            </span>
            <button class="sp-icon small" title="删除这一段" aria-label="删除这一段" @click="removeSegment(index + 1)">×</button>
          </div>
        </div>
        <button class="ble-add" @click="addSegment">＋ 从当前小节起变速 / 变拍号</button>
      </section>

      <section class="ble-sub ble-tap" aria-label="打拍子">
        <button class="ble-tap-btn" :disabled="videoPaused" @click="tap()">
          <span>打拍子</span>
          <small>{{ videoPaused ? '先播放视频' : '跟着音乐连续点击' }}</small>
        </button>
        <div class="ble-tap-value">
          <b :class="{ active: tapValue }">{{ tapValue ? formatBpm(tapValue) : '—' }}</b><span>BPM</span>
        </div>
        <span class="bl-muted">{{ tapValue ? '在上方「应用速度」里应用' : '' }}</span>
      </section>

      <section class="ble-sub" aria-label="按时间输入">
        <h4>按时间输入</h4>
        <div class="bl-row">
          <span class="bl-input-group">
            <input aria-label="手动添加小节起点" v-model="manualMark" placeholder="小节起点 m:ss.mmm" @keydown.enter="addManualMark" />
            <button @click="addManualMark" :disabled="!manualMark.trim()">添加</button>
          </span>
          <span class="bl-input-group" title="第一小节第一拍的视频时间">
            <b>第一拍</b>
            <input aria-label="第一拍时间" class="ble-time" :value="formatTime(segments[0].firstBeatTime ?? 0)" placeholder="m:ss.mmm" @change="onFirstBeatChange($event)" />
          </span>
        </div>
        <div v-if="marks.length" class="ble-marks">
          <span v-for="(time, i) in marks" :key="i" class="ble-mark">{{ i === 0 ? '起点' : '+' + i }} <b>{{ formatTime(time) }}</b><button class="sp-icon small" :aria-label="'删除标记 '+formatTime(time)" @click="removeMark(i)">×</button></span>
        </div>
      </section>

      <slot name="more"></slot>

      <div v-if="hasConfig" class="ble-actions">
        <button class="ghost danger small" @click="deleteAll">删除此视频的节拍配置</button>
      </div>
    </details>
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
  firstBeatForDownbeatAt,
  formatBpm,
  formatTime,
  locateBar,
  normalizeConfig,
  parseTime,
  roundBpm,
  segmentBeatDuration,
} from './config'

/** 「应用速度」卡片里的一个来源（谱面、音频、打拍子……），统一由一个按钮写入节拍器。 */
export interface TempoSource {
  id: string
  label: string
  bpm: number
  detail?: string
  warn?: boolean
  hint?: string
  disabled?: boolean
  apply: () => void
}

export default Vue.extend({
  name: 'BarLineEditor',
  props: {
    video: { type: Object, required: true },
    initial: { type: Object, required: true },
    hasConfig: { type: Boolean, default: false },
    onDelete: { type: Function, required: true },
    onPreview: { type: Function, required: true },
    /** Shown inside the panel instead of a dialog. */
    embedded: { type: Boolean, default: false },
    /** Bumped by the panel when the config changed elsewhere (control bar, auto alignment, volume). */
    revision: { type: Number, default: 0 },
    /** 外部提供的速度来源（谱面对齐、音频分析），与打拍子结果一起列在「应用速度」里。 */
    sources: { type: Array, default: () => [] },
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
      selectedSource: '',
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
    sourceTag(): { text: string; kind: string } {
      if (!this.hasConfig) return { text: '未设置', kind: '' }
      if (this.tempoSource === 'manual-bars') return { text: '已校准', kind: 'ok' }
      if (this.tempoSource === 'auto') return { text: '自动', kind: 'ok' }
      return { text: '手动输入', kind: '' }
    },
    fitSummary(): string {
      const f = this.fit
      if (!f) return ''
      return f.bars > 1
        ? `${formatBpm(f.bpm)} BPM · ${f.bars} 小节平均 · 最大偏差 ${Math.round(f.maxError * 1000)} ms`
        : `${formatBpm(f.bpm)} BPM · 再标几个小节更准`
    },
    allSources(): TempoSource[] {
      const list = [...(this.sources as TempoSource[])]
      if (this.tapValue) {
        list.push({
          id: 'tap',
          label: '打拍子',
          bpm: this.tapValue,
          detail: `${this.tapTimes.length} 次点击`,
          hint: '只改第 1 段速度，第一拍对齐到点击；重拍不对再点「此处为重拍」。',
          apply: () => this.applyTap(),
        })
      }
      return list
    },
    activeSource(): TempoSource | null {
      const list = this.allSources
      return list.find(s => s.id === this.selectedSource) ?? list[0] ?? null
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
    formatBpm,
    roundBpm,
    applySource() {
      this.activeSource?.apply()
    },
    /** BPM 微调：每次 ±0.1，按住 Shift ±1；第一拍位置不动。 */
    nudgeBpm(direction: number, e: MouseEvent) {
      const segment = this.segments[0]
      segment.bpm = clamp(roundBpm(segment.bpm + direction * (e.shiftKey ? 1 : 0.1)), BPM_MIN, BPM_MAX)
    },
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
        this.segments[index].bpm = roundBpm(value)
      }
    },
    onBpmChange(index: number, e: Event) {
      const input = e.target as HTMLInputElement
      const typed = Number(input.value)
      // 输入框显示的是一位小数；值没改时保留原来的完整精度（例如打点拟合的结果）。
      if (typed === roundBpm(this.segments[index].bpm)) return
      this.segments[index].bpm = clamp(roundBpm(typed || DEFAULT_SEGMENT.bpm), BPM_MIN, BPM_MAX)
      input.value = String(roundBpm(this.segments[index].bpm))
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
    alignDownbeatHere() {
      const time = (this.video as HTMLVideoElement).currentTime
      if (!Number.isFinite(time)) return
      this.segments[0].firstBeatTime = firstBeatForDownbeatAt(this.draft, time)
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
      this.tapValue = clamp(roundBpm(60 / avg), BPM_MIN, BPM_MAX)
      this.selectedSource = 'tap'
    },
    applyTap() {
      if (!this.tapValue || !this.segments[0]) return
      const segment = this.segments[0]
      segment.bpm = this.tapValue
      // 第一拍对齐到点击的拍子网格；重拍不对时用 ‹ › 挪一拍。
      if (this.tapTimes.length) {
        const bd = segmentBeatDuration(segment)
        segment.firstBeatTime = ((this.tapTimes[0] % bd) + bd) % bd
      }
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
