import { BPM_MIN, BPM_MAX, DENOMINATORS } from './config'

/** Calculate quarter-note BPM from two consecutive bar starts. */
export function bpmFromMarkers(first: number, second: number, denominator: number, numerator: number): number {
  if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || second <= first) {
    throw new Error('下一小节必须晚于起始小节，请标记相邻两个小节的起点。')
  }
  if (!(DENOMINATORS as readonly number[]).includes(denominator)) throw new Error('请先设置有效的拍号分母。')
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) throw new Error('请先设置有效的每小节拍数。')
  const bpm = 60 * numerator * (4 / denominator) / (second - first)
  if (bpm < BPM_MIN - 1e-8 || bpm > BPM_MAX + 1e-8) {
    throw new Error(`计算结果为 ${bpm.toFixed(2)} BPM，超出 ${BPM_MIN}–${BPM_MAX}，请重新标记相邻两个小节的起点。`)
  }
  return Number(Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)).toFixed(6))
}


export interface BarFit {
  bpm: number
  /** 拟合后的第一个标记小节起点（秒）。 */
  firstBeatTime: number
  /** 跨越的小节数（漏点的小节会自动补上）。 */
  bars: number
  /** 各标记与拟合网格的最大偏差（秒）。 */
  maxError: number
}

/**
 * 用连续多次「下一节」标记做线性回归，求平均小节长度与起点。
 * 手点误差会被平均掉；某次漏点一个小节（间隔约为两倍）时自动按两小节计算。
 */
export function fitBarMarks(times: number[], numerator: number, denominator: number): BarFit {
  if (times.length < 2) throw new Error('至少需要两个小节起点。')
  if (times.some(t => !Number.isFinite(t) || t < 0)) throw new Error('标记时间无效。')
  for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1] + 0.05) throw new Error('标记需按时间先后，且不能在同一位置重复点击。')
  if (times.length === 2) {
    const bpm = bpmFromMarkers(times[0], times[1], denominator, numerator)
    return { bpm, firstBeatTime: times[0], bars: 1, maxError: 0 }
  }
  if (!(DENOMINATORS as readonly number[]).includes(denominator)) throw new Error('请先设置有效的拍号分母。')
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) throw new Error('请先设置有效的每小节拍数。')
  const gaps = times.slice(1).map((t, i) => t - times[i])
  const unit = [...gaps].sort((a, b) => a - b)[gaps.length >> 1]
  const index = [0]
  for (const gap of gaps) index.push(index[index.length - 1] + Math.max(1, Math.round(gap / unit)))
  const n = times.length, mx = index.reduce((a, b) => a + b, 0) / n, my = times.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) { sxy += (index[i] - mx) * (times[i] - my); sxx += (index[i] - mx) ** 2 }
  const bar = sxy / sxx, first = my - bar * mx
  const bpm = 60 * numerator * (4 / denominator) / bar
  if (!(bar > 0) || bpm < BPM_MIN - 1e-8 || bpm > BPM_MAX + 1e-8) {
    throw new Error(`计算结果为 ${bpm.toFixed(2)} BPM，超出 ${BPM_MIN}–${BPM_MAX}，请重新标记。`)
  }
  const maxError = Math.max(...times.map((t, i) => Math.abs(t - (first + bar * index[i]))))
  return { bpm: Number(bpm.toFixed(6)), firstBeatTime: Math.max(0, first), bars: index[n - 1], maxError }
}
