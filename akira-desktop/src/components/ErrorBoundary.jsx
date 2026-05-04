import React, { Component } from 'react';
import '../styles/error-boundary.css';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__card">
            <div className="error-boundary__icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="error-boundary__title">Something went wrong</h2>
            <p className="error-boundary__message">
              Akira encountered an unexpected error. Please try reloading.
            </p>
            <div className="error-boundary__actions">
              <button
                className="error-boundary__btn error-boundary__btn--primary"
                onClick={this.handleReload}
              >
                Reload
              </button>
              <a
                href="https://github.com/anthropics/claude-code/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="error-boundary__btn error-boundary__btn--secondary"
              >
                Report Issue
              </a>
            </div>
            {this.state.error && (
              <details className="error-boundary__details">
                <summary>Error details</summary>
                <pre>{this.state.error.toString()}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
