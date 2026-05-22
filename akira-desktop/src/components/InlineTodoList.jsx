import React, { useState } from 'react';
import '../styles/inline-todo.css';

function InlineTodoList({ todoList }) {
  const [expanded, setExpanded] = useState(false);

  if (!todoList || !todoList.items || todoList.items.length === 0) {
    return null;
  }

  const items = todoList.items;
  const maxVisible = 6;
  const hasMore = items.length > maxVisible;
  const visibleItems = expanded ? items : items.slice(0, maxVisible);

  return (
    <div className="inline-todo">
      <div className="inline-todo__items">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className={`inline-todo__item inline-todo__item--${item.status}`}
          >
            <div className="inline-todo__checkbox">
              {item.status === 'pending' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
              )}
              {item.status === 'in_progress' && (
                <div className="inline-todo__spinner" />
              )}
              {item.status === 'completed' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              )}
              {item.status === 'failed' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                </svg>
              )}
            </div>
            <span className="inline-todo__text">{item.content}</span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          className="inline-todo__expand"
          onClick={() => setExpanded(!expanded)}
        >
          <span>{expanded ? 'Show less' : `+${items.length - maxVisible} more`}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={expanded ? 'inline-todo__expand-icon--up' : ''}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default InlineTodoList;
