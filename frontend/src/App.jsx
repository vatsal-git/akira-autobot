import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import { applyStoredTheme, applyTheme, THEME_PRESETS } from './config/theme';
import { getTheme } from './api/theme';
import './App.css';

function App() {
  useEffect(() => {
    applyStoredTheme();
    getTheme()
      .then(({ theme }) => {
        const t = (theme && typeof theme === 'string') ? theme.trim() : '';
        if (t && THEME_PRESETS[t]) applyTheme(t, true);
      })
      .catch(() => {});
  }, []);

  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/:chatId" element={<ChatPage />} />
    </Routes>
  );
}

export default App;
