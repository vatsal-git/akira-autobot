import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import { applyStoredTheme } from './config/theme';
import './App.css';

function App() {
  useEffect(() => {
    applyStoredTheme();
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
