/**
 * 「音乐小节线」组件 —— 数据模型、时间计算与配置持久化。
 *
 * 配置为「拍号段」列表：第一段以绝对时间「第一拍位置」为锚点，后续每段以「第 N 小节」为锚点，
 * 播放到该小节时切换 BPM 与拍号，从而支持一首曲目内的变速 / 变拍号。
 *
 * 时间约定：
 * - 一拍 = 拍号分母所代表的音符时值（4/4 时一拍即四分音符）
 * - 一拍时长 = 60 / bpm（秒）
 * - 一小节时长 = 分子 × 一拍时长（秒）
 */

export interface TimeSignatureSegment {
  /** BPM */
  bpm: number
  /** 拍号分子（每小节拍数） */
  numerator: number
  /** 拍号分母（2 | 4 | 8 | 16）；决定一拍的时长，参与时间计算 */
  denominator: number
  /** 第一段专属：第一拍的时间（秒） */
  firstBeatTime?: number
  /** 后续段专属：从第几小节（1-based）开始生效 */
  startBar?: number
}

export interface BarConfig {
  tempoSource?: 'manual-bars' | 'auto'
  manualCalibration?: {time:number; bpm:number; numerator:number; denominator:number}
  segments: TimeSignatureSegment[]
  /** 节拍器是否静音 */
  metronomeMuted: boolean
  /** 节拍器音量（0 - 1） */
  metronomeVolume: number
  /** 创建时间（ms）；管理面板按「创建时间」排序用 */
  createdAt?: number
  /** 最近打开时间（ms）；管理面板按「最后打开时间」排序用 */
  openedAt?: number
  /** 视频标题 / 封面（管理面板卡片展示，由 B 站 API 拉取后缓存） */
  videoTitle?: string
  videoCover?: string
  /** 视频 BV 号（跳转用） */
  bvid?: string
  /** 视频 aid（跳转用） */
  aid?: string
}

export const BPM_MIN = 30
export const BPM_MAX = 360
export const NUMERATOR_MIN = 1
export const NUMERATOR_MAX = 32
export const DENOMINATORS = [2, 4, 8, 16] as const

export const DEFAULT_SEGMENT: TimeSignatureSegment = {
  bpm: 120,
  numerator: 4,
  denominator: 4,
  firstBeatTime: 0,
}

export const DEFAULT_CONFIG: BarConfig = {
  segments: [{ ...DEFAULT_SEGMENT }],
  metronomeMuted: true,
  metronomeVolume: 1,
}

export const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

