import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidChart } from './MermaidChart';
import { CodeBlock } from './CodeBlock';

/**
 * Extract plain text from message content (string or blocks with type "text").
 * @param {string|Array} content
 * @returns {string}
 */
export function getMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = content.find((b) => b && b.type === 'text');
    return block && block.text ? block.text : '';
  }
  return '';
}

const THINKING_BLOCK_REGEX = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/i;

/** Opening tag for thinking block (backend: <details><summary>Thinking</summary>\n\n). */
const THINKING_OPEN_REGEX = /<details[^>]*>\s*<summary[^>]*>\s*Thinking\s*<\/summary>\s*/i;

/** Opening tag for tool block: <details>...<summary>Tool Use: name</summary> */
const TOOL_OPEN_REGEX = /<details[^>]*>\s*<summary[^>]*>([^<]*)<\/summary>\s*/i;

/**
 * Parse assistant content: complete blocks + streaming (incomplete) blocks.
 * When thinking/tool block starts but </details> hasn't arrived yet, we show an expanded block and stream into it.
 * @param {string} content
 * @returns {{ main: string, thinking: { summary: string, body: string } | null, thinkingStreaming: string | null, toolStreaming: { summary: string, body: string } | null }}
 */
function parseAssistantContent(content) {
  if (typeof content !== 'string') return { main: getMessageText(content), thinking: null, thinkingStreaming: null, toolStreaming: null };

  let main = content;
  let thinking = null;
  let thinkingStreaming = null;
  let toolStreaming = null;

  // --- Thinking: check for streaming first (opening present, no closing) ---
  const thinkingOpenMatch = main.match(THINKING_OPEN_REGEX);
  if (thinkingOpenMatch) {
    const openStart = main.indexOf(thinkingOpenMatch[0]);
    const bodyStart = openStart + thinkingOpenMatch[0].length;
    const closeIdx = main.indexOf('</details>', bodyStart);
    if (closeIdx === -1) {
      // Streaming: show thinking block expanded, body = everything after opening
      thinkingStreaming = main.slice(bodyStart);
      main = main.slice(0, openStart).trim();
      return { main, thinking: null, thinkingStreaming, toolStreaming };
    }
    // Complete block: use full regex
    const match = main.match(THINKING_BLOCK_REGEX);
    if (match) {
      const summary = match[1].replace(/\s+/g, ' ').trim();
      const body = match[2].trim();
      if (summary.toLowerCase() === 'thinking') {
        thinking = { summary: summary || 'Thinking', body };
        main = main.replace(THINKING_BLOCK_REGEX, '').trim();
      }
    }
  }

  // --- Tool streaming: first occurrence of <details>...Tool Use:... without </details> ---
  const toolOpenMatch = main.match(TOOL_OPEN_REGEX);
  if (toolOpenMatch) {
    const summary = toolOpenMatch[1].replace(/\s+/g, ' ').trim();
    if (/Tool Use:\s*\S+/i.test(summary)) {
      const openStart = main.indexOf(toolOpenMatch[0]);
      const bodyStart = openStart + toolOpenMatch[0].length;
      const closeIdx = main.indexOf('</details>', bodyStart);
      if (closeIdx === -1) {
        toolStreaming = { summary, body: main.slice(bodyStart) };
        main = main.slice(0, openStart).trim();
        return { main, thinking, thinkingStreaming, toolStreaming };
      }
    }
  }

  // No streaming; main may contain complete tool blocks — splitToolDetails handles that
  return { main: main.trim(), thinking, thinkingStreaming, toolStreaming };
}

/**
 * Normalize thinking body so numbered list items stay on one line (e.g. "1.\ntext" → "1. text").
 * @param {string} body
 * @returns {string}
 */
function normalizeThinkingBody(body) {
  if (!body || typeof body !== 'string') return body;
  return body.replace(/(\d+)\.\s*\n/g, '$1. ');
}

/** ReactMarkdown components: render fenced code blocks with CodeBlock (wrap/expand), mermaid as diagrams. */
function createMarkdownComponents() {
  return {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      if (!inline && lang === 'mermaid') {
        return <MermaidChart code={String(children).replace(/\n$/, '')} />;
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ node, children, ...props }) {
      // Try to get code from hast node (react-markdown v10 passes node when passNode is on)
      const codeNode = node?.children?.find?.((n) => n.type === 'element' && n.tagName === 'code');
      const classNames = codeNode?.properties?.className;
      const langFromNode = Array.isArray(classNames)
        ? classNames.find((c) => typeof c === 'string' && /^language-/.test(c))
        : typeof classNames === 'string' && /^language-/.test(classNames) ? classNames : null;
      const valueFromNode = codeNode?.children
        ?.filter?.((t) => t.type === 'text')
        ?.map?.((t) => t.value)
        ?.join?.('');

      if (valueFromNode != null) {
        return (
          <CodeBlock
            languageClassName={typeof langFromNode === 'string' ? langFromNode : ''}
            raw={String(valueFromNode)}
          />
        );
      }

      // Fallback: detect code element in React children
      const arr = React.Children.toArray(children).filter(Boolean);
      let codeEl = null;
      for (const c of arr) {
        if (React.isValidElement(c) && (c.type === 'code' || /language-\w+/.test(String(c.props?.className || '')))) {
          codeEl = c;
          break;
        }
      }
      const className = codeEl?.props?.className;
      const codeChildren = codeEl?.props?.children;
      const hasContent = codeChildren !== undefined && codeChildren !== null;
      if (codeEl && hasContent) {
        return (
          <CodeBlock
            languageClassName={typeof className === 'string' ? className : (Array.isArray(className) ? className.join(' ') : '') || ''}
            raw={String(codeChildren)}
          />
        );
      }
      return <pre {...props}>{children}</pre>;
    },
  };
}

