const defaults = {hideBarNavButtons:false,loopDisableCountIn:false,countInMaxVolume:true,promptMetronomeVolume:false,arrowKeys:'plain',loopSpeedStep:0,loopSpeedTarget:1};
chrome.storage.local.get(Object.keys(defaults).map(key => `option:${key}`)).then(data => {
  for (const [key, fallback] of Object.entries(defaults)) {
    const input = document.getElementById(key), value = data[`option:${key}`] ?? fallback;
    if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
    input.addEventListener('change', () => {
      const next = input.type === 'checkbox' ? input.checked : input.dataset.type === 'number' ? Number(input.value) : input.value;
      chrome.storage.local.set({[`option:${key}`]: next});
    });
  }
});
for (const action of ['edit','manage','score']) document.getElementById(action).addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const result = await chrome.tabs.sendMessage(tab.id, {type:'barline-action',action});
    if (!result?.ok) throw new Error(result?.error || '播放器尚未就绪');
    window.close();
  } catch { document.getElementById('status').textContent = '请先打开 B 站普通视频页；安装扩展后需刷新该页面。'; }
});