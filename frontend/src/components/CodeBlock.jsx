import React from 'react';

/** Wrap icon: lines breaking */
const WrapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18M3 12h10a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H3M3 18h6" />
  </svg>
);

/** No-wrap icon: single line */
const NoWrapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18M3 12h18M3 18h12" />
  </svg>
);

/** Expand icon */
const ExpandIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

/** Collapse icon — four inward brackets, same coordinate range as Expand */
const CollapseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16v3a2 2 0 0 1 2 2h3M16 21h3a2 2 0 0 1 2-2v-3" />
  </svg>
);

/** Copy to clipboard icon */
const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/** Checkmark icon (copied feedback) */
const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * Code block with:
 * - Text wrap on by default (toggle in top-right)
 * - Fixed height with scroll by default; expand button to show full block
 */
export function CodeBlock({ children, raw, languageClassName = '', className = '' }) {
  const content = raw !== undefined ? raw : (typeof children === 'string' ? children : (children ?? ''));
  const [wrap, setWrap] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef(null);

  const handleCopy = React.useCallback(() => {
    const text = typeof content === 'string' ? content : String(content ?? '');
    navigator.clipboard.writeText(text).then(
      () => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        setCopied(true);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false)
    );
  }, [content]);

  React.useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  return (
    <div
      className={`code-block ${expanded ? 'code-block--expanded' : ''} ${!wrap ? 'code-block--no-wrap' : ''} ${className}`.trim()}
    >
      <div className="code-block__toolbar" role="toolbar" aria-label="Code block options">
        <button
          type="button"
          className="code-block__btn"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button
          type="button"
          className="code-block__btn"
          onClick={() => setWrap((w) => !w)}
          aria-label={wrap ? 'Disable wrap' : 'Wrap text'}
          title={wrap ? 'Disable wrap' : 'Wrap text'}
        >
          {wrap ? <WrapIcon /> : <NoWrapIcon />}
        </button>
        <button
          type="button"
          className="code-block__btn"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      <div className="code-block__content">
        <pre className="code-block__pre">
          <code className={languageClassName || ''}>{content}</code>
        </pre>
      </div>
    </div>
  );
}
