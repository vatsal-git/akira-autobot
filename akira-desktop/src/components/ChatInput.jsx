import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import '../styles/chat-input.css';

// Regex to match @path patterns (paths starting with @ followed by drive letter or /)
const FILE_PATH_REGEX = /@([A-Za-z]:[^\s\n]+|\/[^\s\n]+)/g;

function ChatInput({ onSend, onStop, disabled, isStreaming, liveMode, onLiveModeToggle, onFocus, onBlur, chatId }) {
  const [text, setText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const isListeningRef = useRef(false);
  const liveModeRef = useRef(false);

  // Load draft text on mount, reset when chatId changes
  useEffect(() => {
    const loadDraft = async () => {
      if (window.akira?.getDraftText) {
        const draft = await window.akira.getDraftText();
        if (draft) setText(draft);
      }
    };
    loadDraft();
  }, []);

  // Reset input when switching chats
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setText('');
    window.akira?.setDraftText?.('');
  }, [chatId]);

  // Save draft text with debounce
  const saveDraft = useCallback((value) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      window.akira?.setDraftText?.(value);
    }, 300);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  // Initialize speech recognition (once on mount)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setText(prev => {
            const newText = prev + finalTranscript;
            saveDraft(newText);
            return newText;
          });
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        // Use refs to get current values (avoiding stale closure)
        if (liveModeRef.current && isListeningRef.current) {
          try {
            recognition.start();
          } catch (e) {
            // Already started
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [saveDraft]);

  // Start/stop listening when live mode changes
  useEffect(() => {
    if (liveMode && !isListening && recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error('Failed to start speech recognition:', e);
      }
    } else if (!liveMode && isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [liveMode]);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (text.trim() && !disabled) {
      onSend(text.trim());
      setText('');
      // Cancel any pending debounced save before clearing draft
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      window.akira?.setDraftText?.('');
    }
  };

  const handleTextChange = (e) => {
    const value = e.target.value;
    setText(value);
    saveDraft(value);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleLiveModeClick = () => {
    if (onLiveModeToggle) {
      onLiveModeToggle(!liveMode);
    }
  };

  // Extract @paths from text for chip display
  const filePaths = useMemo(() => {
    const matches = text.match(FILE_PATH_REGEX);
    if (!matches) return [];
    // Remove @ prefix and dedupe
    return [...new Set(matches.map(m => m.substring(1)))];
  }, [text]);

  // Handle paste - check for file paths in clipboard
  const handlePaste = useCallback(async (e) => {
    if (!window.akira?.getClipboardFilePaths) return;

    try {
      const paths = await window.akira.getClipboardFilePaths();
      if (paths && paths.length > 0) {
        e.preventDefault();
        // Format paths with @ prefix, one per line
        const pathsText = paths.map(p => `@${p}`).join('\n');
        // Insert at cursor position
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = text.substring(0, start);
        const after = text.substring(end);
        // Add newline before if there's text before cursor
        const prefix = before && !before.endsWith('\n') ? '\n' : '';
        // Add newline after if there's text after cursor
        const suffix = after && !after.startsWith('\n') ? '\n' : '';
        const newText = before + prefix + pathsText + suffix + after;
        setText(newText);
        saveDraft(newText);
      }
    } catch (err) {
      // Normal paste - let browser handle it
    }
  }, [text, saveDraft]);

  // Remove a file path from text
  const removeFilePath = useCallback((pathToRemove) => {
    // Remove @path pattern (with optional preceding/trailing newline)
    const escaped = pathToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\n?@${escaped}\\n?|@${escaped}`, 'g');
    let newText = text.replace(regex, (match) => {
      // If match has newlines on both sides, keep one
      if (match.startsWith('\n') && match.endsWith('\n')) return '\n';
      return '';
    });
    newText = newText.trim();
    setText(newText);
    saveDraft(newText);
  }, [text, saveDraft]);

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      {filePaths.length > 0 && (
        <div className="chat-input__file-chips">
          {filePaths.map((path, index) => (
            <div key={index} className="chat-input__file-chip">
              <span className="chat-input__file-chip-path">{path}</span>
              <button
                type="button"
                className="chat-input__file-chip-remove"
                onClick={() => removeFilePath(path)}
                title="Remove file reference"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input__wrapper">
        <textarea
          ref={textareaRef}
          className="chat-input__textarea"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={liveMode ? "Listening... or type here" : "Type here..."}
          disabled={disabled}
          rows={1}
        />
        <button
          type="button"
          className={`chat-input__live ${liveMode ? 'chat-input__live--active' : ''}`}
          onClick={handleLiveModeClick}
          title={liveMode ? "Turn off Live Mode" : "Turn on Live Mode (Voice)"}
        >
          {liveMode ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
        {(text.trim() || isStreaming) && (
          <button
            type={isStreaming ? "button" : "submit"}
            className="chat-input__send"
            disabled={!isStreaming && (disabled || !text.trim())}
            onClick={isStreaming ? onStop : undefined}
            title={isStreaming ? "Stop generating" : "Send message"}
          >
            {isStreaming ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </form>
  );
}

export default ChatInput;