/** 秒 -> "m:ss.mmm" */
export const formatTime = (sec: number) => {
  const totalMs = Math.max(0, Math.round(sec * 1000))
  const m = Math.floor(totalMs / 60000)
  const s = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** BPM 统一保留一位小数（显示与手动输入）；内部计算仍用完整精度，避免长曲目累积漂移。 */
export const roundBpm = (bpm: number) => Math.round(bpm * 10) / 10
export const formatBpm = (bpm: number) => roundBpm(bpm).toFixed(1)

/** "m:ss.mmm" -> 秒；解析失败返回 NaN。支持三种写法：
 * - 纯数字/小数：当作秒（如 `12` = 12 秒，`1.5` = 1.5 秒）
 * - 含 `:` 或 `：`：前面是分钟、后面是秒（如 `1:02` = 1 分 2 秒）。 */
export const parseTime = (str: string) => {
  const text = str.trim().replace(/。/g, '.')
  if (!text) {
    return NaN
  }
  const colonMatch = text.match(/^\s*(\d+)\s*[:：]\s*(\d+(?:\.\d+)?)\s*$/)
  if (colonMatch) {
    const min = Number(colonMatch[1])
    const sec = Number(colonMatch[2])
    if (min >= 0 && sec >= 0 && sec < 60) {
      return min * 60 + sec
    }
    return NaN
  }
  const secMatch = text.match(/^\s*(\d+(?:\.\d+)?)\s*$/)
  if (secMatch) {
    return Number(secMatch[1])
  }
  return NaN
}

const normalizeDenominator = (value: unknown) =>
  (DENOMINATORS as readonly number[]).includes(Number(value)) ? Number(value) : 4

const normalizeSegment = (input: unknown): TimeSignatureSegment => {
  const src = (input ?? {}) as {
    bpm?: unknown
    numerator?: unknown
    denominator?: unknown
    firstBeatTime?: unknown
    startBar?: unknown
  }
  const segment: TimeSignatureSegment = {
    bpm: clamp(Number(src.bpm) || DEFAULT_SEGMENT.bpm, BPM_MIN, BPM_MAX),
    numerator: clamp(
      Math.round(Number(src.numerator) || DEFAULT_SEGMENT.numerator),
      NUMERATOR_MIN,
      NUMERATOR_MAX,
    ),
    denominator: normalizeDenominator(src.denominator),
  }
  if (src.firstBeatTime !== undefined) {
    segment.firstBeatTime = Number.isFinite(Number(src.firstBeatTime)) ? Math.max(0, Number(src.firstBeatTime)) : 0
  }
  if (src.startBar !== undefined) {
    segment.startBar = Number.isFinite(Number(src.startBar)) ? Math.max(2, Math.round(Number(src.startBar) || 2)) : 2
  }
  return segment
}

/** 校验并归一化配置。 */
export const normalizeConfig = (input: unknown): BarConfig => {
  const src = (input ?? {}) as {
    tempoSource?: unknown
    manualCalibration?: BarConfig['manualCalibration']
    segments?: unknown
    metronomeMuted?: unknown
    metronomeVolume?: unknown
    createdAt?: unknown
    openedAt?: unknown
    videoTitle?: unknown
    videoCover?: unknown
    bvid?: unknown
    aid?: unknown
  }
  let segments =
    Array.isArray(src.segments) && src.segments.length > 0
      ? src.segments.map(normalizeSegment)
      : [{ ...DEFAULT_SEGMENT }]
  if (segments[0].firstBeatTime === undefined) {
    segments[0].firstBeatTime = 0
  }
  // Later entries win when imported data contains duplicate start bars.
  const changes = new Map(segments.slice(1).map(s => [s.startBar ?? 2, {...s, startBar:s.startBar ?? 2}]))
  segments = [segments[0], ...[...changes.values()].sort((a,b) => a.startBar - b.startBar)]
  const cfg: BarConfig = {
    segments,
    metronomeMuted: Boolean(src.metronomeMuted),
    metronomeVolume: clamp(Number(src.metronomeVolume ?? 1), 0, 1),
  }
  const m=src.manualCalibration,s=segments[0]
  if(src.tempoSource==='manual-bars'&&m&&Number.isFinite(m.time)&&m.time===s.firstBeatTime&&m.bpm===s.bpm&&m.numerator===s.numerator&&m.denominator===s.denominator){cfg.tempoSource='manual-bars';cfg.manualCalibration={...m}}
  else if(src.tempoSource==='auto')cfg.tempoSource='auto'
  if (typeof src.createdAt === 'number') {
    cfg.createdAt = src.createdAt
  }
  if (typeof src.openedAt === 'number') {
    cfg.openedAt = src.openedAt
  }
  if (typeof src.videoTitle === 'string' && src.videoTitle) {
    cfg.videoTitle = src.videoTitle
  }
  if (typeof src.videoCover === 'string' && src.videoCover) {
    cfg.videoCover = src.videoCover
  }
  if (typeof src.bvid === 'string' && src.bvid) {
    cfg.bvid = src.bvid
  }
  if (typeof src.aid === 'string' && src.aid) {
    cfg.aid = src.aid
  }
  return cfg
}

/**
 * 一拍时长（秒）。bpm 以四分音符为一拍，分母 d 表示一拍是 d 分音符：
 * 一拍 = (60/bpm) × (4/d)。分母 4 时即 60/bpm。
 */
export const segmentBeatDuration = (segment: TimeSignatureSegment) =>
  (60 / segment.bpm) * (4 / segment.denominator)

export const segmentBarDuration = (segment: TimeSignatureSegment) =>
  segment.numerator * segmentBeatDuration(segment)

/** 时间线上的一段拍号信息（已按 startBar 排序，第一段 startBar = 1） */
export interface SegmentInfo {
  segment: TimeSignatureSegment
  startBar: number
  startTime: number
  beatDuration: number
  barDuration: number
}

/** 由拍号段列表构建时间线，每段给出起始小节号与起始时间。 */
export const buildTimeline = (cfg: BarConfig): SegmentInfo[] => {
  const items = cfg.segments
    .map((segment, index) => ({
      segment,
      startBar: index === 0 ? 1 : Math.max(1, Math.round(segment.startBar ?? 1)),
    }))
    .sort((a, b) => a.startBar - b.startBar)
  const infos: SegmentInfo[] = []
  let time = Math.max(0, items[0]?.segment.firstBeatTime ?? 0)
  for (let i = 0; i < items.length; i += 1) {
    const { segment, startBar } = items[i]
    const beatDuration = segmentBeatDuration(segment)
    const barDuration = segmentBarDuration(segment)
    infos.push({ segment, startBar, startTime: time, beatDuration, barDuration })
    if (i + 1 < items.length) {
      const barCount = Math.max(1, items[i + 1].startBar - startBar)
      time += barCount * barDuration
    }
  }
  return infos
}

/** 定位时间 t 所在的小节：返回全局小节号（1-based）、小节起拍时间。 */
export const locateBar = (cfg: BarConfig, t: number): { bar: number; startTime: number } | null => {
  const infos = buildTimeline(cfg)
  if (infos.length === 0 || t < infos[0].startTime) {
    return null
  }
  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i]
    const nextStartTime = i + 1 < infos.length ? infos[i + 1].startTime : Infinity
    if (t < nextStartTime || i === infos.length - 1) {
      const barInSegment = Math.floor((t - info.startTime) / info.barDuration)
      return {
        bar: info.startBar + barInSegment,
        startTime: info.startTime + barInSegment * info.barDuration,
      }
    }
  }
  return null
}

