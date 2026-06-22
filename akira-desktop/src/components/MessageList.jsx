import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../styles/message-list.css';
import { AgentActivityChip, AgentDelegationChip } from './AgentActivityChip';
import { EmergencyStopAlert, ClarificationRequest, InternalTaskIndicator } from './AlertComponents';
import InlineTodoList from './InlineTodoList';

// Regex to match @path patterns (paths starting with @ followed by drive letter or /)
const FILE_PATH_REGEX = /@([A-Za-z]:[^\s\n]+|\/[^\s\n]+)/g;

// Render text with @path patterns styled as monospace
function renderTextWithFilePaths(text) {
  if (!text) return null;
  const parts = [];
  let lastIndex = 0;
  let match;
  const regex = new RegExp(FILE_PATH_REGEX.source, 'g');

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    // Add the @path as a styled span
    parts.push(
      <span key={match.index} className="message__file-path">
        {match[0]}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

// Helper to truncate long strings
function truncateString(str, maxLength = 500) {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

// Helper to detect and render base64 images
function renderValue(value, depth = 0) {
  if (depth > 3) return JSON.stringify(value);

  if (typeof value === 'string') {
    // Check for base64 image
    const base64Match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,/);
    if (base64Match || (value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 100)))) {
      const src = base64Match ? value : `data:image/png;base64,${value}`;
      return <img src={src} alt="Tool output" className="trail-item__image" />;
    }
    return truncateString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => (
      <div key={i} className="trail-item__array-item">
        {renderValue(item, depth + 1)}
      </div>
    ));
  }

  if (typeof value === 'object' && value !== null) {
    // Flatten nested result: if object has success:true and a result object, show result contents directly
    if (value.success === true && value.result && typeof value.result === 'object') {
      return renderValue(value.result, depth);
    }

    return (
      <div className="trail-item__object">
        {Object.entries(value).map(([key, val]) => (
          <div key={key} className="trail-item__object-entry">
            <span className="trail-item__object-key">{key}:</span>
            <span className="trail-item__object-value">{renderValue(val, depth + 1)}</span>
          </div>
        ))}
      </div>
    );
  }

  return String(value);
}

