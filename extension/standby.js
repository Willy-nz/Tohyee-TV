const channelNumber = new URLSearchParams(location.search).get('channel') ?? '1';
document.getElementById('back').addEventListener('click', async () => {
  const button = document.getElementById('back');
  button.disabled = true;
  button.textContent = 'Going back…';
  try {
    await chrome.runtime.sendMessage({target: 'worker', type: 'leaveStandby', channelNumber});
  } catch {
    button.disabled = false;
    button.textContent = 'Go back to the video now';
  }
});
