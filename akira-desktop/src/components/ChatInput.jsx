import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import '../styles/chat-input.css';

// Regex to match @path patterns (paths starting with @ followed by drive letter or /)
const FILE_PATH_REGEX = /@([A-Za-z]:[^\s\n]+|\/[^\s\n]+)/g;

function ChatInput({ onSend, onStop, disabled, isStreaming, ttsEnabled, onTtsToggle, onFocus, onBlur, chatId, settings, queuedMessage, onQueueMessage }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // When there's a queued message, show it in the textarea
  const displayText = queuedMessage || text;
  const isQueuedState = !!queuedMessage;

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
    if (!text.trim()) return;

    // If streaming, queue the message instead of sending
    if (isStreaming && onQueueMessage) {
      onQueueMessage(text.trim());
      setText('');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      window.akira?.setDraftText?.('');
      return;
    }

    // Normal send when not streaming
    if (!disabled) {
      onSend(text.trim());
      setText('');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      window.akira?.setDraftText?.('');
    }
  };

  const handleTextChange = (e) => {
    // Don't allow changes when message is queued
    if (isQueuedState) return;
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

  const handleTtsToggleClick = () => {
    if (onTtsToggle) {
      onTtsToggle(!ttsEnabled);
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
          className={`chat-input__textarea ${isQueuedState ? 'chat-input__textarea--queued' : ''}`}
          value={displayText}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Type here..."
          disabled={isQueuedState || disabled}
          rows={1}
        />
        <button
          type="button"
          className={`chat-input__tts ${ttsEnabled ? 'chat-input__tts--active' : ''}`}
          onClick={handleTtsToggleClick}
          title={ttsEnabled ? "Turn off Text to Speech" : "Turn on Text to Speech"}
        >
          {ttsEnabled ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
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
