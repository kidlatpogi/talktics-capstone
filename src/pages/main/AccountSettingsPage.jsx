import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IoChevronBack } from 'react-icons/io5';
import { useAuthContext } from '../../context/useAuthContext';
import { ROUTES } from '../../utils/constants';
import Button from '../../components/common/Button';
import './SettingsProfilePage.css';
import './SettingsProfilePageMobile.css';
import './AccountSettingsPage.css';

import { getSpriteUrl } from '../../utils/assetUtils';
import { getBigkasLevelFromUser } from '../../utils/activityProgress';
import { readStoredProfileTheme } from '../../utils/profileTheme';

const mascotSprite = getSpriteUrl('Robot/0002.webp');
const bronzeRank = getSpriteUrl('Rank/rank-bronze.webp');
const silverRank = getSpriteUrl('Rank/rank-silver.webp');
const goldRank = getSpriteUrl('Rank/rank-gold.webp');
const mythrilRank = getSpriteUrl('Rank/rank-mythril.webp');
const legendaryRank = getSpriteUrl('Rank/rank-legendary.webp');

const THEME_CONFIG = [
  { id: 'emerald', label: 'Default', requires: 0, decoration: null, className: 'emerald' },
  { id: 'mascot', label: 'B-01', requires: 0, decoration: mascotSprite, className: 'mascot' },
  { id: 'bronze', label: 'Bronze', requires: 1, decoration: bronzeRank, className: 'bronze' },
  { id: 'silver', label: 'Silver', requires: 2, decoration: silverRank, className: 'silver' },
  { id: 'gold', label: 'Gold', requires: 3, decoration: goldRank, className: 'gold' },
  { id: 'mythril', label: 'Mythril', requires: 4, decoration: mythrilRank, className: 'mythril' },
  { id: 'trophy', label: 'Legend', requires: 5, decoration: legendaryRank, className: 'trophy' },
];

function AccountSettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, deactivateAccount, deleteAccount } = useAuthContext();
  const fromParam = new URLSearchParams(location.search).get('from');
  const fromSource = String(location.state?.from || fromParam || '').toLowerCase();
  const breadcrumbParent = fromSource === 'profile'
    ? { label: 'Profile', to: ROUTES.PROFILE }
    : { label: 'Settings', to: ROUTES.SETTINGS };

  const userLevel = useMemo(() => getBigkasLevelFromUser(user), [user]);
  const heroTheme = useMemo(
    () => readStoredProfileTheme(user?.id, THEME_CONFIG, userLevel.levelNumber),
    [user?.id, userLevel.levelNumber],
  );

  const getThemeDecoration = (themeId) => {
    const config = THEME_CONFIG.find(t => t.id === themeId);
    return config?.decoration || null;
  };

  /* ── Delete modal state ── */
  const [showDeleteModal,   setShowDeleteModal]   = useState(false);
  const [confirmText,       setConfirmText]       = useState('');
  const [password,          setPassword]          = useState('');
  const [isDeleting,        setIsDeleting]        = useState(false);
  const [deleteError,       setDeleteError]       = useState('');

  /* ── Deactivate modal state ── */
  const [showDeactivateModal,  setShowDeactivateModal]  = useState(false);
  const [deactivatePassword,   setDeactivatePassword]   = useState('');
  const [isDeactivating,       setIsDeactivating]       = useState(false);
  const [deactivateError,      setDeactivateError]      = useState('');

  const handleDelete = async () => {
    if (confirmText !== 'CONFIRM DELETE') {
      setDeleteError('Please type CONFIRM DELETE to proceed.');
      return;
    }
    if (!password) {
      setDeleteError('Password is required.');
      return;
    }
    setDeleteError('');
    setIsDeleting(true);
    try {
      const result = await deleteAccount({ password });
      if (result?.success === false) {
        setDeleteError(result.error || 'Failed to delete account.');
        setIsDeleting(false);
        return;
      }
      setShowDeleteModal(false);
      navigate(ROUTES.LOGIN, { replace: true });
    } catch {
      setDeleteError('An unexpected error occurred.');
      setIsDeleting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivatePassword) {
      setDeactivateError('Please enter your password to confirm.');
      return;
    }
    setDeactivateError('');
    setIsDeactivating(true);
    try {
      const result = await deactivateAccount({ password: deactivatePassword });
      if (result?.success === false) {
        setDeactivateError(result.error || 'Failed to deactivate account.');
        setIsDeactivating(false);
        return;
      }
      // On success, close modal and redirect to login
      setShowDeactivateModal(false);
      navigate(ROUTES.LOGIN, { replace: true });
    } catch {
      setDeactivateError('An unexpected error occurred.');
      setIsDeactivating(false);
    }
  };

  return (
    <div className="settings-profile-page dashboard-page-new">
      <div className="settings-profile-container">
        <div className="test-av-mobile-nav">
          <button
            type="button"
            className="test-av-mobile-back"
            onClick={() => navigate(breadcrumbParent.to)}
            aria-label={`Back to ${breadcrumbParent.label}`}
          >
            <IoChevronBack aria-hidden />
            <span>{breadcrumbParent.label}</span>
          </button>
        </div>

        {/* Hero Banner */}
        <div className={`profile-hero-card hero-theme--${heroTheme}`}>
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

          <div className="hero-info" style={{ position: 'relative', zIndex: 2 }}>
            <h1 className="hero-name">Account Settings</h1>
            <p className="hero-email" style={{ opacity: 0.9 }}>
              Manage your account deactivation and permanent data removal options.
            </p>
          </div>
        </div>

        <div className="settings-content-wrapper">
          <div className="settings-main-card sp-preferences-card">
            <div className="settings-form">
              {/* Deactivate section */}
              <div className="settings-form-section">
                <h2 className="section-heading">Deactivate Account</h2>
                <p className="form-help-text" style={{ marginBottom: '18px', fontSize: '14.5px', lineHeight: '1.5' }}>
                  Permanently deactivate your account. Your active session will be revoked and access to your data will be removed.
                </p>
                <div className="security-actions">
                  <Button
                    variant="outline"
                    className="security-btn account-action-btn"
                    onClick={() => { setDeactivatePassword(''); setDeactivateError(''); setShowDeactivateModal(true); }}
                  >
                    Deactivate Account
                  </Button>
                </div>
              </div>

              <div className="settings-divider" />

              {/* Delete section */}
              <div className="settings-form-section">
                <h2 className="section-heading danger-heading">Delete Account</h2>
                <p className="form-help-text" style={{ marginBottom: '18px', fontSize: '14.5px', lineHeight: '1.5' }}>
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <div className="security-actions">
                  <Button
                    variant="danger"
                    className="security-btn account-action-btn"
                    onClick={() => { setPassword(''); setConfirmText(''); setDeleteError(''); setShowDeleteModal(true); }}
                  >
                    Delete Account
                  </Button>
                </div>
              </div>

              <div className="settings-divider" />

              <div className="settings-footer-actions">
                <Button
                  variant="secondary"
                  onClick={() => navigate(breadcrumbParent.to)}
                  style={{ minWidth: '120px' }}
                >
                  Back
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Deactivate confirmation modal ── */}
      {showDeactivateModal && (
        <div className="modal-overlay" onClick={() => { setShowDeactivateModal(false); setDeactivateError(''); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Deactivate Account</h2>
            
            <div className="modal-warning-banner">
              <span className="modal-warning-icon">⚠️</span>
              <p className="modal-warning-text">
                <strong>Permanent Data Removal Warning:</strong> Deactivating your account will permanently remove access to your account and personal data. Your active session will be immediately revoked, and you will not be able to log back in.
              </p>
            </div>

            <p className="modal-desc">
              To confirm deactivation, please enter your password below.
            </p>

            {deactivateError && <div className="page-error" style={{ marginBottom: 14 }}>{deactivateError}</div>}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                value={deactivatePassword}
                onChange={(e) => setDeactivatePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isDeactivating) {
                    handleDeactivate();
                  }
                }}
                placeholder="Your current password"
                autoFocus
              />
            </div>

            <div className="modal-btn-row">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => { setShowDeactivateModal(false); setDeactivateError(''); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleDeactivate}
                disabled={isDeactivating}
              >
                {isDeactivating ? 'Deactivating…' : 'Deactivate Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => { setShowDeleteModal(false); setDeleteError(''); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Delete Account</h2>
            <p className="modal-desc">
              This action is permanent and cannot be undone. Please enter your password and type{' '}
              <strong>CONFIRM DELETE</strong> to continue.
            </p>

            {deleteError && <div className="page-error" style={{ marginBottom: 14 }}>{deleteError}</div>}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your current password"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Type: CONFIRM DELETE</label>
              <input
                className="form-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="CONFIRM DELETE"
              />
            </div>

            <div className="modal-btn-row">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => { setShowDeleteModal(false); setDeleteError(''); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountSettingsPage;
