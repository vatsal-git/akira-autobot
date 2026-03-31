import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageList, getMessageText, getChatTitleFromMessages } from '../components/MessageList';
import ChatInput from '../components/ChatInput';
import { Sidebar } from '../components/Sidebar';
import { SettingsModal } from '../components/SettingsModal';
import { sendMessage } from '../api/chat';
import { listChats, getChat } from '../api/history';
import { getSettings } from '../api/settings';
import { playCompletionSound } from '../utils/sound';
import {
  useBrowserVoice,
  startListening,
  stopListening,
  isListening,
  speak,
  speakQueued,
  stopSpeaking,
  clearSpeakQueue,
  whenSpeakQueueIdle,
  isSynthesizerSpeaking,
} from '../utils/voice';
import { createStreamDictation } from '../utils/streamDictation';
import { BRAND_NAME, BRAND_MEANING } from '../config/brand';

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
      stream: data.stream,
      autonomous_mode: data.autonomous_mode,
      current_model: data.current_model,
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
      stream: settings.stream,
      autonomous_mode: settings.autonomous_mode,
      current_model: settings.current_model,
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
  available_models: [],
  stream: true, // When true, response streams in; when false, buffered and shown at once
  autonomous_mode: false,
};

/** Keep partial streamed reply visible and append the API error (used for display + recovery snapshot). */
function assistantContentAfterStreamError(partialText, errorText) {
  const err = (errorText || '').trim() || 'Something went wrong. Try again.';
  const partial = (partialText || '').trim();
  if (!partial) return err;
  return `${partial}\n\n---\n\n**Something went wrong:** ${err}`;
}

