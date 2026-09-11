import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuthContext } from '../context/useAuthContext';
import { ENV } from '../config/env';
import { ROUTES } from '../utils/constants';
import { fetchUserAchievements } from '../services/achievementsService';
import { syncClaimableAchievements } from '../utils/achievementClaims';
import { syncUnlockedBadgeIds } from '../utils/achievementNavBadge';
import { supabase } from '../lib/supabase';

// Auth Pages
const AdminLoginPage = lazy(() => import('../pages/auth/AdminLoginPage'));
const LoginPage = lazy(() => import('../pages/auth/LoginPage'));
const LandingPage = lazy(() => import('../pages/landing/LandingPage'));
const RegisterPage = lazy(() => import('../pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('../pages/auth/VerifyEmailPage'));
const OAuthCallbackPage = lazy(() => import('../pages/auth/OAuthCallbackPage'));
const NativeAuthCallbackPage = lazy(() => import('../pages/auth/NativeAuthCallbackPage'));
const ForgotPasswordPage = lazy(() => import('../pages/auth/ForgotPasswordPage'));
const CreatePasswordPage = lazy(() => import('../pages/auth/CreatePasswordPage'));

// Main Pages
const AdminDashboardPage = lazy(() => import('../pages/main/AdminDashboardPage'));
const ProgressPage = lazy(() => import('../pages/main/ProgressPage'));
const ProgressPageMobile = lazy(() => import('../pages/main/ProgressPageMobile'));
const AchievementsPage = lazy(() => import('../pages/main/AchievementsPage'));
const SettingsProfilePage = lazy(() => import('../pages/main/SettingsProfilePage'));
const SettingsProfilePageMobile = lazy(() => import('../pages/main/SettingsProfilePageMobile'));
const SettingsPage = lazy(() => import('../pages/main/SettingsPage'));
const SettingsPageMobile = lazy(() => import('../pages/main/SettingsPageMobile'));
const ChangePasswordPage = lazy(() => import('../pages/main/ChangePasswordPage'));
const AccountSettingsPage = lazy(() => import('../pages/main/AccountSettingsPage'));
const TrainingSetupPage = lazy(() => import('../pages/main/TrainingSetupPage'));
const TrainingPage = lazy(() => import('../pages/main/TrainingPage'));
const FrameworksPage = lazy(() => import('../pages/main/FrameworksPage'));
const TestAudioVideoPage = lazy(() => import('../pages/main/TestAudioVideoPage'));
const TestAudioVideoPageMobile = lazy(() => import('../pages/main/TestAudioVideoPageMobile'));
const UserProfilingPage = lazy(() => import('../pages/main/UserProfilingPage'));
const UserPretestPage = lazy(() => import('../pages/main/UserPretestPage'));
const UserAnalyzingPage = lazy(() => import('../pages/main/UserAnalyzingPage'));
const ActivityPage = lazy(() => import('../pages/main/ActivityPage'));
const ActivityPageMobile = lazy(() => import('../pages/main/ActivityPageMobile'));
const AchievementsPageMobile = lazy(() => import('../pages/main/AchievementsPageMobile'));

// Session Pages
const SessionDetailPage = lazy(() => import('../pages/session/SessionDetailPage'));
const DetailedFeedbackPage = lazy(() => import('../pages/session/DetailedFeedbackPage'));

// Main Pages (continued)
const PracticePage = lazy(() => import('../pages/main/PracticePage'));

// Components
const SideNav = lazy(() => import('../components/common/SideNav'));
const BottomNav = lazy(() => import('../components/common/BottomNav'));

const bigkasLogo = '/images/bigkas-logo-72.webp';

function shouldDeferRootLoadingToLanding() {
  return !Capacitor.isNativePlatform() && window.location.pathname === ROUTES.HOME;
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-logo">
        <img src={bigkasLogo} alt="TalkTics" className="loading-logo-image" />
        <span>TalkTics</span>
      </div>
      <div className="loading-spinner" aria-label="Loading" />
    </div>
  );
}

/**
 * ActivityPageWrapper - Conditionally renders desktop or mobile version
 * based on viewport size
 */
function ActivityPageWrapper() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  return isMobileViewport ? <ActivityPageMobile /> : <ActivityPage />;
}

function ProgressPageWrapper() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  return isMobileViewport ? <ProgressPageMobile /> : <ProgressPage />;
}

function AchievementsPageWrapper() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  return isMobileViewport ? <AchievementsPageMobile /> : <AchievementsPage />;
}