const markdownComponents = createMarkdownComponents();

const TOOL_DETAILS_REGEX = /<details[^>]*>[\s\S]*?<summary>[^<]*Tool Use:[^<]*<\/summary>[\s\S]*?<\/details>/gi;
const TOOL_DETAIL_BLOCK_REGEX = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/i;

/**
 * Parse a single <details> block into summary and body for collapsible UI.
 * @param {string} content
 * @returns {{ summary: string, body: string } | null}
 */
function parseToolDetailBlock(content) {
  if (!content || typeof content !== 'string') return null;
  const match = content.match(TOOL_DETAIL_BLOCK_REGEX);
  if (!match) return null;
  return {
    summary: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2].trim(),
  };
}

/**
 * Split main text into segments; tool-detail segments get message-tool-details class (IBM Plex Mono).
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'tool', content: string }>}
 */
function splitToolDetails(text) {
  if (!text || typeof text !== 'string') return [];
  const parts = [];
  let lastIndex = 0;
  const re = new RegExp(TOOL_DETAILS_REGEX.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, m.index) });
    }
    parts.push({ type: 'tool', content: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return parts.length ? parts : [{ type: 'text', content: text }];
}

const VIEWPORT_PADDING = 8;

function MessageActions({ onCopy, onRegenerate, onEdit, messageIndex, justCopied, isStreaming, isAssistant, model, isModelInfoOpen, onModelInfoMouseEnter, onModelInfoMouseLeave }) {
  const canRegenerate = onRegenerate && !isStreaming;
  const modelLabel = model ? `Model: ${model}` : 'Model: unknown';
  const modelInfoTriggerRef = React.useRef(null);
  const modelInfoPopoverRef = React.useRef(null);

  React.useEffect(() => {
    if (!isModelInfoOpen || !modelInfoTriggerRef.current || !modelInfoPopoverRef.current) return;
    const trigger = modelInfoTriggerRef.current.getBoundingClientRect();
    const popover = modelInfoPopoverRef.current;
    const run = () => {
      const rect = popover.getBoundingClientRect();
      const padding = VIEWPORT_PADDING;
      let top;
      if (trigger.bottom + rect.height + 4 <= window.innerHeight - padding) {
        top = trigger.bottom + 4;
      } else if (trigger.top - rect.height - 4 >= padding) {
        top = trigger.top - rect.height - 4;
      } else {
        top = Math.max(padding, Math.min(trigger.bottom + 4, window.innerHeight - rect.height - padding));
      }
      let left = trigger.left;
      if (left + rect.width > window.innerWidth - padding) left = window.innerWidth - padding - rect.width;
      if (left < padding) left = padding;
      popover.style.position = 'fixed';
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.right = 'auto';
      popover.style.bottom = 'auto';
      popover.style.visibility = 'visible';
    };
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  }, [isModelInfoOpen]);

  return (
    <div className="message__actions" role="group" aria-label="Message actions">
      {onEdit && (
        <button
          type="button"
          className="message__action"
          aria-label="Edit message"
          onClick={() => onEdit(messageIndex)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="message__action"
        aria-label={justCopied ? 'Copied' : 'Copy'}
        onClick={() => onCopy && onCopy(messageIndex)}
      >
        {justCopied ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {isAssistant && (
        <span
          className="message__model-info-wrap"
          onMouseEnter={onModelInfoMouseEnter}
          onMouseLeave={onModelInfoMouseLeave}
        >
          <span
            ref={modelInfoTriggerRef}
            className={`message__action message__action--info ${isModelInfoOpen ? 'message__action--info-open' : ''}`}
            aria-label={modelLabel}
            role="img"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </span>
          {isModelInfoOpen && (
            <div
              ref={modelInfoPopoverRef}
              className="message__model-popover"
              data-model-info-popover
              role="tooltip"
            >
              <span className="message__model-popover-label">Model</span>
              <span className="message__model-popover-value">{model || 'unknown'}</span>
            </div>
          )}
        </span>
      )}
      {isAssistant && (
        <button
          type="button"
          className="message__action"
          aria-label="Regenerate response"
          disabled={!canRegenerate}
          onClick={() => canRegenerate && onRegenerate(messageIndex)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function MessageList({ messages, isStreaming, onCopyMessage, onRegenerateMessage, onEditMessage }) {
  const [copiedIndex, setCopiedIndex] = React.useState(null);
  const [hoverModelInfoIndex, setHoverModelInfoIndex] = React.useState(null);

  const handleCopy = (i) => {
    if (onCopyMessage) {
      onCopyMessage(i);
      setCopiedIndex(i);
      window.setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  return (
    <ul className="message-list" aria-label="Chat messages">
      {messages.map((msg, i) => {
        const isAssistant = msg.role === 'assistant';
        const isError = isAssistant && msg.error;
        const isLast = i === messages.length - 1;
        const showCursor = isAssistant && isLast && isStreaming && !isError;
        const parsed = isAssistant && !isError ? parseAssistantContent(msg.content) : null;
        const text = isError ? getMessageText(msg.content) : (isAssistant ? (parsed.main) : getMessageText(msg.content));
        const thinking = isAssistant && !isError ? parsed?.thinking : null;
        const thinkingStreaming = isAssistant && !isError ? parsed?.thinkingStreaming : null;
        const toolStreaming = isAssistant && !isError ? parsed?.toolStreaming : null;
        return (
          <li
            key={i}
            className={`message message--${msg.role}${isError ? ' message--error' : ''}`}
            data-role={msg.role}
          >
            <div className="message__bubble">
              <div className="message__body">
                {isError && (
                  <div className="message__error" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{text}</span>
                  </div>
                )}
                {!isAssistant && msg.images?.length > 0 && (
                  <div className="message__images" aria-label="Attached images">
                    {msg.images.map((img, j) => {
                      const src = typeof img.data === 'string' && img.data.startsWith('data:')
                        ? img.data
                        : `data:${img.media_type || 'image/png'};base64,${img.data || ''}`;
                      return (
                        <img
                          key={j}
                          src={src}
                          alt=""
                          className="message__image"
                        />
                      );
                    })}
                  </div>
                )}
                {!isError && thinking && (
                  <details className="message-thinking" data-thinking>
                    <summary className="message-thinking__summary">
                      {thinking.summary}
                    </summary>
                    <div className="message-thinking__body">
                      <div className="message-thinking__md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {normalizeThinkingBody(thinking.body)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
                {!isError && thinkingStreaming != null && (
                  <details className="message-thinking message-thinking--streaming" data-thinking open>
                    <summary className="message-thinking__summary">Thinking</summary>
                    <div className="message-thinking__body">
                      <div className="message-thinking__md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {normalizeThinkingBody(thinkingStreaming)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
                {!isError && toolStreaming != null && (
                  <details className="message-tool-details message-tool-details--collapsible message-tool-details--streaming" open>
                    <summary className="message-tool-details__summary">{toolStreaming.summary}</summary>
                    <div className="message-tool-details__body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {toolStreaming.body}
                      </ReactMarkdown>
                    </div>
                  </details>
                )}
                {!isError && text && (
                  <div className="message__main">
                    {splitToolDetails(text).map((part, j) => {
                      if (part.type !== 'tool') {
                        return (
                          <div key={j} className="message__main-text">
                            <ReactMarkdown components={markdownComponents}>{part.content}</ReactMarkdown>
                          </div>
                        );
                      }
                      const parsedTool = parseToolDetailBlock(part.content);
                      if (parsedTool) {
                        const isToolUse = /Tool Use:\s*\S+/.test(parsedTool.summary);
                        return (
                          <details key={j} className="message-tool-details message-tool-details--collapsible">
                            <summary className="message-tool-details__summary">{parsedTool.summary}</summary>
                            <div className="message-tool-details__body">
                              {isToolUse ? (
                                <ReactMarkdown components={markdownComponents}>{parsedTool.body}</ReactMarkdown>
                              ) : (
                                <CodeBlock raw={parsedTool.body} />
                              )}
                            </div>
                          </details>
                        );
                      }
                      return (
                        <span key={j} className="message-tool-details">{part.content}</span>
                      );
                    })}
                  </div>
                )}
                {showCursor && <span className="message__cursor" aria-hidden />}
              </div>
              {(!isLast || !isStreaming) && (
                <MessageActions
                  onCopy={onCopyMessage ? handleCopy : null}
                  onRegenerate={onRegenerateMessage}
                  onEdit={onEditMessage}
                  messageIndex={i}
                  justCopied={copiedIndex === i}
                  isStreaming={isStreaming}
                  isAssistant={isAssistant}
                  model={msg.model}
                  isModelInfoOpen={hoverModelInfoIndex === i}
                  onModelInfoMouseEnter={() => setHoverModelInfoIndex(i)}
                  onModelInfoMouseLeave={() => setHoverModelInfoIndex(null)}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
