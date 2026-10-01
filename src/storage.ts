import { normalizeConfig, type BarConfig } from './config'
const prefix = 'config:'
let cache: Record<string, BarConfig> = Object.create(null)
export async function initStore() {
  // Register before the read so subsequent writes stay visible across tabs.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    for (const [key, change] of Object.entries(changes) as any) {
      if (!key.startsWith(prefix) || pending.has(key.slice(prefix.length))) continue
      if (change.newValue === undefined) delete cache[key.slice(prefix.length)]
      else cache[key.slice(prefix.length)] = normalizeConfig(change.newValue)
    }
  })
  const all = await chrome.storage.local.get(null)
  for (const [key, value] of Object.entries(all)) if (key.startsWith(prefix)) cache[key.slice(prefix.length)] = normalizeConfig(value)
}
function report(error: unknown) {
  console.error('[BarLine] 配置保存失败', error)
  window.alert('小节线配置保存失败，请检查扩展是否被重新加载或存储空间是否已满。')
}
export const loadAllConfigs = (): Record<string, BarConfig> => structuredClone(cache)
export const loadConfig = (key: string) => cache[key] ? normalizeConfig(cache[key]) : null
/**
 * Edits apply to the in-memory cache at once; the write to chrome.storage is
 * debounced per video so dragging a value does not hit storage on every input.
 * Pending writes are flushed when the page is hidden or closed.
 */
const pending = new Map<string, number>()
const WRITE_DELAY = 300
function write(key: string) {
  clearTimeout(pending.get(key)); pending.delete(key)
  if (cache[key]) void chrome.storage.local.set({[prefix + key]:cache[key]}).catch(report)
}
function schedule(key: string) {
  clearTimeout(pending.get(key))
  pending.set(key, setTimeout(() => write(key), WRITE_DELAY) as unknown as number)
}
export function flushConfigs() { for (const key of [...pending.keys()]) write(key) }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushConfigs)
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushConfigs() })
}
export function saveConfig(key: string, cfg: BarConfig) {
  const now = Date.now()
  const value = normalizeConfig({...cache[key], ...cfg, createdAt: cache[key]?.createdAt ?? now, openedAt: cache[key]?.openedAt ?? now})
  cache[key] = value
  schedule(key)
  return value
}
export function deleteConfig(key: string) { clearTimeout(pending.get(key)); pending.delete(key); delete cache[key]; void chrome.storage.local.remove(prefix + key).catch(report) }
/** Only opening a video counts as "last opened"; edits no longer bump it. */
export function touchOpened(key: string) { if (cache[key]) { cache[key] = normalizeConfig({...cache[key], openedAt: Date.now()}); schedule(key) } }
export function setVideoMeta(key: string, meta: Partial<BarConfig>) {
  if (!cache[key]) return
  cache[key] = normalizeConfig({...cache[key], ...meta})
  schedule(key)
}export async function importAllConfigs(all: Record<string, unknown>) {
  for (const id of pending.values()) clearTimeout(id)
  pending.clear()
  const next: Record<string, BarConfig> = Object.create(null)
  for (const [key, cfg] of Object.entries(all)) {
    if (!cfg || typeof cfg !== 'object' || !Array.isArray((cfg as BarConfig).segments) || !(cfg as BarConfig).segments.length) throw new Error('配置格式无效')
    next[key] = normalizeConfig(cfg)
  }
  const stored = await chrome.storage.local.get(null)
  const removed = Object.keys(stored).filter(k => k.startsWith(prefix) && !Object.hasOwn(next, k.slice(prefix.length)))
  await chrome.storage.local.set(Object.fromEntries(Object.entries(next).map(([key,cfg]) => [prefix+key,cfg])))
  if (removed.length) await chrome.storage.local.remove(removed)
  cache = next
}
