const DEFAULT_APP_URL = 'http://localhost:5173';

const urlInput = document.getElementById('url');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

function setStatus(text, ok = true) {
  statusEl.textContent = text;
  statusEl.style.color = ok ? '#86efac' : '#fca5a5';
}

chrome.storage.sync.get({ akiraAppUrl: DEFAULT_APP_URL }, (data) => {
  urlInput.value = data.akiraAppUrl || DEFAULT_APP_URL;
});

saveBtn.addEventListener('click', () => {
  const v = urlInput.value.trim() || DEFAULT_APP_URL;
  try {
    new URL(v);
  } catch {
    setStatus('Enter a full URL (including http:// or https://).', false);
    return;
  }
  chrome.storage.sync.set({ akiraAppUrl: v }, () => {
    setStatus('Saved. Reload the side panel if it is already open.');
  });
});
