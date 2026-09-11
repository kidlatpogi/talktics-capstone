import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  IoChevronForward, 
  IoLockClosedOutline,
  IoShieldCheckmarkOutline,
  IoPersonCircleOutline,
  IoLogOutOutline,
  IoAlertCircleOutline,
  IoVideocamOutline,
  IoColorPalette,
  IoVolumeMuteOutline,
  IoVolumeHighOutline,
  IoStatsChartOutline,
  IoBookOutline,
  IoMedalOutline
} from 'react-icons/io5';
import { useAuthContext } from '../../context/useAuthContext';
import { ROUTES } from '../../utils/constants';
import { TERMS_AND_CONDITIONS } from '../../constants/legal/terms';
import { PRIVACY_POLICY } from '../../constants/legal/privacy';
import { useNativeBottomSheetDrag } from '../../hooks/useNativeBottomSheetDrag';
import './SettingsProfilePageMobile.css';
import './SettingsPageMobile.css';
import { getSpriteUrl } from '../../utils/assetUtils';
import { getBigkasLevelFromUser } from '../../utils/activityProgress';
import { readStoredProfileTheme } from '../../utils/profileTheme';
import ConfirmationModal from '../../components/common/ConfirmationModal';
import { fetchUserAchievements, claimAllAchievementsInDB, unclaimAllAchievementsInDB } from '../../services/achievementsService';
import { syncUnlockedBadgeIds } from '../../utils/achievementNavBadge';

const mascotSprite = getSpriteUrl('Robot/0001.webp');

const THEME_CONFIG = [
  { id: 'emerald', label: 'Default', requires: 0, decoration: null, className: 'emerald' },
  { id: 'mascot', label: 'B-01', requires: 0, decoration: getSpriteUrl('Robot/0001.webp'), className: 'mascot' },
  { id: 'bronze', label: 'Bronze', requires: 1, decoration: getSpriteUrl('Rank/rank-bronze.webp'), className: 'bronze' },
  { id: 'silver', label: 'Silver', requires: 2, decoration: getSpriteUrl('Rank/rank-silver.webp'), className: 'silver' },
  { id: 'gold', label: 'Gold', requires: 3, decoration: getSpriteUrl('Rank/rank-gold.webp'), className: 'gold' },
  { id: 'mythril', label: 'Mythril', requires: 4, decoration: getSpriteUrl('Rank/rank-mythril.webp'), className: 'mythril' },
  { id: 'trophy', label: 'Legend', requires: 5, decoration: getSpriteUrl('Rank/rank-legendary.webp'), className: 'trophy' },
];

const MIC_SENSITIVITY_KEY = 'pref_mic_sensitivity';
const AUTO_NEXT_KEY = 'pref_auto_next';

