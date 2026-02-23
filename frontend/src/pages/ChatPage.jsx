import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageList, getMessageText } from '../components/MessageList';
import ChatInput from '../components/ChatInput';
import { Sidebar } from '../components/Sidebar';
import { SettingsModal } from '../components/SettingsModal';
import { sendMessage } from '../api/chat';
import { listChats, getChat } from '../api/history';
import { getSettings } from '../api/settings';
import { applyTheme, getStoredTheme } from '../config/theme';
import { playCompletionSound } from '../utils/sound';

const SETTINGS_STORAGE_KEY = 'akira_settings';

function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      thinking_enabled: data.thinking_enabled,
      thinking_budget: data.thinking_budget,
      enabled_tools: data.enabled_tools,
    };
  } catch {
    return null;
  }
}

function saveStoredSettings(settings) {
  try {
    const toStore = {
      temperature: settings.temperature,
      max_tokens: settings.max_tokens,
      thinking_enabled: settings.thinking_enabled,
      thinking_budget: settings.thinking_budget,
      enabled_tools: settings.enabled_tools,
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(toStore));
  } catch (_) {}
}

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  max_tokens: 131072,
  thinking_enabled: true,
  thinking_budget: 16000,
  enabled_tools: null,
  tools: [],
  current_model: 'anthropic',
  available_providers: ['anthropic'],
};