export default function ChatPage() {
  const { chatId: urlChatId } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [chats, setChats] = useState([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
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
  const createdChatIdRef = useRef(null); // Chat we just created via stream meta; skip loadChat to avoid overwriting messages
  const messagesRef = useRef([]);
  const autonomousModeRef = useRef(false);
  const pendingUserMessageRef = useRef(null);
  const performSendRef = useRef(null);
  const abortedRef = useRef(false);
  /** Snapshot of messages (including failed assistant bubble) while a follow-up error-recovery request runs */
  const preRecoveryMessagesRef = useRef(null);
  const recoveryInProgressRef = useRef(false);
  const chatIdRef = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  /** True while a follow-up error-recovery request runs */
  const [isDiagnosingError, setIsDiagnosingError] = useState(false);
  // Voice conversation: speak to Akira, hear reply
  const voiceSupport = useBrowserVoice();
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const currentAssistantContentRef = useRef('');
  const voiceListenControlRef = useRef(null);
  const lastSendWasVoiceRef = useRef(false);
  const streamDictationRef = useRef(null);
  /** Monotonic id so callbacks from a replaced/aborted stream are ignored */
  const streamGenerationRef = useRef(0);
  useEffect(() => {
    messagesRef.current = messages;
    autonomousModeRef.current = settings.autonomous_mode;
  }, [messages, settings.autonomous_mode]);

  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  const scrollToBottom = (smooth = true) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const targetScrollTop = el.scrollHeight - el.clientHeight;
    if (smooth) {
      el.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    } else {
      el.scrollTop = targetScrollTop;
    }
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

  // Scroll to bottom after DOM updates so long/streaming messages stay in view
  useLayoutEffect(() => {
    if (!autoScrollRef.current) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      // Use instant scroll during streaming so each delta keeps view at bottom; smooth for final jump
      scrollToBottom(/* smooth */ !streaming);
    });
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [messages, streaming]);

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
  // Skip loadChat when we just created this chat (got meta from our own stream) so we don't overwrite in-flight messages
  useEffect(() => {
    if (urlChatId) {
      if (createdChatIdRef.current === urlChatId) {
        setChatId(urlChatId);
        createdChatIdRef.current = null;
        return;
      }
      const alreadyShowing = chatId === urlChatId && messages.length > 0;
      if (!alreadyShowing) loadChat(urlChatId);
    } else {
      createdChatIdRef.current = null;
      setChatId(null);
      setMessages([]);
    }
  }, [urlChatId]);

  const loadChat = (id) => {
    setChatId(id);
    getChat(id)
      .then((data) => setMessages(data.messages || []))
      .catch((err) => {
        const errorText = err.message || 'Could not load chat.';
        setMessages([{ role: 'assistant', content: errorText, error: true }]);
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

  function resumeVoiceListeningIfNeeded() {
    if (!voiceModeRef.current) return;
    if (isSynthesizerSpeaking()) return;
    if (voiceListenControlRef.current && isListening()) return;
    if (voiceListenControlRef.current && !isListening()) {
      voiceListenControlRef.current = null;
    }
    voiceListenControlRef.current = startListening({
      onResult: (text) => {
        if (!text.trim()) return;
        voiceListenControlRef.current?.stop();
        voiceListenControlRef.current = null;
        setListening(false);
        setInterimTranscript('');
        lastSendWasVoiceRef.current = true;
        performSendRef.current?.(text);
      },
      onInterim: setInterimTranscript,
      onError: () => setListening(false),
    });
    setListening(true);
  }

  /**
   * End any in-flight stream, TTS, and mic turn before starting a new user message.
   * Returns the generation id for this request (callbacks must match it).
   */
  function prepareInterruptForNewUserMessage() {
    streamGenerationRef.current += 1;
    const generation = streamGenerationRef.current;
    pendingUserMessageRef.current = null;
    abortControllerRef.current?.abort();
    streamDictationRef.current = null;
    clearSpeakQueue();
    stopSpeaking();
    voiceListenControlRef.current?.stop();
    voiceListenControlRef.current = null;
    setListening(false);
    setInterimTranscript('');
    return generation;
  }

  const handleStop = () => {
    abortedRef.current = true;
    streamDictationRef.current = null;
    clearSpeakQueue();
    stopSpeaking();
    abortControllerRef.current?.abort();
  };

  const handleCopyConversation = () => {
    if (!navigator.clipboard || messages.length === 0) return;
    const lines = messages.map((msg) => {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      const text = getMessageText(msg.content);
      return `${label}: ${text}`;
    });
    navigator.clipboard.writeText(lines.join('\n\n')).then(() => {
      setShowCopyFeedback(true);
      setTimeout(() => setShowCopyFeedback(false), 2000);
    });
  };

  /** Follow-up request so Akira can explain the failure; uses snapshot in preRecoveryMessagesRef */
  function runErrorRecovery(errorText) {
    if (!errorText || !preRecoveryMessagesRef.current) {
      recoveryInProgressRef.current = false;
      setIsDiagnosingError(false);
      return;
    }
    const generation = prepareInterruptForNewUserMessage();
    abortedRef.current = false;
    currentAssistantContentRef.current = '';
    streamDictationRef.current = null;
    if (voiceModeRef.current) {
      streamDictationRef.current = createStreamDictation({
        enqueueSpeak: (chunk) => {
          speakQueued(chunk).catch(() => {});
        },
        maxChunk: 100,
      });
    }
    setSending(true);
    setStreaming(true);
    autoScrollRef.current = true;
    abortControllerRef.current = new AbortController();
    const recoveryMessage = `The assistant response failed with this error:\n${errorText}\n\nChat ID: ${chatIdRef.current || 'unknown'}\n\nPlease explain what likely went wrong and what the user should try next.`;
    sendMessage(
      {
        message: recoveryMessage,
        chat_id: chatIdRef.current || undefined,
        error_recovery: true,
        settings: {
          temperature: settings.temperature,
          max_tokens: settings.max_tokens,
          thinking_enabled: settings.thinking_enabled,
          thinking_budget: settings.thinking_budget,
          enabled_tools: settings.enabled_tools ?? undefined,
          stream: settings.stream,
          model: settings.current_model,
        },
      },
      {
        signal: abortControllerRef.current.signal,
        onMeta: (data) => {
          if (generation !== streamGenerationRef.current) return;
          if (data.chat_id) createdChatIdRef.current = data.chat_id;
          setChatId(data.chat_id);
          if (data.chat_id) navigate(`/chat/${data.chat_id}`);
        },
        onDelta: (delta) => {
          if (generation !== streamGenerationRef.current) return;
          currentAssistantContentRef.current += delta ?? '';
          if (voiceModeRef.current && streamDictationRef.current) {
            streamDictationRef.current.pushDelta(delta ?? '');
          }
        },
        onSettings: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSettings((prev) => ({ ...prev, ...data }));
        },
        onDone: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSending(false);
          setStreaming(false);
          if (abortedRef.current) {
            abortedRef.current = false;
            const base = preRecoveryMessagesRef.current;
            if (base) setMessages(base);
            setIsDiagnosingError(false);
            recoveryInProgressRef.current = false;
            preRecoveryMessagesRef.current = null;
            currentAssistantContentRef.current = '';
            streamDictationRef.current = null;
            if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
            return;
          }
          const diagnostic =
            currentAssistantContentRef.current.trim() ||
            'Something went wrong. Try again or change your request.';
          currentAssistantContentRef.current = '';
          const base = preRecoveryMessagesRef.current;

          if (voiceModeRef.current && streamDictationRef.current) {
            streamDictationRef.current.finish();
            streamDictationRef.current = null;
            whenSpeakQueueIdle().then(() => {
              if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
            });
          } else if (voiceModeRef.current) {
            speak(diagnostic)
              .catch(() => {})
              .finally(() => {
                if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
              });
          }
          
          if (base?.length) {
            const lastIdx = base.length - 1;
            const newMessages = [...base];
            if (newMessages[lastIdx]?.role === 'assistant') {
              newMessages[lastIdx] = {
                ...newMessages[lastIdx],
                content: diagnostic,
                error: false,
                recoveryDiagnostic: true,
                timestamp: new Date().toISOString(),
                ...(data?.model && { model: data.model }),
              };
            } else {
              newMessages.push({
                role: 'assistant',
                content: diagnostic,
                recoveryDiagnostic: true,
                timestamp: new Date().toISOString(),
                ...(data?.model && { model: data.model }),
              });
            }
            setMessages(newMessages);
          }
          setIsDiagnosingError(false);
          recoveryInProgressRef.current = false;
          preRecoveryMessagesRef.current = null;
          playCompletionSound();
        },
        onError: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSending(false);
          setStreaming(false);
          streamDictationRef.current = null;
          clearSpeakQueue();
          const base = preRecoveryMessagesRef.current;
          setIsDiagnosingError(false);
          recoveryInProgressRef.current = false;
          preRecoveryMessagesRef.current = null;
          currentAssistantContentRef.current = '';
          const fallback = data.error || 'Could not get a diagnosis. Try again.';
          if (base?.length) {
            setMessages([
              ...base,
              {
                role: 'assistant',
                content: `Could not diagnose: ${fallback}`,
                error: true,
                timestamp: new Date().toISOString(),
              },
            ]);
          }
        },
      }
    ).catch((err) => {
      if (generation !== streamGenerationRef.current) return;
      setSending(false);
      setStreaming(false);
      streamDictationRef.current = null;
      clearSpeakQueue();
      const base = preRecoveryMessagesRef.current;
      setIsDiagnosingError(false);
      recoveryInProgressRef.current = false;
      preRecoveryMessagesRef.current = null;
      currentAssistantContentRef.current = '';
      const fallback = err?.message || 'Could not reach Akira.';
      if (base?.length) {
        setMessages([
          ...base,
          {
            role: 'assistant',
            content: `Could not diagnose: ${fallback}`,
            error: true,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    });
  }

  const handleRegenerate = (assistantIndex) => {
    if (assistantIndex <= 0 || sending) return;
    const userMsg = messages[assistantIndex - 1];
    const userText = userMsg && getMessageText(userMsg.content);
    if (!userText) return;

    const generation = prepareInterruptForNewUserMessage();
    abortedRef.current = false;

    setSending(true);
    setStreaming(true);
    autoScrollRef.current = true;
    abortControllerRef.current = new AbortController();
    setMessages((prev) => [...prev.slice(0, assistantIndex), { role: 'assistant', content: '' }]);

    streamDictationRef.current = null;
    if (voiceModeRef.current) {
      streamDictationRef.current = createStreamDictation({
        enqueueSpeak: (chunk) => {
          speakQueued(chunk).catch(() => {});
        },
        maxChunk: 100,
      });
    }

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
          stream: settings.stream,
          model: settings.current_model,
        },
      },
      {
        signal: abortControllerRef.current.signal,
        onMeta: (data) => {
          if (generation !== streamGenerationRef.current) return;
          if (data.chat_id) createdChatIdRef.current = data.chat_id;
          setChatId(data.chat_id);
          if (data.chat_id) navigate(`/chat/${data.chat_id}`);
        },
        onDelta: (delta) => {
          if (generation !== streamGenerationRef.current) return;
          if (voiceModeRef.current && streamDictationRef.current) {
            streamDictationRef.current.pushDelta(delta ?? '');
          }
          setMessages((prev) => {
            const next = [...prev];
            const slot = next[assistantIndex];
            if (slot && slot.role === 'assistant') {
              next[assistantIndex] = {
                ...slot,
                content: (slot.content || '') + delta,
              };
            }
            return next;
          });
        },
        onSettings: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSettings((prev) => ({ ...prev, ...data }));
        },
        onDone: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSending(false);
          setStreaming(false);
          const sentAt = new Date().toISOString();
          setMessages((prev) => {
            const next = [...prev];
            const slot = next[assistantIndex];
            if (slot && slot.role === 'assistant') {
              next[assistantIndex] = { ...slot, timestamp: sentAt, ...(data?.model && { model: data.model }) };
            }
            return next;
          });
          playCompletionSound();
          if (voiceModeRef.current) {
            if (streamDictationRef.current) {
              streamDictationRef.current.finish();
              streamDictationRef.current = null;
              whenSpeakQueueIdle().then(() => {
                if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
              });
            } else {
              resumeVoiceListeningIfNeeded();
            }
          } else {
            streamDictationRef.current = null;
          }
        },
        onError: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSending(false);
          setStreaming(false);
          streamDictationRef.current = null;
          clearSpeakQueue();
          const errorText = data.error || 'Something went wrong. Try again.';

          if (voiceModeRef.current) {
            speak(`Error: ${errorText}`).catch(() => {});
          }

          setMessages((prev) => {
            const next = [...prev];
            const slot = next[assistantIndex];
            const partial =
              slot && slot.role === 'assistant' ? getMessageText(slot.content).trim() : '';
            const combined = assistantContentAfterStreamError(partial, errorText);
            if (slot && slot.role === 'assistant') {
              next[assistantIndex] = {
                ...slot,
                content: combined,
                error: true,
                timestamp: new Date().toISOString(),
              };
            } else {
              next.push({
                role: 'assistant',
                content: combined,
                error: true,
                timestamp: new Date().toISOString(),
              });
            }
            preRecoveryMessagesRef.current = next;
            return next;
          });
          setIsDiagnosingError(true);
          recoveryInProgressRef.current = true;
          queueMicrotask(() => runErrorRecovery(errorText));
        },
      }
    );
  };

  const scheduleAutonomousNext = () => {
    setTimeout(() => {
      const pending = pendingUserMessageRef.current;
      pendingUserMessageRef.current = null;
      if (pending) {
        performSendRef.current?.(pending.text, pending.options);
      } else if (autonomousModeRef.current) {
        performSendRef.current?.('Continue.', {});
      }
    }, 0);
  };

  const performSend = (text, options = {}) => {
    const generation = prepareInterruptForNewUserMessage();
    abortedRef.current = false;

    setSending(true);
    setStreaming(true);
    autoScrollRef.current = true;

    const userMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      ...(options.images?.length && { images: options.images }),
      ...(options.files?.length && { files: options.files }),
    };
    const assistantPlaceholder = { role: 'assistant', content: '', timestamp: null };
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);

    const assistantIndex = messagesRef.current.length + 1;
    currentAssistantContentRef.current = '';

    streamDictationRef.current = null;
    if (voiceModeRef.current) {
      streamDictationRef.current = createStreamDictation({
        enqueueSpeak: (chunk) => {
          speakQueued(chunk).catch(() => {});
        },
        maxChunk: 100,
      });
    }

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
          stream: settings.stream,
          model: settings.current_model,
        },
      },
      {
        signal: abortControllerRef.current.signal,
        onMeta: (data) => {
          if (generation !== streamGenerationRef.current) return;
          if (data.chat_id) createdChatIdRef.current = data.chat_id;
          setChatId(data.chat_id);
          if (data.chat_id) navigate(`/chat/${data.chat_id}`);
        },
        onDelta: (delta) => {
          if (generation !== streamGenerationRef.current) return;
          currentAssistantContentRef.current += delta ?? '';
          if (voiceModeRef.current && streamDictationRef.current) {
            streamDictationRef.current.pushDelta(delta ?? '');
          }
          setMessages((prev) => {
            const next = [...prev];
            const slot = next[assistantIndex];
            if (slot && slot.role === 'assistant') {
              next[assistantIndex] = {
                ...slot,
                content: (slot.content || '') + delta,
              };
            }
            return next;
          });
        },
        onSettings: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSettings((prev) => ({ ...prev, ...data }));
        },
        onDone: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSending(false);
          setStreaming(false);
          const sentAt = new Date().toISOString();
          setMessages((prev) => {
            const next = [...prev];
            const slot = next[assistantIndex];
            if (slot && slot.role === 'assistant') {
              next[assistantIndex] = { ...slot, timestamp: sentAt, ...(data?.model && { model: data.model }) };
            }
            return next;
          });
          const wasAborted = abortedRef.current;
          if (!wasAborted) {
            playCompletionSound();
            scheduleAutonomousNext();
          } else {
            abortedRef.current = false;
            streamDictationRef.current = null;
            clearSpeakQueue();
            stopSpeaking();
            if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
          }
          if (!wasAborted && voiceModeRef.current) {
            if (streamDictationRef.current) {
              streamDictationRef.current.finish();
              streamDictationRef.current = null;
              whenSpeakQueueIdle().then(() => {
                if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
              });
            } else {
              const raw = currentAssistantContentRef.current;
              const speakable = raw.replace(/<details[\s\S]*?<\/details>/gi, '').trim();
              if (speakable) {
                speak(speakable)
                  .catch(() => {})
                  .finally(() => {
                    if (voiceModeRef.current) resumeVoiceListeningIfNeeded();
                  });
              } else {
                resumeVoiceListeningIfNeeded();
              }
            }
          } else if (!wasAborted) {
            streamDictationRef.current = null;
          }
        },
        onError: (data) => {
          if (generation !== streamGenerationRef.current) return;
          setSending(false);
          setStreaming(false);
          streamDictationRef.current = null;
          clearSpeakQueue();
          const errorText = data.error || 'Something went wrong. Try again.';

          if (voiceModeRef.current) {
            speak(`Error: ${errorText}`).catch(() => {});
          }

          setMessages((prev) => {
            const next = [...prev];
            const slot = next[assistantIndex];
            const partial =
              slot && slot.role === 'assistant' ? getMessageText(slot.content).trim() : '';
            const combined = assistantContentAfterStreamError(partial, errorText);
            if (slot && slot.role === 'assistant') {
              next[assistantIndex] = {
                ...slot,
                content: combined,
                error: true,
                timestamp: new Date().toISOString(),
              };
            } else {
              next.push({
                role: 'assistant',
                content: combined,
                error: true,
                timestamp: new Date().toISOString(),
              });
            }
            preRecoveryMessagesRef.current = next;
            return next;
          });
          setIsDiagnosingError(true);
          recoveryInProgressRef.current = true;
          queueMicrotask(() => runErrorRecovery(errorText));
          abortedRef.current = false;
        },
      }
    ).catch((err) => {
      if (generation !== streamGenerationRef.current) return;
      setSending(false);
      setStreaming(false);
      streamDictationRef.current = null;
      clearSpeakQueue();
      const errorText = err?.message || 'Could not reach Akira.';
      setMessages((prev) => {
        const next = [...prev];
        const slot = next[assistantIndex];
        const partial =
          slot && slot.role === 'assistant' ? getMessageText(slot.content).trim() : '';
        const combined = assistantContentAfterStreamError(partial, errorText);
        if (slot && slot.role === 'assistant') {
          next[assistantIndex] = {
            ...slot,
            content: combined,
            error: true,
            timestamp: new Date().toISOString(),
          };
        } else {
          next.push({
            role: 'assistant',
            content: combined,
            error: true,
            timestamp: new Date().toISOString(),
          });
        }
        preRecoveryMessagesRef.current = next;
        return next;
      });
      setIsDiagnosingError(true);
      recoveryInProgressRef.current = true;
      queueMicrotask(() => runErrorRecovery(errorText));
      abortedRef.current = false;
    });
  };
  performSendRef.current = performSend;

  const MAX_IMAGES = 5;

  const handleSend = async (text, options = {}) => {
    if (autonomousModeRef.current && streaming) {
      pendingUserMessageRef.current = { text, options };
      return;
    }
    lastSendWasVoiceRef.current = false;
    const allImages = (options?.images || []).slice(0, MAX_IMAGES);
    performSend(text, { ...options, images: allImages.length ? allImages : undefined });
  };
  const chatTitle = useMemo(() => getChatTitleFromMessages(messages), [messages]);

  const handleVoiceToggle = () => {
    if (!voiceSupport.supported) {
      alert('Voice conversation is not available in this browser. Use the Akira desktop app and ensure the frontend has been rebuilt (npm run build in the frontend folder).');
      return;
    }
    const next = !voiceMode;
    voiceModeRef.current = next;
    setVoiceMode(next);
    if (!next) {
      voiceListenControlRef.current?.stop();
      voiceListenControlRef.current = null;
      streamDictationRef.current = null;
      stopListening();
      stopSpeaking();
      setListening(false);
      setInterimTranscript('');
      return;
    }
    setInterimTranscript('');
    voiceListenControlRef.current = startListening({
      onResult: (text) => {
        if (!text.trim()) return;
        voiceListenControlRef.current?.stop();
        voiceListenControlRef.current = null;
        setListening(false);
        setInterimTranscript('');
        lastSendWasVoiceRef.current = true;
        performSend(text);
      },
      onInterim: setInterimTranscript,
      onError: () => setListening(false),
    });
    setListening(true);
  };

  return (
    <div className="chat-page">
      <Sidebar
        chats={chats}
        currentChatId={chatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onOpenSettings={() => {
          setSettingsModalOpen(true);
          getSettings()
            .then((apiSettings) => {
              const stored = loadStoredSettings();
              setSettings((prev) => ({
                ...prev,
                ...apiSettings,
                ...stored,
              }));
            })
            .catch(() => {});
        }}
        loading={sidebarLoading}
        expanded={false}
        tubeReplyActive={sending || streaming || isDiagnosingError}
      />
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
      <div className="chat-main-wrap">
        <main className="chat-main">
        <header className="chat-page__top-bar">
          <h1 className="chat-page__top-bar-title" title={chatTitle}>
            {chatTitle}
          </h1>
        </header>
        {messages.length === 0 && !sending && !isDiagnosingError ? (
          <div className="chat-page__empty" role="region" aria-label={`${BRAND_NAME} chat`}>
            <div className="chat-page__empty-brand">
              <p className="chat-page__empty-name">{BRAND_NAME}</p>
              <p className="chat-page__empty-tagline">{BRAND_MEANING}</p>
            </div>
          </div>
        ) : messages.length === 0 && isDiagnosingError ? (
          <div className="chat-page__diagnosing" role="status" aria-live="polite" aria-busy={streaming}>
            <p className="chat-page__diagnosing-title">Diagnosing and fixing what went wrong</p>
            <p className="chat-page__diagnosing-detail">
              Hang on—Akira is looking at the error and what to try next.
            </p>
            <div className="chat-page__diagnosing-progress" aria-hidden />
          </div>
        ) : (
          <>
            {isDiagnosingError && (
              <div
                className="chat-page__diagnosing-inline"
                role="status"
                aria-live="polite"
                aria-busy={streaming}
              >
                <p className="chat-page__diagnosing-inline-text">
                  Checking what went wrong…
                </p>
                <div className="chat-page__diagnosing-progress chat-page__diagnosing-inline-progress" aria-hidden />
              </div>
            )}
            <div className="chat-page__messages">
              <div
                ref={messagesContainerRef}
                className="chat-page__messages-inner"
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
                  setMessages((prev) => prev.slice(0, i));
                  chatInputRef.current?.setDraft?.(text);
                  setTimeout(() => chatInputRef.current?.focus(), 0);
                }}
              />
              <div ref={messagesEndRef} aria-hidden />
              </div>
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
          disabled={sending && !settings.autonomous_mode && !streaming}
          isStreaming={streaming}
          onCopyConversation={handleCopyConversation}
          canCopyConversation={messages.length > 0}
          copyFeedback={showCopyFeedback}
          voiceSupported={voiceSupport.supported}
          voiceMode={voiceMode}
          listening={listening}
          interimTranscript={interimTranscript}
          onVoiceToggle={handleVoiceToggle}
        />
        </main>
      </div>
    </div>
  );
}
