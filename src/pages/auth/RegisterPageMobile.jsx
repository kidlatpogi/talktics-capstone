import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../context/useAuthContext';
import { isValidEmail, validatePassword } from '../../utils/validators';
import { ROUTES } from '../../utils/constants';
import { LazyMotion, domAnimation, m, AnimatePresence } from 'framer-motion';
import { getAssetUrl } from '../../utils/assetUtils';
import { TERMS_AND_CONDITIONS } from '../../constants/legal/terms';
import { PRIVACY_POLICY } from '../../constants/legal/privacy';
import './RegisterPageMobile.css';

// Lazy load UI components
const PushButton = lazy(() => import('../../components/common/PushButton'));
const PasswordToggle = lazy(() => import('../../components/common/PasswordToggle'));
const LegalModal = lazy(() => import('../../components/Legal/LegalModal'));

const bigkasLogo = getAssetUrl('Images/Bigkas-Logo.webp');

const INSIGHT_WORDS = [
  { text: 'Visual', size: '0.78rem', opacity: 0.45, top: '10%', left: '72%', delay: 0 },
  { text: 'Vocal', size: '0.75rem', opacity: 0.4, top: '65%', left: '78%', delay: 1 },
  { text: 'Verbal', size: '0.75rem', opacity: 0.4, top: '70%', left: '8%', delay: 0.5 },
  { text: 'Presence', size: '0.8rem', opacity: 0.5, top: '8%', left: '50%', delay: 1.2 },
];

