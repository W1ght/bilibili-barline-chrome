import { alignDownbeatHere, component, markBarStart, markNextBar } from './index'
import { initStore } from './storage'
import { initOptions, settings, addControlBarButton, addStyle, hasVideo, addData } from './chrome-adapter'
import panelIcon from './pencil.svg?raw'
import css from './chrome.scss?inline'
import { initScorePanel, openScorePanel } from './score-panel'
import scoreCss from './score.scss?inline'
async function main() {
  await Promise.all([initStore(), initOptions()])
  addStyle(css, 'barline-chrome')
  addStyle(scoreCss, 'barline-score-styles')
  initScorePanel()
  addData('ui.icons', icons => { icons['chrome-panel'] = panelIcon })
  // One entry for everything: settings, score, chapters, practice and the library live in the panel.
  addControlBarButton({ name: 'barLinePanel', displayName: '小节线面板：节拍、抄谱、段落与练习', icon: 'chrome-panel', order: 0, action: () => openScorePanel() })
  addControlBarButton({ name: 'barLineMarkStart', displayName: '标记小节起点（Alt+1）', label: '起点', icon: '', order: 1.1, action: markBarStart })
  addControlBarButton({ name: 'barLineMarkNext', displayName: '标记下一小节，可连续标记多个（Alt+2）', label: '下一节', icon: '', order: 1.2, action: markNextBar })
  addControlBarButton({ name: 'barLineDownbeat', displayName: '此处为重拍：保持 BPM，让当前位置成为小节第一拍（Alt+3）', label: '重拍', icon: '', order: 1.3, action: alignDownbeatHere })
  const tabs: Record<string, string> = { open: '', edit: 'bars', score: 'capture', manage: 'library', chapters: 'practice' }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'barline-action') return
    if (!hasVideo() || !openScorePanel(tabs[message.action])) { reply({ ok: false }); return }
    reply({ ok: true })
  })
  await component.entry({ settings })
}
void main().catch(error => console.error('[BarLine] 启动失败', error))