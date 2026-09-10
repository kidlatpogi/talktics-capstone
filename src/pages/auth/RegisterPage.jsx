import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../context/useAuthContext';
import { isValidEmail, validatePassword } from '../../utils/validators';
import { ROUTES } from '../../utils/constants';
import { LazyMotion, domAnimation, m, AnimatePresence } from 'framer-motion';
import PasswordToggle from '../../components/common/PasswordToggle';
import LegalModal from '../../components/Legal/LegalModal';
import { TERMS_AND_CONDITIONS } from '../../constants/legal/terms';
import { PRIVACY_POLICY } from '../../constants/legal/privacy';
import PushButton from '../../components/common/PushButton';
import { getAssetUrl, getSpriteUrl } from '../../utils/assetUtils';
import './RegisterPage.css';

// Lazy load the specialized mobile version
const robotImgUrl = "https://assets.bigkas.site/Sprites/Robot/0001.webp";
const bigkasLogoUrl = "https://assets.bigkas.site/Images/Bigkas-Logo.webp";

// Module-level preloading to trigger early discovery by the browser's preload scanner
if (typeof window !== 'undefined') {
  const p1 = new Image(); p1.src = robotImgUrl;
  const p2 = new Image(); p2.src = bigkasLogoUrl;
}

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

function RegisterPageDesktop({ managePageClass = true }) {
  const layoutRef = useRef(null);
  const navigate = useNavigate();
  const { register, isLoading } = useAuthContext();

  const [legalModal, setLegalModal] = useState({ isOpen: false, title: '', content: '' });
  const [consentChecked, setConsentChecked] = useState(false);
  const [layoutMode, setLayoutMode] = useState('split');

  const showTerms = (e) => {
    e.preventDefault();
    setLegalModal({ isOpen: true, title: 'Terms & Conditions', content: TERMS_AND_CONDITIONS });
  };
  const showPrivacy = (e) => {
    e.preventDefault();
    setLegalModal({ isOpen: true, title: 'Privacy Policy', content: PRIVACY_POLICY });
  };
  const closeLegal = () => setLegalModal({ ...legalModal, isOpen: false });

  useEffect(() => {
    if (managePageClass) {
      document.documentElement.classList.add('register-page-active');
      document.body.classList.add('register-page-active');
    }
    return () => {
      if (managePageClass) {
        document.documentElement.classList.remove('register-page-active');
        document.body.classList.remove('register-page-active');
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

  /* Password strength logic */
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
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][passwordStrength];
  const strengthColor = ['', '#EF4444', '#F59E0B', '#3B82F6', '#10B981'][passwordStrength];

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'firstName' || name === 'lastName') {
      const regex = /^[A-Za-z\s-]*$/;
      if (!regex.test(value)) return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    } else if (!/^[A-Za-z\s-]+$/.test(formData.firstName)) {
      newErrors.firstName = 'Letters only';
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    } else if (!/^[A-Za-z\s-]+$/.test(formData.lastName)) {
      newErrors.lastName = 'Letters only';
    }
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = 'Invalid email';
    }
    const passwordValidation = validatePassword(formData.password);
    if (!passwordValidation.isValid) {
      newErrors.password = passwordValidation.errors[0];
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
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
      setErrors({ consent: 'Please agree to the terms' });
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
        return;
      }
      setErrors({ submit: mapSignupError(result.error) });
    } catch {
      setErrors({ submit: 'Unexpected error occurred.' });
    }
  };

  useEffect(() => {
    if (!layoutRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect?.width || window.innerWidth;
      setLayoutMode(width < 960 ? 'stack' : 'split');
    });
    observer.observe(layoutRef.current);
    return () => observer.disconnect();
  }, []);

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
      <div ref={layoutRef} className="auth-page-v2" data-layout={layoutMode}>
        <div className="auth-container">
          <m.div
            className="auth-card"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Left Side: Visuals */}
            <div className="auth-visual-side">
            <div className="auth-brand-logo">
              <img 
                src={bigkasLogoUrl} 
                alt="TalkTics" 
                className="auth-logo-img" 
                width="48" 
                height="48" 
                loading="eager" 
                fetchPriority="high"
              />
              <span>TalkTics</span>
            </div>
              <div className="auth-visual-content">
              <div className="auth-robot-img-wrap auth-robot-floating">
                <div className="auth-robot-glow" />
                <img 
                  src={robotImgUrl} 
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

                <m.h2 variants={itemVariants} className="auth-hero-tagline">
                  Master <span>Public Speaking</span>
                </m.h2>
                <m.p variants={itemVariants} className="auth-hero-desc">
                  Your AI-powered journey to public speaking excellence starts here.
                </m.p>
              </div>
            </div>

            {/* Right Side: Form */}
            <div className="auth-form-side">
              <div className="auth-form-inner">
                <m.h1 variants={itemVariants} className="auth-form-headline">Create Account</m.h1>
                <m.p variants={itemVariants} className="auth-form-subline">Join TalkTics and start your speaking journey</m.p>

                <form className="auth-form" onSubmit={handleSubmit}>
                  <AnimatePresence>
                    {errors.submit && (
                      <m.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="auth-status-banner is-error"
                      >
                        {errors.submit}
                      </m.div>
                    )}
                  </AnimatePresence>

                  <m.div variants={itemVariants} className="form-row-v2">
                    <div className="form-group-v2">
                      <label>First Name</label>
                      <div className="input-field-wrap">
                        <input
                          name="firstName"
                          className={errors.firstName ? 'is-invalid' : ''}
                          value={formData.firstName}
                          onChange={handleChange}
                          placeholder="Juan"
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                    <div className="form-group-v2">
                      <label>Last Name</label>
                      <div className="input-field-wrap">
                        <input
                          name="lastName"
                          className={errors.lastName ? 'is-invalid' : ''}
                          value={formData.lastName}
                          onChange={handleChange}
                          placeholder="Dela Cruz"
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                  </m.div>

                  <m.div variants={itemVariants} className="form-group-v2">
                    <label>Email</label>
                    <div className="input-field-wrap">
                      <input
                        type="email"
                        name="email"
                        className={errors.email ? 'is-invalid' : ''}
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="name@gmail.com"
                        disabled={isLoading}
                      />
                    </div>
                    {errors.email && <span className="field-error">{errors.email}</span>}
                  </m.div>

                  <m.div variants={itemVariants} className="form-group-v2">
                    <label>Password</label>
                    <div className="input-field-wrap">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        className={errors.password ? 'is-invalid' : ''}
                        value={formData.password}
                        onChange={handleChange}
                        placeholder="••••••••"
                        disabled={isLoading}
                        autoComplete="new-password"
                      />
                      <PasswordToggle isVisible={showPassword} onToggle={() => setShowPassword(!showPassword)} label="password" />
                    </div>
                    {formData.password && (
                      <div className="pw-strength-v2">
                        <div className="pw-strength-track">
                          <div className="pw-strength-fill" style={{ width: `${(passwordStrength / 4) * 100}%`, background: strengthColor }} />
                        </div>
                        <span style={{ color: strengthColor }}>{strengthLabel}</span>
                      </div>
                    )}
                    {errors.password && <span className="field-error">{errors.password}</span>}
                  </m.div>

                  <m.div variants={itemVariants} className="form-group-v2">
                    <label>Confirm Password</label>
                    <div className="input-field-wrap">
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        name="confirmPassword"
                        className={errors.confirmPassword ? 'is-invalid' : ''}
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        placeholder="••••••••"
                        disabled={isLoading}
                        autoComplete="new-password"
                      />
                      <PasswordToggle isVisible={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} label="confirm password" />
                    </div>
                    {errors.confirmPassword && <span className="field-error">{errors.confirmPassword}</span>}
                  </m.div>

                  <m.div variants={itemVariants} className="consent-group-v2">
                    <label className="checkbox-wrap-v2">
                      <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
                      <span className="checkmark-v2"></span>
                      <span className="consent-text">
                        I agree to the <a href="#" onClick={showTerms}>Terms</a> and <a href="#" onClick={showPrivacy}>Privacy Policy</a>.
                      </span>
                    </label>
                  </m.div>

                  <m.div variants={itemVariants} className="form-actions-v2">
                    <PushButton
                      type="submit"
                      disabled={isLoading || !consentChecked}
                      bgColor="#047857"
                      shadowColor="#065f46"
                    >
                      {isLoading ? <span className="loading-spinner" /> : 'Create Account'}
                    </PushButton>
                  </m.div>

                  <m.div variants={itemVariants} className="signup-prompt-v2">
                    Already have an account? <Link to={ROUTES.LOGIN}>Login here</Link>
                  </m.div>
                </form>
              </div>
            </div>
          </m.div>
        </div>

        <LegalModal
          isOpen={legalModal.isOpen}
          onClose={closeLegal}
          title={legalModal.title}
          content={legalModal.content}
        />
      </div>
    </LazyMotion>
  );
}

const RegisterPageMobile = lazy(() => import('./RegisterPageMobile'));

export { RegisterPageDesktop };

/**
 * Main Responsive Wrapper for Register Page
 * Switches between Desktop and Mobile/Tablet specialized versions
 */
function RegisterPage() {
  const [isMobileOrTablet, setIsMobileOrTablet] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileOrTablet(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Suspense fallback={null}>
      {isMobileOrTablet ? <RegisterPageMobile /> : <RegisterPageDesktop />}
    </Suspense>
  );
}

export default RegisterPage;
