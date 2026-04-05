import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../styles/message-list.css';

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
  const [toolsCollapsed, setToolsCollapsed] = useState(true);

  return (
    <div
      className={`message ${isUser ? 'message--user' : 'message--assistant'} ${
        isError ? 'message--error' : ''
      }`}
    >
      <div className="message__bubble">
        {isUser ? (
          <div className="message__content">{message.content}</div>
        ) : (
          <div className="message__content message__content--markdown">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Render code blocks
                  code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline ? (
                      <pre className="message__code-block">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
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
            ) : isStreaming ? (
              <span className="message__typing">
                <span className="message__typing-dot" />
                <span className="message__typing-dot" />
                <span className="message__typing-dot" />
              </span>
            ) : null}
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