/** 第 bar 小节（1-based）的起拍时间；超出时间线返回 null。 */
export const barStartTime = (cfg: BarConfig, bar: number): number | null => {
  const infos = buildTimeline(cfg)
  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i]
    const nextStartBar = i + 1 < infos.length ? infos[i + 1].startBar : Infinity
    if (bar >= info.startBar && bar < nextStartBar) {
      return info.startTime + (bar - info.startBar) * info.barDuration
    }
  }
  return null
}

/**
 * 「重拍对齐此处」：整体平移小节网格（BPM、拍号、变速段不变），让某个小节的第一拍落在 t。
 * 取平移量最小的方向，返回新的第一拍时间；t 在第一拍之前时第一小节直接从 t 开始。
 */
export const firstBeatForDownbeatAt = (cfg: BarConfig, t: number): number => {
  const first = Math.max(0, cfg.segments[0]?.firstBeatTime ?? 0)
  const loc = locateBar(cfg, t)
  if (!loc) return Math.max(0, t)
  const info = buildTimeline(cfg).filter(s => s.startTime <= loc.startTime + 1e-9).pop()
  const barDuration = info?.barDuration ?? 0
  const offset = t - loc.startTime
  const shift = barDuration > 0 && offset > barDuration / 2 && first + offset - barDuration >= 0 ? offset - barDuration : offset
  return Math.max(0, first + shift)
}

/** 时间 t 所在的拍号段；t 在时间线之前时返回第一段。 */
export const segmentAt = (cfg: BarConfig, t: number): TimeSignatureSegment | null => {
  const infos = buildTimeline(cfg)
  if (infos.length === 0) {
    return null
  }
  let result = infos[0].segment
  for (const info of infos) {
    if (t >= info.startTime) {
      result = info.segment
    } else {
      break
    }
  }
  return result
}

/** 时间 t 位于当前小节的第几拍（1-based）；在时间线之前返回 null。 */
export const beatNumberAt = (cfg: BarConfig, t: number): number | null => {
  const infos = buildTimeline(cfg)
  if (infos.length === 0 || t < infos[0].startTime) {
    return null
  }
  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i]
    const nextStartTime = i + 1 < infos.length ? infos[i + 1].startTime : Infinity
    if (t < nextStartTime || i === infos.length - 1) {
      const beatInSegment = Math.floor((t - info.startTime) / info.beatDuration)
      return (beatInSegment % info.segment.numerator) + 1
    }
  }
  return null
}

/** 时间 t 之后的下一拍边界。 */
export const nextBeatAt = (cfg: BarConfig, t: number): { time: number; isBar: boolean } | null => {
  const infos = buildTimeline(cfg)
  if (infos.length === 0) {
    return null
  }
  if (t < infos[0].startTime) {
    return { time: infos[0].startTime, isBar: true }
  }
  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i]
    const nextStartTime = i + 1 < infos.length ? infos[i + 1].startTime : Infinity
    if (t < nextStartTime || i === infos.length - 1) {
      // 加微小量避免浮点误差导致返回与 t 相同的边界（会造成重复触发同一拍）。
      const beatInSegment = Math.floor((t - info.startTime) / info.beatDuration + 1e-9)
      const nextBeatTime = info.startTime + (beatInSegment + 1) * info.beatDuration
      if (i + 1 < infos.length && nextBeatTime >= infos[i + 1].startTime) {
        return { time: infos[i + 1].startTime + 1e-9, isBar: true }
      }
      return {
        time: nextBeatTime,
        isBar: (beatInSegment + 1) % info.segment.numerator === 0,
      }
    }
  }
  return null
}

/**
 * 配置存储：使用组件 settings 的一个 string 型选项 `configs` 持久化，
 * 内容为 JSON 字符串，形如 { [videoKey]: BarConfig }。
 */

export { initStore, loadAllConfigs, loadConfig, saveConfig, deleteConfig, touchOpened, setVideoMeta, importAllConfigs } from './storage'
