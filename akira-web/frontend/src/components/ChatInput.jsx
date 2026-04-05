import React, { useState, useRef, useImperativeHandle, forwardRef, useLayoutEffect } from 'react';

/** Max height (px) for the growing textarea — keep in sync with CSS max-height. */
const TEXTAREA_MAX_HEIGHT = 240;
const MAX_IMAGES = 5;
const MAX_OTHER_FILES = 5;
const IMAGE_TYPES = /^image\/(jpeg|png|gif|webp)$/i;

export const ChatInput = forwardRef(function ChatInput(
  {
    onSend,
    onStop,
    disabled,
    isStreaming = false,
    placeholder = '',
    onTyping,
    onCopyConversation,
    canCopyConversation = false,
    copyFeedback = false,
    voiceSupported = false,
    voiceMode = false,
    listening = false,
    interimTranscript = '',
    onVoiceToggle,
  },
  ref
) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState([]); // { data, media_type, name }
  const [otherFiles, setOtherFiles] = useState([]); // { name, data, mime_type }
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setDraft: (text) => setValue(String(text ?? '')),
  }), []);

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (isStreaming) {
      const trimmed = value.trim();
      const hasPayload =
        Boolean(trimmed) || images.length > 0 || otherFiles.length > 0;
      if (hasPayload) {
        if (disabled) return;
        onSend(trimmed, {
          images: images.length ? images.map(({ data, media_type }) => ({ data, media_type })) : undefined,
          files: otherFiles.length ? otherFiles.map(({ name, data, mime_type }) => ({ name, data, mime_type })) : undefined,
        });
        setValue('');
        setImages([]);
        setOtherFiles([]);
        return;
      }
      if (onStop) onStop();
      return;
    }
    const trimmed = value.trim();
    if ((!trimmed && images.length === 0 && otherFiles.length === 0) || disabled) return;
    onSend(trimmed, {
      images: images.length ? images.map(({ data, media_type }) => ({ data, media_type })) : undefined,
      files: otherFiles.length ? otherFiles.map(({ name, data, mime_type }) => ({ name, data, mime_type })) : undefined,
    });
    setValue('');
    setImages([]);
    setOtherFiles([]);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setValue(next);
    if (next.length > 0 && onTyping) onTyping();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [value]);

  const openFileSelector = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const imageFiles = [];
    const nonImageFiles = [];
    for (const file of files) {
      if (IMAGE_TYPES.test(file.type || '')) imageFiles.push(file);
      else nonImageFiles.push(file);
    }
    const remainingImages = MAX_IMAGES - images.length;
    const toAddImages = imageFiles.slice(0, remainingImages);
    if (toAddImages.length > 0) {
      Promise.all(
        toAddImages.map((file) => {
          const mediaType = file.type || 'image/png';
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const data = reader.result.replace(/^data:[^;]+;base64,/, '');
              resolve({ data, media_type: mediaType, name: file.name });
            };
            reader.readAsDataURL(file);
          });
        })
      ).then((newImages) => setImages((prev) => [...prev, ...newImages]));
    }
    const remainingFiles = MAX_OTHER_FILES - otherFiles.length;
    const toAddFiles = nonImageFiles.slice(0, remainingFiles);
    if (toAddFiles.length > 0) {
      Promise.all(
        toAddFiles.map((file) => {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const data = reader.result.replace(/^data:[^;]+;base64,/, '');
              resolve({ name: file.name, data, mime_type: file.type || 'application/octet-stream' });
            };
            reader.readAsDataURL(file);
          });
        })
      ).then((newFiles) => setOtherFiles((prev) => [...prev, ...newFiles]));
    }
  };

  const removeImage = (index) => setImages((prev) => prev.filter((_, i) => i !== index));
  const removeOtherFile = (index) => setOtherFiles((prev) => prev.filter((_, i) => i !== index));

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) return;
    const imageItems = [];
    for (let i = 0; i < items.length && imageItems.length < remaining; i++) {
      const item = items[i];
      if (item.kind === 'file' && IMAGE_TYPES.test(item.type || '')) {
        const file = item.getAsFile();
        if (file) imageItems.push(file);
      }
    }
    if (imageItems.length === 0) return;
    e.preventDefault();
    Promise.all(
      imageItems.map((file) => {
        const mediaType = file.type || 'image/png';
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const data = reader.result.replace(/^data:[^;]+;base64,/, '');
            resolve({ data, media_type: mediaType, name: file.name || 'Pasted image' });
          };
          reader.readAsDataURL(file);
        });
      })
    ).then((newImages) => setImages((prev) => [...prev, ...newImages]));
  };

  return (
    <form className="chat-input" onSubmit={handleSubmit} onPaste={handlePaste}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="chat-input__hidden-file"
        aria-hidden
        onChange={handleFileChange}
      />
      {listening && interimTranscript && (
        <div className="chat-input__interim" aria-live="polite">
          {interimTranscript}
        </div>
      )}
      {(images.length > 0 || otherFiles.length > 0) && (
        <div className="chat-input__attachments">
          {images.map((img, i) => (
            <div key={`img-${i}`} className="chat-input__image-preview">
              <img
                src={`data:${img.media_type || 'image/png'};base64,${img.data}`}
                alt={img.name || 'Pasted image'}
                className="chat-input__image-preview-img"
              />
              <button
                type="button"
                className="chat-input__image-preview-remove"
                onClick={() => removeImage(i)}
                aria-label={`Remove ${img.name || 'image'}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
          {otherFiles.map((f, i) => (
            <span key={`file-${i}`} className="chat-input__attachment-pill">
              <span className="chat-input__attachment-name">{f.name}</span>
              <button type="button" className="chat-input__attachment-remove" onClick={() => removeOtherFile(i)} aria-label="Remove attachment">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input__bar">
          <div className="chat-input__left">
            <button
              type="button"
              className="chat-input__icon"
              aria-label="Attach file"
              onClick={openFileSelector}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {onCopyConversation && (
              <button
                type="button"
                className="chat-input__icon"
                aria-label={copyFeedback ? 'Copied' : 'Copy conversation'}
                title={copyFeedback ? 'Copied' : 'Copy conversation'}
                disabled={!canCopyConversation}
                onClick={onCopyConversation}
              >
                {copyFeedback ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                )}
              </button>
            )}
          </div>
          <textarea
            ref={inputRef}
            className="chat-input__field chat-input__field--textarea"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Message"
            autoComplete="off"
            rows={1}
          />
            {onVoiceToggle != null && (
              <button
                type="button"
                className={`chat-input__icon chat-input__icon--voice ${voiceMode ? 'chat-input__icon--voice-active' : ''} ${listening ? 'chat-input__icon--listening' : ''}`}
                aria-label={listening ? 'Listening…' : voiceMode ? 'Voice conversation on (click to off)' : 'Start voice conversation'}
                title={listening ? 'Listening…' : voiceMode ? 'Voice on' : 'Talk with Akira (voice in & out)'}
                onClick={onVoiceToggle}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          <button
            type="button"
            onClick={handleSubmit}
            className={`chat-input__send ${isStreaming && !value.trim() && images.length === 0 && otherFiles.length === 0 ? 'chat-input__send--stop' : ''}`}
            disabled={
              !isStreaming &&
              (disabled || (!value.trim() && images.length === 0 && otherFiles.length === 0))
            }
            aria-label={
              isStreaming && !value.trim() && images.length === 0 && otherFiles.length === 0
                ? 'Stop generating'
                : 'Send message'
            }
            aria-busy={disabled && !isStreaming}
          >
            {isStreaming && !value.trim() && images.length === 0 && otherFiles.length === 0 ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 2 2 9l9 4 4 9 7-20Z" />
              </svg>
            )}
          </button>
      </div>
    </form>
  );
});

export default ChatInput;
