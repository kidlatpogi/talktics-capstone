import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { buildRoute } from '../../utils/constants';
import { getSessionMode } from '../../utils/sessionFormatting';
import { sanitizeTranscriptForDisplay } from '../../utils/analysisTranscript';
import { getSpriteUrl } from '../../utils/assetUtils';
import { useNativeBottomSheetDrag } from '../../hooks/useNativeBottomSheetDrag';
import { buildStagePassResultForSession } from '../../utils/passingScore';

const verbalSprite = getSpriteUrl('common/Verbal.webp');
const visualSprite = getSpriteUrl('common/Visual.webp');
const vocalSprite = getSpriteUrl('common/Vocal.webp');
import DetailedFeedbackPageMobile from '../session/DetailedFeedbackPageMobile';
import './HistoryPage.css';
import './HistoryPageMobile.css';

const HISTORY_FILTERS = ['All', 'Daily', 'Weekly', 'Monthly', 'Yearly'];
const HISTORY_SCORE_SORT_OPTIONS = [5, 4, 3, 2, 1];
const HISTORY_SCORE_SORT_NONE = '';

function buildActivityLookup(activityTasks) {
  const lookup = new Map();
  if (!Array.isArray(activityTasks)) return lookup;
  activityTasks.forEach((activity) => {
    const id = String(activity?.id || '').trim();
    if (id) lookup.set(id, activity);
  });
  return lookup;
}

function mergeSessionActivity(session, activityLookup) {
  const activity = activityLookup.get(String(session?.activity_id || '').trim());
  if (!activity) return session;
  return {
    ...session,
    activity_title: session.activity_title || activity.title || activity.objective || null,
    activity_objective: session.activity_objective || activity.objective || null,
    activity_target_level: session.activity_target_level ?? activity.target_level ?? null,
    activity_order: session.activity_order ?? activity.activity_order ?? activity.activityOrder ?? null,
    passing_score: session.passing_score ?? activity.passing_score ?? activity.passingScore ?? null,
  };
}

function formatCompactStageRequirement(requiredText) {
  return String(requiredText || '').replace(/\s+Score\b/g, '').trim();
}

// --- Helpers (1:1 with HistoryPage) ---
function toFivePointScore(rawScore) {
  const numeric = Number(rawScore);
  if (!Number.isFinite(numeric)) return 1;
  if (numeric <= 5) return Math.round(Math.max(1, Math.min(5, numeric)) * 10) / 10;
  const normalized = Math.max(0, Math.min(100, numeric));
  return Math.round((1 + (normalized / 100) * 4) * 10) / 10;
}

function getScoreTier15(score) {
  if (score >= 3.0) return { label: 'Strong', color: '#10B981' };
  if (score >= 2.0) return { label: 'Developing', color: '#3B82F6' };
  return { label: 'Rising', color: '#F59E0B' };
}

function clamp15(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.min(5, numeric));
}

function score100to15(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return 1 + (Math.max(0, Math.min(100, numeric)) / 100) * 4;
}

function score15ToPercent(score15) {
  const clamped = Math.max(1, Math.min(5, Number(score15) || 1));
  return Math.round(((clamped - 1) / 4) * 100);
}

function resolveSessionPillars(session) {
  const visual = clamp15(session?.visual_avg) ?? score100to15(session?.visual_score) ?? 1;
  const verbal = clamp15(session?.verbal_avg) ?? score100to15(session?.context_score) ?? 1;
  const vocal = clamp15(session?.vocal_avg) ?? score100to15(session?.acoustic_score) ?? 1;
  return [
    { key: 'visual', label: 'Visual', sprite: visualSprite, score: visual, lackHint: 'eye contact & gestures' },
    { key: 'verbal', label: 'Verbal', sprite: verbalSprite, score: verbal, lackHint: 'wording & clarity' },
    { key: 'vocal', label: 'Vocal', sprite: vocalSprite, score: vocal, lackHint: 'pace & voice control' },
  ];
}

function buildLacksSummary(pillars) {
  const sorted = [...pillars].sort((a, b) => a.score - b.score);
  const weakest = sorted.filter((pillar) => pillar.score <= 2.5);
  const shortlist = (weakest.length ? weakest : sorted.slice(0, 1)).slice(0, 2);
  return `Focus: ${shortlist.map((pillar) => pillar.lackHint).join(' • ')}`;
}

