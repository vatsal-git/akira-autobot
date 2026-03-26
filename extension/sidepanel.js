const DEFAULT_APP_URL = 'http://localhost:5173';

function normalizeUrl(raw) {
  const s = (raw || '').trim();
  return s || DEFAULT_APP_URL;
}

async function applyUrl() {
  const { akiraAppUrl } = await chrome.storage.sync.get({ akiraAppUrl: DEFAULT_APP_URL });
  const frame = document.getElementById('frame');
  frame.src = normalizeUrl(akiraAppUrl);
}

applyUrl();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.akiraAppUrl) applyUrl();
});
