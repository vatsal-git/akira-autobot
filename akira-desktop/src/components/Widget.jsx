import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import SettingsPanel from './SettingsPanel';
import '../styles/widget.css';

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

function Widget({ settings, onSettingsChange }) {
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [currentCorner, setCurrentCorner] = useState(settings?.corner || 'bottom-right');
  const [liveMode, setLiveMode] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const messagesEndRef = useRef(null);
  const currentContentRef = useRef('');
  const lastRelocateTime = useRef(0);
  const lastSpokenRef = useRef('');
  const speechSynthRef = useRef(null);

  // Drag state for collapsed ball
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);

  // Tubelight effect state (ignore system reduced-motion for this effect)
  const [bootComplete, setBootComplete] = useState(false);
  const [reducedMotion] = useState(false); // Force animations on
  const wasTubeReplyActiveRef = useRef(false);
  const [replyDurationSec, setReplyDurationSec] = useState(2.2);

  const bootStyle = useMemo(
    () => ({
      '--tube-boot-delay': `${Math.random() * 0.35}s`,
      '--tube-boot-duration': `${1.45 + Math.random() * 1.55}s`,
    }),
    []
  );

  // streaming = tubeReplyActive
  useLayoutEffect(() => {
    if (streaming && !wasTubeReplyActiveRef.current) {
      setReplyDurationSec(1.15 + Math.random() * 1.65);
    }
    wasTubeReplyActiveRef.current = streaming;
  }, [streaming]);

  const tubeInlineStyle = useMemo(() => {
    const glowOn = {
      color: '#fff',
      textShadow: '0 0 10px rgba(255,255,255,0.9), 0 0 20px rgba(255,255,255,0.6), 0 0 30px rgba(255,255,255,0.4)',
    };

    if (reducedMotion) {
      return glowOn;
    }

    if (streaming) {
      // Reply: loop flicker while streaming
      return {
        willChange: 'opacity, color, text-shadow',
        animation: `tubelight-flicker ${replyDurationSec}s steps(1, end) infinite`,
      };
    }

    if (!bootComplete) {
      // Boot: one-shot flicker
      const duration = bootStyle['--tube-boot-duration'] || '2.5s';
      return {
        willChange: 'opacity, color, text-shadow',
        animation: `tubelight-flicker ${duration} steps(1, end) forwards`,
      };
    }

    // Steady on state
    return glowOn;
  }, [streaming, replyDurationSec, bootComplete, reducedMotion, bootStyle]);

  // Mark boot complete after animation finishes (or when streaming starts)
  useEffect(() => {
    if (streaming) {
      setBootComplete(true);
      return;
    }

    if (!bootComplete && !reducedMotion) {
      // Parse the boot duration and set timeout to mark complete
      const durationStr = bootStyle['--tube-boot-duration'] || '2.5s';
      const durationMs = parseFloat(durationStr) * 1000;
      const timer = setTimeout(() => setBootComplete(true), durationMs);
      return () => clearTimeout(timer);
    }
  }, [streaming, bootComplete, reducedMotion, bootStyle]);

  
    
  // Preload voices for text-to-speech
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Stop speech when live mode is turned off
  useEffect(() => {
    if (!liveMode) {
      window.speechSynthesis.cancel();
      lastSpokenRef.current = '';
    }
  }, [liveMode]);

  // Text-to-speech for Akira's responses in live mode
  const speakText = useCallback((text, forceSpeak = false) => {
    if (!liveMode || !text) return;

    // Only speak new content
    const newContent = text.slice(lastSpokenRef.current.length);
    if (!newContent.trim()) return;

    // For streaming: speak when we hit sentence boundaries or have enough text
    const sentenceEnd = /[.!?]\s*$/;
    const hasCompleteSentence = sentenceEnd.test(newContent);

    // Speak if we have a complete sentence, or force speak (on done), or accumulated 100+ chars
    if (!hasCompleteSentence && !forceSpeak && newContent.length < 100) return;

    const utterance = new SpeechSynthesisUtterance(newContent);
    utterance.rate = 2.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a female voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v =>
      v.name.includes('Zira') ||      // Windows female
      v.name.includes('Samantha') ||  // macOS female
      v.name.includes('Google UK English Female') ||
      v.name.includes('Google US English') ||
      (v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
    ) || voices.find(v => v.lang.startsWith('en'));
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
    lastSpokenRef.current = text;
  }, [liveMode]);

  // Handle stream events from chat
  const handleStreamEvent = useCallback((data) => {
    switch (data.event) {
      case 'meta':
        setChatId(data.data.chat_id);
        break;

      case 'delta':
        currentContentRef.current += data.data.delta || '';
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              content: currentContentRef.current,
            };
          }
          return newMessages;
        });
        // Speak incrementally as text streams in
        if (liveMode) {
          speakText(currentContentRef.current);
        }
        break;

      case 'tool_use':
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              toolCalls: data.data.tools || [],
              isTooling: true,
            };
          }
          return newMessages;
        });
        break;

      case 'tool_result':
        // Tool result received - update message to show tool completed
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            const toolResults = newMessages[lastIdx].toolResults || [];
            toolResults.push({
              tool: data.data.tool,
              result: data.data.result,
            });
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              toolResults,
            };
          }
          return newMessages;
        });
        break;

      case 'done':
        // Speak any remaining content in live mode
        if (liveMode && currentContentRef.current) {
          speakText(currentContentRef.current, true);
        }
        // Mark tooling as complete
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              isTooling: false,
            };
          }
          return newMessages;
        });
        setSending(false);
        setStreaming(false);
        lastSpokenRef.current = '';
        currentContentRef.current = '';
        break;

      case 'error':
        setSending(false);
        setStreaming(false);
        currentContentRef.current = '';
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `Error: ${data.data.error || 'Something went wrong'}`,
            error: true,
          },
        ]);
        break;

      default:
        break;
    }
  }, [liveMode, speakText]);

  // Set up event listeners
  useEffect(() => {
    let cleanup = null;
    if (window.akira?.onChatStream) {
      cleanup = window.akira.onChatStream((data) => {
        handleStreamEvent(data);
      });
    }

    const handleOpenSettings = () => setShowSettings(true);
    window.addEventListener('akira-open-settings', handleOpenSettings);

    let trayCleanup = null;
    if (window.akira?.onTrayExpand) {
      trayCleanup = window.akira.onTrayExpand(() => {
        setCurrentCorner('bottom-right');
        setIsCollapsed(false);
      });
    }

    let collapsedCleanup = null;
    if (window.akira?.onCollapsedChanged) {
      collapsedCleanup = window.akira.onCollapsedChanged((collapsed) => {
        setIsCollapsed(collapsed);
      });
    }

    return () => {
      if (cleanup) cleanup();
      if (trayCleanup) trayCleanup();
      if (collapsedCleanup) collapsedCleanup();
      window.removeEventListener('akira-open-settings', handleOpenSettings);
    };
  }, [handleStreamEvent]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async (text, options = {}) => {
    if (!text.trim() || sending) return;

    // Add user message
    const userMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    // Add placeholder for assistant
    const assistantPlaceholder = {
      role: 'assistant',
      content: '',
      timestamp: null,
    };

    setMessages(prev => [...prev, userMessage, assistantPlaceholder]);
    setSending(true);
    setStreaming(true);
    currentContentRef.current = '';

    try {
      if (window.akira?.sendMessage) {
        window.akira.sendMessage(text, chatId, settings?.defaultModel);
      }
    } catch (error) {
      console.error('Send message error:', error);
      setSending(false);
      setStreaming(false);
      setMessages(prev => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0) {
          newMessages[lastIdx] = {
            role: 'assistant',
            content: `Error: ${error}`,
            error: true,
          };
        }
        return newMessages;
      });
    }
  };

  const handleClearChat = async () => {
    if (chatId && window.akira?.clearChat) {
      await window.akira.clearChat(chatId);
    }
    setMessages([]);
    setChatId(null);
  };

  // Start a new chat
  const handleNewChat = async () => {
    // Save current chat if it has messages
    if (chatId && messages.length > 0 && window.akira?.saveChat) {
      const userMessages = messages.filter(m => m.role !== 'system');
      if (userMessages.length > 0) {
        await window.akira.saveChat(chatId, messages);
      }
    }
    setMessages([]);
    setChatId(null);
    setShowHistory(false);
  };

  // Load chat history list
  const loadChatHistory = async () => {
    if (window.akira?.getChatHistory) {
      const history = await window.akira.getChatHistory();
      setChatHistory(history);
    }
  };

  // Load a specific chat from history
  const handleLoadChat = async (historyChatId) => {
    if (window.akira?.loadChat) {
      const chat = await window.akira.loadChat(historyChatId);
      if (chat) {
        // Filter out system and tool messages for display
        const displayMessages = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
        setMessages(displayMessages);
        setChatId(historyChatId);
        setShowHistory(false);
      }
    }
  };

  // Delete a chat from history
  const handleDeleteChat = async (historyChatId) => {
    if (window.akira?.deleteChat) {
      await window.akira.deleteChat(historyChatId);
      await loadChatHistory();
    }
  };

  // Toggle history view
  const handleToggleHistory = async () => {
    if (!showHistory) {
      await loadChatHistory();
    }
    setShowHistory(!showHistory);
  };

  // Format date for display
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const handleCornerSwitch = async () => {
    const currentIndex = CORNERS.indexOf(currentCorner);
    const nextCorner = CORNERS[(currentIndex + 1) % CORNERS.length];

    try {
      if (window.akira?.switchCorner) {
        await window.akira.switchCorner(nextCorner);
      }
      setCurrentCorner(nextCorner);
    } catch (error) {
      console.error('Corner switch error:', error);
    }
  };

  // Drag handlers for collapsed ball
  const handleCollapsedMouseDown = useCallback((e) => {
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartRef.current = { x: e.screenX, y: e.screenY };

    const handleMouseMove = (moveEvent) => {
      if (!isDraggingRef.current) return;

      const deltaX = moveEvent.screenX - dragStartRef.current.x;
      const deltaY = moveEvent.screenY - dragStartRef.current.y;

      // Only start actual drag if moved more than 5px (to distinguish from click)
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasDraggedRef.current = true;
        window.akira?.moveWindow?.(deltaX, deltaY);
        dragStartRef.current = { x: moveEvent.screenX, y: moveEvent.screenY };
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      // If didn't drag, treat as click to expand
      if (!hasDraggedRef.current) {
        window.akira?.setCollapsed?.(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Collapsed ball view
  if (isCollapsed) {
    return (
      <div
        className="widget widget--collapsed"
        onMouseDown={handleCollapsedMouseDown}
        title="Drag to move, click to expand"
      >
        <span className="widget__collapsed-text" style={tubeInlineStyle}>A</span>
      </div>
    );
  }

  const widgetMode = settings?.widgetMode || 'compact';
  const modeClass = widgetMode === 'window' ? 'widget--window' :
                    widgetMode === 'sidebar' ? 'widget--sidebar' : '';

  return (
    <div
      className={`widget ${modeClass} ${isHovered ? 'widget--hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="widget__header">
        <div className="widget__header-left">
          {(showSettings || showHistory) ? (
            <button
              className="widget__btn widget__btn--back"
              onClick={() => {
                setShowSettings(false);
                setShowHistory(false);
              }}
              title="Back"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          ) : null}
          <span
            className="widget__title"
            style={!showSettings && !showHistory ? tubeInlineStyle : undefined}
          >{showSettings ? 'Settings' : showHistory ? 'History' : 'Akira'}</span>
        </div>
        <div className="widget__header-right">
          {!showSettings && !showHistory && (
            <>
              {/* New Chat button */}
              <button
                className="widget__btn widget__btn--new-chat"
                onClick={handleNewChat}
                title="New chat"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              {/* History button */}
              <button
                className="widget__btn widget__btn--history"
                onClick={handleToggleHistory}
                title="Chat history"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </button>
              {/* Corner switch - hide in window mode */}
              {settings?.widgetMode !== 'window' && (
                <button
                  className="widget__btn widget__btn--corner"
                  onClick={handleCornerSwitch}
                  title="Move to corner"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l3 3 3-3M19 9l3 3-3 3" />
                  </svg>
                </button>
              )}
              <button
                className="widget__btn widget__btn--settings"
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
            </>
          )}
          {/* Maximize/Restore button only in window mode */}
          {settings?.widgetMode === 'window' && (
            <button
              className="widget__btn widget__btn--maximize"
              onClick={async () => {
                const max = await window.akira?.toggleMaximize?.();
                setIsMaximized(max);
              }}
              title={isMaximized ? "Restore" : "Maximize"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {isMaximized ? (
                  <>
                    <rect x="5" y="9" width="10" height="10" rx="1" />
                    <path d="M9 9V5a1 1 0 011-1h9a1 1 0 011 1v9a1 1 0 01-1 1h-4" />
                  </>
                ) : (
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                )}
              </svg>
            </button>
          )}
          <button
            className="widget__btn widget__btn--collapse"
            onClick={() => {
              if (settings?.widgetMode === 'window') {
                window.akira?.minimizeWindow?.();
              } else {
                window.akira?.setCollapsed?.(true);
              }
            }}
            title={settings?.widgetMode === 'window' ? "Minimize" : "Collapse"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content: Settings, History, or Chat */}
      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSettingsChange={onSettingsChange}
          inline={true}
        />
      ) : showHistory ? (
        <div className="widget__history">
          {chatHistory.length === 0 ? (
            <div className="widget__history-empty">
              <p>No chat history yet</p>
            </div>
          ) : (
            <div className="widget__history-list">
              {chatHistory.map((chat) => (
                <div
                  key={chat.id}
                  className={`widget__history-item ${chat.id === chatId ? 'widget__history-item--active' : ''}`}
                  onClick={() => handleLoadChat(chat.id)}
                >
                  <div className="widget__history-item-content">
                    <span className="widget__history-item-title">{chat.title}</span>
                    <span className="widget__history-item-date">{formatDate(chat.updatedAt)}</span>
                  </div>
                  <button
                    className="widget__history-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChat(chat.id);
                    }}
                    title="Delete chat"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="widget__messages">
            {messages.length === 0 ? (
              <div className="widget__empty">
                <p className="widget__empty-title" style={tubeInlineStyle}>Hi, I'm Akira</p>
                <p className="widget__empty-subtitle">How can I help you today?</p>
              </div>
            ) : (
              <>
                <MessageList
                  messages={messages}
                  isStreaming={streaming}
                />
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="widget__input-area">
            <ChatInput
              onSend={handleSend}
              disabled={sending}
              isStreaming={streaming}
              liveMode={liveMode}
              onLiveModeToggle={setLiveMode}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Widget;