function getScoreBandBounds(scoreTarget) {
  const target = Number(scoreTarget);
  if (!Number.isFinite(target)) return { min: 1, max: 1.9 };
  const clamped = Math.max(1, Math.min(5, target));
  if (clamped >= 5) return { min: 5, max: 5 };
  return { min: clamped, max: Math.min(5, clamped + 0.9) };
}

function sortSessionsByTargetScore(sessions, scoreTarget) {
  const target = Number(scoreTarget);
  if (!Number.isFinite(target)) return sessions;
  const { min, max } = getScoreBandBounds(scoreTarget);
  return [...sessions].sort((a, b) => {
    const scoreA = toFivePointScore(a?.confidence_score);
    const scoreB = toFivePointScore(b?.confidence_score);
    const inBandA = scoreA >= min && scoreA <= max;
    const inBandB = scoreB >= min && scoreB <= max;
    if (inBandA !== inBandB) return inBandA ? -1 : 1;
    const distanceA = Math.abs(scoreA - target);
    const distanceB = Math.abs(scoreB - target);
    if (distanceA !== distanceB) return distanceA - distanceB;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function buildSessionTitleOrTopic(session) {
  const candidates = [session?.activity_title, session?.script_title, session?.title, session?.topic, session?.target_text];
  const firstMatch = candidates.find((v) => typeof v === 'string' && v.trim());
  if (firstMatch) return firstMatch.trim();
  const transcript = sanitizeTranscriptForDisplay(session?.transcript, '');
  if (transcript) return transcript.length > 64 ? `${transcript.slice(0, 61)}...` : transcript;
  return 'Training Session';
}

function truncateToWords(text, maxWords = 5) {
  if (!text) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(' ')}...`;
}

function getAdaptiveHistoryPages(pageCount, activePage) {
  if (pageCount <= 6) return Array.from({ length: pageCount }, (_, idx) => idx);
  const leading = [0, 1, 2, 3].filter(i => i < pageCount - 1);
  const trailing = [pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1].filter(i => i > 0);
  if (activePage < Math.ceil(pageCount / 2)) return [...leading, 'end-ellipsis', pageCount - 1];
  return [0, 'start-ellipsis', ...trailing];
}

// --- Main Component ---
export default function HistoryPageMobile({ isOpen, onClose, userSessions = [], isLoading, activityTasks = [] }) {
  const navigate = useNavigate();
  const [historyFilter, setHistoryFilter] = useState('All');
  const [scoreSortTarget, setScoreSortTarget] = useState(HISTORY_SCORE_SORT_NONE);
  const [historyPage, setHistoryPage] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [innerViewMode, setInnerViewMode] = useState('results');
  const historyPageSize = 3; // Fixed for mobile

  useEffect(() => {
    if (selectedSessionId) setInnerViewMode('results');
  }, [selectedSessionId]);

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return userSessions.find((s) => String(s?.id || '') === String(selectedSessionId || '')) || null;
  }, [selectedSessionId, userSessions]);

  const dateFilteredSessions = useMemo(() => {
    const filtered = userSessions.filter((s) => {
      const d = new Date(s.created_at);
      if (historyFilter === 'Daily') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return d >= today;
      }
      if (historyFilter === 'Weekly') {
        const week = new Date();
        week.setDate(week.getDate() - 7);
        return d >= week;
      }
      if (historyFilter === 'Monthly') {
        const monthStart = new Date();
        monthStart.setMonth(monthStart.getMonth() - 1);
        return d >= monthStart;
      }
      if (historyFilter === 'Yearly') {
        const yearStart = new Date();
        yearStart.setFullYear(yearStart.getFullYear() - 1);
        return d >= yearStart;
      }
      if (historyFilter === 'All') return true;
      return true;
    });
    return filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [historyFilter, userSessions]);

  const historySessions = useMemo(() => {
    if (scoreSortTarget === HISTORY_SCORE_SORT_NONE) return dateFilteredSessions;
    const { min, max } = getScoreBandBounds(scoreSortTarget);
    const scoreBandMatches = dateFilteredSessions.filter((s) => {
      const score = toFivePointScore(s?.confidence_score);
      return score >= min && score <= max;
    });
    return sortSessionsByTargetScore(scoreBandMatches, scoreSortTarget);
  }, [dateFilteredSessions, scoreSortTarget]);

  const pageCount = Math.ceil(historySessions.length / historyPageSize);
  const safePage = Math.min(historyPage, Math.max(0, pageCount - 1));
  const paginatedSessions = useMemo(() => {
    const start = safePage * historyPageSize;
    return historySessions.slice(start, start + historyPageSize);
  }, [safePage, historySessions]);

  const adaptivePages = useMemo(() => getAdaptiveHistoryPages(pageCount, safePage), [pageCount, safePage]);
  const activityLookup = useMemo(() => buildActivityLookup(activityTasks), [activityTasks]);

  const handleClose = useCallback(() => {
    if (selectedSessionId) setSelectedSessionId(null);
    else onClose();
  }, [onClose, selectedSessionId]);

  const sheetDrag = useNativeBottomSheetDrag(isOpen && !selectedSessionId, handleClose);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

  if (!isOpen) return null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="profile-modal-backdrop"
        onClick={handleClose}
        style={{ zIndex: 2000 }}
        aria-hidden="true"
      />
      <div
        className={`history-mobile-sidebar history-visible native-bottom-sheet${sheetDrag.isDragging ? ' is-dragging' : ''} ${selectedSessionId ? 'history-viewing-session' : ''}`}
        style={{ ...sheetDrag.sheetStyle, zIndex: 2050 }}
      >
        <div className={`history-mobile-container ${selectedSessionId ? 'slide-out-left' : 'slide-in-right'}`}>
          
          <div className="history-mobile-header dashboard-anim-top">
            {!selectedSessionId && (
              <div className="native-bottom-sheet-grabber" aria-hidden="true" {...sheetDrag.dragHandleProps} />
            )}
            <div className="history-mobile-title-row">
              <h2 className="history-mobile-title">History</h2>
              <button type="button" className="dashboard-overlay-close-btn" onClick={onClose} aria-label="Close history">×</button>
            </div>
          </div>

          <div className="history-mobile-controls">
            <div className="history-mobile-filters no-scrollbar">
              {HISTORY_FILTERS.map((f) => (
                <button
                  key={f}
                  className={`history-mobile-filter-btn ${historyFilter === f ? 'active' : ''}`}
                  onClick={() => { setHistoryFilter(f); setHistoryPage(0); }}
                >
                  {f}
                </button>
              ))}
            </div>
            
            <div className="history-mobile-sort-row">
              <span className="history-mobile-sort-label">Target Score</span>
              <select
                className="history-mobile-sort-select"
                value={scoreSortTarget}
                onChange={(e) => { setScoreSortTarget(e.target.value); setHistoryPage(0); }}
              >
                <option value={HISTORY_SCORE_SORT_NONE}>All Scores</option>
                {HISTORY_SCORE_SORT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt.toFixed(1)}>{opt.toFixed(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="history-mobile-scroll-content">
            <div className="history-mobile-list">
              {paginatedSessions.map((s) => {
                const sessionForStage = mergeSessionActivity(s, activityLookup);
                const score = toFivePointScore(s.confidence_score);
                const tier = getScoreTier15(score);
                const pillars = resolveSessionPillars(s);
                const stageGoal = buildStagePassResultForSession(sessionForStage);
                const stageGoalColor = stageGoal?.passed ? '#059669' : '#2563EB';
                const stageRequirement = formatCompactStageRequirement(stageGoal?.requiredText);
                const dateObj = new Date(s.created_at);
                const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                
                return (
                  <div
                    key={s.id}
                    className="history-mobile-item dashboard-anim-bottom"
                    onClick={() => setSelectedSessionId(s.id)}
                    style={{
                      '--tier-color': tier.color,
                      '--tier-border': `${tier.color}2e`,
                      '--stage-goal-color': stageGoalColor,
                      '--stage-goal-bg': `${stageGoalColor}12`,
                      '--stage-goal-border': `${stageGoalColor}36`,
                    }}
                  >
                    <div className="history-mobile-item-top">
                      <div className="history-mobile-item-info">
                        <h3 className="history-mobile-item-title">{truncateToWords(buildSessionTitleOrTopic(sessionForStage))}</h3>
                        <div className="history-mobile-item-meta">
                          <span className="history-mobile-item-badge" style={{ borderColor: tier.color, backgroundColor: `${tier.color}15`, color: tier.color }}>
                            <span className="history-mobile-item-badge-dot" style={{ backgroundColor: tier.color }} />
                            {tier.label}
                          </span>
                          <p className="history-mobile-item-date">{formattedDate}</p>
                        </div>
                      </div>
                      <div className="history-mobile-item-score-ring" style={{ background: `conic-gradient(${tier.color} ${(score/5)*100}%, #f1f5f9 0)` }}>
                        <div className="history-mobile-item-score-inner">{Math.round(score15ToPercent(score))}%</div>
                      </div>
                    </div>

                    {stageGoal ? (
                      <div className={`history-mobile-stage-goal ${stageGoal.passed ? 'history-mobile-stage-goal--unlocked' : 'history-mobile-stage-goal--next'}`}>
                        <span className="history-mobile-stage-goal-label">
                          {stageGoal.passed ? 'Unlocked' : 'Next goal'}
                        </span>
                        {stageRequirement ? (
                          <span className="history-mobile-stage-goal-text">{stageRequirement}</span>
                        ) : null}
                      </div>
                    ) : null}
                    
                    <div className="history-mobile-pillar-grid">
                      {pillars.map(p => (
                        <div 
                          key={p.key} 
                          className={`history-mobile-pillar-chip ${p.score <= 2.0 ? 'history-mobile-pillar-chip--rising' : p.score <= 3.0 ? 'history-mobile-pillar-chip--developing' : 'history-mobile-pillar-chip--strong'}`}
                        >
                          <img src={p.sprite} alt="" className="history-mobile-pillar-icon" />
                          <span className="history-mobile-pillar-label">{p.label}</span>
                          <span className="history-mobile-pillar-score">{Math.round(score15ToPercent(p.score))}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              
              {isLoading && <p style={{ textAlign: 'center', color: '#888', padding: '20px' }}>Loading...</p>}
              {!isLoading && historySessions.length === 0 && <p style={{ textAlign: 'center', color: '#888', padding: '20px' }}>No sessions found.</p>}
            </div>

            {pageCount > 1 && (
              <div className="history-mobile-pagination-container">
                <ul className="history-pagination">
                  <li className={`history-pagination-page ${safePage <= 0 ? 'disabled' : ''}`}>
                    <button className="history-pagination-link" onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={safePage <= 0}><IoChevronBack /></button>
                  </li>
                  {adaptivePages.map((p, i) => (
                    <li key={i} className={`history-pagination-page ${p === safePage ? 'active' : ''} ${typeof p !== 'number' ? 'history-pagination-break' : ''}`}>
                      {typeof p === 'number' ? (
                        <button className="history-pagination-link" onClick={() => setHistoryPage(p)}>{p + 1}</button>
                      ) : '...'}
                    </li>
                  ))}
                  <li className={`history-pagination-page ${safePage >= pageCount - 1 ? 'disabled' : ''}`}>
                    <button className="history-pagination-link" onClick={() => setHistoryPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}><IoChevronForward /></button>
                  </li>
                </ul>
              </div>
            )}

            <div className="history-mobile-footer">
              <button className="history-mobile-back-btn" onClick={onClose}>Close History</button>
            </div>
          </div>
        </div>

        {selectedSessionId && (
          <div className="history-mobile-session-view slide-in-right">
             <div className="history-mobile-session-view-header">
                <button type="button" className="history-mobile-back-to-list-btn" onClick={() => { if (innerViewMode === 'detailed') setInnerViewMode('results'); else setSelectedSessionId(null); }}>
                   <IoChevronBack /> {innerViewMode === 'detailed' ? 'Back to Results' : 'Back to History'}
                </button>
             </div>
             <div className="history-mobile-session-view-content">
                <DetailedFeedbackPageMobile
                  sessionIdProp={selectedSessionId} 
                  sessionProp={selectedSession}
                  isInnerView={true} 
                  initialShowDetailed={innerViewMode === 'detailed'}
                  activityTasks={activityTasks}
                  onCloseInner={() => {
                    if (innerViewMode === 'detailed') {
                      setInnerViewMode('results');
                    } else {
                      setSelectedSessionId(null);
                    }
                  }}
                  onViewDetailed={() => setInnerViewMode('detailed')}
                />
             </div>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
