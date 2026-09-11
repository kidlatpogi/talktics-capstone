import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../context/useAuthContext';
import { ROUTES } from '../../utils/constants';
import './InnerPages.css';
import './AccountSettingsPage.css';

function AccountSettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { deactivateAccount, deleteAccount } = useAuthContext();
  const fromParam = new URLSearchParams(location.search).get('from');
  const fromSource = String(location.state?.from || fromParam || '').toLowerCase();
  const breadcrumbParent = fromSource === 'profile'
    ? { label: 'Profile', to: ROUTES.PROFILE }
    : { label: 'Settings', to: ROUTES.SETTINGS };

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
      }
      // On success, AuthContext signs out → auto-redirect to login
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
    <div className="subpage-layout account-settings-layout">
      <div className="subpage-frame">
        <nav className="subpage-breadcrumb" aria-label="Breadcrumb">
          <Link className="subpage-breadcrumb-link" to={breadcrumbParent.to}>
            {breadcrumbParent.label}
          </Link>
          <span className="subpage-breadcrumb-sep">&gt;</span>
          <span className="subpage-breadcrumb-current">Account Settings</span>
        </nav>

        <div className="inner-page account-settings-page">
          <div className="inner-page-header account-settings-header">
            <h1 className="inner-page-title">Account Settings</h1>
          </div>

          {/* Deactivate section */}
          <div className="page-card account-section">
            <p className="account-section-title">Deactivate Account</p>
            <p className="account-section-desc">
              Permanently deactivate your account. Your active session will be revoked and access to your data will be removed.
            </p>
            <button className="btn-outline" onClick={() => { setDeactivatePassword(''); setDeactivateError(''); setShowDeactivateModal(true); }}>
              Deactivate Account
            </button>
          </div>

          {/* Delete section */}
          <div className="page-card account-section danger-zone">
            <p className="account-section-title danger">Delete Account</p>
            <p className="account-section-desc">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button className="btn-danger account-btn-primary" onClick={() => { setPassword(''); setConfirmText(''); setDeleteError(''); setShowDeleteModal(true); }}>
              Delete Account
            </button>
          </div>

          <div className="btn-row">
            <button className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </div>
      </div>

      {/* ── Deactivate confirmation modal ── */}
      {showDeactivateModal && (
        <div className="modal-overlay" onClick={() => { setShowDeactivateModal(false); setDeactivateError(''); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Deactivate Account</h2>
            
            <div className="modal-warning-banner" style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px'
            }}>
              <span style={{ fontSize: '18px', lineHeight: '1.2' }}>⚠️</span>
              <p style={{ margin: 0, fontSize: '13.5px', lineHeight: '1.45', color: '#b91c1c', fontWeight: 500 }}>
                <strong>Permanent Data Removal Warning:</strong> Deactivating your account will permanently remove access to your account and personal data. Your active session will be immediately revoked, and you will not be able to log back in.
              </p>
            </div>

            <p className="modal-desc">
              To confirm deactivation, please enter your password below.
            </p>

            {deactivateError && <div className="page-error" style={{ marginBottom: 12 }}>{deactivateError}</div>}

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

            <div className="btn-row">
              <button className="btn-secondary" onClick={() => { setShowDeactivateModal(false); setDeactivateError(''); }}>
                Cancel
              </button>
              <button className="btn-danger account-btn-primary" onClick={handleDeactivate} disabled={isDeactivating}>
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
              This is permanent. Please enter your password and type{' '}
              <strong>CONFIRM DELETE</strong> to continue.
            </p>

            {deleteError && <div className="page-error" style={{ marginBottom: 12 }}>{deleteError}</div>}

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

            <div className="btn-row">
              <button className="btn-secondary" onClick={() => { setShowDeleteModal(false); setDeleteError(''); }}>
                Cancel
              </button>
              <button className="btn-danger account-btn-primary" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountSettingsPage;
