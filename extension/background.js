const DEFAULT_APP_URL = 'http://localhost:5173';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ akiraAppUrl: null }, (data) => {
    if (data.akiraAppUrl == null) {
      chrome.storage.sync.set({ akiraAppUrl: DEFAULT_APP_URL });
    }
  });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
