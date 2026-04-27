import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import SettingsPanel from './SettingsPanel';
import '../styles/widget.css';

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const SIDEBAR_POSITIONS = ['right', 'left'];

function Widget({ settings, onSettingsChange }) {
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState('general'); // 'general' or 'model'
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [currentCorner, setCurrentCorner] = useState(settings?.corner || 'bottom-right');
  const [liveMode, setLiveMode] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [copiedChat, setCopiedChat] = useState(false);
  const messagesEndRef = useRef(null);
  const currentContentRef = useRef('');
  const lastRelocateTime = useRef(0);
  const reasoningBreakRef = useRef(true); // Track if we need a new reasoning block
  const lastSpokenRef = useRef('');
  const speechSynthRef = useRef(null);


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

  // Detect if light theme is active
  const isLightTheme = useMemo(() => {
    const theme = settings?.theme || 'system';
    if (theme === 'light') return true;
    if (theme === 'dark') return false;
    // System preference
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  }, [settings?.theme]);

  const tubeInlineStyle = useMemo(() => {
    const glowOn = isLightTheme ? {
      color: '#1a1a1a',
      textShadow: '0 0 10px rgba(0,0,0,0.25), 0 0 20px rgba(0,0,0,0.15), 0 0 30px rgba(0,0,0,0.1)',
    } : {
      color: '#fff',
      textShadow: '0 0 10px rgba(255,255,255,0.9), 0 0 20px rgba(255,255,255,0.6), 0 0 30px rgba(255,255,255,0.4)',
    };

    const animationName = isLightTheme ? 'tubelight-flicker-light' : 'tubelight-flicker';

    if (reducedMotion) {
      return glowOn;
    }

    if (streaming) {
      // Reply: loop flicker while streaming
      return {
        willChange: 'opacity, color, text-shadow',
        animation: `${animationName} ${replyDurationSec}s steps(1, end) infinite`,
      };
    }

    if (!bootComplete) {
      // Boot: one-shot flicker
      const duration = bootStyle['--tube-boot-duration'] || '2.5s';
      return {
        willChange: 'opacity, color, text-shadow',
        animation: `${animationName} ${duration} steps(1, end) forwards`,
      };
    }

    // Steady on state
    return glowOn;
  }, [streaming, replyDurationSec, bootComplete, reducedMotion, bootStyle, isLightTheme]);

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

  // Apply theme to document
  useEffect(() => {
    const theme = settings?.theme || 'system';
    const root = document.documentElement;

    // Remove existing theme classes
    root.classList.remove('theme-light', 'theme-dark');

    if (theme === 'system') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    } else {
      root.classList.add(`theme-${theme}`);
    }
  }, [settings?.theme]);

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

      case 'thinking':
      case 'reasoning':
        // Handle reasoning as inline item (like tool calls)
        // Create a new reasoning block if there's been a break (tool call, content, etc.)
        setMessages(prev => {
          const newMessages = [...prev];

          // Count existing reasoning blocks for numbering
          const reasoningCount = newMessages.filter(m => m.type === 'reasoning').length;

          // Find currently active reasoning block (if any and no break occurred)
          const activeReasoningIdx = !reasoningBreakRef.current
            ? newMessages.findIndex(m => m.type === 'reasoning' && m.status === 'active')
            : -1;

          if (activeReasoningIdx >= 0) {
            // Append to existing active reasoning
            newMessages[activeReasoningIdx] = {
              ...newMessages[activeReasoningIdx],
              content: (newMessages[activeReasoningIdx].content || '') + (data.data.reasoning || ''),
            };
          } else {
            // Append new reasoning message at the end (chronological order)
            newMessages.push({
              type: 'reasoning',
              content: data.data.reasoning || '',
              status: 'active',
              index: reasoningCount + 1, // 1-based index for display
            });
          }
          reasoningBreakRef.current = false; // Reasoning is now active
          return newMessages;
        });
        break;

      case 'delta': {
        // Mark reasoning break - any content after this should be a new reasoning block
        reasoningBreakRef.current = true;
        const deltaText = data.data.delta || '';

        // Mark any active reasoning as complete since we're now getting content
        setMessages(prev => {
          const newMessages = prev.map(m =>
            m.type === 'reasoning' && m.status === 'active'
              ? { ...m, status: 'complete' }
              : m
          );
          const lastIdx = newMessages.length - 1;
          const lastMsg = newMessages[lastIdx];

          // If last message is assistant, append delta to it
          if (lastMsg?.role === 'assistant') {
            const newContent = (lastMsg.content || '') + deltaText;
            currentContentRef.current = newContent;
            newMessages[lastIdx] = {
              ...lastMsg,
              content: newContent,
            };
          } else {
            // Last message is NOT assistant (it's agent, tool, reasoning, or user)
            // Always create a NEW assistant message at the end to maintain chronological order
            currentContentRef.current = deltaText;
            newMessages.push({
              role: 'assistant',
              content: deltaText,
              timestamp: null,
            });
          }
          return newMessages;
        });

        // Speak incrementally as text streams in
        if (liveMode) {
          speakText(currentContentRef.current);
        }
        break;
      }

      case 'agent_start':
        // An agent started working on a task
        setMessages(prev => [...prev, {
          type: 'agent',
          agent: data.data.agent,
          displayName: data.data.displayName,
          task: data.data.task,
          status: 'running'
        }]);
        break;

      case 'agent_delegate':
        // One agent delegating to another
        setMessages(prev => [...prev, {
          type: 'delegation',
          fromAgent: data.data.fromAgent,
          toAgent: data.data.toAgent,
          task: data.data.task
        }]);
        break;

      case 'agent_complete':
        // Mark the agent as complete
        setMessages(prev => prev.map(m =>
          m.type === 'agent' && m.agent === data.data.agent && m.status === 'running'
            ? { ...m, status: 'complete' }
            : m
        ));
        break;

      case 'tool_use':
        // Mark reasoning break - reasoning after tool use is a new block
        reasoningBreakRef.current = true;
        // Mark any active reasoning as complete
        setMessages(prev => {
          const updated = prev.map(m =>
            m.type === 'reasoning' && m.status === 'active'
              ? { ...m, status: 'complete' }
              : m
          );
          return [...updated, {
            type: 'tool',
            toolId: data.data.toolId,
            name: data.data.name,
            input: data.data.input,
            agent: data.data.agent, // Include which agent is using this tool
            status: 'running',
            result: null,
          }];
        });
        break;

      case 'tool_result':
        // Mark reasoning break - reasoning after tool result is a new block
        reasoningBreakRef.current = true;
        // Find and update the matching tool message by toolId
        setMessages(prev => prev.map(m =>
          m.type === 'tool' && m.toolId === data.data.toolId
            ? { ...m, status: 'completed', result: data.data.result, agent: data.data.agent }
            : m
        ));
        break;

      case 'done':
        // Speak any remaining content in live mode
        if (liveMode && currentContentRef.current) {
          speakText(currentContentRef.current, true);
        }
        setSending(false);
        setStreaming(false);
        lastSpokenRef.current = '';
        currentContentRef.current = '';
        // Mark any active reasoning as complete and tag last assistant message if cached
        const wasCached = data.data.cached === true;
        setMessages(prev => {
          const newMessages = prev.map(m =>
            m.type === 'reasoning' && m.status === 'active'
              ? { ...m, status: 'complete' }
              : m
          );
          // Find the last assistant message and mark if cached
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].role === 'assistant') {
              newMessages[i] = { ...newMessages[i], cached: wasCached };
              break;
            }
          }
          return newMessages;
        });
        // Auto-focus input for next message
        setTimeout(() => {
          const textarea = document.querySelector('.chat-input__textarea');
          if (textarea) textarea.focus();
        }, 50);
        break;

      case 'cancelled':
        setSending(false);
        setStreaming(false);
        currentContentRef.current = '';
        // Mark last assistant message as incomplete
        setMessages(prev => {
          const newMessages = [...prev];
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].role === 'assistant') {
              newMessages[i] = { ...newMessages[i], incomplete: true };
              break;
            }
          }
          return newMessages;
        });
        break;

      case 'error':
        setSending(false);
        setStreaming(false);
        // Preserve partial content if we were streaming
        const partialContent = currentContentRef.current;
        currentContentRef.current = '';
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          // If we have a partial response, keep it and mark as incomplete
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant' && partialContent) {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              content: partialContent,
              error: true,
              incomplete: true,
              errorMessage: data.data.error || 'Something went wrong',
            };
          } else {
            // No partial content, just add error message
            newMessages.push({
              role: 'assistant',
              content: `Error: ${data.data.error || 'Something went wrong'}`,
              error: true,
            });
          }
          return newMessages;
        });
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
        // Auto-focus input when expanding
        if (!collapsed) {
          setTimeout(() => {
            const textarea = document.querySelector('.chat-input__textarea');
            if (textarea) textarea.focus();
          }, 50);
        }
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

    // Add user message only - NO assistant placeholder
    // Messages will be added in chronological order as stream events arrive
    const userMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setSending(true);
    setStreaming(true);
    currentContentRef.current = '';
    reasoningBreakRef.current = true; // Reset for new message

    try {
      if (window.akira?.sendMessage) {
        window.akira.sendMessage(text, chatId);
      }
    } catch (error) {
      console.error('Send message error:', error);
      setSending(false);
      setStreaming(false);
      setMessages(prev => {
        const newMessages = [...prev];
        // Add error as assistant message
        newMessages.push({
          role: 'assistant',
          content: `Error: ${error}`,
          error: true,
        });
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

  // Regenerate a response without using cache
  const handleRegenerate = useCallback((messageIndex) => {
    if (sending) return;

    // Find the user message that triggered this response
    let userMessageIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }

    if (userMessageIndex === -1) return;

    const userMessage = messages[userMessageIndex];

    // Remove everything from the user message onward
    setMessages(prev => prev.slice(0, userMessageIndex));

    // Add user message back (NO assistant placeholder - messages will arrive in order)
    setMessages(prev => [...prev, userMessage]);
    setSending(true);
    setStreaming(true);
    currentContentRef.current = '';
    reasoningBreakRef.current = true;

    // Send with skipCache = true
    if (window.akira?.sendMessage) {
      window.akira.sendMessage(userMessage.content, chatId, true); // skipCache = true
    }
  }, [messages, sending, chatId]);

  // Stop ongoing generation
  const handleStop = useCallback(async () => {
    if (chatId && window.akira?.cancelGeneration) {
      await window.akira.cancelGeneration(chatId);
    }
  }, [chatId]);

  // Continue generation after stopping
  const handleContinue = useCallback(() => {
    if (sending) return;
    handleSend('Continue');
  }, [sending, handleSend]);

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
    // Auto-focus input for new chat
    setTimeout(() => {
      const textarea = document.querySelector('.chat-input__textarea');
      if (textarea) textarea.focus();
    }, 50);
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
        // Messages are now stored in chronological order with all types
        // Just load them directly since they're already in display format
        const displayMessages = [];

        for (const msg of chat.messages) {
          if (msg.role === 'system') {
            continue; // Skip system messages
          } else if (msg.type === 'agent') {
            // Agent activity
            displayMessages.push({
              type: 'agent',
              agent: msg.agent,
              displayName: msg.displayName,
              task: msg.task,
              status: msg.status || 'complete'
            });
          } else if (msg.type === 'delegation') {
            // Agent delegation
            displayMessages.push({
              type: 'delegation',
              fromAgent: msg.fromAgent,
              toAgent: msg.toAgent,
              task: msg.task
            });
          } else if (msg.type === 'reasoning') {
            // Reasoning block
            displayMessages.push({
              type: 'reasoning',
              content: msg.content,
              status: msg.status || 'complete',
              index: msg.index
            });
          } else if (msg.type === 'tool') {
            // Tool call (new format - already has all fields)
            displayMessages.push({
              type: 'tool',
              toolId: msg.toolId,
              name: msg.name,
              input: msg.input,
              agent: msg.agent,
              status: msg.status || 'completed',
              result: msg.result
            });
          } else if (msg.role === 'user') {
            displayMessages.push({
              role: 'user',
              content: msg.content,
              timestamp: msg.timestamp
            });
          } else if (msg.role === 'assistant') {
            displayMessages.push({
              role: 'assistant',
              content: msg.content,
              timestamp: msg.timestamp,
              cached: msg.cached
            });
          } else if (msg.role === 'tool') {
            // Legacy format - tool result from old API format
            // Try to find matching tool call in previous messages
            let toolInfo = { name: 'unknown', input: {} };
            displayMessages.push({
              type: 'tool',
              toolId: msg.tool_call_id,
              name: toolInfo.name,
              input: toolInfo.input,
              status: 'completed',
              result: msg.content
            });
          }
        }

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

  // Strip base64 image data from values, replacing with placeholder
  const stripBase64 = (value) => {
    if (typeof value === 'string') {
      // Check for data URI base64 images
      if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(value)) {
        return '[Screenshot Image]';
      }
      // Check for raw base64 that looks like an image (long string of base64 chars)
      if (value.length > 500 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 100))) {
        return '[Captured Image]';
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(stripBase64);
    }
    if (typeof value === 'object' && value !== null) {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = stripBase64(val);
      }
      return result;
    }
    return value;
  };

  // Copy chat to clipboard for debugging
  const handleCopyChat = async () => {
    const sanitizedMessages = stripBase64(messages);
    const chatData = {
      chatId,
      messages: sanitizedMessages,
      timestamp: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(chatData, null, 2));
      setCopiedChat(true);
      setTimeout(() => setCopiedChat(false), 1500);
    } catch (err) {
      console.error('Failed to copy chat:', err);
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
    const widgetMode = settings?.widgetMode || 'compact';
    let nextPosition;

    if (widgetMode === 'sidebar') {
      // Sidebar mode: only left/right positions
      const currentIndex = SIDEBAR_POSITIONS.indexOf(currentCorner);
      nextPosition = SIDEBAR_POSITIONS[(currentIndex + 1) % SIDEBAR_POSITIONS.length];
    } else {
      // Compact mode: all 4 corners
      const currentIndex = CORNERS.indexOf(currentCorner);
      nextPosition = CORNERS[(currentIndex + 1) % CORNERS.length];
    }

    try {
      if (window.akira?.switchCorner) {
        await window.akira.switchCorner(nextPosition);
      }
      setCurrentCorner(nextPosition);
    } catch (error) {
      console.error('Corner switch error:', error);
    }
  };

  // Handle click to expand collapsed tab
  const handleCollapsedClick = useCallback(() => {
    window.akira?.setCollapsed?.(false);
  }, []);

  // Collapsed tab view (bottom-right with arrow pointing left)
  if (isCollapsed) {
    return (
      <div
        className="widget widget--collapsed"
        onClick={handleCollapsedClick}
        title="Click to expand"
      >
        <svg
          className="widget__collapsed-arrow"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </div>
    );
  }

  const widgetMode = settings?.widgetMode || 'compact';
  const modeClass = widgetMode === 'window' ? 'widget--window' :
                    widgetMode === 'sidebar' ? 'widget--sidebar' : '';

  return (
    <div
      className={`widget ${modeClass} ${isHovered || isInputFocused ? 'widget--hovered' : ''}`}
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
                if (showSettings && settingsView === 'model') {
                  setSettingsView('general');
                } else {
                  setShowSettings(false);
                  setShowHistory(false);
                  setSettingsView('general');
                }
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
          >{showSettings ? (settingsView === 'model' ? 'Model Settings' : 'Settings') : showHistory ? 'History' : 'Akira'}</span>
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
              {/* Copy Chat button */}
              <button
                className={`widget__btn widget__btn--copy ${copiedChat ? 'widget__btn--copied' : ''}`}
                onClick={handleCopyChat}
                title="Copy chat (debug)"
              >
                {copiedChat ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
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
          onClose={() => { setShowSettings(false); setSettingsView('general'); }}
          onSettingsChange={onSettingsChange}
          inline={true}
          currentView={settingsView}
          onViewChange={setSettingsView}
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
                  onRegenerate={handleRegenerate}
                  onContinue={handleContinue}
                />
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="widget__input-area">
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              disabled={sending}
              isStreaming={streaming}
              liveMode={liveMode}
              onLiveModeToggle={setLiveMode}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Widget;