function RegisterPageMobile({ managePageClass = true }) {
  const navigate = useNavigate();
  const { register, isLoading } = useAuthContext();

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [legalModal, setLegalModal] = useState({ isOpen: false, title: '', content: '' });

  useEffect(() => {
    if (managePageClass) {
      document.documentElement.classList.add('login-page-mobile-active');
      document.body.classList.add('login-page-mobile-active');
    }
    return () => {
      if (managePageClass) {
        document.documentElement.classList.remove('login-page-mobile-active');
        document.body.classList.remove('login-page-mobile-active');
      }
    };
  }, [managePageClass]);

  // SEO Metadata
  useEffect(() => {
    document.title = 'Create Account | TalkTics — Master Public Speaking';
    const metaDesc = document.querySelector('meta[name="description"]') || document.createElement('meta');
    metaDesc.name = 'description';
    metaDesc.content = 'Join TalkTics today and start your AI-powered journey to public speaking excellence. Analyze your voice, master your presence, and empower your communication.';
    if (!metaDesc.parentNode) document.head.appendChild(metaDesc);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'firstName' || name === 'lastName') {
      const regex = /^[A-Za-z\s-]*$/;
      if (!regex.test(value)) return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const passwordStrength = (() => {
    const p = formData.password;
    if (!p) return 0;
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return Math.min(score, 4);
  })();

  const strengthInfo = [
    { label: '', color: '' },
    { label: 'Weak', color: '#EF4444' },
    { label: 'Fair', color: '#F59E0B' },
    { label: 'Good', color: '#3B82F6' },
    { label: 'Strong', color: '#10B981' },
  ][passwordStrength];

  const validateForm = () => {
    const newErrors = {};
    if (!formData.firstName.trim()) newErrors.firstName = 'Required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Required';
    if (!formData.email) newErrors.email = 'Email required';
    else if (!isValidEmail(formData.email)) newErrors.email = 'Invalid email';
    
    const pwVal = validatePassword(formData.password);
    if (!pwVal.isValid) newErrors.password = pwVal.errors[0];
    if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Mismatch';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const mapSignupError = (message) => {
    if (!message) return 'Registration failed.';
    const normalized = message.toLowerCase();
    if (normalized.includes('already registered') || normalized.includes('already exists')) {
      return 'An account with this email already exists. Please log in instead.';
    }
    return message;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    if (!validateForm()) return;
    if (!consentChecked) {
      setErrors({ consent: 'Please agree to terms' });
      return;
    }

    try {
      const result = await register({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
      });

      if (result.success) {
        window.localStorage.setItem('bigkas_pending_verification_email', formData.email);
        navigate(ROUTES.VERIFY_EMAIL, {
          state: { email: formData.email },
          replace: true,
        });
      } else {
        setErrors({ submit: mapSignupError(result.error) || 'Registration failed' });
      }
    } catch {
      setErrors({ submit: 'An error occurred' });
    }
  };

  const showTerms = (e) => {
    e.preventDefault();
    setLegalModal({ isOpen: true, title: 'Terms & Conditions', content: TERMS_AND_CONDITIONS });
  };
  const showPrivacy = (e) => {
    e.preventDefault();
    setLegalModal({ isOpen: true, title: 'Privacy Policy', content: PRIVACY_POLICY });
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
  };

  return (
    <LazyMotion features={domAnimation}>
      <div className="auth-mobile-page">
        {/* 1. Background Visuals Layer */}
        <div className="auth-mobile-visual-bg">
          <div className="auth-mobile-header-accent" />
          <div className="auth-mobile-visual-content">
            <m.div className="auth-mobile-hero-text" initial="hidden" animate="visible" variants={itemVariants}>
              <h2>Master <span>Public Speaking</span></h2>
              <p>Create your account and start your AI-powered journey.</p>
            </m.div>
          </div>

          {INSIGHT_WORDS.map((word, i) => (
            <div 
              key={i}
              className="insight-chip-bg"
              style={{ 
                top: word.top, 
                left: word.left, 
                fontSize: word.size,
                opacity: word.opacity,
                animationDelay: `${word.delay}s`
              }}
            >
              {word.text}
            </div>
          ))}
        </div>

        {/* 2. Upper Left Brand Logo */}
        <div className="auth-brand-logo-mobile">
          <img 
            src={bigkasLogo} 
            alt="TalkTics Logo" 
            width="32" 
            height="32" 
            fetchPriority="high" 
            loading="eager"
          />
          <span>TalkTics</span>
        </div>

        {/* 3. Main Form Content */}
        <div className="auth-mobile-form-container">
          <div className="auth-mobile-form-card">
            <div className="auth-form-header-mobile">
              <h1>Create Account</h1>
              <p>Join TalkTics and empower your voice</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <AnimatePresence mode="wait">
                {errors.submit && (
                  <m.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="auth-status-banner-mobile is-error"
                  >
                    {errors.submit}
                  </m.div>
                )}
              </AnimatePresence>

              <div className="register-name-row-mobile">
                <div className="form-group-mobile">
                  <label>First Name</label>
                  <input
                    name="firstName"
                    id="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="Juan"
                    disabled={isLoading}
                    aria-label="First Name"
                  />
                  {errors.firstName && <span className="error-text-mobile">{errors.firstName}</span>}
                </div>
                <div className="form-group-mobile">
                  <label>Last Name</label>
                  <input
                    name="lastName"
                    id="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Dela Cruz"
                    disabled={isLoading}
                    aria-label="Last Name"
                  />
                  {errors.lastName && <span className="error-text-mobile">{errors.lastName}</span>}
                </div>
              </div>

              <div className="form-group-mobile">
                <label>Email Address</label>
                <input
                  type="email"
                  name="email"
                  id="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="name@gmail.com"
                  disabled={isLoading}
                  aria-label="Email Address"
                />
                {errors.email && <span className="error-text-mobile">{errors.email}</span>}
              </div>

              <div className="form-group-mobile">
                <label>Password</label>
                <div className="input-with-toggle-mobile">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                  <Suspense fallback={null}>
                    <PasswordToggle
                      isVisible={showPassword}
                      onToggle={() => setShowPassword(!showPassword)}
                    />
                  </Suspense>
                </div>
                {formData.password && (
                  <div className="register-pw-strength-mobile">
                    <div className="register-pw-strength-track-mobile">
                      <div 
                        className="register-pw-strength-fill-mobile" 
                        style={{ width: `${(passwordStrength / 4) * 100}%`, background: strengthInfo.color }} 
                      />
                    </div>
                    <span className="register-pw-strength-label-mobile" style={{ color: strengthInfo.color }}>
                      {strengthInfo.label}
                    </span>
                  </div>
                )}
                {errors.password && <span className="error-text-mobile">{errors.password}</span>}
              </div>

              <div className="form-group-mobile">
                <label>Confirm Password</label>
                <div className="input-with-toggle-mobile">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                  <Suspense fallback={null}>
                    <PasswordToggle
                      isVisible={showConfirm}
                      onToggle={() => setShowConfirm(!showConfirm)}
                    />
                  </Suspense>
                </div>
                {errors.confirmPassword && <span className="error-text-mobile">{errors.confirmPassword}</span>}
              </div>

              <div className="register-consent-group-mobile">
                <input 
                  type="checkbox" 
                  id="consent"
                  checked={consentChecked} 
                  onChange={(e) => setConsentChecked(e.target.checked)} 
                  aria-label="Agree to terms and conditions"
                />
                <span className="register-consent-text-mobile">
                  I agree to the <a href="#" onClick={showTerms}>Terms</a> and <a href="#" onClick={showPrivacy}>Privacy Policy</a>.
                </span>
              </div>
              {errors.consent && <span className="error-text-mobile">{errors.consent}</span>}

              <Suspense fallback={<div style={{ height: '56px' }} />}>
                <PushButton
                  type="submit"
                  disabled={isLoading || !consentChecked}
                  bgColor="#047857" /* High contrast emerald-700 */
                  shadowColor="#065f46"
                  className="mobile-register-btn"
                  aria-label="Create Account Button"
                >
                  {isLoading ? '...' : 'Create Account'}
                </PushButton>
              </Suspense>

              <div className="register-login-link-mobile">
                Already have an account? <Link to={ROUTES.LOGIN}>Login here</Link>
              </div>
            </form>
          </div>
        </div>

        <Suspense fallback={null}>
          <LegalModal
            isOpen={legalModal.isOpen}
            onClose={() => setLegalModal({ ...legalModal, isOpen: false })}
            title={legalModal.title}
            content={legalModal.content}
          />
        </Suspense>
      </div>
    </LazyMotion>
  );
}

export default RegisterPageMobile;