export default function ChatPage() {
  const { chatId: urlChatId } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [chats, setChats] = useState([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const chatInputRef = useRef(null);
  const wasStreamingRef = useRef(false);
  const abortControllerRef = useRef(null);
  const autoScrollRef = useRef(true);
  const scrollRafRef = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const updateCanScrollDown = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setCanScrollDown(distanceFromBottom > 8);
  };

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= 80;
    autoScrollRef.current = atBottom;
    setCanScrollDown(distanceFromBottom > 8);
  };

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    updateCanScrollDown();
    el.addEventListener('scroll', handleMessagesScroll);
    const ro = new ResizeObserver(updateCanScrollDown);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', handleMessagesScroll);
      ro.disconnect();
    };
  }, [messages]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom();
    });
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [messages]);

  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      chatInputRef.current?.focus();
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);

  // New chat route (/chat): focus message input
  useEffect(() => {
    if (urlChatId == null) {
      const t = setTimeout(() => chatInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [urlChatId]);

  // When opening a chat or on refresh: focus message input after view updates
  useEffect(() => {
    const t = setTimeout(() => chatInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [urlChatId]);

  useEffect(() => {
    getSettings()
      .then((apiSettings) => {
        const stored = loadStoredSettings();
        setSettings((prev) => ({
          ...DEFAULT_SETTINGS,
          ...apiSettings,
          ...stored,
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    listChats()
      .then(setChats)
      .catch(() => setChats([]))
      .finally(() => setSidebarLoading(false));
  }, [messages.length]);

  // Sync URL -> chat: load chat when chatId is in URL; clear when not (e.g. /chat)
  useEffect(() => {
    if (urlChatId) {
      const alreadyShowing = chatId === urlChatId && messages.length > 0;
      if (!alreadyShowing) loadChat(urlChatId);
    } else {
      setChatId(null);
      setMessages([]);
      setError(null);
    }
  }, [urlChatId]);

  const loadChat = (id) => {
    setError(null);
    setChatId(id);
    getChat(id)
      .then((data) => setMessages(data.messages || []))
      .catch((err) => {
        setError(err.message || 'Couldn’t load chat.');
        setMessages([]);
      });
  };

  const handleNewChat = () => {
    navigate('/chat');
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };

  const handleSelectChat = (id) => {
    if (id === chatId) return;
    navigate(`/chat/${id}`);
  };

  const handleSettingsChange = (newSettings) => {
    setSettings((prev) => {
      const next = { ...prev, ...newSettings };
      saveStoredSettings(next);
      return next;
    });
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleRegenerate = (assistantIndex) => {
    if (assistantIndex <= 0 || sending) return;
    const userMsg = messages[assistantIndex - 1];
    const userText = userMsg && getMessageText(userMsg.content);
    if (!userText) return;

    setError(null);
    setSending(true);
    setStreaming(true);
    autoScrollRef.current = true;
    abortControllerRef.current = new AbortController();
    setMessages((prev) => [...prev.slice(0, assistantIndex), { role: 'assistant', content: '' }]);

    sendMessage(
      {
        message: userText,
        chat_id: chatId || undefined,
        settings: {
          temperature: settings.temperature,
          max_tokens: settings.max_tokens,
          thinking_enabled: settings.thinking_enabled,
          thinking_budget: settings.thinking_budget,
          enabled_tools: settings.enabled_tools ?? undefined,
          mood: getStoredTheme()?.theme ?? undefined,
        },
      },
      {
        signal: abortControllerRef.current.signal,
        onMeta: (data) => {
          setChatId(data.chat_id);
          if (data.chat_id) navigate(`/chat/${data.chat_id}`);
        },
        onDelta: (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                content: (last.content || '') + delta,
              };
            }
            return next;
          });
        },
        onSettings: (data) => {
          setSettings((prev) => ({ ...prev, ...data }));
        },
        onTheme: (data) => {
          if (data.theme) applyTheme(data.theme, true);
        },
        onDone: () => {
          setSending(false);
          setStreaming(false);
          playCompletionSound();
        },
        onError: (data) => {
          setError(data.error || 'Something went wrong. Try again.');
          setSending(false);
          setStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && !last.content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        },
      }
    );
  };

  const handleSend = (text, options = {}) => {
    setError(null);
    setSending(true);
    setStreaming(true);
    autoScrollRef.current = true;

    const userMessage = {
      role: 'user',
      content: text,
      ...(options.images?.length && { images: options.images }),
      ...(options.files?.length && { files: options.files }),
    };
    setMessages((prev) => [...prev, userMessage]);

    const assistantPlaceholder = { role: 'assistant', content: '' };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    abortControllerRef.current = new AbortController();
    sendMessage(
      {
        message: text || '',
        chat_id: chatId || undefined,
        images: options.images,
        files: options.files,
        settings: {
          temperature: settings.temperature,
          max_tokens: settings.max_tokens,
          thinking_enabled: settings.thinking_enabled,
          thinking_budget: settings.thinking_budget,
          enabled_tools: settings.enabled_tools ?? undefined,
          mood: getStoredTheme()?.theme ?? undefined,
        },
      },
      {
        signal: abortControllerRef.current.signal,
        onMeta: (data) => {
          setChatId(data.chat_id);
          if (data.chat_id) navigate(`/chat/${data.chat_id}`);
        },
        onDelta: (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                content: (last.content || '') + delta,
              };
            }
            return next;
          });
        },
        onSettings: (data) => {
          setSettings((prev) => ({ ...prev, ...data }));
        },
        onTheme: (data) => {
          if (data.theme) applyTheme(data.theme, true);
        },
        onDone: () => {
          setSending(false);
          setStreaming(false);
          playCompletionSound();
        },
        onError: (data) => {
          setError(data.error || 'Something went wrong. Try again.');
          setSending(false);
          setStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && !last.content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        },
      }
    );
  };

  return (
    <div className="chat-page">
      <Sidebar
        chats={chats}
        currentChatId={chatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onOpenSettings={() => setSettingsModalOpen(true)}
        loading={sidebarLoading}
        expanded={false}
      />
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
      <div className="chat-main-wrap">
        <main className="chat-main">
          {error && (
          <div className="chat-page__error" role="alert">
            {error}
          </div>
        )}
        {messages.length === 0 && !sending ? (
          <div className="chat-page__empty" aria-hidden />
        ) : (
          <>
            <div
              ref={messagesContainerRef}
              className="chat-page__messages"
            >
              <MessageList
                messages={messages}
                isStreaming={streaming}
                onCopyMessage={(i) => {
                  const msg = messages[i];
                  if (msg && navigator.clipboard) {
                    const text = getMessageText(msg.content);
                    if (text) navigator.clipboard.writeText(text);
                  }
                }}
                onRegenerateMessage={handleRegenerate}
                onEditMessage={(i) => {
                  const msg = messages[i];
                  if (!msg) return;
                  const text = getMessageText(msg.content);
                  setMessages((prev) => prev.slice(0, i + 1));
                  chatInputRef.current?.setDraft?.(text);
                  setTimeout(() => chatInputRef.current?.focus(), 0);
                }}
              />
              <div ref={messagesEndRef} aria-hidden />
            </div>
            <button
              type="button"
              className={`chat-page__messages-scroll-indicator${canScrollDown ? ' chat-page__messages-scroll-indicator--visible' : ''}`}
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
              aria-hidden={!canScrollDown}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
            </button>
          </>
        )}
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          onStop={handleStop}
          disabled={sending}
          isStreaming={streaming}
        />
        </main>
      </div>
    </div>
  );
}
