import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IoChevronBack } from 'react-icons/io5';
import { useAuthContext } from '../../context/useAuthContext';
import { isValidEmail } from '../../utils/validators';
import { ROUTES } from '../../utils/constants';
import PasswordToggle from '../../components/common/PasswordToggle';
import { AnimatePresence, LazyMotion, domAnimation, motion as Motion } from 'framer-motion';
import PushButton from '../../components/common/PushButton';
import { getAssetUrl } from '../../utils/assetUtils';
import googleIcon from '../../assets/logos/google-icon.svg';
import LoginPageMobile from './LoginPageMobile';
import './LoginPage.css';

const bigkasLogo = getAssetUrl('Images/Bigkas-Logo.webp');

const LEGACY_LOGIN_LOCKOUT_UNTIL_KEY = 'bigkas_login_lockout_until';
const LOGIN_LOCKED_ACCOUNTS_KEY = 'bigkas_login_locked_accounts';
const LOGIN_FAILED_ATTEMPTS_KEY = 'bigkas_login_failed_attempts';
const LOGIN_LOCK_MIGRATION_KEY = 'bigkas_login_lock_schema_v2_applied';
const LOGIN_GUARD_PREFIX = 'bigkas_login_guard_v1';
const MAX_LOGIN_ATTEMPTS = 3;
const ACCOUNT_LOCKED_MESSAGE = 'Account locked after 3 failed login attempts. Please reset your password or contact support.';

const INSIGHT_WORDS = [
  { text: 'Visual', size: '1rem', opacity: 0.8, top: '15%', left: '12%', delay: 0 },
  { text: 'Vocal', size: '0.95rem', opacity: 0.7, top: '22%', left: '80%', delay: 1 },
  { text: 'Verbal', size: '0.9rem', opacity: 0.6, top: '68%', left: '8%', delay: 0.5 },
  { text: 'Gesture', size: '1.1rem', opacity: 0.9, top: '12%', left: '65%', delay: 2 },
  { text: 'Eye Contact', size: '1rem', opacity: 0.75, top: '55%', left: '82%', delay: 1.5 },
  { text: 'Jitter', size: '0.8rem', opacity: 0.5, top: '78%', left: '70%', delay: 3 },
  { text: 'Shimmer', size: '0.9rem', opacity: 0.65, top: '38%', left: '6%', delay: 2.5 },
  { text: 'Confidence', size: '1.15rem', opacity: 0.95, top: '50%', left: '10%', delay: 0 },
  { text: 'Clarity', size: '1rem', opacity: 0.8, top: '82%', left: '22%', delay: 4 },
  { text: 'Presence', size: '1.1rem', opacity: 0.85, top: '18%', left: '42%', delay: 1.2 },
  { text: 'Empower', size: '0.9rem', opacity: 0.6, top: '72%', left: '48%', delay: 2.2 },
  { text: 'Growth', size: '1.05rem', opacity: 0.8, top: '8%', left: '85%', delay: 0.8 },
  { text: 'Flow', size: '1rem', opacity: 0.7, top: '48%', left: '88%', delay: 3.5 },
  { text: 'Impact', size: '1.1rem', opacity: 0.9, top: '30%', left: '18%', delay: 4.5 },
  { text: 'Authentic', size: '0.95rem', opacity: 0.75, top: '62%', left: '60%', delay: 5 },
];

function normalizeLoginEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function readLoginStorageMap(key) {
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) return {};
    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch {
    return {};
  }
}

