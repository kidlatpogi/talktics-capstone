import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IoPersonOutline, IoSettingsOutline, IoLogOutOutline } from 'react-icons/io5';
import { useAuthContext } from '../../context/useAuthContext';
import { ROUTES } from '../../utils/constants';
import { ensureProfileModalAvatarSrc, invalidateProfileModalAvatarCache } from '../../utils/profileModalAvatarCache';
import './ProfileModal.css';

export default function ProfileModal({ isOpen, onClose, onRequestLogout }) {
  const navigate = useNavigate();
  const { user, logout } = useAuthContext();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [resolvedAvatarSrc, setResolvedAvatarSrc] = useState(null);

  const displayName = user?.name || user?.nickname || user?.firstName || 'Speaker';
  const displayEmail = user?.email || '';
  const avatarUrl = user?.avatarUrl || user?.avatar_url || null;

  const userInitials = useMemo(() => {
    const first = user?.firstName || '';
    const last = user?.lastName || '';
    const pair = `${first.charAt(0)}${last.charAt(0)}`.trim().toUpperCase();
    if (pair) return pair;
    return displayName.charAt(0).toUpperCase() || '?';
  }, [user?.firstName, user?.lastName, displayName]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatarUrl]);

  useEffect(() => {
    if (!avatarUrl) {
      setResolvedAvatarSrc(null);
      return undefined;
    }
    let cancelled = false;
    ensureProfileModalAvatarSrc(avatarUrl).then((src) => {
      if (!cancelled) setResolvedAvatarSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  useEffect(() => {
    if (!isOpen && !showLogoutConfirm) {
      setShowLogoutConfirm(false);
    }
  }, [isOpen, showLogoutConfirm]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (isOpen || showLogoutConfirm) {
      document.body.classList.add('profile-modal-open');
    } else {
      document.body.classList.remove('profile-modal-open');
    }
    return () => document.body.classList.remove('profile-modal-open');
  }, [isOpen, showLogoutConfirm]);

  const handleLogoutClick = () => {
    if (onRequestLogout) {
      onRequestLogout();
      return;
    }
    onClose?.();
    setShowLogoutConfirm(true);
  };

  const handleCancelLogout = () => {
    setShowLogoutConfirm(false);
  };

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    onClose?.();
    logout();
  };

  const handleNavigateToProfile = () => {
    onClose?.();
    navigate(ROUTES.PROFILE);
  };

  const handleNavigateToSettings = () => {
    onClose?.();
    navigate(ROUTES.SETTINGS);
  };

  if (!isOpen && !showLogoutConfirm) return null;

  const modalContent = (
    <>
      {isOpen && (
        <>
          <div className="profile-modal-backdrop" role="presentation" onClick={onClose} />
          <div className="profile-modal-wrapper">
        <div className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
          {/* Header */}
          <div className="profile-modal-header">
            <h2 id="profile-modal-title" className="profile-modal-title">Settings</h2>
            <button
              type="button"
              className="dashboard-overlay-close-btn"
              onClick={onClose}
              aria-label="Close profile modal"
            >
              ×
            </button>
          </div>

          {/* User Info */}
          <div className="profile-modal-user-section">
            <div className="profile-modal-avatar">
              {avatarUrl && !avatarLoadFailed ? (
                resolvedAvatarSrc ? (
                  <img
                    src={resolvedAvatarSrc}
                    alt=""
                    className="profile-modal-avatar-img"
                    onError={() => {
                      invalidateProfileModalAvatarCache(avatarUrl);
                      setAvatarLoadFailed(true);
                      setResolvedAvatarSrc(null);
                    }}
                  />
                ) : (
                  <span className="profile-modal-avatar-loading" aria-hidden>
                    {userInitials}
                  </span>
                )
              ) : (
                userInitials
              )}
            </div>
            <div className="profile-modal-user-info">
              <p className="profile-modal-user-name">{displayName}</p>
              <p className="profile-modal-user-email">{displayEmail}</p>
            </div>
          </div>

          {/* Menu Items */}
          <nav className="profile-modal-menu">
            <button
              type="button"
              className="profile-modal-menu-item"
              onClick={handleNavigateToProfile}
            >
              <div className="profile-modal-menu-icon">
                <IoPersonOutline size={22} />
              </div>
              <span className="profile-modal-menu-text">Profile</span>
            </button>
            <button
              type="button"
              className="profile-modal-menu-item"
              onClick={handleNavigateToSettings}
            >
              <div className="profile-modal-menu-icon">
                <IoSettingsOutline size={22} />
              </div>
              <span className="profile-modal-menu-text">Preferences</span>
            </button>
            <button
              type="button"
              className="profile-modal-menu-item profile-modal-menu-item--logout"
              onClick={handleLogoutClick}
            >
              <div className="profile-modal-menu-icon" style={{ color: '#ef4444' }}>
                <IoLogOutOutline size={22} />
              </div>
              <span className="profile-modal-menu-text" style={{ color: '#ef4444' }}>Log Out</span>
            </button>
          </nav>
        </div>
      </div>
      </>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="profile-modal-confirm-backdrop"
          role="presentation"
          onClick={handleCancelLogout}
        >
          <div
            className="profile-modal-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-logout-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="profile-modal-logout-title" className="profile-modal-confirm-title">
              Log out?
            </h3>
            <p className="profile-modal-confirm-message">
              Are you sure you want to log out?
            </p>
            <div className="profile-modal-confirm-actions">
              <button
                type="button"
                className="profile-modal-confirm-btn profile-modal-confirm-btn--cancel"
                onClick={handleCancelLogout}
              >
                Cancel
              </button>
              <button
                type="button"
                className="profile-modal-confirm-btn profile-modal-confirm-btn--confirm"
                onClick={handleConfirmLogout}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
