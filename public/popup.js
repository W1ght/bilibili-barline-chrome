const defaults = {hideBarNavButtons:true,loopDisableCountIn:false,arrowKeys:'plain',loopSpeedStep:0,loopSpeedTarget:1};
const targetRow = document.getElementById('targetRow');
const syncTarget = () => { targetRow.hidden = Number(document.getElementById('loopSpeedStep').value) <= 0; };
chrome.storage.local.get(Object.keys(defaults).map(key => `option:${key}`)).then(data => {
  for (const [key, fallback] of Object.entries(defaults)) {
    // data-invert: the switch reads as the positive wording of a stored "disable/hide" option.
    const input = document.getElementById(key), value = data[`option:${key}`] ?? fallback, invert = 'invert' in input.dataset;
    if (input.type === 'checkbox') input.checked = Boolean(value) !== invert; else input.value = String(value);
    input.addEventListener('change', () => {
      const next = input.type === 'checkbox' ? input.checked !== invert : input.dataset.type === 'number' ? Number(input.value) : input.value;
      chrome.storage.local.set({[`option:${key}`]: next});
      syncTarget();
    });
  }
  syncTarget();
});
document.getElementById('open').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const result = await chrome.tabs.sendMessage(tab.id, {type:'barline-action',action:'open'});
    if (!result?.ok) throw new Error(result?.error || '播放器尚未就绪');
    window.close();
  } catch { document.getElementById('status').textContent = '请先打开 B 站普通视频页；安装扩展后需刷新该页面。'; }
});