function writeLoginStorageMap(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getLoginGuardKey(email) {
  return `${LOGIN_GUARD_PREFIX}:user:${email}`;
}

function clearStoredLoginLock(email) {
  const normalizedEmail = normalizeLoginEmail(email);
  if (!normalizedEmail) return;

  const lockedAccounts = readLoginStorageMap(LOGIN_LOCKED_ACCOUNTS_KEY);
  const failedAttempts = readLoginStorageMap(LOGIN_FAILED_ATTEMPTS_KEY);
  delete lockedAccounts[normalizedEmail];
  delete failedAttempts[normalizedEmail];
  writeLoginStorageMap(LOGIN_LOCKED_ACCOUNTS_KEY, lockedAccounts);
  writeLoginStorageMap(LOGIN_FAILED_ATTEMPTS_KEY, failedAttempts);
  window.localStorage.removeItem(getLoginGuardKey(normalizedEmail));
  window.localStorage.removeItem(LEGACY_LOGIN_LOCKOUT_UNTIL_KEY);
}

function migrateLegacyLoginLocks() {
  if (window.localStorage.getItem(LOGIN_LOCK_MIGRATION_KEY)) return;
  window.localStorage.removeItem(LOGIN_LOCKED_ACCOUNTS_KEY);
  window.localStorage.removeItem(LOGIN_FAILED_ATTEMPTS_KEY);
  window.localStorage.removeItem(LEGACY_LOGIN_LOCKOUT_UNTIL_KEY);
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(`${LOGIN_GUARD_PREFIX}:user:`)) {
      window.localStorage.removeItem(key);
    }
  }
  window.localStorage.setItem(LOGIN_LOCK_MIGRATION_KEY, 'true');
}

function isCredentialFailure(code) {
  return [
    'invalid_credentials',
    'account_not_found',
    'unknown_auth_error',
  ].includes(String(code || '').toLowerCase());
}

function resolvePostLoginRoute(user) {
  if (user?.onboardingStage === 'profiling') return ROUTES.USER_PROFILING;
  if (user?.onboardingStage === 'pretest') return ROUTES.USER_PRETEST;
  if (user?.onboardingStage === 'analyzing') return ROUTES.USER_ANALYZING;
  return ROUTES.ACTIVITY;
}

/**
 * Login Page — 1:1 from Figma screenshot
 * Split layout: left branding panel + right form panel
 */
/**
 * Desktop-optimized version of the Login Page
 */