// Reasoning chip component (minimal trail style)
function ReasoningChip({ reasoning, isConnected }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = reasoning.status === 'active';
  const dotClass = isActive ? 'trail-item__dot--running' : 'trail-item__dot--completed';

  return (
    <div className={`trail-item ${isConnected ? 'trail-item--connected' : ''}`}>
      <div className="trail-item__line" />
      <div className={`trail-item__dot ${dotClass}`} />
      <div className="trail-item__content">
        <div className="trail-item__header" onClick={() => setExpanded(!expanded)}>
          <span className="trail-item__name">
            {isActive ? 'Thinking...' : 'Thoughts'}
          </span>
          <span className={`trail-item__chevron ${expanded ? 'trail-item__chevron--open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
        {expanded && (
          <div className="trail-item__dropdown">
            <div className="trail-item__text">
              {reasoning.content?.trim()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Check if a tool result indicates failure
function isToolResultFailed(result) {
  if (!result) return false;
  return result.success === false;
}

// Tool call chip component (minimal trail style)
function ToolCallChip({ tool, isConnected, todoList }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = tool.status === 'running';
  const isFailed = tool.status === 'failed' || (tool.status === 'completed' && isToolResultFailed(tool.result));
  const dotClass = isRunning
    ? 'trail-item__dot--running'
    : isFailed
      ? 'trail-item__dot--error'
      : 'trail-item__dot--completed';
  const isTodoTool = tool.name === 'create_todo' || tool.name === 'update_todo';
  const showTodoList = isTodoTool && tool.status === 'completed' && todoList;

  return (
    <>
      <div className={`trail-item ${isConnected ? 'trail-item--connected' : ''}`}>
        <div className="trail-item__line" />
        <div className={`trail-item__dot ${dotClass}`} />
        <div className="trail-item__content">
          <div className="trail-item__header" onClick={() => setExpanded(!expanded)}>
            <span className="trail-item__name">
              {tool.name}
              {tool.agent && <span className="trail-item__agent">({tool.agent})</span>}
            </span>
            <span className={`trail-item__chevron ${expanded ? 'trail-item__chevron--open' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </div>
          {expanded && (
            <div className="trail-item__dropdown">
              <div className="trail-item__section">
                <span className="trail-item__label">Input</span>
                <pre className="trail-item__json">{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
              {tool.result && (
                <div className="trail-item__section">
                  <span className="trail-item__label">Output</span>
                  <div className="trail-item__result">
                    {renderValue(tool.result)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showTodoList && <InlineTodoList todoList={todoList} />}
    </>
  );
}

function CodeBlock({ className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const preRef = useRef(null);
  const codeText = String(children).replace(/\n$/, '');

  useEffect(() => {
    const checkOverflow = () => {
      if (preRef.current) {
        setHasOverflow(preRef.current.scrollWidth > preRef.current.clientWidth);
      }
    };
    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [children]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeText]);

  return (
    <pre ref={preRef} className={`message__code-block ${wrapped ? 'message__code-block--wrapped' : ''}`}>
      <div className="message__code-actions">
        {hasOverflow && (
          <button
            className={`message__code-wrap ${wrapped ? 'message__code-wrap--active' : ''}`}
            onClick={() => setWrapped(!wrapped)}
            title={wrapped ? 'Disable wrap' : 'Wrap text'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h15a3 3 0 110 6h-4" />
              <polyline points="10 15 7 18 10 21" />
            </svg>
          </button>
        )}
        <button
          className={`message__code-copy ${copied ? 'message__code-copy--copied' : ''}`}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
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
      </div>
      <code className={className} {...props}>
        {children}
      </code>
    </pre>
  );
}

function MessageList({ messages, isStreaming, onRegenerate, onContinue, onEmergencyResponse, onClarificationResponse, todoList }) {
  // Render user, assistant, tool, reasoning, agent, emergency, and clarification messages
  // Skip empty assistant messages and internal-only items
  const displayMessages = messages.filter((m) => {
    if (m.type === 'tool') return true;
    if (m.type === 'reasoning') return true;
    if (m.type === 'agent') return true;
    if (m.type === 'delegation') return true;
    if (m.type === 'emergency_stop') return true;
    if (m.type === 'clarification') return true;
    if (m.type === 'internal_task') return true; // Show working indicator
    if (m.role === 'user') return true;
    if (m.role === 'assistant') {
      // Keep only if has content
      return m.content && m.content.trim().length > 0;
    }
    return false;
  });

  // Helper to check if a message is a trail item (tool, reasoning, agent, delegation)
  const isTrailItem = (m) => m && (m.type === 'tool' || m.type === 'reasoning' || m.type === 'agent' || m.type === 'delegation' || m.type === 'internal_task');

  // Create index mapping from display index to original messages index
  const getOriginalIndex = (displayIndex) => {
    let count = -1;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.type === 'tool' || m.type === 'reasoning' || m.type === 'agent' ||
          m.type === 'delegation' || m.role === 'user' ||
          (m.role === 'assistant' && m.content && m.content.trim().length > 0)) {
        count++;
        if (count === displayIndex) return i;
      }
    }
    return -1;
  };

  return (
    <div className="message-list">
      {displayMessages.map((message, index) => {
        const prevMessage = displayMessages[index - 1];
        const isConnected = isTrailItem(message) && isTrailItem(prevMessage);

        return message.type === 'tool' ? (
          <ToolCallChip key={message.toolId || index} tool={message} isConnected={isConnected} todoList={todoList} />
        ) : message.type === 'reasoning' ? (
          <ReasoningChip key={`reasoning-${index}`} reasoning={message} isConnected={isConnected} />
        ) : message.type === 'agent' ? (
          <AgentActivityChip key={`agent-${index}`} activity={message} isConnected={isConnected} />
        ) : message.type === 'delegation' ? (
          <AgentDelegationChip key={`delegation-${index}`} delegation={message} isConnected={isConnected} />
        ) : message.type === 'emergency_stop' ? (
          <EmergencyStopAlert
            key={`emergency-${index}`}
            alert={message}
            onResponse={(response) => onEmergencyResponse?.(message, response)}
          />
        ) : message.type === 'clarification' ? (
          <ClarificationRequest
            key={`clarification-${message.clarificationId || index}`}
            request={message}
            onResponse={(response) => onClarificationResponse?.(message, response)}
          />
        ) : message.type === 'internal_task' ? (
          <InternalTaskIndicator key={`internal-${index}`} task={message} />
        ) : (
          <Message
            key={index}
            message={message}
            isLast={index === displayMessages.length - 1}
            isStreaming={isStreaming && index === displayMessages.length - 1 && message.role === 'assistant'}
            onRegenerate={message.cached && onRegenerate ? () => onRegenerate(getOriginalIndex(index)) : null}
            onContinue={message.incomplete && onContinue ? () => onContinue(getOriginalIndex(index)) : null}
          />
        );
      })}
    </div>
  );
}

function Message({ message, isLast, isStreaming, onRegenerate, onContinue }) {
  const isUser = message.role === 'user';
  const isError = message.error;
  const isIncomplete = message.incomplete;
  const isTyping = !isUser && !message.content && isStreaming;
  const isCached = message.cached === true;

  return (
    <div
      className={`message ${isUser ? 'message--user' : 'message--assistant'} ${
        isError ? 'message--error' : ''
      } ${isIncomplete ? 'message--incomplete' : ''} ${isTyping ? 'message--typing' : ''} ${isCached ? 'message--cached' : ''}`}
    >
      <div className="message__bubble">
        {isUser ? (
          <div className="message__content">{renderTextWithFilePaths(message.content)}</div>
        ) : (
          <div className="message__content message__content--markdown">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Render code blocks
                  code({ node, inline, className, children, ...props }) {
                    return !inline ? (
                      <CodeBlock className={className} {...props}>
                        {children}
                      </CodeBlock>
                    ) : (
                      <code className="message__inline-code" {...props}>
                        {children}
                      </code>
                    );
                  },
                  // Make links open in browser
                  a({ node, children, href, ...props }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : null}
          </div>
        )}
      </div>
      {/* Incomplete response footer - outside bubble, minimal */}
      {isIncomplete && !isStreaming && (
        <div className="message__incomplete-footer">
          <span className="message__incomplete-text">Response stopped</span>
          {onContinue && (
            <button
              className="message__continue-btn"
              onClick={onContinue}
              title="Continue"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
        </div>
      )}
      {/* Flash response indicator - outside bubble, subtle */}
      {isCached && !isStreaming && (
        <div className="message__flash-footer">
          <span className="message__flash-icon" title="Flash response (cached)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </span>
          {onRegenerate && (
            <button
              className="message__regenerate-btn"
              onClick={onRegenerate}
              title="Regenerate"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default MessageList;
