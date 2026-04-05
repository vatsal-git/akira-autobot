import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../styles/message-list.css';

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

function MessageList({ messages, isStreaming }) {
  // Only render user and assistant messages, skip empty assistant messages (from tool calls)
  // But keep the last assistant message if streaming (for typing indicator)
  const displayMessages = messages.filter((m, idx) => {
    if (m.role === 'user') return true;
    if (m.role === 'assistant') {
      const hasContent = m.content && m.content.trim().length > 0;
      const isLastMessage = idx === messages.length - 1;
      // Keep if has content, OR if it's the last message and we're streaming (typing indicator)
      return hasContent || (isLastMessage && isStreaming);
    }
    return false;
  });

  return (
    <div className="message-list">
      {displayMessages.map((message, index) => (
        <Message
          key={index}
          message={message}
          isLast={index === displayMessages.length - 1}
          isStreaming={isStreaming && index === displayMessages.length - 1 && message.role === 'assistant'}
        />
      ))}
    </div>
  );
}

function Message({ message, isLast, isStreaming }) {
  const isUser = message.role === 'user';
  const isError = message.error;
  const isIncomplete = message.incomplete;
  const [toolsCollapsed, setToolsCollapsed] = useState(true);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);

  return (
    <div
      className={`message ${isUser ? 'message--user' : 'message--assistant'} ${
        isError ? 'message--error' : ''
      } ${isIncomplete ? 'message--incomplete' : ''}`}
    >
      <div className="message__bubble">
        {isUser ? (
          <div className="message__content">{message.content}</div>
        ) : (
          <div className="message__content message__content--markdown">
            {message.content ? (
              <>
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
                {isIncomplete && (
                  <div className="message__incomplete-notice">
                    ⚠ Response interrupted: {message.errorMessage || 'Connection error'}
                  </div>
                )}
              </>
            ) : isStreaming ? (
              <span className="message__typing">
                <span className="message__typing-dot" />
                <span className="message__typing-dot" />
                <span className="message__typing-dot" />
              </span>
            ) : null}
          </div>
        )}

        {/* Thinking - collapsible */}
        {message.thinking && (
          <div className={`message__thinking ${thinkingCollapsed ? 'message__thinking--collapsed' : ''}`}>
            <div className="message__thinking-header" onClick={() => setThinkingCollapsed(!thinkingCollapsed)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>Thinking</span>
              <button className="message__thinking-toggle" title={thinkingCollapsed ? 'Expand' : 'Collapse'}>
                {thinkingCollapsed ? '+' : '−'}
              </button>
            </div>
            {!thinkingCollapsed && (
              <div className="message__thinking-content">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* Tool calls and results - collapsible */}
        {((message.toolCalls && message.toolCalls.length > 0) || (message.toolResults && message.toolResults.length > 0)) && (
          <div className={`message__tools ${toolsCollapsed ? 'message__tools--collapsed' : ''}`}>
            <div className="message__tools-header" onClick={() => setToolsCollapsed(!toolsCollapsed)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span>
                {isStreaming && message.isTooling
                  ? `Using tool: ${(() => {
                      const last = message.toolCalls?.[message.toolCalls.length - 1];
                      return typeof last === 'string' ? last : last?.function?.name || '...';
                    })()}`
                  : 'Tools Used:'}
              </span>
              <button className="message__tools-toggle" title={toolsCollapsed ? 'Expand' : 'Collapse'}>
                {toolsCollapsed ? '+' : '−'}
              </button>
            </div>
            {!toolsCollapsed && (
              <>
                {message.toolResults && message.toolResults.length > 0 && (
                  <div className="message__tool-results">
                    {message.toolResults.map((tr, i) => (
                      <div key={i} className="message__tool-result">
                        <span className="message__tool-result-name">{tr.tool}</span>
                        <span className="message__tool-result-status">
                          {tr.result?.success ? '✓' : '✗'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageList;