function LoginPageDesktop({ managePageClass = true }) {
  const layoutRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    login,
    loginWithGoogle,
    resendVerificationEmail,
    isLoading,
  } = useAuthContext();
  const passwordResetEmail = normalizeLoginEmail(location.state?.passwordResetEmail);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState({});
  const [resendLoading, setResendLoading] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [showAccountCreated, setShowAccountCreated] = useState(() => Boolean(location.state?.accountCreated));
  const [showAccountVerified, setShowAccountVerified] = useState(() => Boolean(location.state?.accountVerified));
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [lockedAccounts, setLockedAccounts] = useState(() => {
    migrateLegacyLoginLocks();
    clearStoredLoginLock(passwordResetEmail);
    return readLoginStorageMap(LOGIN_LOCKED_ACCOUNTS_KEY);
  });
  const [failedAttempts, setFailedAttempts] = useState(() => readLoginStorageMap(LOGIN_FAILED_ATTEMPTS_KEY));
  const [showPassword, setShowPassword] = useState(false);
  const [layoutMode, setLayoutMode] = useState('split');
  const normalizedEmail = normalizeLoginEmail(formData.email);
  const isAccountLocked = Boolean(normalizedEmail && lockedAccounts[normalizedEmail]);

  // Show the "Account created" banner from navigation state, auto-clear after 3s
  useEffect(() => {
    if (!showAccountCreated) return;
    const timer = setTimeout(() => setShowAccountCreated(false), 3000);
    window.history.replaceState({}, '');
    return () => clearTimeout(timer);
  }, [showAccountCreated]);

  // Show the "Email verified" success banner from VerifyEmailPage, auto-clear after 5s
  useEffect(() => {
    if (!showAccountVerified) return;
    const timer = setTimeout(() => setShowAccountVerified(false), 5000);
    window.history.replaceState({}, '');
    return () => clearTimeout(timer);
  }, [showAccountVerified]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  useEffect(() => {
    window.localStorage.removeItem(LEGACY_LOGIN_LOCKOUT_UNTIL_KEY);
  }, []);

  useEffect(() => {
    if (!passwordResetEmail) return;
    window.history.replaceState({}, '');
  }, [passwordResetEmail]);

  useEffect(() => {
    if (managePageClass) {
      document.documentElement.classList.add('login-page-v2-active');
      document.body.classList.add('login-page-v2-active');
    }
    return () => {
      if (managePageClass) {
        document.documentElement.classList.remove('login-page-v2-active');
        document.body.classList.remove('login-page-v2-active');
      }
    };
  }, [managePageClass]);

  // SEO Metadata
  useEffect(() => {
    document.title = 'Login | TalkTics — Master Public Speaking';
    const metaDesc = document.querySelector('meta[name="description"]') || document.createElement('meta');
    metaDesc.name = 'description';
    metaDesc.content = 'Log in to TalkTics and continue your AI-powered journey to public speaking excellence. Analyze your voice, master your presence, and empower your communication.';
    if (!metaDesc.parentNode) document.head.appendChild(metaDesc);
  }, []);

  useEffect(() => {
    if (!layoutRef.current || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect?.width || window.innerWidth;
      setLayoutMode(width < 960 ? 'stack' : 'split');
    });

    observer.observe(layoutRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!root) return undefined;

    const setKeyboardOffset = () => {
      if (layoutMode !== 'stack') {
        root.style.setProperty('--login-kb-offset', '0px');
        return;
      }

      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty('--login-kb-offset', '0px');
        return;
      }

      const keyboardOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--login-kb-offset', `${Math.round(keyboardOffset)}px`);
    };

    setKeyboardOffset();
    window.visualViewport?.addEventListener('resize', setKeyboardOffset);
    window.visualViewport?.addEventListener('scroll', setKeyboardOffset);
    window.addEventListener('resize', setKeyboardOffset);

    return () => {
      root.style.setProperty('--login-kb-offset', '0px');
      window.visualViewport?.removeEventListener('resize', setKeyboardOffset);
      window.visualViewport?.removeEventListener('scroll', setKeyboardOffset);
      window.removeEventListener('resize', setKeyboardOffset);
    };
  }, [layoutMode]);

  useEffect(() => {
    if (layoutMode !== 'stack') return undefined;

    const handleFocusIn = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches('input, textarea, select')) return;

      window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 120);
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [layoutMode]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (showAccountCreated) {
      setShowAccountCreated(false);
    }
    if (showAccountVerified) {
      setShowAccountVerified(false);
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
    if (name === 'email') {
      const nextEmail = normalizeLoginEmail(value);
      setErrors((prev) => ({
        ...prev,
        submit: nextEmail && lockedAccounts[nextEmail] ? ACCOUNT_LOCKED_MESSAGE : null,
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isAccountLocked) {
      setErrors({ submit: ACCOUNT_LOCKED_MESSAGE });
      return;
    }
    if (isLoading) return;
    if (!validateForm()) return;
    // Clear all banners when attempting to log in
    setShowUnverified(false);
    setShowAccountCreated(false);
    setShowAccountVerified(false);
    setResendSuccess(false);
    setErrors({});

    const result = await login(formData.email, formData.password);
    if (result.success) {
      if (normalizedEmail) {
        clearStoredLoginLock(normalizedEmail);
      }
      navigate(resolvePostLoginRoute(result.user), { replace: true });
    } else if (result.requiresEmailConfirmation) {
      if (normalizedEmail) {
        clearStoredLoginLock(normalizedEmail);
        setFailedAttempts(readLoginStorageMap(LOGIN_FAILED_ATTEMPTS_KEY));
      }
      // User account exists but email is not verified
      setShowUnverified(true);
      setFormData({ email: '', password: '' });
    } else if (result.code === 'account_locked') {
      const nextLockedAccounts = {
        ...lockedAccounts,
        [normalizedEmail]: { lockedAt: new Date().toISOString() },
      };
      setLockedAccounts(nextLockedAccounts);
      writeLoginStorageMap(LOGIN_LOCKED_ACCOUNTS_KEY, nextLockedAccounts);
      setErrors({ submit: ACCOUNT_LOCKED_MESSAGE });
      setFormData((prev) => ({ ...prev, password: '' }));
    } else {
      // Clear fields for invalid credentials or account not found
      const nextFailedCount = normalizedEmail ? Number(failedAttempts[normalizedEmail] || 0) + 1 : 0;
      if (!isCredentialFailure(result.code)) {
        setErrors({ submit: result.error });
      } else if (normalizedEmail && nextFailedCount >= MAX_LOGIN_ATTEMPTS) {
        const nextLockedAccounts = {
          ...lockedAccounts,
          [normalizedEmail]: { lockedAt: new Date().toISOString() },
        };
        const nextAttempts = { ...failedAttempts };
        delete nextAttempts[normalizedEmail];
        setLockedAccounts(nextLockedAccounts);
        setFailedAttempts(nextAttempts);
        writeLoginStorageMap(LOGIN_LOCKED_ACCOUNTS_KEY, nextLockedAccounts);
        writeLoginStorageMap(LOGIN_FAILED_ATTEMPTS_KEY, nextAttempts);
        setErrors({ submit: ACCOUNT_LOCKED_MESSAGE });
      } else {
        const nextAttempts = normalizedEmail
          ? { ...failedAttempts, [normalizedEmail]: nextFailedCount }
          : failedAttempts;
        setFailedAttempts(nextAttempts);
        writeLoginStorageMap(LOGIN_FAILED_ATTEMPTS_KEY, nextAttempts);
        setErrors({ submit: result.error });
      }
      setFormData((prev) => ({ ...prev, password: '' }));
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0) return;

    const email = (formData.email || '').trim();
    if (!email) {
      setErrors((prev) => ({
        ...prev,
        submit: 'Enter your email in the field above to resend verification.',
      }));
      return;
    }

    setResendLoading(true);
    const result = await resendVerificationEmail(email);
    setResendLoading(false);

    if (result.success) {
      setResendSuccess(true);
      setResendCooldown(60);
      setTimeout(() => setResendSuccess(false), 5000);
      return;
    }

    setErrors((prev) => ({
      ...prev,
      submit: result.error || 'Unable to resend verification email.',
    }));
  };

  const handleGoogleSignIn = async () => {
    const result = await loginWithGoogle();
    if (!result?.success) {
      setErrors((prev) => ({
        ...prev,
        submit: result?.error || 'Google sign-in failed. Please try again.',
      }));
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 14 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } }
  };

  return (
    <LazyMotion features={domAnimation}>
    <div
      ref={layoutRef}
      className="auth-page-v2"
      data-layout={layoutMode}
    >
      <div className="auth-container">
        <Motion.div
          className="auth-card"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Left Side: Branding & Visuals */}
          <div className="auth-visual-side">
            <Motion.div variants={itemVariants} className="auth-brand-logo">
              <img 
                src={bigkasLogo} 
                alt="TalkTics" 
                className="auth-logo-img" 
                width="48" 
                height="48" 
                loading="eager" 
              />
              <span>TalkTics</span>
            </Motion.div>
            
            <div className="auth-visual-content">
              <div className="auth-robot-img-wrap auth-robot-floating">
                <div className="auth-robot-glow" />
                <img 
                  src="https://assets.bigkas.site/Sprites/Robot/0001.webp" 
                  alt="AI Companion" 
                  className="auth-robot-img" 
                  fetchPriority="high"
                  loading="eager"
                  width="460"
                  height="460"
                />
              </div>

              {/* Floating Insight Cloud */}
              {INSIGHT_WORDS.map((word, i) => (
                <div 
                  key={i}
                  className="insight-chip insight-chip-floating"
                  style={{ 
                    top: word.top, 
                    left: word.left, 
                    fontSize: word.size,
                    opacity: word.opacity,
                    animationDelay: `${word.delay}s`,
                    animationDuration: `${6 + (i % 4)}s`
                  }}
                >
                  {word.text}
                </div>
              ))}
              <Motion.h2 variants={itemVariants} className="auth-hero-tagline">
                Master <span>Public Speaking</span>
              </Motion.h2>
              <Motion.p variants={itemVariants} className="auth-hero-desc">
                Your AI-powered journey to public speaking excellence starts here.
              </Motion.p>
            </div>
            
          </div>

          {/* Right Side: Login Form */}
          <div className="auth-form-side">
            <div className="auth-form-inner">
              <Motion.h1 variants={itemVariants} className="auth-form-headline">Welcome Back</Motion.h1>
              <Motion.p variants={itemVariants} className="auth-form-subline">Please enter your credentials to continue</Motion.p>

              <form className="auth-form" onSubmit={handleLogin}>
                <AnimatePresence mode="wait">
                  {(showAccountCreated || showAccountVerified || resendSuccess || errors.submit || showUnverified) && (
                    <Motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className={`auth-status-banner ${errors.submit ? 'is-error' : showUnverified ? 'is-warning' : 'is-success'}`}
                    >
                      <div className="banner-content">
                        {errors.submit || (showUnverified ? 'Please verify your email to continue.' : 'Success!')}
                        {showUnverified && (
                          <button 
                            type="button" 
                            className="resend-link" 
                            onClick={handleResendVerification} 
                            disabled={resendLoading || resendCooldown > 0}
                          >
                            {resendLoading ? '...' : resendCooldown > 0 ? `Resend (${resendCooldown}s)` : 'Resend Verification Email'}
                          </button>
                        )}
                      </div>
                    </Motion.div>
                  )}
                </AnimatePresence>

                <Motion.div variants={itemVariants} className="form-group-v2">
                  <label htmlFor="email">Email Address</label>
                  <div className="input-field-wrap">
                    <input
                      type="email"
                      id="email"
                      name="email"
                      className={errors.email ? 'is-invalid' : ''}
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="name@gmail.com"
                      disabled={isLoading}
                      autoComplete="username"
                    />
                  </div>
                  {errors.email && <span className="field-error">{errors.email}</span>}
                </Motion.div>

                <Motion.div variants={itemVariants} className="form-group-v2">
                  <label htmlFor="password">Password</label>
                  <div className="input-field-wrap">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        id="password"
                        name="password"
                        className={errors.password ? 'is-invalid' : ''}
                        value={formData.password}
                        onChange={handleChange}
                        placeholder="••••••••"
                        disabled={isLoading || isAccountLocked}
                        autoComplete="current-password"
                      />
                      <PasswordToggle isVisible={showPassword} onToggle={() => setShowPassword(!showPassword)} label="password" />
                    </div>
                    <div className="form-footer-row">
                      <Link
                        to={ROUTES.FORGOT_PASSWORD}
                        state={{ email: formData.email }}
                        className="forgot-pw-link"
                      >
                        Forgot Password?
                      </Link>
                    </div>
                    {errors.password && <span className="field-error">{errors.password}</span>}
                </Motion.div>

                <Motion.div variants={itemVariants} className="form-actions-v2">
                  <PushButton
                    type="button"
                    onClick={handleLogin}
                    disabled={isLoading || isAccountLocked}
                    bgColor="#047857"
                    shadowColor="#065f46"
                  >
                    {isLoading ? <span className="loading-spinner" /> : isAccountLocked ? 'ACCOUNT LOCKED' : 'LOGIN'}
                  </PushButton>
                </Motion.div>

                <Motion.div variants={itemVariants} className="divider-v2">
                  <span>OR</span>
                </Motion.div>

                <Motion.div variants={itemVariants}>
                  <button 
                    type="button" 
                    className="google-signin-btn-v2" 
                    onClick={handleGoogleSignIn} 
                    disabled={isLoading}
                    aria-label="Continue with Google"
                  >
                    <img src={googleIcon} alt="" width="20" height="20" loading="eager" />
                    Continue with Google
                  </button>
                </Motion.div>

                <Motion.div variants={itemVariants} className="signup-prompt-v2">
                  Don't have an account? <Link to={ROUTES.REGISTER}>Create one now</Link>
                </Motion.div>
              </form>
            </div>
          </div>
        </Motion.div>
      </div>
    </div>
    </LazyMotion>
  );
}


/**
 * Main Responsive Wrapper for Login Page
 * Switches between Desktop and Mobile/Tablet specialized versions
 */
function LoginPage() {
  const [isMobileOrTablet, setIsMobileOrTablet] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileOrTablet(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    isMobileOrTablet ? <LoginPageMobile /> : <LoginPageDesktop />
  );
}

export default LoginPage;
