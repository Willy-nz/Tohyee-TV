let opening = false;
let captureTabId;
browser.browserAction.onClicked.addListener(async () => {
  if (opening) return;
  opening = true;
  try {
    if (captureTabId !== undefined) {
      try {
        const tab = await browser.tabs.update(captureTabId, {active: true});
        await browser.windows.update(tab.windowId, {focused: true});
        return;
      } catch { captureTabId = undefined; }
    }
    const tab = await browser.tabs.create({url: browser.runtime.getURL('capture.html')});
    captureTabId = tab.id;
  } finally { opening = false; }
});
browser.tabs.onRemoved.addListener(id => {
  if (id === captureTabId) captureTabId = undefined;
});