function SettingsProfilePageWrapper() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  return isMobileViewport ? <SettingsProfilePageMobile /> : <SettingsProfilePage />;
}

function SettingsPageWrapper() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  return isMobileViewport ? <SettingsPageMobile /> : <SettingsPage />;
}

function TestAudioVideoPageWrapper() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  return isMobileViewport ? <TestAudioVideoPageMobile /> : <TestAudioVideoPage />;
}

function getAuthenticatedRedirect(user, isAdminAuthenticated) {
  if (isAdminAuthenticated) return ROUTES.ADMIN_DASHBOARD;
  if (user?.onboardingStage === 'profiling') return ROUTES.USER_PROFILING;
  if (user?.onboardingStage === 'pretest') return ROUTES.USER_PRETEST;
  if (user?.onboardingStage === 'analyzing') return ROUTES.USER_ANALYZING;
  return ROUTES.ACTIVITY;
}

/**
 * Protected Route Wrapper
 * - If not authenticated → redirect to login
 * - Otherwise render the protected page with Navbar
 */
function ProtectedRoute() {
  const { isAuthenticated, isInitializing, user } = useAuthContext();
  const { pathname } = useLocation();
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    let active = true;
    let lastSyncTime = 0;

    const performSync = async (force = false) => {
      const now = Date.now();
      // Throttle non-forced syncs to once every 10 seconds
      if (!force && now - lastSyncTime < 10000) return;
      lastSyncTime = now;

      try {
        const data = await fetchUserAchievements(user.id, user);
        if (!active) return;
        syncClaimableAchievements(data || [], user.id);
        const unclaimed = (data || []).filter((a) => a.unlocked && !a.claimed).map((a) => a.id);
        const claimed = (data || []).filter((a) => a.claimed).map((a) => a.id);
        syncUnlockedBadgeIds(unclaimed, claimed);
      } catch (err) {
        console.warn('[AchievementSync] Background fetch failed:', err);
      }
    };

    // Run on mount or when user/pathname changes
    performSync();

    // Supabase Realtime WebSocket subscription for instant notification bell & achievement updates
    const channel = supabase
      .channel(`realtime-notifications-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_achievements', filter: `user_id=eq.${user.id}` },
        () => performSync(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_trophies', filter: `user_id=eq.${user.id}` },
        () => performSync(true)
      )
      .subscribe();

    // Run every 30 seconds as backup
    const interval = setInterval(() => performSync(), 30000);

    return () => {
      active = false;
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [isAuthenticated, user?.id, pathname]);

  const hideMainNav =
    pathname === ROUTES.USER_PROFILING ||
    pathname === ROUTES.USER_PRETEST ||
    pathname === ROUTES.USER_ANALYZING ||
    (pathname.startsWith(ROUTES.TRAINING) && pathname !== ROUTES.TRAINING_SETUP);

  if (isInitializing) {
    // Only show the app-level loading screen if we're not on the landing page,
    // since the landing page has its own loader.
    if (shouldDeferRootLoadingToLanding()) {
      return null;
    }
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  const isSettingsOrAccountRoute =
    pathname === ROUTES.ACCOUNT_SETTINGS ||
    pathname === ROUTES.SETTINGS ||
    pathname === ROUTES.CHANGE_PASSWORD;

  if (user?.onboardingStage === 'profiling' && pathname !== ROUTES.USER_PROFILING && !isSettingsOrAccountRoute) {
    return <Navigate to={ROUTES.USER_PROFILING} replace />;
  }

  if (
    user?.onboardingStage === 'pretest' &&
    pathname !== ROUTES.USER_PRETEST &&
    pathname !== ROUTES.USER_ANALYZING &&
    !isSettingsOrAccountRoute &&
    !pathname.startsWith(ROUTES.TRAINING) &&
    !pathname.startsWith('/session')
  ) {
    return <Navigate to={ROUTES.USER_PRETEST} replace />;
  }

  if (
    user?.onboardingStage === 'analyzing' &&
    pathname !== ROUTES.USER_ANALYZING &&
    !isSettingsOrAccountRoute &&
    !pathname.startsWith('/session')
  ) {
    return <Navigate to={ROUTES.USER_ANALYZING} replace />;
  }

  return (
    <>
      {!hideMainNav && isMobileViewport && (
        <Suspense fallback={null}>
          <BottomNav />
        </Suspense>
      )}
      {!hideMainNav && !isMobileViewport && (
        <Suspense fallback={null}>
          <SideNav />
        </Suspense>
      )}
      <main
        className={`main-content${hideMainNav ? ' main-content--full' : ''}`}
      >
        <Outlet />
      </main>
    </>
  );
}

function AdminRoute() {
  const { isAuthenticated, isInitializing, isAdminAuthenticated } = useAuthContext();

  if (isInitializing) {
    if (shouldDeferRootLoadingToLanding()) {
      return null;
    }
    return <LoadingScreen />;
  }

  if (isAdminAuthenticated) {
    return (
      <>
        <main className="main-content">
          <Outlet />
        </main>
      </>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ENV.ADMIN_LOGIN_PATH || ROUTES.ADMIN_LOGIN_BASE} replace />;
  }

  if (!isAdminAuthenticated) {
    return <Navigate to={ENV.ADMIN_LOGIN_PATH || ROUTES.ADMIN_LOGIN_BASE} replace />;
  }

  return (
    <>
      <main className="main-content">
        <Outlet />
      </main>
    </>
  );
}

/**
 * Public Route Wrapper
 * Redirects to dashboard if user is already authenticated
 */
function PublicRoute() {
  const { isAuthenticated, isInitializing, isAdminAuthenticated, user } = useAuthContext();

  if (isInitializing) {
    if (shouldDeferRootLoadingToLanding()) {
      return null;
    }
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to={getAuthenticatedRedirect(user, isAdminAuthenticated)} replace />;
  }

  return (
    <>
      <Outlet />
    </>
  );
}

/**
 * App Router Component
 * Defines all application routes
 */
function AppRouter() {
  const isNative = Capacitor.isNativePlatform();
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    const baseTitle = 'TalkTics — Master Public Speaking';

    if (path === ROUTES.LOGIN) {
      document.title = 'Login | ' + baseTitle;
    } else if (path === ROUTES.REGISTER) {
      document.title = 'Create Account | ' + baseTitle;
    } else if (path === ROUTES.FORGOT_PASSWORD) {
      document.title = 'Forgot Password | ' + baseTitle;
    } else if (path === ROUTES.CREATE_PASSWORD) {
      document.title = 'Create Password | ' + baseTitle;
    } else if (path === ROUTES.VERIFY_EMAIL) {
      document.title = 'Verify Email | ' + baseTitle;
    } else if (path === ROUTES.ACTIVITY) {
      document.title = 'Activity | ' + baseTitle;
    } else if (path === ROUTES.PROGRESS) {
      document.title = 'Progress | ' + baseTitle;
    } else if (path === ROUTES.ACHIEVEMENTS) {
      document.title = 'Achievements | ' + baseTitle;
    } else if (path === ROUTES.PROFILE) {
      document.title = 'Profile | ' + baseTitle;
    } else if (path === ROUTES.SETTINGS) {
      document.title = 'Settings | ' + baseTitle;
    } else if (path === ROUTES.TRAINING || path === ROUTES.TRAINING_SETUP) {
      document.title = 'Training | ' + baseTitle;
    } else if (path === ROUTES.FRAMEWORKS) {
      document.title = 'Frameworks | ' + baseTitle;
    } else if (path === ROUTES.PRACTICE) {
      document.title = 'Practice | ' + baseTitle;
    } else if (path.includes('/session/') || path === ROUTES.SESSION_DETAIL || path === ROUTES.SESSION_RESULT || path === ROUTES.DETAILED_FEEDBACK) {
      document.title = 'Feedback | ' + baseTitle;
    } else if (path === ROUTES.ADMIN_DASHBOARD) {
      document.title = 'Admin Dashboard | ' + baseTitle;
    } else if (path === ROUTES.HOME) {
      document.title = 'TalkTics — Master Speaking';
    } else {
      document.title = baseTitle;
    }
  }, [location.pathname]);

  return (
    <Routes>
      <Route
        path={ROUTES.AUTH_CALLBACK}
        element={
          <Suspense fallback={<LoadingScreen />}>
            <OAuthCallbackPage />
          </Suspense>
        }
      />

      <Route
        path={ROUTES.NATIVE_AUTH_CALLBACK}
        element={
          <Suspense fallback={<LoadingScreen />}>
            <NativeAuthCallbackPage />
          </Suspense>
        }
      />

      {/* Public Routes - accessible only when not logged in */}
      <Route element={<PublicRoute />}>
        <Route
          path={ROUTES.HOME}
          element={isNative ? <Navigate to={ROUTES.LOGIN} replace /> : (
            <Suspense fallback={<LoadingScreen />}>
              <LandingPage />
            </Suspense>
          )}
        />
        <Route
          path={ROUTES.LOGIN}
          element={
            <Suspense fallback={<LoadingScreen />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path={ROUTES.ADMIN_LOGIN_BASE}
          element={
            <Suspense fallback={<LoadingScreen />}>
              <AdminLoginPage />
            </Suspense>
          }
        />
        {ENV.ADMIN_LOGIN_PATH && (
          <Route
            path={ENV.ADMIN_LOGIN_PATH}
            element={
              <Suspense fallback={<LoadingScreen />}>
                <AdminLoginPage />
              </Suspense>
            }
          />
        )}
        <Route
          path={ROUTES.REGISTER}
          element={
            <Suspense fallback={<LoadingScreen />}>
              <RegisterPage />
            </Suspense>
          }
        />
      </Route>

      {/* Email Verification - accessible anytime */}
      <Route
        path={ROUTES.VERIFY_EMAIL}
        element={
          <Suspense fallback={<LoadingScreen />}>
            <VerifyEmailPage />
          </Suspense>
        }
      />

      {/* Forgot Password - accessible anytime */}
      <Route
        path={ROUTES.FORGOT_PASSWORD}
        element={
          <Suspense fallback={<LoadingScreen />}>
            <ForgotPasswordPage />
          </Suspense>
        }
      />

      {/* Account Invite - accessible anytime while Supabase restores the invite session */}
      <Route
        path={ROUTES.CREATE_PASSWORD}
        element={
          <Suspense fallback={<LoadingScreen />}>
            <CreatePasswordPage />
          </Suspense>
        }
      />

      {/* Protected Routes - require authentication */}
      <Route
        element={
          <Suspense fallback={<LoadingScreen />}>
            <ProtectedRoute />
          </Suspense>
        }
      >
        <Route path={ROUTES.USER_PROFILING} element={<UserProfilingPage />} />
        <Route path={ROUTES.USER_PRETEST} element={<UserPretestPage />} />
        <Route path={ROUTES.USER_ANALYZING} element={<UserAnalyzingPage />} />

        {/* Practice */}
        <Route path={ROUTES.PRACTICE} element={<PracticePage />} />

        {/* Training */}
        <Route path={ROUTES.TRAINING_SETUP} element={<TrainingSetupPage />} />
        <Route path={ROUTES.TRAINING} element={<TrainingPage />} />

        {/* Frameworks / Training Hub */}
        <Route path={ROUTES.FRAMEWORKS} element={<FrameworksPage />} />

        {/* Progress / Activity */}
        <Route path={ROUTES.DASHBOARD} element={<Navigate to={ROUTES.ACTIVITY} replace />} />
        <Route path={ROUTES.PROGRESS} element={<ProgressPageWrapper />} />
        <Route path={ROUTES.ACHIEVEMENTS} element={<AchievementsPageWrapper />} />
        <Route path={ROUTES.ACTIVITY} element={<ActivityPageWrapper />} />

        {/* Profile */}
        <Route path={ROUTES.PROFILE} element={<SettingsProfilePageWrapper />} />

        {/* Settings */}
        <Route path={ROUTES.SETTINGS} element={<SettingsPageWrapper />} />
        <Route path={ROUTES.CHANGE_PASSWORD} element={<ChangePasswordPage />} />
        <Route path={ROUTES.ACCOUNT_SETTINGS} element={<AccountSettingsPage />} />
        <Route path={ROUTES.AUDIO_TEST} element={<TestAudioVideoPageWrapper />} />

        {/* Session */}
        <Route path={ROUTES.SESSION_DETAIL} element={<SessionDetailPage />} />
        <Route path={ROUTES.SESSION_RESULT} element={<DetailedFeedbackPage initialShowDetailed={false} />} />
        <Route path={ROUTES.DETAILED_FEEDBACK} element={<DetailedFeedbackPage initialShowDetailed={true} />} />
      </Route>

      <Route
        element={
          <Suspense fallback={<LoadingScreen />}>
            <AdminRoute />
          </Suspense>
        }
      >
        <Route path={ROUTES.ADMIN_DASHBOARD} element={<AdminDashboardPage />} />
      </Route>

      {/* 404 - Redirect to landing */}
      <Route path="*" element={<Navigate to={isNative ? ROUTES.LOGIN : ROUTES.HOME} replace />} />
    </Routes>
  );
}

export default AppRouter;
