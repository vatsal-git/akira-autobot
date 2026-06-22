import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import SettingsPanel from './SettingsPanel';
import SetupPanel from './SetupPanel';
import '../styles/widget.css';
import '../styles/alerts.css';
import '../styles/setup-panel.css';
import '../styles/inline-todo.css';

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const SIDEBAR_POSITIONS = ['right', 'left'];

function Widget({ settings, onSettingsChange, isSetupMode, onSetupComplete }) {
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState('general'); // 'general' or 'model'
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [currentCorner, setCurrentCorner] = useState(settings?.corner || 'bottom-right');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [copiedChat, setCopiedChat] = useState(false);
  const [todoList, setTodoList] = useState(null);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState(null);
  const queuedMessageRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const savedScrollTopRef = useRef(null);
  const currentContentRef = useRef('');
  const lastRelocateTime = useRef(0);
  const reasoningBreakRef = useRef(true); // Track if we need a new reasoning block
  const delegationStackRef = useRef([]); // Track delegation chain for return flow visualization
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

  // Start a new chat
  const handleNewChat = useCallback(async () => {
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
    setTodoList(null); // Clear todo list for new chat
    setQueuedMessage(null); // Clear queued message for new chat
    queuedMessageRef.current = null;
    delegationStackRef.current = []; // Clear delegation stack for new chat
    isAtBottomRef.current = true;
    savedScrollTopRef.current = null;
    // Auto-focus input for new chat
    setTimeout(() => {
      const textarea = document.querySelector('.chat-input__textarea');
      if (textarea) textarea.focus();
    }, 50);
  }, [chatId, messages]);

  const handleNewChatRef = useRef(handleNewChat);
  useEffect(() => {
    handleNewChatRef.current = handleNewChat;
  }, [handleNewChat]);

  // Keyboard shortcuts: Ctrl+A followed by arrow keys (move window), and Ctrl+A+N (new chat)
  useEffect(() => {
    let moveMode = false;
    let moveModeTimeout = null;
    let aPressed = false;

    const handleKeyDown = (e) => {
      const widgetMode = settings?.widgetMode || 'compact';
      const key = e.key.toLowerCase();

      // Track if 'a' key is pressed
      if (key === 'a') {
        aPressed = true;
      }

      // 1. Simultaneous Shortcut: Ctrl+A+N pressed together
      // Works anywhere (even inside input textareas/inputs)
      if (e.ctrlKey && key === 'n' && aPressed) {
        e.preventDefault();
        // Blur active element to clear focus/selection from input
        if (document.activeElement) {
          document.activeElement.blur();
        }
        handleNewChatRef.current();
        return;
      }

      // 2. Sequential Chord Trigger: Ctrl+A (when not in a text input to avoid conflict with select-all)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'a') {
        const tagName = e.target.tagName;
        const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA' || e.target.isContentEditable;

        // In inputs, let Ctrl+A work normally for select-all
        // User needs to click outside input first to use move/chord shortcuts
        if (isInput) return;

        e.preventDefault();
        moveMode = true;
        clearTimeout(moveModeTimeout);
        // Shortcut mode expires after 1.5 seconds
        moveModeTimeout = setTimeout(() => { moveMode = false; }, 1500);
        return;
      }

      // 3. Sequential Chord Action: Ctrl+A followed by N (opens a new chat)
      if (moveMode && key === 'n') {
        e.preventDefault();
        moveMode = false;
        clearTimeout(moveModeTimeout);
        handleNewChatRef.current();
        return;
      }

      // 4. Sequential Chord Action: Ctrl+A followed by Arrow Keys (moves the window)
      if (moveMode && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        // Window mode has no movement shortcuts
        if (widgetMode === 'window') return;

        e.preventDefault();
        moveMode = false;
        clearTimeout(moveModeTimeout);

        // Map arrow to direction
        const directionMap = {
          'arrowup': 'up',
          'arrowdown': 'down',
          'arrowleft': 'left',
          'arrowright': 'right'
        };
        const direction = directionMap[key];

        // Sidebar mode: only allow left/right
        if (widgetMode === 'sidebar' && (direction === 'up' || direction === 'down')) {
          return;
        }

        // Call IPC to move window
        if (window.akira?.moveWindowDirection) {
          window.akira.moveWindowDirection(direction);
        }
      }
    };

    const handleKeyUp = (e) => {
      if (e.key.toLowerCase() === 'a') {
        aPressed = false;
      }
    };

    const handleBlur = () => {
      aPressed = false;
      moveMode = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      clearTimeout(moveModeTimeout);
    };
  }, [settings?.widgetMode]);

  // Preload voices for text-to-speech
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Stop speech when TTS is turned off
  useEffect(() => {
    if (!ttsEnabled) {
      window.speechSynthesis.cancel();
      lastSpokenRef.current = '';
    }
  }, [ttsEnabled]);

  // Text-to-speech for Akira's responses when enabled
  const speakText = useCallback((text, forceSpeak = false) => {
    if (!ttsEnabled || !text) return;

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
  }, [ttsEnabled]);

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
        if (ttsEnabled) {
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
        // Track delegation for return flow visualization
        delegationStackRef.current.push({
          fromAgent: data.data.fromAgent,
          toAgent: data.data.toAgent
        });
        // One agent delegating to another - check visibility
        if (data.data.visibility !== 'internal') {
          setMessages(prev => [...prev, {
            type: 'delegation',
            fromAgent: data.data.fromAgent,
            toAgent: data.data.toAgent,
            task: data.data.task,
            visibility: data.data.visibility
          }]);
        }
        break;

      case 'agent_complete': {
        // Find and pop the delegation from the stack for return flow
        const completingAgent = data.data.agent;
        const stackIndex = delegationStackRef.current.findIndex(d => d.toAgent === completingAgent);
        let returnDelegation = null;
        if (stackIndex !== -1) {
          returnDelegation = delegationStackRef.current.splice(stackIndex, 1)[0];
        }

        // Mark the agent as complete and add return delegation if applicable
        setMessages(prev => {
          const updated = prev.map(m => {
            if (m.type === 'agent' && m.agent === completingAgent && m.status === 'running') {
              const visibility = data.data._visibility || 'full';
              return {
                ...m,
                status: 'complete',
                visibility,
                displayContent: visibility === 'summary' ? data.data.displayContent : null
              };
            }
            return m;
          });

          // Add return delegation chip if we found the original delegation
          if (returnDelegation) {
            updated.push({
              type: 'delegation',
              fromAgent: returnDelegation.toAgent,
              toAgent: returnDelegation.fromAgent,
              isReturn: true
            });
          }

          return updated;
        });
        break;
      }

      case 'agent_error':
        // Mark the agent as error state
        setMessages(prev => prev.map(m => {
          if (m.type === 'agent' && m.agent === data.data.agent && m.status === 'running') {
            return {
              ...m,
              status: 'error',
              error: data.data.error
            };
          }
          return m;
        }));
        break;

      case 'emergency_stop':
        // Add emergency stop alert to messages
        setMessages(prev => [...prev, {
          type: 'emergency_stop',
          severity: data.data.severity,
          reason: data.data.reason,
          context: data.data.context,
          triggeredBy: data.data.triggeredBy,
          suggestedActions: data.data.suggestedActions,
          requiresResponse: data.data.requiresResponse,
          timestamp: data.data.timestamp,
          resolved: false
        }]);
        break;

      case 'clarification_needed':
        // Add clarification request to messages
        setMessages(prev => [...prev, {
          type: 'clarification',
          clarificationId: data.data.clarificationId,
          fromAgent: data.data.fromAgent,
          question: data.data.question,
          whatIUnderstood: data.data.whatIUnderstood,
          options: data.data.options,
          canSkip: data.data.canSkip,
          defaultAction: data.data.defaultAction,
          timestamp: data.data.timestamp,
          resolved: false
        }]);
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

      case 'async_task_result':
        // Update the original async tool with actual result from await_tasks
        setMessages(prev => prev.map(m => {
          if (m.type === 'tool' && m.toolId === data.data.toolId) {
            const isSuccess = data.data.success !== false && data.data.result?.success !== false;
            return {
              ...m,
              status: isSuccess ? 'completed' : 'failed',
              result: data.data.result,
              agent: data.data.agent
            };
          }
          return m;
        }));
        break;

      case 'done':
        // Speak any remaining content
        if (ttsEnabled && currentContentRef.current) {
          speakText(currentContentRef.current, true);
        }
        // Play beep sound on generation complete
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          oscillator.frequency.value = 800;
          oscillator.type = 'sine';
          gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
          oscillator.start(audioCtx.currentTime);
          oscillator.stop(audioCtx.currentTime + 0.15);
        } catch (e) {
          // Silently ignore audio errors
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
        // Check for queued message and send it
        if (queuedMessageRef.current) {
          const msgToSend = queuedMessageRef.current;
          queuedMessageRef.current = null;
          setQueuedMessage(null);
          // Small delay to let state settle, then send
          setTimeout(() => {
            if (window.akira?.sendMessage) {
              // Add user message
              const userMessage = {
                role: 'user',
                content: msgToSend,
                timestamp: new Date().toISOString(),
              };
              setMessages(prev => [...prev, userMessage]);
              setSending(true);
              setStreaming(true);
              currentContentRef.current = '';
              reasoningBreakRef.current = true;
              window.akira.sendMessage(msgToSend, chatId);
            }
          }, 100);
        } else {
          // Auto-focus input for next message only if no queued message
          setTimeout(() => {
            const textarea = document.querySelector('.chat-input__textarea');
            if (textarea) textarea.focus();
          }, 50);
        }
        break;

      case 'cancelled':
        setSending(false);
        setStreaming(false);
        currentContentRef.current = '';
        // Clear queued message - user cancelled, so don't auto-send
        queuedMessageRef.current = null;
        setQueuedMessage(null);
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
        // Clear queued message on error
        queuedMessageRef.current = null;
        setQueuedMessage(null);
        // Preserve partial content if we were streaming
        const partialContent = currentContentRef.current;
        currentContentRef.current = '';
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          
          let rawError = data.data.error || 'Something went wrong';
          let cleanError = rawError;
          if (typeof rawError === 'string') {
            const jsonStartIdx = rawError.indexOf('{');
            if (jsonStartIdx !== -1) {
              const prefix = rawError.substring(0, jsonStartIdx);
              const jsonPart = rawError.substring(jsonStartIdx);
              try {
                const parsed = JSON.parse(jsonPart);
                if (parsed) {
                  if (parsed.error && typeof parsed.error.message === 'string') {
                    cleanError = `${prefix}${parsed.error.message}`;
                  } else if (typeof parsed.message === 'string') {
                    cleanError = `${prefix}${parsed.message}`;
                  }
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }

          // If we have a partial response, keep it and mark as incomplete
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant' && partialContent) {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              content: partialContent,
              error: true,
              incomplete: true,
              errorMessage: cleanError,
            };
          } else {
            // No partial content, just add error message
            newMessages.push({
              role: 'assistant',
              content: `Error: ${cleanError}`,
              error: true,
            });
          }
          return newMessages;
        });
        break;

      case 'todo_created':
        setTodoList(data.data);
        break;

      case 'todo_updated':
        setTodoList(prev => {
          if (!prev) return prev;
          const updatedItems = prev.items.map(item =>
            item.id === data.data.itemId
              ? { ...item, ...data.data.updates }
              : item
          );
          // Add new verification item if present
          if (data.data.newItem) {
            // Find index of parent item and insert after it
            const parentIdx = updatedItems.findIndex(i => i.id === data.data.itemId);
            if (parentIdx !== -1) {
              updatedItems.splice(parentIdx + 1, 0, data.data.newItem);
            } else {
              updatedItems.push(data.data.newItem);
            }
          }
          return { ...prev, items: updatedItems, updatedAt: Date.now() };
        });
        break;

      case 'todo_cleared':
        setTodoList(null);
        break;

      default:
        break;
    }
  }, [ttsEnabled, speakText]);

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

  // Scroll to bottom helper
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messagesContainerRef.current) {
      const scrollHeight = messagesContainerRef.current.scrollHeight;
      messagesContainerRef.current.scrollTo({
        top: scrollHeight,
        behavior
      });
      isAtBottomRef.current = true;
      setShowScrollBottomBtn(false);
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
      isAtBottomRef.current = true;
      setShowScrollBottomBtn(false);
    }
  }, []);

  // Handle user scrolling
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    
    // We are at the bottom if we are within 50px of the bottom
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceToBottom < 50;
    
    isAtBottomRef.current = atBottom;
    setShowScrollBottomBtn(!atBottom);
    savedScrollTopRef.current = scrollTop;
  }, []);

  // Scroll to bottom when messages change, but ONLY if user was already at the bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [messages, scrollToBottom]);

  // Restore scroll position immediately when transitioning from collapsed to expanded
  useLayoutEffect(() => {
    if (!isCollapsed && messagesContainerRef.current) {
      if (isAtBottomRef.current) {
        const scrollHeight = messagesContainerRef.current.scrollHeight;
        messagesContainerRef.current.scrollTop = scrollHeight;
      } else if (savedScrollTopRef.current !== null) {
        messagesContainerRef.current.scrollTop = savedScrollTopRef.current;
      }
    }
  }, [isCollapsed]);

  // Maintain scroll position when the message container is resized (e.g. during animations or window resizing)
  useEffect(() => {
    if (isCollapsed || !messagesContainerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        scrollToBottom('auto');
      } else if (savedScrollTopRef.current !== null && messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = savedScrollTopRef.current;
      }
    });

    observer.observe(messagesContainerRef.current);
    return () => observer.disconnect();
  }, [isCollapsed, scrollToBottom]);

  // Queue a message to be sent when streaming completes
  const handleQueueMessage = useCallback((text) => {
    setQueuedMessage(text);
    queuedMessageRef.current = text;
  }, []);

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
    setTimeout(() => scrollToBottom('smooth'), 50);

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
    isAtBottomRef.current = true;
    savedScrollTopRef.current = null;
    delegationStackRef.current = [];
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

  // Handle emergency stop response from user
  const handleEmergencyResponse = useCallback((alert, response) => {
    // Mark the alert as resolved
    setMessages(prev => prev.map(m =>
      m.type === 'emergency_stop' && m.timestamp === alert.timestamp
        ? { ...m, resolved: true, userResponse: response }
        : m
    ));

    // Send response to backend
    if (window.akira?.submitEmergencyResponse) {
      window.akira.submitEmergencyResponse(response);
    }
  }, []);

  // Handle clarification response from user
  const handleClarificationResponse = useCallback((request, response) => {
    // Mark the request as resolved
    setMessages(prev => prev.map(m =>
      m.type === 'clarification' && m.clarificationId === request.clarificationId
        ? { ...m, resolved: true, userResponse: response }
        : m
    ));

    // Send response to backend
    if (window.akira?.submitClarificationResponse) {
      window.akira.submitClarificationResponse(request.clarificationId, response);
    }
  }, []);

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
              task: msg.task,
              isReturn: msg.isReturn
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
        isAtBottomRef.current = true;
        savedScrollTopRef.current = null;
        setTimeout(() => scrollToBottom('auto'), 50);
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
      const text = JSON.stringify(chatData, null, 2);
      if (window.akira?.writeClipboard) {
        await window.akira.writeClipboard(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
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
          {(showSettings || showHistory) && !isSetupMode ? (
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
            style={!showSettings && !showHistory && !isSetupMode ? tubeInlineStyle : undefined}
          >{isSetupMode ? 'Setup' : showSettings ? (settingsView === 'model' ? 'Model Settings' : 'Settings') : showHistory ? 'History' : 'A'}</span>
        </div>
        <div className="widget__header-right">
          {/* Hide all action icons during setup mode */}
          {!isSetupMode && !showSettings && !showHistory && (
            <>
              {/* New Chat button */}
              <button
                className="widget__btn widget__btn--new-chat"
                onClick={handleNewChat}
                title="New chat"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
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
          {/* Maximize/Restore button only in window mode, hide during setup */}
          {!isSetupMode && settings?.widgetMode === 'window' && (
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
          {/* Collapse/Minimize button - hide during setup */}
          {!isSetupMode && (
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
          )}
        </div>
      </div>

      {/* Content: Setup, Settings, History, or Chat */}
      {isSetupMode ? (
        <SetupPanel onComplete={onSetupComplete} />
      ) : showSettings ? (
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
          {/* Messages Wrapper */}
          <div className="widget__messages-wrapper">
            <div
              ref={messagesContainerRef}
              className="widget__messages"
              onScroll={handleScroll}
            >
              {messages.length === 0 ? (
                <div className="widget__empty">
                  <p className="widget__empty-title">Hi, I'm Akira</p>
                  <p className="widget__empty-subtitle">Ask, Automate, Delegate</p>
                </div>
              ) : (
                <>
                  <MessageList
                    messages={messages}
                    isStreaming={streaming}
                    onRegenerate={handleRegenerate}
                    onContinue={handleContinue}
                    onEmergencyResponse={handleEmergencyResponse}
                    onClarificationResponse={handleClarificationResponse}
                    todoList={todoList}
                  />
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
            {showScrollBottomBtn && (
              <button
                className="widget__scroll-bottom-btn"
                onClick={() => scrollToBottom('smooth')}
                title="Scroll to bottom"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            )}
          </div>

          {/* Input */}
          <div className="widget__input-area">
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              disabled={sending && !streaming}
              isStreaming={streaming}
              ttsEnabled={ttsEnabled}
              onTtsToggle={setTtsEnabled}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              chatId={chatId}
              settings={settings}
              queuedMessage={queuedMessage}
              onQueueMessage={handleQueueMessage}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Widget;
