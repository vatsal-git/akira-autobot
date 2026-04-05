import React, { useLayoutEffect, useState, useId } from 'react';
import mermaid from 'mermaid';

const THEME_FALLBACKS = {
  primaryColor: '#0f62fe',
  primaryTextColor: '#fff',
  primaryBorderColor: '#525252',
  lineColor: '#8d8d8d',
  secondaryColor: '#262626',
  tertiaryColor: '#161616',
};

const CSS_VARS = {
  primaryColor: '--color-primary',
  primaryTextColor: '--color-fg',
  primaryBorderColor: '--color-border',
  lineColor: '--color-fg-muted',
  secondaryColor: '--color-bg-elevated',
  tertiaryColor: '--color-bg',
};

function getComputedColor(cssVar) {
  if (typeof document === 'undefined') return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || null;
}

function getMermaidThemeVariables() {
  const themeVariables = {};
  for (const [key, cssVar] of Object.entries(CSS_VARS)) {
    themeVariables[key] = getComputedColor(cssVar) || THEME_FALLBACKS[key];
  }
  return themeVariables;
}

// Minimal init at load; theme colors are applied before each render
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'base',
  themeVariables: THEME_FALLBACKS,
});

/**
 * Renders Mermaid diagram code as SVG. Uses a unique ID per instance
 * so multiple diagrams on the page don't conflict.
 */
export function MermaidChart({ code }) {
  const id = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  useLayoutEffect(() => {
    if (!code || !code.trim()) {
      setSvg('');
      setError(null);
      return;
    }
    setError(null);
    // Mermaid only accepts real colors; resolve CSS variables from the document
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: getMermaidThemeVariables(),
    });
    const uniqueId = `mermaid-${id}-${Math.random().toString(36).slice(2, 9)}`;
    mermaid
      .render(uniqueId, code.trim())
      .then(({ svg: result }) => {
        setSvg(result);
      })
      .catch((err) => {
        setError(err.message || 'Failed to render diagram');
        setSvg('');
      });
  }, [code, id]);

  if (error) {
    return (
      <div className="mermaid-chart mermaid-chart--error" role="img" aria-label="Mermaid diagram failed to render">
        <pre className="mermaid-chart__fallback">{code}</pre>
        <p className="mermaid-chart__error-msg">{error}</p>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-chart mermaid-chart--loading" aria-busy="true">
        <span className="mermaid-chart__loading-text">Rendering diagram…</span>
      </div>
    );
  }

  return (
    <div
      className="mermaid-chart"
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label="Mermaid diagram"
    />
  );
}
