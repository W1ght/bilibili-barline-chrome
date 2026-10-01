importScripts('score-db.js');
// Only the fixed video metadata endpoint is exposed to content scripts.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'barline-video-info' || sender.id !== chrome.runtime.id) return;
  if (!/^(BV[0-9A-Za-z]+|\d+)$/.test(message.id)) { reply({error: '无效的视频编号'}); return; }
  const query = message.id.startsWith('BV') ? 'bvid' : 'aid';
  fetch(`https://api.bilibili.com/x/web-interface/view?${query}=${encodeURIComponent(message.id)}`, {signal: AbortSignal.timeout(10000)})
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(reply).catch(error => reply({error: error.message}));
  return true;
});
