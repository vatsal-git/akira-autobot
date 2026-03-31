import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidChart } from './MermaidChart';
import { CodeBlock } from './CodeBlock';

/** react-markdown only allows http(s) etc. by default; tool screenshots use data:image/... URLs. */
function akiraMarkdownUrlTransform(url) {
  if (typeof url === 'string' && /^data:image\//i.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

const markdownCommonProps = {
  remarkPlugins: [remarkGfm],
  urlTransform: akiraMarkdownUrlTransform,
};

/**
 * Backend may append `[Sent at: <iso>]` to message text for the model; the model may echo it.
 * Strip from the end of the string (including trailing whitespace / CRLF / repeated lines).
 */
const SENT_AT_END_BLOCK = /\r?\n\[{1,2}Sent at:\s*[^\]\r\n]+\]{1,2}\s*$/;
const SENT_AT_WHOLE_MESSAGE = /^\[{1,2}Sent at:\s*[^\]\r\n]+\]{1,2}\s*$/;

export function stripSentAtSuffix(str) {
  if (typeof str !== 'string') return str;
  let s = str;
  for (let i = 0; i < 8; i++) {
    const next = s.replace(SENT_AT_END_BLOCK, '').replace(SENT_AT_WHOLE_MESSAGE, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Extract plain text from message content (string or blocks with type "text").
 * @param {string|Array} content
 * @returns {string}
 */
export function getMessageText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return stripSentAtSuffix(content);
  if (Array.isArray(content)) {
    const block = content.find((b) => b && b.type === 'text');
    const raw = block && block.text ? block.text : '';
    return stripSentAtSuffix(raw);
  }
  return stripSentAtSuffix(String(content));
}

/** Same delimiter as ChatPage `assistantContentAfterStreamError` — partial before, API error after. */
const ASSISTANT_STREAM_ERROR_MARK = /\n\n---\n\n\*\*Something went wrong:\*\*\s*/;

/**
 * @param {string|unknown} raw — full assistant message text (string or block-shaped content)
 * @returns {{ partial: string, errorDetail: string }}
 */
export function splitAssistantStreamErrorContent(raw) {
  const text = typeof raw === 'string' ? stripSentAtSuffix(raw) : getMessageText(raw);
  if (!text || typeof text !== 'string') return { partial: '', errorDetail: '' };
  const parts = text.split(ASSISTANT_STREAM_ERROR_MARK);
  if (parts.length < 2) {
    return { partial: '', errorDetail: text.trim() };
  }
  const errorDetail = (parts.pop() || '').trim();
  const partial = parts.join('\n\n---\n\n**Something went wrong:**\n\n').trim();
  return { partial, errorDetail };
}

const THINKING_BLOCK_REGEX = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/i;

/**
 * Skip complete <details>...</details> blocks from the start of text; return the first
 * unclosed block's start index and the slice after its opening <details> tag (or null).
 */
function findFirstUnclosedDetailsTail(text) {
  if (!text || typeof text !== 'string') return null;
  let i = 0;
  while (i < text.length) {
    const slice = text.slice(i);
    const rel = slice.search(/<details[^>]*>/i);
    if (rel < 0) return null;
    const openMatch = slice.slice(rel).match(/^<details[^>]*>/i);
    if (!openMatch) return null;
    const blockStart = i + rel;
    const absOpenEnd = blockStart + openMatch[0].length;
    const after = text.slice(absOpenEnd);
    const closeRel = after.indexOf('</details>');
    if (closeRel === -1) {
      return { blockStart, afterOpen: after };
    }
    i = absOpenEnd + closeRel + '</details>'.length;
  }
  return null;
}

/**
 * Parse content after <details> until </details> (or EOF): summary label + body.
 * Does not require </summary> or </details> to be present yet.
 * @param {string} afterOpen - text immediately after the opening <details> tag
 * @returns {{ summary: string, body: string }}
 */
function parseDetailsOpenTail(afterOpen) {
  const rest = afterOpen.replace(/^\s*/, '');
  const sm = rest.match(/^<summary[^>]*>/i);
  if (!sm) {
    return { summary: 'Thinking', body: '' };
  }
  const afterSm = rest.slice(sm[0].length);
  const sc = afterSm.indexOf('</summary>');
  let summary;
  let body;
  if (sc === -1) {
    summary = afterSm.replace(/\s+/g, ' ').trim() || '…';
    body = '';
  } else {
    summary = afterSm.slice(0, sc).replace(/\s+/g, ' ').trim() || '…';
    body = afterSm.slice(sc + '</summary>'.length).replace(/^\s*/, '');
  }
  return { summary, body };
}

/** Prefer Tool Use while summary still streaming ("To…" vs "Th…"). */
function isToolStreamingSummary(summary) {
  const s = summary.trim();
  if (/^tool use:/i.test(s)) return true;
  if (/^think/i.test(s)) return false;
  if (/^th/i.test(s)) return false;
  if (/^to/i.test(s)) return true;
  return false;
}

/**
 * Parse assistant content: complete blocks + streaming (incomplete) blocks.
 * When a <details> block has no </details> yet, show the expandable UI as soon as the
 * opening <details> tag is complete — no need to wait for </summary> or </details>.
 * @param {string} content
 * @returns {{ main: string, thinking: { summary: string, body: string } | null, thinkingStreaming: string | null, toolStreaming: { summary: string, body: string } | null }}
 */
function parseAssistantContent(content) {
  if (typeof content !== 'string') return { main: getMessageText(content), thinking: null, thinkingStreaming: null, toolStreaming: null };

  let main = content;
  let thinking = null;
  let thinkingStreaming = null;
  let toolStreaming = null;

  const unclosed = findFirstUnclosedDetailsTail(main);
  if (unclosed) {
    const { summary, body } = parseDetailsOpenTail(unclosed.afterOpen);
    const openStart = unclosed.blockStart;
    if (isToolStreamingSummary(summary)) {
      toolStreaming = { summary, body };
    } else {
      thinkingStreaming = body;
    }
    main = stripSentAtSuffix(main.slice(0, openStart).trim());
    return { main, thinking, thinkingStreaming, toolStreaming };
  }

  const match = main.match(THINKING_BLOCK_REGEX);
  if (match) {
    const summary = match[1].replace(/\s+/g, ' ').trim();
    const body = match[2].trim();
    if (summary.toLowerCase() === 'thinking') {
      thinking = { summary: summary || 'Thinking', body: stripSentAtSuffix(body) };
      main = main.replace(THINKING_BLOCK_REGEX, '').trim();
    }
  }

  return { main: stripSentAtSuffix(main.trim()), thinking, thinkingStreaming, toolStreaming };
}

function firstNonEmptyLine(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/**
 * Single-line label for the chat header: first line of the first assistant reply, or "New Chat".
 * @param {Array<{ role: string, content?: unknown, error?: boolean }>} messages
 * @returns {string}
 */
export function getChatTitleFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 'New Chat';
  const assistant = messages.find((m) => m && m.role === 'assistant');
  if (!assistant) return 'New Chat';
  let raw;
  if (assistant.error) {
    const split = splitAssistantStreamErrorContent(assistant.content);
    raw = (split.partial || '').trim() ? split.partial : split.errorDetail;
  } else {
    const parsed = parseAssistantContent(assistant.content);
    raw = parsed.main || '';
  }
  raw = stripSentAtSuffix(raw);
  const line = firstNonEmptyLine(raw);
  if (!line) return 'New Chat';
  let display = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\s+/, '')
    .replace(/^>\s*/, '')
    .trim();
  display = display.replace(/\s+/g, ' ');
  if (!display) return 'New Chat';
  return display;
}

/**
 * Normalize markdown so numbered list items are not split across lines (models often emit "1.\\n**Title**").
 * Does not merge "1. ... \\n\\n2. ..." — skips when the next non-whitespace line starts a new list item.
 * @param {string} body
 * @returns {string}
 */
function normalizeMarkdownLists(body) {
  if (!body || typeof body !== 'string') return body;
  return body.replace(/(\d+)\.\s*\n+(?!\s*\d+\.\s)/g, '$1. ');
}

/** ReactMarkdown components: render fenced code blocks with CodeBlock (wrap/expand), mermaid as diagrams, tables in a scroll wrapper. */
function createMarkdownComponents() {
  return {
    table({ node, children, ...props }) {
      return (
        <div className="markdown-table-wrap" role="region" aria-label="Table">
          <table {...props}>{children}</table>
        </div>
      );
    },
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
/** Matches any <details> block; captures summary (1) and body (2). Used to split so both Thinking and Tool Use render as collapsibles. */
const ANY_DETAILS_BLOCK_REGEX = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/gi;
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
 * Split main text into segments: text, thinking blocks, and tool-use blocks.
 * So every <details> (Thinking or Tool Use) renders as a proper collapsible, not raw HTML.
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'thinking' | 'tool', content?: string, summary?: string, body?: string }>}
 */
function splitToolDetails(text) {
  if (!text || typeof text !== 'string') return [];
  const parts = [];
  let lastIndex = 0;
  const re = new RegExp(ANY_DETAILS_BLOCK_REGEX.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, m.index) });
    }
    const summary = (m[1] || '').replace(/\s+/g, ' ').trim();
    const body = (m[2] || '').trim();
    const isThinking = summary.toLowerCase() === 'thinking';
    parts.push(isThinking ? { type: 'thinking', summary: summary || 'Thinking', body } : { type: 'tool', content: m[0], summary, body });
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
        let parsed = null;
        let streamErrorDetail = null;
        if (isAssistant) {
          if (isError) {
            const split = splitAssistantStreamErrorContent(msg.content);
            streamErrorDetail = split.errorDetail;
            parsed = parseAssistantContent(split.partial || '');
          } else {
            parsed = parseAssistantContent(msg.content);
          }
        }
        let text = isAssistant ? (parsed?.main ?? '') : getMessageText(msg.content);
        text = stripSentAtSuffix(text);
        const thinking = isAssistant ? parsed?.thinking : null;
        const thinkingStreaming = isAssistant ? parsed?.thinkingStreaming : null;
        const toolStreaming = isAssistant ? parsed?.toolStreaming : null;
        return (
          <li
            key={i}
            className={`message message--${msg.role}`}
            data-role={msg.role}
          >
            <div className="message__bubble">
              <div className="message__body">
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
                {thinking && (
                  <details className="message-thinking" data-thinking>
                    <summary className="message-thinking__summary">
                      {thinking.summary}
                    </summary>
                    <div className="message-thinking__body">
                      <div className="message-thinking__md">
                        <ReactMarkdown {...markdownCommonProps} components={markdownComponents}>
                          {normalizeMarkdownLists(thinking.body)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
                {thinkingStreaming != null && (
                  <details className="message-thinking message-thinking--streaming" data-thinking open>
                    <summary className="message-thinking__summary">Thinking</summary>
                    <div className="message-thinking__body">
                      <div className="message-thinking__md">
                        <ReactMarkdown {...markdownCommonProps} components={markdownComponents}>
                          {normalizeMarkdownLists(thinkingStreaming)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
                {toolStreaming != null && (
                  <details className="message-thinking message-thinking--streaming" data-tool-use open>
                    <summary className="message-thinking__summary">{toolStreaming.summary}</summary>
                    <div className="message-thinking__body">
                      <div className="message-thinking__md">
                        <ReactMarkdown {...markdownCommonProps} components={markdownComponents}>
                          {normalizeMarkdownLists(toolStreaming.body)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
                {text && (
                  <div className="message__main">
                    {splitToolDetails(text).map((part, j) => {
                      if (part.type === 'text') {
                        return (
                          <div key={j} className="message__main-text">
                            {isAssistant ? (
                              <ReactMarkdown {...markdownCommonProps} components={markdownComponents}>
                                {normalizeMarkdownLists(part.content)}
                              </ReactMarkdown>
                            ) : (
                              <div className="message__main-text-plain">{part.content}</div>
                            )}
                          </div>
                        );
                      }
                      if (part.type === 'thinking') {
                        return (
                          <details key={j} className="message-thinking" data-thinking>
                            <summary className="message-thinking__summary">{part.summary}</summary>
                            <div className="message-thinking__body">
                              <div className="message-thinking__md">
                                <ReactMarkdown {...markdownCommonProps} components={markdownComponents}>
                                  {normalizeMarkdownLists(part.body)}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </details>
                        );
                      }
                      const parsedTool = part.summary != null ? { summary: part.summary, body: part.body } : parseToolDetailBlock(part.content);
                      if (parsedTool) {
                        const isToolUse = /Tool Use:\s*\S+/.test(parsedTool.summary);
                        return (
                          <details key={j} className="message-thinking" data-tool-use>
                            <summary className="message-thinking__summary">{parsedTool.summary}</summary>
                            <div className="message-thinking__body">
                              {isToolUse ? (
                                <div className="message-thinking__md">
                                  <ReactMarkdown {...markdownCommonProps} components={markdownComponents}>
                                    {normalizeMarkdownLists(parsedTool.body)}
                                  </ReactMarkdown>
                                </div>
                              ) : (
                                <CodeBlock raw={parsedTool.body} />
                              )}
                            </div>
                          </details>
                        );
                      }
                      return (
                        <span key={j} className="message-thinking">{part.content}</span>
                      );
                    })}
                  </div>
                )}
                {isError && (
                  <div className="message__error" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span className="message__error-body">
                      <strong>Something went wrong:</strong>{' '}
                      {streamErrorDetail || 'Try again.'}
                    </span>
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
