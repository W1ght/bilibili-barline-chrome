export const identity: {aid?:string; cid?:string; bvid?:string} = {}
export const defineComponentMetadata = <T>(value:T) => value
export const defineOptionsMetadata = <T>(value:T) => value
const defaults:Record<string,any> = {hideBarNavButtons:false, loopDisableCountIn:false, countInMaxVolume:true, promptMetronomeVolume:false, arrowKeys:'plain', loopSpeedStep:0, loopSpeedTarget:1}
export const settings = {options:{...defaults} as Record<string,any>}
const listeners = new Map<string, Set<(v:any)=>void>>()
export async function initOptions() {
  const stored = await chrome.storage.local.get(null)
  for (const key of Object.keys(defaults)) settings.options[key] = stored['option:'+key] ?? defaults[key]
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    for (const key of Object.keys(defaults)) if (changes['option:'+key]) {
      settings.options[key] = changes['option:'+key].newValue ?? defaults[key]
      listeners.get('barline.'+key)?.forEach(fn => fn(settings.options[key]))
    }
  })
}
export function addComponentListener(key:string, fn:(v:any)=>void, immediate=false) {
  if (!listeners.has(key)) listeners.set(key,new Set())
  listeners.get(key)!.add(fn)
  if (immediate) fn(settings.options[key.split('.')[1]])
}
export const removeComponentListener = (key:string, fn:any) => listeners.get(key)?.delete(fn)
export function addStyle(css:string, id:string) {
  if (document.getElementById(id)) return
  const style = document.createElement('style'); style.id=id; style.textContent=css; document.head.append(style)
}
export const getActiveElement = () => document.activeElement
export const isTyping = () => !!document.activeElement?.closest('input,textarea,select,[contenteditable="true"]')
export const playerUrls = []
export const hasVideo = () => !!findVideo()
function findVideo(): HTMLVideoElement | null {
  if (!/^\/video\//.test(location.pathname)) return null
  return document.querySelector('.bpx-player-container video, .bilibili-player video, #bilibili-player video')
}
export const playerAgent = {query:{video:{element: async () => findVideo(), container:{sync:() => findVideo()?.closest('.bpx-player-video-wrap, .bilibili-player-video-wrap') ?? findVideo()?.parentElement}},control:{progress:async()=>document.querySelector('.bpx-player-progress-wrap, .bilibili-player-video-progress')}}}
export const select = async <T extends Element>(selector:string) => {
  for(let i=0;i<50;i++) {const el=document.querySelector<T>(selector);if(el)return el;await new Promise(r=>setTimeout(r,200))}
  return null
}
export const playerReady = async () => { while(!findVideo()) await new Promise(resolve=>setTimeout(resolve,500)) }
const icons: Record<string,string> = {}
export const addData = (_key:string, callback:(icons:Record<string,string>)=>void) => callback(icons)
export type VideoControlBarItem = {name:string; displayName:string; label?:string; icon:string; order:number; action:()=>void}
const buttons: VideoControlBarItem[] = []
export const addControlBarButton = (button:VideoControlBarItem) => buttons.push(button)
let toolbar: HTMLElement | null = null
/**
 * One shared page ticker for toolbar mounting, SPA navigation and the score
 * panel, instead of several independent polls. Skips work while the tab is
 * hidden and runs immediately on navigation or when the tab becomes visible.
 */
const tickers = new Set<() => void>()
let tickTimer = 0
function runTickers() { if (!document.hidden) tickers.forEach(fn => { try { fn() } catch (error) { console.error('[BarLine]', error) } }) }
export function onPageTick(fn: () => void) {
  tickers.add(fn)
  if (!tickTimer) {
    tickTimer = window.setInterval(runTickers, 400)
    document.addEventListener('visibilitychange', runTickers)
    window.addEventListener('popstate', () => setTimeout(runTickers, 50))
    ;(window as any).navigation?.addEventListener?.('navigatesuccess', () => setTimeout(runTickers, 50))
  }
  return () => tickers.delete(fn)
}
export function updateControlBar() { if (toolbar?.isConnected) renderButtons() }
function mountToolbar() {
  const video = findVideo()
  const player = video?.closest('.bpx-player-container, .bilibili-player')
  const parent = player?.querySelector('.bpx-player-control-bottom-left, .bilibili-player-video-control-bottom-left')
  if (!parent) { toolbar?.remove(); return }
  if (!toolbar) { toolbar=document.createElement('div'); toolbar.className='be-video-control-bar-extend barline-chrome-toolbar' }
  if (toolbar.parentElement !== parent) parent.append(toolbar)
  renderButtons()
}
function renderButtons() {
  if (!toolbar) return
  for (const item of [...buttons].sort((a,b)=>a.order-b.order)) {
    let button = toolbar.querySelector<HTMLButtonElement>(`[data-name="${item.name}"]`)
    if (!button) {
      button=document.createElement('button'); button.type='button'; button.dataset.name=item.name; button.className='be-video-control-bar-extend-item bpx-player-ctrl-btn'
      const label=document.createElement('span');label.className='barline-button-label';button.append(label)
      button.onclick=e=>{e.stopPropagation();item.action();button!.blur()}; toolbar.append(button)
    }
    const title=item.displayName || '节拍器：点击静音 / 恢复，悬停调节音量（Alt+M）'
    if (button.title !== title) { button.title=title; button.setAttribute('aria-label', title) }
    const html=icons[item.icon] ? `<span class="be-icon">${icons[item.icon]}</span>` : item.label || item.displayName
    if (button.dataset.icon !== html) {button.querySelector('.barline-button-label')!.innerHTML=html;button.dataset.icon=html}
  }
}
export async function getJsonWithCredentials(url:string) {
  const parsed=new URL(url)
  return chrome.runtime.sendMessage({type:'barline-video-info',id:parsed.searchParams.get('bvid') || parsed.searchParams.get('aid')})
}
export async function videoChange(callback:(id:any)=>Promise<void>) {
  let lastRoute='', lastVideo:HTMLVideoElement|null=null, lastSource='', busy=false
  const tick=async()=>{
    mountToolbar()
    if(busy) return
    const video=findVideo(), url=new URL(location.href)
    const route=url.pathname+'?p='+(url.searchParams.get('p')||'1')
    const source=video?.currentSrc || ''
    if(route===lastRoute && video===lastVideo && source===lastSource) return
    busy=true
    try {
      if(route!==lastRoute) {
        // Cancel the previous video before an asynchronous metadata request.
        await callback({})
        const id=url.pathname.match(/\/video\/(BV[\da-zA-Z]+|av\d+)/)?.[1] || ''
        let data:any
        if(id) try { const json=await getJsonWithCredentials('https://api.bilibili.com/x/web-interface/view?'+(id.startsWith('BV')?'bvid='+id:'aid='+id.slice(2))); data=json.code===0?json.data:null } catch {}
        if(location.pathname!==url.pathname || (new URL(location.href).searchParams.get('p')||'1')!==(url.searchParams.get('p')||'1')) return
        identity.aid=data?.aid?String(data.aid):id.startsWith('av')?id.slice(2):undefined
        identity.bvid=data?.bvid || (id.startsWith('BV')?id:undefined)
        identity.cid=id ? String(data?.pages?.find((p:any)=>p.page===Number(url.searchParams.get('p')||1))?.cid || `${id}:p${url.searchParams.get('p')||1}`) : undefined
      }
      lastRoute=route;lastVideo=video;lastSource=source
      await callback(identity)
    } catch(error) { console.error('[BarLine]',error) } finally {busy=false}
  }
  await tick(); onPageTick(() => void tick())
}
export const Toast = {
  /** Auto-dismisses after `ms` (restarted whenever the message changes); 0 keeps it until dismissed. */
  info(message:string,title='',ms=4000) {
    document.querySelectorAll('.barline-toast.leaving').forEach(e=>e.remove())
    const el=document.createElement('div');el.className='barline-toast barline-ui';el.setAttribute('role','status')
    const head=document.createElement('b'),body=document.createElement('span');head.textContent=title;body.textContent=message
    if(title)el.append(head);el.append(body);(document.fullscreenElement||document.body).append(el)
    let timer=0
    const dismiss=()=>{clearTimeout(timer);el.classList.add('leaving');setTimeout(()=>el.remove(),200)}
    const arm=()=>{clearTimeout(timer);if(ms>0)timer=window.setTimeout(dismiss,ms)}
    arm()
    return {set message(value:string){body.textContent=value;arm()},dismiss}
  },  mini(content:HTMLElement,anchor:HTMLElement,options:any) {
    content.addEventListener('click',e=>e.stopPropagation())
    content.classList.add('barline-chrome-volume'); anchor.append(content)
    const refresh=()=>options.onShow?.();anchor.addEventListener('mouseenter',refresh)
    return {tippy:{destroy:()=>{content.remove();anchor.removeEventListener('mouseenter',refresh)}}}
  }
}
