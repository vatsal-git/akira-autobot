import React, { useMemo } from 'react';
import '../styles/todo-panel.css';

function TodoItem({ item }) {
  const statusClass = `todo-item--${item.status}`;
  const isVerification = item.verification;

  return (
    <div className={`todo-item ${statusClass} ${isVerification ? 'todo-item--verification' : ''}`}>
      <div className="todo-item__checkbox">
        {item.status === 'pending' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
          </svg>
        )}
        {item.status === 'in_progress' && (
          <div className="todo-item__spinner" />
        )}
        {item.status === 'completed' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        )}
        {item.status === 'failed' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
      </div>
      <div className="todo-item__content">
        <span className="todo-item__text">{item.content}</span>
        {item.agent && (
          <span className="todo-item__agent">{item.agent}</span>
        )}
      </div>
    </div>
  );
}

function TodoPanel({ todoList, isCollapsed, onToggle }) {
  const progress = useMemo(() => {
    if (!todoList || !todoList.items) return { completed: 0, total: 0, percent: 0 };
    const total = todoList.items.length;
    const completed = todoList.items.filter(i => i.status === 'completed').length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  }, [todoList]);

  if (!todoList || !todoList.items || todoList.items.length === 0) {
    return null;
  }

  return (
    <div className={`todo-panel ${isCollapsed ? 'todo-panel--collapsed' : ''}`}>
      <div className="todo-panel__header" onClick={onToggle}>
        <div className="todo-panel__header-left">
          <span className="todo-panel__title">{todoList.title || 'Tasks'}</span>
          <span className="todo-panel__count">
            {progress.completed}/{progress.total}
          </span>
        </div>
        <div className="todo-panel__header-right">
          {progress.percent > 0 && progress.percent < 100 && (
            <div className="todo-panel__progress-bar">
              <div
                className="todo-panel__progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          )}
          <span className={`todo-panel__chevron ${isCollapsed ? '' : 'todo-panel__chevron--open'}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
      </div>
      {!isCollapsed && (
        <div className="todo-panel__items">
          {todoList.items.map(item => (
            <TodoItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export default TodoPanel;
