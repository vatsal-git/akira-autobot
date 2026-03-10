import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCurrentThemeEmoji } from '../config/theme';

function sortChatsByTime(chats) {
  return [...chats].sort((a, b) => {
    const tA = a.last_updated || a.created_at || '';
    const tB = b.last_updated || b.created_at || '';
    const dA = tA ? new Date(tA).getTime() : 0;
    const dB = tB ? new Date(tB).getTime() : 0;
    return dB - dA;
  });
}

const DATE_GROUP = { TODAY: 'Today', YESTERDAY: 'Yesterday', OLDER: 'Older' };

function getDateGroup(isoDateStr) {
  if (!isoDateStr) return DATE_GROUP.OLDER;
  const d = new Date(isoDateStr);
  const today = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return DATE_GROUP.TODAY;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return DATE_GROUP.YESTERDAY;
  return DATE_GROUP.OLDER;
}

function groupChatsByDate(sortedChats) {
  const groups = { [DATE_GROUP.TODAY]: [], [DATE_GROUP.YESTERDAY]: [], [DATE_GROUP.OLDER]: [] };
  for (const chat of sortedChats) {
    const key = chat.last_updated || chat.created_at || '';
    const group = getDateGroup(key);
    groups[group].push(chat);
  }
  return groups;
}

function formatHistoryPreview(isoStr, groupLabel) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (groupLabel === DATE_GROUP.OLDER) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function Sidebar({
  chats,
  currentChatId,
  onSelectChat,
  onNewChat,
  onOpenSettings,
  loading,
  expanded = false,
}) {
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyExpandedGroup, setHistoryExpandedGroup] = useState(DATE_GROUP.TODAY);
  const sortedChats = sortChatsByTime(chats);
  const chatsByDate = groupChatsByDate(sortedChats);

  useEffect(() => {
    if (!historyModalOpen) return;
    setHistoryExpandedGroup(DATE_GROUP.TODAY);
    const onEscape = (e) => {
      if (e.key === 'Escape') setHistoryModalOpen(false);
    };
    document.addEventListener('keydown', onEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.body.style.overflow = '';
    };
  }, [historyModalOpen]);

  const openHistory = () => setHistoryModalOpen(true);
  const closeHistory = () => setHistoryModalOpen(false);
  const selectChat = (chatId) => {
    onSelectChat(chatId);
    closeHistory();
  };

  const historyModal = historyModalOpen && createPortal(
    <div
      className="history-modal-backdrop"
      onClick={closeHistory}
      role="presentation"
    >
      <div
        className="history-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
      >
        <header className="history-modal__header">
          <h2 id="history-modal-title" className="history-modal__title">History</h2>
          <button
            type="button"
            className="history-modal__close"
            onClick={closeHistory}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="history-modal__body">
          {loading ? (
            <p className="history-modal__loading">Loading…</p>
          ) : sortedChats.length === 0 ? (
            <p className="history-modal__empty">No chats yet.</p>
          ) : (
            <div className="history-modal__groups">
              {[DATE_GROUP.TODAY, DATE_GROUP.YESTERDAY, DATE_GROUP.OLDER].map((label) => {
                const groupChats = chatsByDate[label];
                if (!groupChats.length) return null;
                const isExpanded = historyExpandedGroup === label;
                return (
                  <div
                    key={label}
                    className={`history-modal__group ${isExpanded ? 'history-modal__group--expanded' : 'history-modal__group--collapsed'}`}
                  >
                    <button
                      type="button"
                      className="history-modal__group-head"
                      onClick={() => setHistoryExpandedGroup(label)}
                      aria-expanded={isExpanded}
                      aria-controls={`history-modal-list-${label.toLowerCase()}`}
                      id={`history-modal-head-${label.toLowerCase()}`}
                    >
                      <span className="history-modal__group-title">{label}</span>
                      <svg
                        className="history-modal__group-chevron"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    <ul
                      id={`history-modal-list-${label.toLowerCase()}`}
                      className="history-modal__list"
                      aria-label={label}
                      role="region"
                      aria-labelledby={`history-modal-head-${label.toLowerCase()}`}
                    >
                      {groupChats.map((chat) => {
                        const ts = chat.last_updated || chat.created_at || '';
                        const preview = formatHistoryPreview(ts, label);
                        return (
                          <li key={chat.chat_id} className="history-modal__item">
                            <button
                              type="button"
                              className={`history-modal__chat ${currentChatId === chat.chat_id ? 'history-modal__chat--active' : ''}`}
                              onClick={() => selectChat(chat.chat_id)}
                              aria-current={currentChatId === chat.chat_id ? 'true' : undefined}
                            >
                              <span className="history-modal__chat-title">{chat.title}</span>
                              {preview && (
                                <span className="history-modal__chat-time" aria-hidden>
                                  {preview}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <aside className={`sidebar ${expanded ? 'sidebar--expanded' : ''}`} aria-label="Past chats">
        <div className="sidebar__top">
          <span className="sidebar__brand" aria-label="Akira">
            <span className="sidebar__brand-initial">A</span>
            <span className="sidebar__brand-text">Akira</span>
          </span>
          <button
            type="button"
            className="sidebar__new"
            onClick={onNewChat}
            aria-label="Start new chat"
          >
            <svg className="sidebar__new-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className="sidebar__history-strip"
            onClick={openHistory}
            aria-label="History"
          >
            <svg className="sidebar__history-strip-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="10" />
            </svg>
          </button>
          <button
            type="button"
            className="sidebar__settings-strip"
            onClick={() => onOpenSettings?.()}
            aria-label="Settings"
          >
            <svg className="sidebar__settings-strip-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        </div>
        {loading && <p className="sidebar__loading">Loading…</p>}
        <div className="sidebar__history-wrap">
          <button
            type="button"
            className="sidebar__history-toggle"
            onClick={openHistory}
            aria-label="Open chat history"
          >
            <span className="sidebar__history-toggle-inner">
              <svg className="sidebar__history-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span className="sidebar__history-title">History</span>
              <svg className="sidebar__history-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
          </button>
        </div>
        <div className="sidebar__footer" aria-hidden>
          <span className="sidebar__mood-emoji" aria-label="Current mood">{getCurrentThemeEmoji()}</span>
          {expanded && (
            <button
              type="button"
              className="sidebar__footer-settings"
              onClick={() => onOpenSettings?.()}
              aria-label="Settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
              <span className="sidebar__footer-settings-text">Settings</span>
            </button>
          )}
        </div>
      </aside>
      {historyModal}
    </>
  );
}
