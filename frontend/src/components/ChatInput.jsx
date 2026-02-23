import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';

const LONG_MESSAGE_CHARS = 80;
const MAX_IMAGES = 5;
const MAX_OTHER_FILES = 5;
const IMAGE_TYPES = /^image\/(jpeg|png|gif|webp)$/i;

export const ChatInput = forwardRef(function ChatInput({ onSend, onStop, disabled, isStreaming = false, placeholder = '', onTyping }, ref) {
  const [value, setValue] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
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
    if (isStreaming && onStop) {
      onStop();
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
    setIsExpanded(false);
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

  const showExpandButton = value.length >= LONG_MESSAGE_CHARS && !isExpanded;

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
      {(images.length > 0 || otherFiles.length > 0) && (
        <div className="chat-input__attachments">
          {images.map((img, i) => (
            <span key={`img-${i}`} className="chat-input__attachment-pill">
              <span className="chat-input__attachment-name">{img.name || 'Image'}</span>
              <button type="button" className="chat-input__attachment-remove" onClick={() => removeImage(i)} aria-label="Remove attachment">
                ×
              </button>
            </span>
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
      <div className={`chat-input__bar ${isExpanded ? 'chat-input__bar--expanded' : ''}`}>
          <div className="chat-input__left">
            <button
              type="button"
              className="chat-input__icon"
              aria-label="Attach file"
              onClick={openFileSelector}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          {isExpanded ? (
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
              rows={4}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              className="chat-input__field"
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              aria-label="Message"
              autoComplete="off"
            />
          )}
          {showExpandButton && (
            <button
              type="button"
              className="chat-input__expand"
              onClick={() => setIsExpanded(true)}
              aria-label="Expand to multi-line"
              title="Expand to multi-line"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
          )}
          {isExpanded && (
            <button
              type="button"
              className="chat-input__expand"
              onClick={() => setIsExpanded(false)}
              aria-label="Collapse to single line"
              title="Collapse to single line"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            className={`chat-input__send ${isStreaming ? 'chat-input__send--stop' : ''}`}
            disabled={!isStreaming && (disabled || (!value.trim() && images.length === 0 && otherFiles.length === 0))}
            aria-label={isStreaming ? 'Stop generating' : 'Send message'}
            aria-busy={disabled && !isStreaming}
          >
            {isStreaming ? (
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