function SettingsLegalSheet({ isOpen, title, content, onClose }) {
  const sheetDrag = useNativeBottomSheetDrag(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return undefined;
    document.body.classList.add('settings-mobile-sheet-open');
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('settings-mobile-sheet-open');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-mobile-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-mobile-sheet-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className={`settings-mobile-sheet native-bottom-sheet${sheetDrag.isDragging ? ' is-dragging' : ''}`}
        style={sheetDrag.sheetStyle}
      >
        <div className="settings-mobile-sheet-grabber native-bottom-sheet-grabber" aria-hidden="true" {...sheetDrag.dragHandleProps} />
        <div className="settings-mobile-sheet-header">
          <h2 id="settings-mobile-sheet-title" className="settings-mobile-sheet-title">{title}</h2>
          <button type="button" className="dashboard-overlay-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="settings-mobile-sheet-content">
          {content}
        </div>
        <div className="settings-mobile-sheet-footer">
          <button type="button" className="settings-mobile-sheet-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPageMobile() {
  const navigate = useNavigate();
  const { user, updateProfile, updateUserMetadata, uploadAvatar, logout } = useAuthContext();
  
  const [micSensitivity, setMicSensitivity] = useState(() => {
    return localStorage.getItem(MIC_SENSITIVITY_KEY) || '80';
  });
  const [voicePreference, setVoicePreference] = useState(() => {
    return localStorage.getItem('bigkas_b01_voice') || 'voice1';
  });
  const [autoNext, setAutoNext] = useState(() => {
    return localStorage.getItem(AUTO_NEXT_KEY) === 'true';
  });

  const [legalModal, setLegalModal] = useState({ isOpen: false, type: '', title: '', content: '' });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const userLevel = useMemo(() => getBigkasLevelFromUser(user), [user]);
  const heroTheme = useMemo(
    () => readStoredProfileTheme(user?.id, THEME_CONFIG, userLevel.levelNumber),
    [user?.id, userLevel.levelNumber],
  );

  const getThemeDecoration = (themeId) => {
    const config = THEME_CONFIG.find(t => t.id === themeId);
    return config?.decoration || null;
  };

  useEffect(() => {
    localStorage.setItem(MIC_SENSITIVITY_KEY, micSensitivity);
  }, [micSensitivity]);

  useEffect(() => {
    localStorage.setItem(AUTO_NEXT_KEY, autoNext.toString());
  }, [autoNext]);

  const previewAudioRef = React.useRef(null);

  const playVoiceSample = (voiceId) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    const sampleUrl = voiceId === 'voice2'
      ? 'https://assets.bigkas.site/Voices/Voice%202%20-%20Sample.mp3'
      : 'https://assets.bigkas.site/Voices/Voice%201%20-%20Sample.mp3';
    
    const audio = new Audio(sampleUrl);
    previewAudioRef.current = audio;
    audio.play().catch(err => console.log('Audio playback failed:', err));
  };

  useEffect(() => {
    localStorage.setItem('bigkas_b01_voice', voicePreference);
  }, [voicePreference]);

  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
    };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      navigate(ROUTES.LOGIN);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleToggleMute = async () => {
    const nextMute = !user?.isAudioMuted;
    // Update locally and in DB
    await updateUserMetadata({ is_audio_muted: nextMute });
    localStorage.setItem('bigkas_global_audio_muted_v1', nextMute ? '1' : '0');
  };

  const openLegal = (type) => {
    if (type === 'terms') {
      setLegalModal({
        isOpen: true,
        type: 'terms',
        title: 'Terms of Service',
        content: TERMS_AND_CONDITIONS
      });
    } else {
      setLegalModal({
        isOpen: true,
        type: 'privacy',
        title: 'Privacy Policy',
        content: PRIVACY_POLICY
      });
    }
  };

  const [developerAction, setDeveloperAction] = useState('');
  const [developerStatus, setDeveloperStatus] = useState('');

  const hasDeveloperPowers = useMemo(() => {
    if (!user) return false;
    const email = String(user.email || '').toLowerCase();
    const role = String(user.role || '').toLowerCase();
    const appRole = String(user.app_metadata?.role || '').toLowerCase();
    return (
      role === 'admin' ||
      appRole === 'admin' ||
      Boolean(user.is_developer) ||
      email.endsWith('@bigkas.site') ||
      email === 'zeushack000@gmail.com'
    );
  }, [user]);

  const DEVELOPER_PREVIEW_SESSION_KEY = 'bigkas_developer_onboarding_preview_v1';

  const handleReplayProfilingPreview = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DEVELOPER_PREVIEW_SESSION_KEY, '1');
      window.sessionStorage.removeItem('bigkas_pretest_tutorial_seen');
      window.localStorage.removeItem('bigkas_current_training_session');
    }
    setDeveloperStatus('Preview mode: full onboarding will not save data.');
    navigate(ROUTES.USER_PROFILING, {
      state: {
        developerPreview: true,
        t: Date.now(),
      },
    });
  };

  const handleReplayPretestPreview = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DEVELOPER_PREVIEW_SESSION_KEY, '1');
      window.sessionStorage.removeItem('bigkas_pretest_tutorial_seen');
      window.localStorage.removeItem('bigkas_current_training_session');
    }
    setDeveloperStatus('Preview mode: pre-testing will not save data.');
    navigate(ROUTES.USER_PRETEST, {
      state: {
        developerPreview: true,
        t: Date.now(),
      },
    });
  };

  const handleReplayFrameworksTutorial = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bigkas_free_speech_tutorial_seen_v1', '0');
    }
    setDeveloperStatus('Replaying the tutorial walkthrough.');
    navigate(ROUTES.ACTIVITY, {
      state: {
        skywardEntrance: true,
        launchFreeSpeechTutorial: true,
        skipTutorialIntro: true,
        t: Date.now(),
      },
    });
  };

  const handleClaimAchievementsForDev = async () => {
    if (!user?.id || developerAction) return;
    setDeveloperAction('claim');
    setDeveloperStatus('');
    try {
      const rows = await claimAllAchievementsInDB(user.id);
      const refreshed = await fetchUserAchievements(user.id, user);
      syncUnlockedBadgeIds([], refreshed.filter((a) => a.claimed).map((a) => a.id));
      setDeveloperStatus(`Claimed ${rows.length} achievements for this account.`);
    } catch (err) {
      setDeveloperStatus(err?.message || 'Failed to claim achievements.');
    } finally {
      setDeveloperAction('');
    }
  };

  const handleUnclaimAchievementsForDev = async () => {
    if (!user?.id || developerAction) return;
    setDeveloperAction('unclaim');
    setDeveloperStatus('');
    try {
      const rows = await unclaimAllAchievementsInDB(user.id);
      syncUnlockedBadgeIds([], []);
      setDeveloperStatus(`Unclaimed ${rows.length} achievements for this account.`);
    } catch (err) {
      setDeveloperStatus(err?.message || 'Failed to unclaim achievements.');
    } finally {
      setDeveloperAction('');
    }
  };

  const closeLegal = useCallback(() => {
    setLegalModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const userInitials = useMemo(() => {
    if (!user) return '?';
    const first = user.firstName || '';
    const last = user.lastName || '';
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?';
  }, [user]);

  return (
    <div className="settings-profile-page settings-profile-page--preferences dashboard-page-new">
      <div className="settings-profile-container">
        <div className={`profile-hero-card profile-hero-card--preferences hero-theme--${heroTheme}`}>
          <div className="hero-decoration">
            {heroTheme === 'mascot' ? (
              <img src={mascotSprite} alt="" className="decoration-img decoration-mascot" />
            ) : (
              getThemeDecoration(heroTheme) && (
                <img 
                  src={getThemeDecoration(heroTheme)} 
                  alt="" 
                  className={`decoration-img ${heroTheme === 'trophy' ? 'decoration-trophy' : 'decoration-rank'}`} 
                />
              )
            )}
          </div>

          <div className="hero-info hero-info--preferences">
            <h1 className="hero-name">Preferences</h1>
            <p className="hero-email">Customize your experience and manage your account.</p>
          </div>
        </div>

        <div className="settings-content-wrapper">
          <div className="settings-main-card sp-preferences-card">
            
            {/* Account Section */}
            <div className="settings-form-section">
              <h2 className="section-heading">Account</h2>
              <div className="sp-list-group">
                <button className="sp-list-item" onClick={() => navigate(ROUTES.PROFILE)}>
                  <div className="sp-list-icon">
                    <IoPersonCircleOutline />
                  </div>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Profile Information</span>
                    <span className="sp-list-hint">Name, email, and avatar</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>

                <button className="sp-list-item" onClick={() => navigate(ROUTES.CHANGE_PASSWORD)}>
                  <div className="sp-list-icon">
                    <IoLockClosedOutline />
                  </div>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Password & Security</span>
                    <span className="sp-list-hint">Update your login credentials</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>

                <button className="sp-list-item" onClick={() => navigate(ROUTES.ACCOUNT_SETTINGS)}>
                  <div className="sp-list-icon">
                    <IoShieldCheckmarkOutline />
                  </div>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Account Management</span>
                    <span className="sp-list-hint">Deactivate or delete your account</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>
              </div>
            </div>

            <div className="settings-divider" />

            {/* App Settings */}
            <div className="settings-form-section">
              <h2 className="section-heading">App Settings</h2>
              <div className="sp-list-group">
                <div className="sp-list-item sp-list-item--interactive">
                  <div className="sp-list-icon">
                    <IoAlertCircleOutline />
                  </div>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Microphone Sensitivity</span>
                    <span className="sp-list-hint">Current: {micSensitivity}%</span>
                    <div className="sp-select-wrapper">
                      <select 
                        className="sp-select"
                        value={micSensitivity}
                        onChange={(e) => setMicSensitivity(e.target.value)}
                      >
                        <option value="100">High (100%) - Quiet rooms</option>
                        <option value="80">Normal (80%) - Default</option>
                        <option value="50">Low (50%) - Noisy environments</option>
                      </select>
                      <IoChevronForward className="sp-select-icon" />
                    </div>
                  </div>
                </div>

                <div className="sp-list-item sp-list-item--interactive">
                  <div className="sp-list-icon">
                    <IoVolumeHighOutline />
                  </div>
                  <div className="sp-list-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span className="sp-list-label">Voice Preference</span>
                        <span className="sp-list-hint">Choose assistant voice character</span>
                      </div>
                      <button 
                        type="button" 
                        className="sp-listen-btn"
                        onClick={() => playVoiceSample(voicePreference)}
                        style={{
                          background: 'rgba(16, 185, 129, 0.1)',
                          border: 'none',
                          color: '#10B981',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s',
                          height: 'fit-content'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; }}
                      >
                        <IoVolumeHighOutline size={14} /> Listen
                      </button>
                    </div>
                    <div className="sp-select-wrapper">
                      <select 
                        className="sp-select"
                        value={voicePreference}
                        onChange={(e) => {
                          const val = e.target.value;
                          setVoicePreference(val);
                          playVoiceSample(val);
                        }}
                      >
                        <option value="voice1">Voice 1</option>
                        <option value="voice2">Voice 2</option>
                      </select>
                      <IoChevronForward className="sp-select-icon" />
                    </div>
                  </div>
                </div>

                <button className="sp-list-item" onClick={() => navigate(ROUTES.AUDIO_TEST)}>
                  <div className="sp-list-icon">
                    <IoVideocamOutline />
                  </div>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Test Audio/ Video</span>
                    <span className="sp-list-hint">Verify your camera and microphone setup</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>

              </div>
            </div>

            <div className="settings-divider" />

            {/* Legal & About */}
            <div className="settings-form-section">
              <h2 className="section-heading">About</h2>
              <div className="sp-list-group">
                <button className="sp-list-item" onClick={() => openLegal('terms')}>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Terms of Service</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>
                
                <button className="sp-list-item" onClick={() => openLegal('privacy')}>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Privacy Policy</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>



              </div>
            </div>

            {/* Developer Controls */}
            {hasDeveloperPowers && (
              <>
                <div className="settings-divider" />
                <div className="settings-form-section">
                  <h2 className="section-heading" style={{ color: '#dc2626' }}>Developer Powers</h2>
                  <div className="sp-list-group">
                    <button type="button" className="sp-list-item" onClick={handleReplayProfilingPreview}>
                      <div className="sp-list-icon"><IoStatsChartOutline /></div>
                      <div className="sp-list-content">
                        <span className="sp-list-label">Preview Onboarding</span>
                      </div>
                      <IoChevronForward className="sp-list-chevron" />
                    </button>
                    <button type="button" className="sp-list-item" onClick={handleReplayPretestPreview}>
                      <div className="sp-list-icon"><IoStatsChartOutline /></div>
                      <div className="sp-list-content">
                        <span className="sp-list-label">Replay Pre-Testing</span>
                      </div>
                      <IoChevronForward className="sp-list-chevron" />
                    </button>
                    <button type="button" className="sp-list-item" onClick={handleReplayFrameworksTutorial}>
                      <div className="sp-list-icon"><IoBookOutline /></div>
                      <div className="sp-list-content">
                        <span className="sp-list-label">Replay Tutorial</span>
                      </div>
                      <IoChevronForward className="sp-list-chevron" />
                    </button>
                    <button type="button" className="sp-list-item" onClick={handleClaimAchievementsForDev} disabled={developerAction !== ''}>
                      <div className="sp-list-icon"><IoMedalOutline /></div>
                      <div className="sp-list-content">
                        <span className="sp-list-label">{developerAction === 'claim' ? 'Claiming...' : 'Claim Achievements'}</span>
                      </div>
                      <IoChevronForward className="sp-list-chevron" />
                    </button>
                    <button type="button" className="sp-list-item sp-list-item--danger" onClick={handleUnclaimAchievementsForDev} disabled={developerAction !== ''}>
                      <div className="sp-list-icon"><IoMedalOutline /></div>
                      <div className="sp-list-content">
                        <span className="sp-list-label">{developerAction === 'unclaim' ? 'Unclaiming...' : 'Unclaim Achievements'}</span>
                      </div>
                      <IoChevronForward className="sp-list-chevron" />
                    </button>
                  </div>
                  {developerStatus ? <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '6px', textAlign: 'center' }}>{developerStatus}</p> : null}
                </div>
              </>
            )}

            {/* Danger Zone */}
            <div className="settings-form-section" style={{ marginTop: '24px' }}>
              <div className="sp-list-group">
                <button 
                  type="button" 
                  className="sp-list-item sp-list-item--danger" 
                  onClick={() => setShowLogoutConfirm(true)}
                >
                  <div className="sp-list-icon">
                    <IoLogOutOutline />
                  </div>
                  <div className="sp-list-content">
                    <span className="sp-list-label">Log Out</span>
                    <span className="sp-list-hint">Sign out of your TalkTics account</span>
                  </div>
                  <IoChevronForward className="sp-list-chevron" />
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      <SettingsLegalSheet
        isOpen={legalModal.isOpen}
        onClose={closeLegal}
        title={legalModal.title}
        content={legalModal.content}
      />

      <ConfirmationModal
        isOpen={showLogoutConfirm}
        title="Log Out"
        message="Are you sure you want to log out of TalkTics?"
        confirmLabel="Log Out"
        cancelLabel="Cancel"
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        variant="danger"
      />
    </div>
  );
}

export default SettingsPageMobile;
