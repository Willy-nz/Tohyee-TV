let creating;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) creating = chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Keep a user-started 30-second capture test alive after the popup closes, and retain its local replay.'
  }).finally(() => { creating = undefined; });
  await creating;
}
async function command(message) {
  if (message.type === 'badge') {
    await chrome.action.setBadgeText({text: message.state === 'recording' ? 'REC' : message.state === 'starting' ? '…' : message.state === 'done' ? 'DONE' : message.state === 'error' ? 'ERR' : ''});
    await chrome.action.setBadgeBackgroundColor({color: message.state === 'recording' ? '#b52b44' : '#665018'});
    await chrome.action.setTitle({title: `Tohyee TV — ${message.state}`});
    return {ok: true};
  }
  if (message.type === 'start') {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('Open a normal website tab, then click the extension there.');
    await ensureOffscreen();
    const state = await chrome.runtime.sendMessage({target:'offscreen', type:'status'});
    if (['starting','recording','stopping'].includes(state.state)) throw new Error('A test is already running. Stop it first.');
    const id = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
    return chrome.runtime.sendMessage({target:'offscreen', type:'start', id});
  }
  if (!(await chrome.offscreen.hasDocument())) return {state:'idle', message:'Ready for a local capture test.'};
  return chrome.runtime.sendMessage({target:'offscreen', type:message.type});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'worker' || sender.id !== chrome.runtime.id) return;
  command(message).then(respond, error => respond({error:error.message}));
  return true;
});
