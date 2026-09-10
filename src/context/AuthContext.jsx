import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase, ensureFreshAccessToken, isAuthSessionError, isJwtExpiredError } from '../lib/supabase';
import { ENV } from '../config/env';
import { ROUTES } from '../utils/constants';
import { normalizeSpeakerPointsHistory } from '../utils/speakerPointsHistory';
import { BIGKAS_LEVELS, getBigkasLevelFromScore, mapPercentToEntryScore } from '../utils/activityProgress';
import { PENDING_SIGNUP_PASSWORD_KEY } from '../services/session/api/authApi';
import { getOrGenerateInstanceToken, broadcastSessionClaimed, handleSessionEjection, finalizeSessionEjection, clearInstanceClaimKeys, getDeviceFingerprint, checkSystemParallelAccountPolicy, checkSystemMaintenanceMode, forceClaimSession } from '../utils/sessionIntegrity';
import ConfirmationModal from '../components/common/ConfirmationModal';

/**
 * Authentication Context — backed by Supabase Auth
 */
const AuthContext = createContext(null);
const SIGNUP_COOLDOWN_KEY = 'bigkas_signup_cooldown_until';
const ADMIN_SESSION_KEY = 'bigkas_admin_session';
const LOGIN_GUARD_NOT_CONFIGURED_CODES = ['42883', 'PGRST202', '42P01'];
const LOGIN_GUARD_PREFIX = 'bigkas_login_guard_v1';
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCKOUT_SECONDS = 30;
const LOGIN_GUARD_RESET_WINDOW_MS = 24 * 60 * 60 * 1000;
const GENERIC_LOGIN_FAILURE_MESSAGE = 'Wrong email or password.';
const PROFILE_GUARD_TIMEOUT_MS = 2500;
const PROFILE_CACHE_TTL_MS = 10_000;
const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';
const NATIVE_AUTH_REDIRECT_URL = 'org.nationalu.bigkas://auth/callback';
const NATIVE_AUTH_BRIDGE_URL = 'https://bigkas.site/auth/native-callback';
const OAUTH_RETURN_PATH_KEY = 'bigkas_oauth_return_path_v1';
let loginGuardRpcDisabled = false;
const profileRequestCache = new Map();

function withTimeout(promise, label, timeoutMs = PROFILE_GUARD_TIMEOUT_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function normalizeLoginLockoutSeconds(value) {
  const seconds = Math.ceil(Number(value) || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(LOGIN_LOCKOUT_SECONDS, seconds);
}

function buildLockoutMessage(waitSeconds) {
  const seconds = Math.max(1, normalizeLoginLockoutSeconds(waitSeconds) || LOGIN_LOCKOUT_SECONDS);
  return `Temporary cooldown active. Please wait ${seconds}s before trying again.`;
}

function isOAuthBackedUser(authUser) {
  const appMetadata = authUser?.app_metadata || {};
  const primaryProvider = String(appMetadata.provider || '').toLowerCase();
  const providers = Array.isArray(appMetadata.providers)
    ? appMetadata.providers.map((provider) => String(provider || '').toLowerCase())
    : [];

  return (
    (primaryProvider && primaryProvider !== 'email') ||
    providers.some((provider) => provider && provider !== 'email')
  );
}

function hasVerifiedAuthIdentity(authUser) {
  if (!authUser) return false;
  if (authUser.email_confirmed_at || authUser.confirmed_at) return true;
  return isOAuthBackedUser(authUser);
}

function isLoginGuardNotConfigured(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const errorText = String(error || '').toLowerCase();
  const status = Number(error?.status || 0);

  return (
    LOGIN_GUARD_NOT_CONFIGURED_CODES.includes(code) ||
    code === '404' ||
    status === 404 ||
    name.includes('not found') ||
    message.includes('not found') ||
    message.includes('could not find the function') ||
    message.includes('relation') && message.includes('login_attempt_guards') && message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('login_guard_') ||
    details.includes('schema cache') ||
    details.includes('login_guard_') ||
    hint.includes('login_guard_') ||
    errorText.includes('login_guard_') ||
    errorText.includes('/rpc/login_guard_')
  );
}

function getLoginGuardKey(scope, email) {
  return `${LOGIN_GUARD_PREFIX}:${scope}:${email}`;
}

function readLocalLoginGuardState(scope, email) {
  if (typeof window === 'undefined' || !email) return null;
  try {
    const raw = window.localStorage.getItem(getLoginGuardKey(scope, email));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      failedAttempts: Number(parsed.failedAttempts || 0),
      cooldownStep: Number(parsed.cooldownStep || 0),
      lockUntil: Number(parsed.lockUntil || 0),
      lastFailedAt: Number(parsed.lastFailedAt || 0),
    };
  } catch {
    return null;
  }
}

function writeLocalLoginGuardState(scope, email, state) {
  if (typeof window === 'undefined' || !email) return;
  window.localStorage.setItem(getLoginGuardKey(scope, email), JSON.stringify(state));
}

function clearLocalLoginGuardState(scope, email) {
  if (typeof window === 'undefined' || !email) return;
  window.localStorage.removeItem(getLoginGuardKey(scope, email));
}

function getLocalLoginLockStatus(scope, email) {
  const state = readLocalLoginGuardState(scope, email);
  if (!state) return { isLocked: false, remainingSeconds: 0, error: null };

  const now = Date.now();
  if (state.lockUntil > now) {
    const remainingSeconds = normalizeLoginLockoutSeconds((state.lockUntil - now) / 1000);
    const correctedLockUntil = now + remainingSeconds * 1000;
    if (remainingSeconds > 0 && correctedLockUntil < state.lockUntil) {
      writeLocalLoginGuardState(scope, email, {
        ...state,
        cooldownStep: 1,
        lockUntil: correctedLockUntil,
      });
    }

    return {
      isLocked: true,
      remainingSeconds,
      error: null,
    };
  }

  clearLocalLoginGuardState(scope, email);
  return { isLocked: false, remainingSeconds: 0, error: null };
}

function registerLocalLoginFailure(scope, email) {
  const now = Date.now();
  const current = readLocalLoginGuardState(scope, email) || {
    failedAttempts: 0,
    cooldownStep: 0,
    lockUntil: 0,
    lastFailedAt: 0,
  };

  if (current.lockUntil > now) {
    const lockoutSeconds = normalizeLoginLockoutSeconds((current.lockUntil - now) / 1000);
    const correctedLockUntil = now + lockoutSeconds * 1000;
    if (lockoutSeconds > 0 && correctedLockUntil < current.lockUntil) {
      writeLocalLoginGuardState(scope, email, {
        ...current,
        cooldownStep: 1,
        lockUntil: correctedLockUntil,
      });
    }

    return {
      locked: true,
      lockoutSeconds,
      error: null,
    };
  }

  const shouldResetState =
    current.lockUntil > 0 ||
    !current.lastFailedAt ||
    (now - current.lastFailedAt) > LOGIN_GUARD_RESET_WINDOW_MS;
  const baseState = shouldResetState
    ? { failedAttempts: 0, cooldownStep: 0, lockUntil: 0, lastFailedAt: 0 }
    : current;

  const failedAttempts = baseState.failedAttempts + 1;
  if (failedAttempts >= MAX_LOGIN_ATTEMPTS) {
    writeLocalLoginGuardState(scope, email, {
      failedAttempts: 0,
      cooldownStep: 1,
      lockUntil: now + (LOGIN_LOCKOUT_SECONDS * 1000),
      lastFailedAt: now,
    });
    return { locked: true, lockoutSeconds: LOGIN_LOCKOUT_SECONDS, error: null };
  }

  writeLocalLoginGuardState(scope, email, {
    ...baseState,
    failedAttempts,
    lastFailedAt: now,
  });

  return { locked: false, lockoutSeconds: 0, error: null };
}

function isJwtVerificationError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  return (
    message.includes('jwt failed verification') ||
    message.includes('invalid jwt') ||
    message.includes('jwt expired') ||
    details.includes('jwt failed verification') ||
    details.includes('jwt expired') ||
    hint.includes('jwt')
  );
}

async function callLoginGuardRpc(fnName, args) {
  let result = await supabase.schema('public').rpc(fnName, args);

  if (!result?.error || !isJwtVerificationError(result.error)) {
    return result;
  }

  // Recover from stale local session tokens by clearing local auth and retrying once.
  await supabase.auth.signOut({ scope: 'local' });
  result = await supabase.schema('public').rpc(fnName, args);
  return result;
}

async function getLoginLockStatus(scope, email) {
  if (!email) return { isLocked: false, remainingSeconds: 0, error: null };

  if (loginGuardRpcDisabled) {
    return getLocalLoginLockStatus(scope, email);
  }

  const { data, error } = await callLoginGuardRpc('login_guard_check', {
    p_email: email,
    p_scope: scope,
  });

  if (error) {
    if (isLoginGuardNotConfigured(error)) {
      loginGuardRpcDisabled = true;
      return getLocalLoginLockStatus(scope, email);
    }
    return { isLocked: false, remainingSeconds: 0, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const remainingSeconds = normalizeLoginLockoutSeconds(row?.remaining_seconds);
  return {
    isLocked: !!row?.is_locked,
    remainingSeconds,
    failedAttempts: Number(row?.failed_attempts || 0),
    unlockTime: row?.is_locked && remainingSeconds > 0
      ? new Date(Date.now() + remainingSeconds * 1000).toISOString()
      : null,
    error: null,
    guardNotConfigured: false,
  };
}

function shouldTrackCredentialFailure(code) {
  return [
    'invalid_credentials',
    'account_not_found',
    'unknown_auth_error',
  ].includes(String(code || '').toLowerCase());
}

async function registerLoginFailure(scope, email) {
  if (!email) return { locked: false, lockoutSeconds: 0, error: null };

  if (loginGuardRpcDisabled) {
    return registerLocalLoginFailure(scope, email);
  }

  const { data, error } = await callLoginGuardRpc('login_guard_register_failure', {
    p_email: email,
    p_scope: scope,
  });

  if (error) {
    if (isLoginGuardNotConfigured(error)) {
      loginGuardRpcDisabled = true;
      return registerLocalLoginFailure(scope, email);
    }
    return { locked: false, lockoutSeconds: 0, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const lockoutSeconds = normalizeLoginLockoutSeconds(row?.lockout_seconds);
  return {
    locked: !!row?.locked,
    lockoutSeconds,
    failedAttempts: Number(row?.failed_attempts || 0),
    unlockTime: lockoutSeconds > 0
      ? new Date(Date.now() + lockoutSeconds * 1000).toISOString()
      : null,
    error: null,
    guardNotConfigured: false,
  };
}

async function registerLoginSuccess(scope, email) {
  if (!email) return { error: null };

  if (loginGuardRpcDisabled) {
    clearLocalLoginGuardState(scope, email);
    return { error: null, guardNotConfigured: true };
  }

  const { error } = await callLoginGuardRpc('login_guard_register_success', {
    p_email: email,
    p_scope: scope,
  });

  if (error && isLoginGuardNotConfigured(error)) {
    loginGuardRpcDisabled = true;
    clearLocalLoginGuardState(scope, email);
    return { error: null, guardNotConfigured: true };
  }

  return { error: error || null, guardNotConfigured: false };
}

function getWebRedirectPath(path = '/') {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${path}`;
}

function getOAuthRedirectPath(path = '/') {
  return Capacitor.isNativePlatform() ? NATIVE_AUTH_BRIDGE_URL : getWebRedirectPath(path);
}

function rememberOAuthReturnPath(path = ROUTES.ACTIVITY) {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return;
  try {
    window.sessionStorage.setItem(OAUTH_RETURN_PATH_KEY, path || ROUTES.ACTIVITY);
  } catch {
    // Best-effort only.
  }
}

function consumeOAuthReturnPath() {
  if (typeof window === 'undefined') return ROUTES.ACTIVITY;
  try {
    const path = window.sessionStorage.getItem(OAUTH_RETURN_PATH_KEY) || ROUTES.ACTIVITY;
    window.sessionStorage.removeItem(OAUTH_RETURN_PATH_KEY);
    return path.startsWith('/') ? path : ROUTES.ACTIVITY;
  } catch {
    return ROUTES.ACTIVITY;
  }
}

function getAuthParamsFromUrl(url) {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  const hashParams = new URLSearchParams(hash);
  hashParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}

function cleanWebOAuthUrl(defaultPath = ROUTES.ACTIVITY) {
  if (typeof window === 'undefined') return;
  const currentPath = window.location.pathname;
  const targetPath = currentPath === ROUTES.LOGIN || currentPath === ROUTES.HOME || currentPath === ROUTES.AUTH_CALLBACK
    ? defaultPath
    : currentPath;

  window.history.replaceState(null, '', targetPath);
  const navigationEvent = typeof PopStateEvent === 'function'
    ? new PopStateEvent('popstate', { state: null })
    : new Event('popstate');
  window.dispatchEvent(navigationEvent);
}

async function completeWebOAuthCallback() {
  if (Capacitor.isNativePlatform() || typeof window === 'undefined') {
    return { handled: false, session: null };
  }

  const params = getAuthParamsFromUrl(window.location.href);
  const hasOAuthPayload =
    params.has('code') ||
    (params.has('access_token') && params.has('refresh_token')) ||
    params.has('error') ||
    params.has('error_description');

  if (!hasOAuthPayload) return { handled: false, session: null };

  const returnPath = consumeOAuthReturnPath();
  const errorDescription = params.get('error_description') || params.get('error');
  if (errorDescription) {
    cleanWebOAuthUrl(ROUTES.LOGIN);
    throw new Error(errorDescription);
  }

  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  let session = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    session = data?.session ?? null;
  } else if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    session = data?.session ?? null;
  }

  cleanWebOAuthUrl(returnPath);
  return { handled: true, session };
}

function getSignupCooldownUntil() {
  if (typeof window === 'undefined') return 0;
  const stored = Number(window.localStorage.getItem(SIGNUP_COOLDOWN_KEY) || 0);
  return Number.isFinite(stored) ? stored : 0;
}

function setSignupCooldownUntil(untilTs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SIGNUP_COOLDOWN_KEY, String(untilTs));
}

function getStoredAdminSession() {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

function setStoredAdminSession(isEnabled) {
  if (typeof window === 'undefined') return;
  if (isEnabled) {
    window.sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    return;
  }

  window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function normalizeLoginError(err, email) {
  const rawMessage = (err?.message || '').trim();
  const msg = rawMessage.toLowerCase();
  const code = (err?.code || '').toLowerCase();

  if (err?.status === 423 || code.includes('locked')) {
    const remainingSeconds = Number(err?.remainingSeconds || 0);
    const unlockTimeMs = err?.unlockTime ? Date.parse(err.unlockTime) : NaN;
    const fallbackSeconds = Number.isFinite(unlockTimeMs)
      ? normalizeLoginLockoutSeconds((unlockTimeMs - Date.now()) / 1000)
      : LOGIN_LOCKOUT_SECONDS;
    const waitSeconds = Number.isFinite(remainingSeconds) && remainingSeconds > 0
      ? normalizeLoginLockoutSeconds(remainingSeconds)
      : fallbackSeconds;
    const lockoutSeconds = Math.max(1, waitSeconds || LOGIN_LOCKOUT_SECONDS);
    return {
      code: 'account_locked',
      message: `Too many failed attempts. Try again in ${lockoutSeconds}s.`,
      requiresEmailConfirmation: false,
      lockoutSeconds,
    };
  }

  if (
    msg.includes('email not confirmed') ||
    msg.includes('not confirmed') ||
    code.includes('email_not_confirmed')
  ) {
    return {
      code: 'email_not_confirmed',
      message: 'Verify your email address first. Then click resend email below if you need a new link.',
      requiresEmailConfirmation: true,
      pendingEmail: email,
    };
  }

  if (
    msg.includes('account has been deactivated') ||
    msg.includes('account has been permanently deleted') ||
    msg.includes('account cannot be used to sign in') ||
    code.includes('account_deactivated') ||
    code.includes('account_deleted')
  ) {
    return {
      code: 'invalid_credentials',
      message: GENERIC_LOGIN_FAILURE_MESSAGE,
      requiresEmailConfirmation: false,
    };
  }

  if (
    msg.includes('user not found') ||
    msg.includes('no user') ||
    msg.includes('email not found')
  ) {
    return {
      code: 'account_not_found',
      message: 'No account found for this email address.',
      requiresEmailConfirmation: false,
    };
  }

  if (
    msg.includes('invalid login') ||
    msg.includes('invalid credentials') ||
    msg.includes('invalid email or password') ||
    code.includes('invalid_credentials')
  ) {
    return {
      code: 'invalid_credentials',
      message: GENERIC_LOGIN_FAILURE_MESSAGE,
      requiresEmailConfirmation: false,
    };
  }

  if (msg.includes('too many') || msg.includes('rate limit') || err?.status === 429) {
    return {
      code: 'rate_limited',
      message: 'Too many login attempts. Please wait a moment and try again.',
      requiresEmailConfirmation: false,
    };
  }

  return {
    code: 'unknown_auth_error',
    message: rawMessage || 'Unable to log in right now. Please try again.',
    requiresEmailConfirmation: false,
  };
}

function parseMetadataBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') return false;
  }
  return false;
}

function hasSpeakerProfileData(value) {
  return !!(value && typeof value === 'object' && Object.keys(value).length > 0);
}

function isBlockedByClient(error) {
  if (!error) return false;
  const msg = String(error.message || error || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('blocked by client') ||
    msg.includes('net::err_blocked_by_client') ||
    msg.includes('unexpected end of input') ||
    msg.includes('aborterror') ||
    msg.includes('extension') ||
    msg.includes('not allowed')
  );
}

function getAccountBlockedMessage(meta = {}) {
  if (parseMetadataBoolean(meta.account_deleted)) {
    return {
      code: 'invalid_credentials',
      message: GENERIC_LOGIN_FAILURE_MESSAGE,
    };
  }

  if (parseMetadataBoolean(meta.account_deactivated)) {
    return {
      code: 'invalid_credentials',
      message: GENERIC_LOGIN_FAILURE_MESSAGE,
    };
  }

  return null;
}

function isArchivedProfile(profile) {
  if (profile?.archived_at === null || profile?.archived_at === undefined) return false;
  return String(profile.archived_at).trim() !== '';
}

function deriveOnboardingStage(meta = {}, profile = {}) {
  const explicitStage = ['profiling', 'pretest', 'analyzing', 'completed'].includes(meta.onboarding_stage)
    ? meta.onboarding_stage
    : null;

  // Prioritize database columns if available, fall back to metadata
  const profilingCompleted = 
    parseMetadataBoolean(profile.is_profiling_completed) || 
    parseMetadataBoolean(meta.profiling_completed) || 
    hasSpeakerProfileData(meta.speaker_profile);

  const pretestCompleted = 
    parseMetadataBoolean(profile.is_pre_test_completed) || 
    parseMetadataBoolean(meta.pretest_completed);

  const pretestFreeCompleted = 
    parseMetadataBoolean(meta.pretest_free_completed);

  const onboardingCompleted = 
    parseMetadataBoolean(meta.onboarding_completed) || 
    (profilingCompleted && pretestCompleted);

  if (pretestCompleted && pretestFreeCompleted) {
    if (explicitStage === 'analyzing') {
      return 'analyzing';
    }
    if (explicitStage === 'completed' || onboardingCompleted) {
      return 'completed';
    }
    return 'completed';
  }

  if (pretestCompleted && !pretestFreeCompleted) {
    return 'pretest';
  }

  if (profilingCompleted) {
    return explicitStage === 'profiling' ? 'profiling' : 'pretest';
  }

  if (explicitStage) return explicitStage;
  return 'profiling';
}

function getOnboardingStageRank(stage) {
  const ranks = {
    profiling: 1,
    pretest: 2,
    analyzing: 3,
    completed: 4,
  };
  return ranks[stage] || 0;
}

function normalizeLevelNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function normalizeEntryScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 1 || score > 5) return null;
  return Math.round(score * 100) / 100;
}

function getLevelName(levelNumber) {
  const normalized = normalizeLevelNumber(levelNumber) || 1;
  return BIGKAS_LEVELS[normalized - 1]?.name || BIGKAS_LEVELS[0].name;
}

function firstElevatedLevel(values = []) {
  for (const value of values) {
    const level = normalizeLevelNumber(value);
    if (level && level > 1) return level;
  }
  return null;
}

function firstValidLevel(values = []) {
  for (const value of values) {
    const level = normalizeLevelNumber(value);
    if (level) return level;
  }
  return null;
}

function resolveAuthEntryScore(meta = {}, profile = {}) {
  const direct = normalizeEntryScore(meta.speaker_entry_score);
  if (direct) return direct;

  const finalScore = Number(meta.onboarding_level_analysis?.final_score);
  if (Number.isFinite(finalScore) && finalScore > 0) {
    return mapPercentToEntryScore(finalScore);
  }

  return normalizeEntryScore(profile.diagnostic_score);
}

function resolveLevelFromSources(assessed = [], progress = [], legacy = [], entryScore = null) {
  const derivedFromEntry = entryScore
    ? normalizeLevelNumber(getBigkasLevelFromScore(entryScore)?.levelNumber)
    : null;

  const elevatedAssessed = firstElevatedLevel(assessed);
  if (elevatedAssessed) return elevatedAssessed;

  if (derivedFromEntry && derivedFromEntry > 1) return derivedFromEntry;

  const elevatedProgress = firstElevatedLevel(progress);
  if (elevatedProgress) return elevatedProgress;

  const elevatedLegacy = firstElevatedLevel(legacy);
  if (elevatedLegacy) return elevatedLegacy;

  if (derivedFromEntry) return derivedFromEntry;

  return firstValidLevel(assessed) || firstValidLevel(progress) || firstValidLevel(legacy) || 1;
}

function resolveAuthLevelFields(meta = {}, profile = {}) {
  const entryScore = resolveAuthEntryScore(meta, profile);
  const speakerLevelNumber = resolveLevelFromSources(
    [
      meta.speaker_level_number,
      meta.onboarding_level_analysis?.estimated_level_number,
    ],
    [
      meta.progress_level_number,
      meta.current_level,
    ],
    [
      profile.speaker_level,
      profile.current_level,
    ],
    entryScore,
  );
  const progressLevelNumber = resolveLevelFromSources(
    [
      meta.progress_level_number,
      meta.current_level,
    ],
    [
      meta.speaker_level_number,
      meta.onboarding_level_analysis?.estimated_level_number,
    ],
    [
      profile.current_level,
      profile.speaker_level,
    ],
    entryScore,
  );

  return {
    speakerEntryScore: entryScore || speakerLevelNumber,
    speakerLevel: getLevelName(speakerLevelNumber),
    speakerLevelNumber,
    progressLevelNumber,
  };
}

async function syncProfileWithUserFunction(profileUpdates) {
  const { session, error: sessionError } = await ensureFreshAccessToken();
  if (sessionError) return { error: sessionError.message || 'Unable to refresh profile sync session.' };

  const { data, error } = await supabase.functions.invoke('sync-user-profile', {
    body: { profile_updates: profileUpdates },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined,
  });

  if (error) {
    let functionMessage = '';
    try {
      const details = await error.context?.json?.();
      functionMessage = details?.error || details?.message || '';
    } catch {
      functionMessage = '';
    }
    return { error: functionMessage || error.message || 'Profile was not synced.' };
  }

  if (data?.error) {
    return { error: data.error };
  }

  return { profile: data?.profile || null };
}

async function syncProfileUpdates(userId, profileUpdates) {
  if (!userId || !Object.keys(profileUpdates || {}).length) return { profile: null };

  let { data, error } = await supabase
    .from('profiles')
    .update(profileUpdates)
    .eq('id', userId)
    .select('id');

  if (error && isJwtExpiredError(error)) {
    await ensureFreshAccessToken(null, { force: true });
    ({ data, error } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', userId)
      .select('id'));
  }

  if (!error && Array.isArray(data) && data.length > 0) {
    return { profile: data[0] };
  }

  const functionResult = await syncProfileWithUserFunction(profileUpdates);
  if (functionResult.error) {
    return {
      error: error?.message
        ? `${error.message}; ${functionResult.error}`
        : functionResult.error,
    };
  }

  return functionResult;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => getStoredAdminSession());
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingEmailVerification, setPendingEmailVerification] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);
  const [sessionEjectedReason, setSessionEjectedReason] = useState(null);
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('bigkas_maintenance_mode_cache') === 'true';
  });
  const signupCooldownUntilRef = useRef(0);
  const signupInProgressRef = useRef(false);
  const loginInProgressRef = useRef(false);
  const adminLoginInProgressRef = useRef(false);
  const currentUserIdRef = useRef(null);

  useEffect(() => {
    currentUserIdRef.current = user?.id || null;
    if (isMaintenanceMode && user && user.role !== 'admin' && user.role !== 'superadmin' && !isAdminAuthenticated) {
      void supabase.auth.signOut({ scope: 'local' });
      setUser(null);
    }
  }, [user?.id, isMaintenanceMode, user, isAdminAuthenticated]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    checkSystemMaintenanceMode(supabase).then((mVal) => {
      setIsMaintenanceMode(mVal);
      try {
        window.localStorage.setItem('bigkas_maintenance_mode_cache', mVal ? 'true' : 'false');
      } catch (e) {}
    });

    const settingsChannel = supabase
      .channel('auth-system-settings-global')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'system_settings',
        },
        async () => {
          const mVal = await checkSystemMaintenanceMode(supabase);
          setIsMaintenanceMode(mVal);
          try {
            window.localStorage.setItem('bigkas_maintenance_mode_cache', mVal ? 'true' : 'false');
          } catch (e) {}
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(settingsChannel);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleModalTrigger = (e) => {
      const reason = e.detail?.reason || 'Another device or browser tab has logged into this account. Only one active account session is allowed at a time.';
      setSessionEjectedReason(reason);
    };
    window.addEventListener('bigkas_trigger_ejection_modal', handleModalTrigger);
    return () => window.removeEventListener('bigkas_trigger_ejection_modal', handleModalTrigger);
  }, []);

  const resolveAvatarUrl = useCallback((avatarValue) => {
    if (!avatarValue) return null;

    if (/^https?:\/\//i.test(avatarValue)) {
      return avatarValue;
    }

    const normalizedPath = avatarValue
      .replace(/^\/+/, '')
      .replace(/^avatars\//, '');

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(normalizedPath);

    return publicUrl || null;
  }, []);

  const clearAdminSession = useCallback(() => {
    setIsAdminAuthenticated(false);
    setStoredAdminSession(false);
  }, []);

  const persistAdminSession = useCallback(() => {
    setIsAdminAuthenticated(true);
    setStoredAdminSession(true);
  }, []);

  /* ── Build user object from Supabase session ── */
  const buildUser = useCallback((supaSession, profile = {}) => {
    if (!supaSession) return null;
    const u = supaSession.user || supaSession;
    const meta = u?.user_metadata || {};
    const onboardingStage = deriveOnboardingStage(meta, profile);
    const levelFields = resolveAuthLevelFields(meta, profile);
    const fullName = meta.full_name || meta.name || u.email?.split('@')[0] || 'User';
    const fallbackFirst = fullName.split(' ')[0] || '';
    const fallbackLast = fullName.split(' ').slice(1).join(' ');

    return {
      id: u.id,
      email: u.email,
      role: profile.role || meta.role || null,
      name: fullName,
      firstName: meta.first_name || fallbackFirst,
      lastName: meta.last_name || fallbackLast,
      nickname: meta.nickname || null,
      avatarUrl: resolveAvatarUrl(meta.avatar_url),
      avatar_url: resolveAvatarUrl(meta.avatar_url),
      onboardingStage,
      profilingCompleted: parseMetadataBoolean(profile.is_profiling_completed) || parseMetadataBoolean(meta.is_profiling_completed) || parseMetadataBoolean(meta.profiling_completed) || hasSpeakerProfileData(meta.speaker_profile),
      pretestCompleted: parseMetadataBoolean(profile.is_pre_test_completed) || parseMetadataBoolean(meta.is_pre_test_completed) || parseMetadataBoolean(meta.pretest_completed),
      pretestScriptedCompleted: parseMetadataBoolean(meta.pretest_scripted_completed) || parseMetadataBoolean(meta.pretest_completed),
      pretestFreeCompleted: parseMetadataBoolean(meta.pretest_free_completed),
      pretestScriptedSessionId: meta.pretest_scripted_session_id || null,
      pretestFreeSessionId: meta.pretest_free_session_id || meta.pretest_session_id || null,
      pretestScriptedScore: Number(meta.pretest_scripted_score ?? 0) || 0,
      pretestFreeScore: Number(meta.pretest_free_score ?? 0) || 0,
      speakerProfile: meta.speaker_profile || null,
      speakerPoints: Number(meta.speaker_points ?? 0) || 0,
      speakerEntryScore: levelFields.speakerEntryScore,
      speakerLevel: levelFields.speakerLevel,
      speakerLevelNumber: levelFields.speakerLevelNumber,
      progressLevelNumber: levelFields.progressLevelNumber,
      speakerPointsHistory: normalizeSpeakerPointsHistory(meta.speaker_points_history),
      onboardingLevelAnalysis: meta.onboarding_level_analysis || null,
      dashboardTutorialSeen: parseMetadataBoolean(profile.dashboard_tutorial_seen) || parseMetadataBoolean(meta.dashboard_tutorial_seen) || parseMetadataBoolean(meta.is_tutorial_completed),
      activeBannerId: meta.active_banner_id || 'default_skyward',
      unlockedBanners: Array.isArray(meta.unlocked_banners) ? meta.unlocked_banners : ['default_skyward'],
      isAudioMuted: typeof window !== 'undefined' && window.localStorage.getItem('bigkas_global_audio_muted_v1') === '1',
      createdAt: u.created_at,
    };
  }, [resolveAvatarUrl]);

  const loadSessionProfile = useCallback(async (userId) => {
    if (!userId) return { profile: null, error: null };
    const cached = profileRequestCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      if (cached.promise) return cached.promise;
      return { profile: cached.profile, error: cached.error };
    }

    const selectProfile = () =>
      supabase
        .from('profiles')
        .select('role, archived_at, is_profiling_completed, is_pre_test_completed, dashboard_tutorial_seen, current_level, speaker_level, diagnostic_score, diagnostic_completed_at')
        .eq('id', userId)
        .maybeSingle();

    const request = (async () => {
      let { data: profile, error } = await selectProfile();

      if (error && (isJwtExpiredError(error) || isAuthSessionError(error))) {
        const { session: fresh, error: refErr } = await ensureFreshAccessToken(undefined, { force: true });
        if (!refErr && fresh) {
          ({ data: profile, error } = await selectProfile());
        } else if (refErr) {
          error = refErr;
        }
      }

      const result = { profile, error };
      profileRequestCache.set(userId, {
        ...result,
        expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
      });
      return result;
    })();

    profileRequestCache.set(userId, {
      promise: request,
      expiresAt: now + PROFILE_CACHE_TTL_MS,
    });

    return request;
  }, []);

  const rejectArchivedSession = useCallback(async (session) => {
    const userId = session?.user?.id;
    if (!userId) return null;

    let profile = null;
    let error = null;

    try {
      ({ profile, error } = await withTimeout(
        loadSessionProfile(userId),
        'Archived profile check',
      ));
    } catch (err) {
      console.debug('Bigkas Auth: archived-profile check skipped after timeout:', err);
      return null;
    }

    if (error) {
      if (isAuthSessionError(error)) {
        setError(SESSION_EXPIRED_MESSAGE);
        setUser(null);
        clearAdminSession();
        profileRequestCache.delete(userId);
        await supabase.auth.signOut({ scope: 'local' });
        return { code: 'session_expired', message: SESSION_EXPIRED_MESSAGE };
      }
      console.warn('Bigkas Auth: archived-profile check skipped:', error);
      return null;
    }

    if (isArchivedProfile(profile)) {
      const message = GENERIC_LOGIN_FAILURE_MESSAGE;
      setError(message);
      setUser(null);
      clearAdminSession();
      await supabase.auth.signOut({ scope: 'local' });
      return { code: 'invalid_credentials', message };
    }

    return null;
  }, [clearAdminSession, loadSessionProfile]);

  const fetchAndMergeProfile = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { profile, error } = await loadSessionProfile(userId);

      if (error) {
        if (isAuthSessionError(error)) {
          console.warn('Bigkas Auth: stale session cleared after profile fetch failed:', error);
          setError(SESSION_EXPIRED_MESSAGE);
          setUser(null);
          clearAdminSession();
          profileRequestCache.delete(userId);
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }
        if (error.code !== 'PGRST116') { // PGRST116 is 'no rows found'
          console.error('Bigkas Auth: failed to fetch profile:', error);
          return;
        } else {
          return;
        }
      }

      if (profile) {
        if (isArchivedProfile(profile)) {
          setError(GENERIC_LOGIN_FAILURE_MESSAGE);
          setUser(null);
          clearAdminSession();
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }

        // --- Session Claiming (decoupled from profile loading) ---
        if (typeof window !== 'undefined') {
          const isFreshLogin = loginInProgressRef.current || adminLoginInProgressRef.current || signupInProgressRef.current;

          // Check if Admin has disabled parallel multi-account sessions on the same device
          if (isFreshLogin) {
            const isMultiAccountAllowed = await checkSystemParallelAccountPolicy(supabase);
            if (!isMultiAccountAllowed) {
              const myFingerprint = getDeviceFingerprint();
              try {
                const { data: deviceConflict } = await supabase
                  .from('profiles')
                  .select('id, first_name, last_name')
                  .neq('id', userId)
                  .not('active_session_token', 'is', null)
                  .eq('active_device_fingerprint', myFingerprint)
                  .maybeSingle();
                if (deviceConflict && deviceConflict.id !== userId) {
                  const conflictedName = [deviceConflict.first_name, deviceConflict.last_name].filter(Boolean).join(' ') || 'User';
                  handleSessionEjection(`Strict Device Lock: Another account (${conflictedName}) is already active on this device. Only one account per device is allowed.`, supabase);
                  return;
                }
              } catch (e) {
                console.warn('[SessionIntegrity] Device conflict check error:', e);
              }
            }
          }

          // Always claim the session (writes active_session_token to DB)
          await forceClaimSession(supabase, userId);
        }


        setUser(prev => {
          if (prev?.id !== userId) return prev;

          const profilingCompleted = prev.profilingCompleted || !!profile.is_profiling_completed;
          const pretestCompleted = prev.pretestCompleted || !!profile.is_pre_test_completed;
          const dashboardTutorialSeen = prev.dashboardTutorialSeen || !!profile.dashboard_tutorial_seen;

          // Recalculate stage using the same logic as deriveOnboardingStage but with derived flags
          let nextStage = prev.onboardingStage;
          if (pretestCompleted && prev.pretestFreeCompleted) {
             if (nextStage !== 'analyzing') nextStage = 'completed';
          } else if (pretestCompleted && !prev.pretestFreeCompleted) {
             nextStage = 'pretest';
          } else if (profilingCompleted) {
             if (nextStage === 'profiling' || !nextStage) nextStage = 'pretest';
          }

          const mergedLevelFields = resolveAuthLevelFields(
            {
              speaker_entry_score: prev.speakerEntryScore,
              speaker_level_number: prev.speakerLevelNumber,
              progress_level_number: prev.progressLevelNumber,
              onboarding_level_analysis: prev.onboardingLevelAnalysis,
            },
            profile,
          );

          return {
            ...prev,
            role: profile.role || prev.role || null,
            isProfilingCompleted: !!profile.is_profiling_completed,
            isPreTestCompleted: !!profile.is_pre_test_completed,
            dashboardTutorialSeen,
            profilingCompleted,
            pretestCompleted,
            onboardingStage: nextStage,
            progressLevelNumber: mergedLevelFields.progressLevelNumber,
            speakerLevel: mergedLevelFields.speakerLevel,
            speakerLevelNumber: mergedLevelFields.speakerLevelNumber,
            speakerEntryScore: mergedLevelFields.speakerEntryScore,
            isAudioMuted: typeof window !== 'undefined' && window.localStorage.getItem('bigkas_global_audio_muted_v1') === '1',
          };
        });
      }
    } catch (err) {
      console.error('Bigkas Auth: unexpected error fetching profile:', err);
    }
  }, [clearAdminSession, loadSessionProfile]);

  useEffect(() => {
    if (!user?.id || !user?.onboardingStage) return;

    let isCancelled = false;

    const syncDerivedOnboardingMetadata = async () => {
      let { data, error: getUserError } = await supabase.auth.getUser();
      if (
        getUserError
        && (getUserError.status === 401 || getUserError.status === 403)
      ) {
        const { session: fresh, error: refErr } = await ensureFreshAccessToken(undefined, { force: true });
        if (!refErr && fresh) {
          ({ data, error: getUserError } = await supabase.auth.getUser());
        }
      }
      if (isCancelled || getUserError || !data?.user) return;

      const meta = data.user.user_metadata || {};
      const normalizedStage = deriveOnboardingStage(meta);
      const normalizedProfiling = parseMetadataBoolean(meta.profiling_completed) || hasSpeakerProfileData(meta.speaker_profile);
      const normalizedPretest = parseMetadataBoolean(meta.pretest_completed);
      const normalizedPretestScripted = parseMetadataBoolean(meta.pretest_scripted_completed);
      const normalizedPretestFree = parseMetadataBoolean(meta.pretest_free_completed);

      const remoteMetadataIsAhead =
        getOnboardingStageRank(normalizedStage) > getOnboardingStageRank(user.onboardingStage) ||
        (normalizedProfiling && !user.profilingCompleted) ||
        (normalizedPretest && !user.pretestCompleted) ||
        (normalizedPretestScripted && !user.pretestScriptedCompleted) ||
        (normalizedPretestFree && !user.pretestFreeCompleted);

      if (remoteMetadataIsAhead) {
        setUser(buildUser({ user: data.user }));
        return;
      }

      if (
        normalizedStage === user.onboardingStage &&
        normalizedProfiling === user.profilingCompleted &&
        normalizedPretest === user.pretestCompleted &&
        normalizedPretestScripted === user.pretestScriptedCompleted &&
        normalizedPretestFree === user.pretestFreeCompleted
      ) {
        return;
      }

      await supabase.auth.updateUser({
        data: {
          ...meta,
          onboarding_stage: user.onboardingStage,
          profiling_completed: user.profilingCompleted,
          pretest_completed: user.pretestCompleted,
          pretest_scripted_completed: user.pretestScriptedCompleted,
          pretest_free_completed: user.pretestFreeCompleted,
        },
      });
    };

    syncDerivedOnboardingMetadata();

    return () => {
      isCancelled = true;
    };
  }, [buildUser, user?.id, user?.onboardingStage, user?.profilingCompleted, user?.pretestCompleted, user?.pretestScriptedCompleted, user?.pretestFreeCompleted]);

  /* ── Restore session on mount ── */
  useEffect(() => {
    let isMounted = true;
    let isBootstrapped = false;

    const bootstrapTimeout = setTimeout(() => {
      if (!isMounted || isBootstrapped) return;
      isBootstrapped = true;
      setIsLoading(false);
      setIsInitializing(false);
    }, 8000);

    (async () => {
      if (!isMounted || isBootstrapped) return;

      let oauthSession = null;
      try {
        const oauthResult = await completeWebOAuthCallback();
        oauthSession = oauthResult.session;
      } catch (oauthError) {
        console.warn('Bigkas Auth: OAuth callback exchange error:', oauthError);
        const fallbackSession = await supabase.auth.getSession().catch(() => null);
        oauthSession = fallbackSession?.data?.session ?? null;
        if (!oauthSession) {
          setError(oauthError?.message || 'Google sign-in failed. Please try again.');
        }
      }

      const { data: { session: restoredSession }, error } = await supabase.auth.getSession();
      const initialSession = oauthSession || restoredSession;

      if (error) {
        console.warn('Bigkas Auth: session restoration error:', error);
        // Recover from "Refresh Token Not Found" or other 400 Bad Request errors by clearing local session
        if (error.message?.includes('Refresh Token') || error.status === 400) {
          await supabase.auth.signOut({ scope: 'local' });
        }
      }

      let session = initialSession;
      if (session) {
        const { session: freshSession, error: refreshErr } = await ensureFreshAccessToken(session);
        if (refreshErr) {
          const msg = String(refreshErr.message || '').toLowerCase();
          const fatalRefresh =
            msg.includes('refresh token')
            || msg.includes('invalid')
            || refreshErr.status === 400
            || refreshErr.status === 401
            || refreshErr.status === 403;
          if (fatalRefresh) {
            await supabase.auth.signOut({ scope: 'local' });
            session = null;
          }
        } else if (freshSession) {
          session = freshSession;
        }
      }

      const blockedAccount = getAccountBlockedMessage(session?.user?.user_metadata || {});
      if (blockedAccount) {
        setError(blockedAccount.message);
        setUser(null);
        clearAdminSession();
        await supabase.auth.signOut({ scope: 'local' });
        isBootstrapped = true;
        clearTimeout(bootstrapTimeout);
        setIsLoading(false);
        setIsInitializing(false);
        return;
      }

      const blockedProfile = await rejectArchivedSession(session);
      if (blockedProfile) {
        isBootstrapped = true;
        clearTimeout(bootstrapTimeout);
        setIsLoading(false);
        setIsInitializing(false);
        return;
      }

      const cachedProfile = session?.user?.id ? profileRequestCache.get(session.user.id)?.profile : null;
      const nextUser = buildUser(session, cachedProfile || {});
      setUser(nextUser);
      if (nextUser?.id) {
        void fetchAndMergeProfile(nextUser.id);
      }
      if (!nextUser) {
        clearAdminSession();
      }
      isBootstrapped = true;
      clearTimeout(bootstrapTimeout);
      setIsLoading(false);
      setIsInitializing(false);
    })().catch((err) => {
      if (!isMounted || isBootstrapped) return;
      console.error('Bigkas Auth: unexpected bootstrap error:', err);
      clearAdminSession();
      isBootstrapped = true;
      clearTimeout(bootstrapTimeout);
      setIsLoading(false);
      setIsInitializing(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Skip auth state changes while signup is in progress to prevent race conditions
      // that would reset pendingEmailVerification or cause unwanted navigation
      if (signupInProgressRef.current) return;
      // User password login performs an archived-profile check after Supabase accepts
      // credentials. Keep the session unpublished until that check finishes.
      if (loginInProgressRef.current) return;
      // Admin login performs an additional role check after Supabase accepts
      // credentials. Do not publish the session as a regular user before that
      // check finishes, or public routes can briefly render the user login flow.
      if (adminLoginInProgressRef.current) return;

      if (_event === 'TOKEN_REFRESHED' && session?.user?.id === currentUserIdRef.current) {
        return;
      }

      if (_event === 'SIGNED_OUT') {
        setPendingEmailVerification(false);
        setPendingEmail(null);
        setUser(null);
        clearAdminSession();
        return;
      }

      const blockedAccount = getAccountBlockedMessage(session?.user?.user_metadata || {});
      if (blockedAccount) {
        setError(blockedAccount.message);
        setPendingEmailVerification(false);
        setPendingEmail(null);
        setUser(null);
        clearAdminSession();
        void supabase.auth.signOut({ scope: 'local' });
        return;
      }

      const blockedProfile = await rejectArchivedSession(session);
      if (blockedProfile) return;

      const cachedProfile = session?.user?.id ? profileRequestCache.get(session.user.id)?.profile : null;
      const nextUser = buildUser(session, cachedProfile || {});
      const emailConfirmed = hasVerifiedAuthIdentity(session?.user);

      if (session?.user && !emailConfirmed) {
        setPendingEmailVerification(true);
        setPendingEmail(session.user.email || null);
        setUser(null);
        clearAdminSession();
        void supabase.auth.signOut({ scope: 'local' });
        return;
      }

      setPendingEmailVerification(false);
      setPendingEmail(null);
      setUser(nextUser);
      if (nextUser?.id) {
        void fetchAndMergeProfile(nextUser.id);
      }
      if (!nextUser) {
        clearAdminSession();
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(bootstrapTimeout);
      subscription.unsubscribe();
    };
  }, [buildUser, clearAdminSession, fetchAndMergeProfile, rejectArchivedSession]);

  /* ── Native OAuth deep-link completion ── */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let isDisposed = false;

    const completeNativeOAuth = async (url) => {
      if (!url || !String(url).startsWith(NATIVE_AUTH_REDIRECT_URL)) return;
      try {
        const params = getAuthParamsFromUrl(url);
        const errorDescription = params.get('error_description') || params.get('error');
        if (errorDescription) {
          throw new Error(errorDescription);
        }

        const code = params.get('code');
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        clearInstanceClaimKeys();

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          return;
        }

        await Browser.close().catch(() => {});
        if (!isDisposed && typeof window !== 'undefined' && window.location.pathname === '/login') {
          window.history.replaceState(null, '', ROUTES.ACTIVITY);
          window.dispatchEvent(new Event('popstate'));
        }
      } catch (authError) {
        await Browser.close().catch(() => {});
        if (!isDisposed) {
          const message = authError?.message || 'Google sign-in failed. Please try again.';
          setError(message);
          setIsLoading(false);
        }
      }
    };

    let listenerHandle;
    CapacitorApp.getLaunchUrl()
      .then((launch) => completeNativeOAuth(launch?.url))
      .catch(() => {});
    CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      void completeNativeOAuth(url);
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      isDisposed = true;
      listenerHandle?.remove?.();
    };
  }, []);

  /* ── Refresh JWT when the tab becomes visible (background tabs throttle auto-refresh timers) ── */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) void ensureFreshAccessToken(session);
      });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /* ── Login ── */
  const login = useCallback(async (email, password) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const lockStatus = await getLoginLockStatus('user', normalizedEmail);
    if (lockStatus.error) {
      const details = String(lockStatus.error?.message || '').trim();
      const message = isJwtVerificationError(lockStatus.error)
        ? 'Session token is invalid. Please refresh the page and sign in again.'
        : (details
          ? `Unable to verify login policy right now. ${details}`
          : 'Unable to verify login policy right now. Please try again.');
      setError(message);
      return {
        success: false,
        code: 'login_policy_unavailable',
        error: message,
        requiresEmailConfirmation: false,
      };
    }

    if (lockStatus.isLocked) {
      const message = buildLockoutMessage(lockStatus.remainingSeconds, lockStatus.failedAttempts);
      setIsLoading(false);
      setError(message);
      return {
        success: false,
        code: 'account_locked',
        error: message,
        requiresEmailConfirmation: false,
        lockoutSeconds: lockStatus.remainingSeconds,
        unlockTime: lockStatus.unlockTime,
      };
    }

    setIsLoading(true);
    setError(null);
    clearAdminSession();
    clearInstanceClaimKeys();
    loginInProgressRef.current = true;

    try {
      // Direct Supabase login (no gateway)
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });

      setIsLoading(false);

      if (err) {
        const normalizedError = normalizeLoginError(err, email);

        if (shouldTrackCredentialFailure(normalizedError.code)) {
          const failureResult = await registerLoginFailure('user', normalizedEmail);
          if (failureResult.error) {
            setError('Unable to update login attempts right now. Please try again.');
            return {
              success: false,
              code: 'login_policy_unavailable',
              error: 'Unable to update login attempts right now. Please try again.',
              requiresEmailConfirmation: false,
            };
          }

          if (failureResult.locked) {
            const message = buildLockoutMessage(failureResult.lockoutSeconds, failureResult.failedAttempts);
            setError(message);
            return {
              success: false,
              code: 'account_locked',
              error: message,
              requiresEmailConfirmation: false,
              lockoutSeconds: failureResult.lockoutSeconds,
              unlockTime: failureResult.unlockTime,
            };
          }
        }

        setError(normalizedError.message);
        return {
          success: false,
          code: normalizedError.code,
          error: normalizedError.message,
          requiresEmailConfirmation: false,
          lockoutSeconds: normalizedError.lockoutSeconds,
        };
      }

      const emailConfirmed = hasVerifiedAuthIdentity(data.user);
      if (!emailConfirmed) {
        setPendingEmailVerification(true);
        setPendingEmail(email);
        const message = 'Verify your email address first. Then click resend email below if you need a new link.';
        setError(message);
        await supabase.auth.signOut({ scope: 'local' });
        return {
          success: false,
          code: 'email_not_confirmed',
          error: message,
          requiresEmailConfirmation: true,
        };
      }

      // Block deactivated / deleted accounts
      const meta = data.user?.user_metadata || {};
      if (parseMetadataBoolean(meta.account_deactivated) || parseMetadataBoolean(meta.account_deleted)) {
        await supabase.auth.signOut({ scope: 'local' });
        const blockedMessage = GENERIC_LOGIN_FAILURE_MESSAGE;
        setError(blockedMessage);
        return {
          success: false,
          code: 'invalid_credentials',
          error: blockedMessage,
        };
      }

      const blockedProfile = await rejectArchivedSession(data.session);
      if (blockedProfile) {
        return {
          success: false,
          code: blockedProfile.code,
          error: blockedProfile.message,
        };
      }

      const maintenanceActive = await checkSystemMaintenanceMode(supabase);
      if (maintenanceActive) {
        let userRole = data.user?.user_metadata?.role;
        if (!userRole && data.user?.id) {
          const { data: roleRow } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
          userRole = roleRow?.role;
        }
        if (userRole !== 'admin' && userRole !== 'superadmin') {
          await supabase.auth.signOut({ scope: 'local' });
          const maintMsg = 'System is currently under maintenance. Please come back later.';
          setError(maintMsg);
          return { success: false, code: 'maintenance_mode', error: maintMsg };
        }
      }

      setPendingEmailVerification(false);
      setPendingEmail(null);
      const cachedProfile = data.session?.user?.id ? profileRequestCache.get(data.session.user.id)?.profile : null;
      const nextUser = buildUser(data.session, cachedProfile || {});
      setUser(nextUser);
      if (data.user?.id) {
        await fetchAndMergeProfile(data.user.id);
      }
      await registerLoginSuccess('user', normalizedEmail);
      return { success: true, user: nextUser };
    } catch (networkError) {
      setIsLoading(false);
      if (isBlockedByClient(networkError)) {
        const msg = 'Login blocked by your browser. Please disable ad-blockers or privacy extensions for this site and try again.';
        setError(msg);
        return { success: false, error: msg, code: 'blocked_by_client' };
      }
      const message = networkError?.message || 'An unexpected error occurred during login. Please try again.';
      setError(message);
      return { success: false, error: message };
    } finally {
      loginInProgressRef.current = false;
    }
  }, [buildUser, clearAdminSession, fetchAndMergeProfile, rejectArchivedSession]);

  /* ── Admin Login ── */
  const adminLogin = useCallback(async (email, password) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const lockStatus = await getLoginLockStatus('admin', normalizedEmail);
    if (lockStatus.error) {
      const details = String(lockStatus.error?.message || '').trim();
      const message = isJwtVerificationError(lockStatus.error)
        ? 'Session token is invalid. Please refresh the page and sign in again.'
        : (details
          ? `Unable to verify login policy right now. ${details}`
          : 'Unable to verify login policy right now. Please try again.');
      setError(message);
      return {
        success: false,
        code: 'login_policy_unavailable',
        error: message,
      };
    }

    if (lockStatus.isLocked) {
      const message = buildLockoutMessage(lockStatus.remainingSeconds, lockStatus.failedAttempts);
      setIsLoading(false);
      setError(message);
      return {
        success: false,
        code: 'account_locked',
        error: message,
        lockoutSeconds: lockStatus.remainingSeconds,
        unlockTime: lockStatus.unlockTime,
      };
    }

    setIsLoading(true);
    setError(null);
    clearInstanceClaimKeys();
    adminLoginInProgressRef.current = true;

    try {
      // First login with Supabase
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });

      if (err) {
        const normalizedError = normalizeLoginError(err, email);

        if (shouldTrackCredentialFailure(normalizedError.code)) {
          const failureResult = await registerLoginFailure('admin', normalizedEmail);
          if (failureResult.error) {
            setError('Unable to update login attempts right now. Please try again.');
            return {
              success: false,
              code: 'login_policy_unavailable',
              error: 'Unable to update login attempts right now. Please try again.',
            };
          }

          if (failureResult.locked) {
            const message = buildLockoutMessage(failureResult.lockoutSeconds, failureResult.failedAttempts);
            setError(message);
            return {
              success: false,
              code: 'account_locked',
              error: message,
              lockoutSeconds: failureResult.lockoutSeconds,
              unlockTime: failureResult.unlockTime,
            };
          }
        }

        setError(normalizedError.message);
        return {
          success: false,
          code: normalizedError.code,
          error: normalizedError.message,
          lockoutSeconds: normalizedError.lockoutSeconds,
        };
      }

      const emailConfirmed = hasVerifiedAuthIdentity(data.user);
      if (!emailConfirmed) {
        setPendingEmailVerification(true);
        setPendingEmail(email);
        setUser(null);
        clearAdminSession();
        const message = 'Verify your email address first. Then click resend email below if you need a new link.';
        setError(message);
        await supabase.auth.signOut({ scope: 'local' });
        return {
          success: false,
          code: 'email_not_confirmed',
          error: message,
          requiresEmailConfirmation: true,
        };
      }

      // Authorize admin access strictly from public.profiles.role
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, archived_at')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile || !profile.role) {
        setUser(null);
        clearAdminSession();
        await supabase.auth.signOut({ scope: 'local' });
        const message = GENERIC_LOGIN_FAILURE_MESSAGE;
        setError(message);
        return {
          success: false,
          code: 'invalid_credentials',
          error: message,
        };
      }

      if (isArchivedProfile(profile)) {
        setUser(null);
        clearAdminSession();
        await supabase.auth.signOut({ scope: 'local' });
        const message = GENERIC_LOGIN_FAILURE_MESSAGE;
        setError(message);
        return {
          success: false,
          code: 'invalid_credentials',
          error: message,
        };
      }

      if (profile.role !== 'admin' && profile.role !== 'superadmin') {
        setUser(null);
        clearAdminSession();
        await supabase.auth.signOut({ scope: 'local' });
        const message = 'Access Denied: Admin privileges required.';
        setError(message);
        return {
          success: false,
          code: 'insufficient_permissions',
          error: message,
        };
      }

      setPendingEmailVerification(false);
      setPendingEmail(null);
      const cachedProfile = data.session?.user?.id ? profileRequestCache.get(data.session.user.id)?.profile : null;
      const nextUser = buildUser(data.session, cachedProfile || {});
      setUser(nextUser);
      if (data.user?.id) {
        await fetchAndMergeProfile(data.user.id);
      }
      persistAdminSession();
      await registerLoginSuccess('admin', normalizedEmail);
      return { success: true, user: nextUser };
    } catch {
      setUser(null);
      clearAdminSession();
      const message = 'Admin login failed. Please try again.';
      setError(message);
      return {
        success: false,
        code: 'admin_login_error',
        error: message,
      };
    } finally {
      adminLoginInProgressRef.current = false;
      setIsLoading(false);
    }
  }, [buildUser, clearAdminSession, persistAdminSession]);

  /* ── Register ── */
  const register = useCallback(async ({ name, firstName, lastName, email, password }) => {
    const cooldownUntil = Math.max(signupCooldownUntilRef.current, getSignupCooldownUntil());
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs > 0) {
      const waitSeconds = Math.ceil(remainingMs / 1000);
      const message = `Too many signup attempts. Please wait ${waitSeconds}s and try again.`;
      setError(message);
      return { success: false, error: message };
    }

    const maintenanceActive = await checkSystemMaintenanceMode(supabase);
    if (maintenanceActive) {
      const message = 'System is currently under maintenance. New account registration is temporarily disabled. Please come back later.';
      setError(message);
      return { success: false, error: message };
    }

    setIsLoading(true);
    setError(null);
    clearInstanceClaimKeys();
    signupInProgressRef.current = true;
    const normalizedEmail = (email || '').trim();
    const resolvedFirstName = (firstName || '').trim();
    const resolvedLastName = (lastName || '').trim();
    const resolvedFullName =
      (name || '').trim() ||
      `${resolvedFirstName} ${resolvedLastName}`.trim();

    const emailRedirectTo = getWebRedirectPath('/verify-email');
    const ALREADY_REGISTERED_ERROR = 'An account with this email already exists. Please log in instead.';

    try {
      // Pre-check if email already exists in profiles table
      try {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', normalizedEmail)
          .maybeSingle();

        if (existingProfile) {
          setIsLoading(false);
          signupInProgressRef.current = false;
          setError(ALREADY_REGISTERED_ERROR);
          return { success: false, error: ALREADY_REGISTERED_ERROR };
        }
      } catch {
        // Non-blocking fallback to auth check
      }

      // Supabase signup attempt
      const signupPromise = supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo,
          data: {
            full_name: resolvedFullName,
            first_name: resolvedFirstName || undefined,
            last_name: resolvedLastName || undefined,
          },
        },
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SIGNUP_TIMEOUT')), 15000)
      );

      const { data, error: err } = await Promise.race([signupPromise, timeoutPromise]);
      setIsLoading(false);

      if (err) {
        const errMsg = err.message || '';
        const errStatus = err.status || 0;

        // Rate-limited
        if (errStatus === 429 || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('too many')) {
          const cooldownUntilTs = Date.now() + 60_000;
          signupCooldownUntilRef.current = cooldownUntilTs;
          setSignupCooldownUntil(cooldownUntilTs);
          const message = 'Too many signup attempts. Please wait 60 seconds and try again.';
          setError(message);
          return { success: false, error: message };
        }

        // Already registered
        if (errMsg.toLowerCase().includes('already registered') || errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('already been registered')) {
          setError(ALREADY_REGISTERED_ERROR);
          return { success: false, error: ALREADY_REGISTERED_ERROR };
        }

        // SMTP / email sending failure (500)
        // The user may have been created but the confirmation email failed.
        // Try to recover by resending the confirmation email separately.
        if (errStatus === 500 || errMsg.toLowerCase().includes('internal server') || errMsg.toLowerCase().includes('sending confirmation')) {
          try {
            const { error: resendErr } = await supabase.auth.resend({
              type: 'signup',
              email: normalizedEmail,
              options: { emailRedirectTo },
            });

            if (!resendErr) {
              // Recovery succeeded: the verification code email was sent.
              setPendingEmailVerification(true);
              setPendingEmail(normalizedEmail);
              return { success: true, requiresEmailConfirmation: true };
            }
          } catch {
            // Resend also failed, fall through to error
          }

          const message = 'Account may have been created but the verification code could not be sent. Please try logging in, or try again in a few minutes.';
          setError(message);
          return { success: false, error: message };
        }

        // Password too weak
        if (errMsg.toLowerCase().includes('password')) {
          const message = 'Password does not meet the requirements. Please choose a stronger password (at least 8 characters).';
          setError(message);
          return { success: false, error: message };
        }

        // Generic fallback
        setError(errMsg);
        return { success: false, error: errMsg };
      }

      // Check for existing account when Supabase email enumeration protection is ON:
      // Supabase returns 200 with identities: [] if the account already exists.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError(ALREADY_REGISTERED_ERROR);
        return { success: false, error: ALREADY_REGISTERED_ERROR };
      }

      if (!data.session) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(PENDING_SIGNUP_PASSWORD_KEY, password);
        }
        // Email verification required.
        setPendingEmailVerification(true);
        setPendingEmail(normalizedEmail);
        return { success: true, requiresEmailConfirmation: true };
      }
      return { success: true, user: buildUser(data.session) };
    } catch (networkError) {
      setIsLoading(false);
      if (isBlockedByClient(networkError)) {
        const msg = 'Registration blocked by your browser. Please disable ad-blockers for this site to receive the verification code.';
        setError(msg);
        return { success: false, error: msg, code: 'blocked_by_client' };
      }
      const message = networkError?.message || '';

      // Signup request timed out — SMTP is likely hanging
      if (message === 'SIGNUP_TIMEOUT') {
        const errorMsg = 'Account creation is taking too long (email service may be slow). Please try again in a moment.';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      if (message.toLowerCase().includes('fetch') || message.toLowerCase().includes('network') || message.toLowerCase().includes('failed')) {
        const errorMsg = 'Network error. Please check your internet connection and try again.';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      const errorMsg = 'An unexpected error occurred during sign-up. Please try again.';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      // Reset flag after a short delay to let any pending auth events settle
      setTimeout(() => { signupInProgressRef.current = false; }, 3000);
    }
  }, [buildUser]);

  /* ── Google OAuth Login ── */
  const loginWithGoogle = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    clearAdminSession();
    clearInstanceClaimKeys();

    rememberOAuthReturnPath(ROUTES.ACTIVITY);
    const redirectTo = getOAuthRedirectPath(ROUTES.AUTH_CALLBACK);

    const { data, error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: Capacitor.isNativePlatform(),
      },
    });

    if (err) {
      setIsLoading(false);
      if (isBlockedByClient(err)) {
        const msg = 'Google sign-in was blocked by your browser (common with Brave Shields or aggressive ad-blockers). Please disable Brave Shields for this site and try again.';
        setError(msg);
        return { success: false, error: msg, code: 'blocked_by_client' };
      }
      setError(err.message);
      return { success: false, error: err.message };
    }

    if (Capacitor.isNativePlatform() && data?.url) {
      await Browser.open({ url: data.url });
    }

    return { success: true };
  }, [clearAdminSession]);

  /* ── Resend verification code ── */
  const resendVerificationEmail = useCallback(async (email) => {
    const normalizedEmail = (email || '').trim();
    if (!normalizedEmail) {
      return { success: false, error: 'Enter your email to resend verification.' };
    }

    const emailRedirectTo = getWebRedirectPath('/verify-email');

    // Try standard signup resend first
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: { emailRedirectTo },
    });

    if (!resendErr) {
      return { success: true };
    }

    // Fallback via Supabase signInWithOtp (Magic Link/OTP template)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false, emailRedirectTo },
    });

    if (err) {
      if (isBlockedByClient(err)) {
        return { success: false, error: 'Resend blocked by your browser. Please disable ad-blockers for this site and try again.' };
      }
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('rate limit') || msg.includes('too many') || err.status === 429) {
        return { success: false, error: 'Please wait before requesting another verification code.' };
      }
      return { success: false, error: err.message };
    }

    return { success: true };
  }, []);

  /* ── Logout ── */
  const logout = useCallback(async () => {
    setIsLoading(true);
    if (user?.id) {
      try {
        await supabase
          .from('profiles')
          .update({ active_session_token: null, active_device_fingerprint: null })
          .eq('id', user.id);
      } catch (e) {
        console.warn('Signout session token clear failed:', e);
      }
    }
    clearInstanceClaimKeys();
    await supabase.auth.signOut();
    setUser(null);
    clearAdminSession();
    setIsLoading(false);
  }, [clearAdminSession, user?.id]);

  /* ── Update nickname ── */
  const updateNickname = useCallback(async (nickname) => {
    const trimmed = nickname.trim();
    if (!trimmed) return { success: false, error: 'Nickname is required' };
    const metadataUpdates = {
      nickname: trimmed,
      onboarding_stage: user?.onboardingStage || 'profiling',
      profiling_completed: !!user?.profilingCompleted,
      pretest_completed: !!user?.pretestCompleted,
    };
    const { data, error: err } = await supabase.auth.updateUser({ data: metadataUpdates });
    if (err) return { success: false, error: err.message };
    setUser((prev) => ({ ...prev, nickname: trimmed, ...buildUser({ user: data.user }, { role: prev?.role }) }));
    return { success: true };
  }, [buildUser, user?.onboardingStage, user?.pretestCompleted, user?.profilingCompleted]);

  /* ── Update arbitrary user metadata ── */
  const updateUserMetadata = useCallback(async (updates = {}) => {
    if (!updates || typeof updates !== 'object') {
      return { success: false, error: 'Invalid metadata updates.' };
    }

    const { data, error: err } = await supabase.auth.updateUser({ data: updates });
    if (err) return { success: false, error: err.message };

    // Sync with public.profiles if completion flags are present
    const profileUpdates = {};
    if (updates.profiling_completed !== undefined) {
      profileUpdates.is_profiling_completed = !!updates.profiling_completed;
    }
    if (updates.pretest_completed !== undefined) {
      profileUpdates.is_pre_test_completed = !!updates.pretest_completed;
    }
    if (updates.onboarding_completed !== undefined) {
      profileUpdates.diagnostic_completed_at = updates.onboarding_completed ? new Date().toISOString() : null;
    }
    const nextMeta = data.user?.user_metadata || {};
    const resolvedLevelFields = resolveAuthLevelFields(nextMeta);
    const requestedProgressLevel = normalizeLevelNumber(
      updates.progress_level_number ?? updates.current_level,
    );
    const requestedSpeakerLevel = normalizeLevelNumber(
      updates.speaker_level_number ?? (
        Number.isFinite(Number(updates.speaker_level)) ? updates.speaker_level : null
      ),
    );
    const requestedEntryScore = normalizeEntryScore(updates.speaker_entry_score);
    const analysisLevel = normalizeLevelNumber(updates.onboarding_level_analysis?.estimated_level_number);

    if (requestedProgressLevel) {
      profileUpdates.current_level = requestedProgressLevel;
    } else if (updates.onboarding_completed || analysisLevel) {
      profileUpdates.current_level = analysisLevel || resolvedLevelFields.progressLevelNumber;
    }

    if (requestedSpeakerLevel) {
      profileUpdates.speaker_level = requestedSpeakerLevel;
    } else if (updates.onboarding_completed || analysisLevel) {
      profileUpdates.speaker_level = analysisLevel || resolvedLevelFields.speakerLevelNumber;
    }

    if (requestedEntryScore) {
      profileUpdates.diagnostic_score = requestedEntryScore;
    } else if (updates.onboarding_completed && resolvedLevelFields.speakerEntryScore) {
      profileUpdates.diagnostic_score = resolvedLevelFields.speakerEntryScore;
    }

    if (updates.dashboard_tutorial_seen !== undefined) {
      profileUpdates.dashboard_tutorial_seen = !!updates.dashboard_tutorial_seen;
    }
    if (updates.demographic_profile !== undefined) {
      profileUpdates.demographic_profile = updates.demographic_profile;
    }
    if (updates.speaker_profile !== undefined) {
      profileUpdates.speaker_profile = updates.speaker_profile;
    }
    if (updates.is_audio_muted !== undefined) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('bigkas_global_audio_muted_v1', updates.is_audio_muted ? '1' : '0');
      }
    }

    if (Object.keys(profileUpdates).length > 0 && data.user?.id) {
      const profileSyncResult = await syncProfileUpdates(data.user.id, profileUpdates);
      if (profileSyncResult.error) {
        return { success: false, error: profileSyncResult.error };
      }
    }

    const nextUser = buildUser({ user: data.user }, { ...profileUpdates, role: user?.role });
    setUser(nextUser);
    return { success: true, user: nextUser };
  }, [buildUser, user?.role]);

  /* ── Update profile ── */
  const updateProfile = useCallback(async ({ name, full_name, first_name, last_name, nickname, avatarUrl, avatar_url }) => {
    const updates = {};
    const resolvedName = (name ?? full_name)?.trim();
    const resolvedFirstName = first_name?.trim();
    const resolvedLastName = last_name?.trim();

    if (resolvedFirstName !== undefined) updates.first_name = resolvedFirstName;
    if (resolvedLastName !== undefined) updates.last_name = resolvedLastName;

    if (!resolvedName && (resolvedFirstName !== undefined || resolvedLastName !== undefined)) {
      const fallbackFullName = `${resolvedFirstName || ''} ${resolvedLastName || ''}`.trim();
      updates.full_name = fallbackFullName;
    }

    if (resolvedName) updates.full_name = resolvedName;
    if (nickname !== undefined) updates.nickname = nickname || null;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;

    const { data, error: err } = await supabase.auth.updateUser({ data: updates });
    if (err) return { success: false, error: err.message };
    setUser(buildUser({ user: data.user }));
    return { success: true };
  }, [buildUser]);

  /* ── Change password ── */
  const changePassword = useCallback(async (payload) => {
    const nextPassword = typeof payload === 'string' ? payload : payload?.newPassword;
    const currentPassword = typeof payload === 'string' ? null : payload?.currentPassword;

    if (!nextPassword || nextPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters.' };
    }

    if (currentPassword) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return { success: false, error: 'Not authenticated' };

      const { error: reAuthErr } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword,
      });
      if (reAuthErr) return { success: false, error: 'Current password is incorrect.' };
    }

    const { error: err } = await supabase.auth.updateUser({ password: nextPassword });
    if (err) return { success: false, error: err.message };
    return { success: true };
  }, []);

  /* ── Upload avatar ── */
  const uploadAvatar = useCallback(async (file) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Not authenticated' };
    const ext = file.name.split('.').pop();
    const path = `${session.user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('avatars').upload(path, file, { upsert: true });
    if (upErr) return { success: false, error: upErr.message };
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    return { success: true, url: publicUrl };
  }, []);

  /* ── Deactivate account ── */
  const deactivateAccount = useCallback(async ({ password }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Not authenticated' };

    // Verify password
    const { error: reAuthErr } = await supabase.auth.signInWithPassword({
      email: session.user.email, password,
    });
    if (reAuthErr) return { success: false, error: 'Incorrect password.' };

    // Set deactivation flag in user metadata
    const { error: updateErr } = await supabase.auth.updateUser({
      data: {
        account_deactivated: true,
        account_deactivated_at: new Date().toISOString(),
      },
    });
    if (updateErr) return { success: false, error: updateErr.message };

    // Sign the user out
    await supabase.auth.signOut();
    setUser(null);
    clearAdminSession();
    return { success: true };
  }, [clearAdminSession]);

  /* ── Delete account ── */
  const deleteAccount = useCallback(async ({ password }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Not authenticated' };
    const userId = session.user.id;

    // Verify password
    const { error: reAuthErr } = await supabase.auth.signInWithPassword({
      email: session.user.email, password,
    });
    if (reAuthErr) return { success: false, error: 'Incorrect password.' };

    // Delete user data from database
    if (ENV.ENABLE_SESSION_PERSISTENCE) {
      const { error: sessionDeleteError } = await supabase
        .from('sessions')
        .delete()
        .eq('user_id', userId);

      const missingSessionsTable = sessionDeleteError?.code === '42P01' ||
        sessionDeleteError?.status === 404 ||
        sessionDeleteError?.message?.toLowerCase().includes('relation') ||
        sessionDeleteError?.message?.toLowerCase().includes('does not exist');

      if (sessionDeleteError && !missingSessionsTable) {
        return { success: false, error: sessionDeleteError.message };
      }
    }

    // Delete avatar from storage
    try {
      const { data: avatarFiles } = await supabase.storage
        .from('avatars')
        .list(userId);
      if (avatarFiles?.length) {
        await supabase.storage
          .from('avatars')
          .remove(avatarFiles.map((f) => `${userId}/${f.name}`));
      }
    } catch {
      // Avatar cleanup is best-effort
    }

    // Mark account as deleted in user metadata so login is blocked
    const { error: markDeletedError } = await supabase.auth.updateUser({
      data: {
        account_deleted: true,
        account_deleted_at: new Date().toISOString(),
        account_deactivated: true,
      },
    });
    if (markDeletedError) return { success: false, error: markDeletedError.message };

    // Sign the user out
    await supabase.auth.signOut();
    setUser(null);
    clearAdminSession();
    return { success: true };
  }, [clearAdminSession]);

  const clearError = useCallback(() => setError(null), []);

  /* ── Real-Time Single-Instance Heartbeat & Subscription ── */
  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return;

    let active = true;
    const myToken = getOrGenerateInstanceToken();
    const uid = user.id;

    // Helper to check if this specific tab has successfully claimed the active session
    const isClaimedByMe = () => {
      if (typeof window === 'undefined') return false;
      const claimedKey = `bigkas_instance_claimed_${uid}`;
      return window.sessionStorage.getItem(claimedKey) === '1';
    };

    // 1. Check integrity against profiles table and strict device policy
    const verifyIntegrity = async () => {
      if (!active) return;
      try {
        const timeSinceClaim = Date.now() - (window.__bigkasClaimTimestamp || 0);
        const inClaimGracePeriod = timeSinceClaim < 3000; // 3s grace period while our claim settles in DB

        // First check: poll profiles table for session token mismatch (only if claimed by this tab)
        if (!inClaimGracePeriod && isClaimedByMe()) {
          const { data: profileData, error: profileErr } = await supabase
            .from('profiles')
            .select('active_session_token')
            .eq('id', uid)
            .maybeSingle();

          if (profileErr) {
            // Column might not exist — log once but don't crash the heartbeat
            if (!window.__bigkasIntegrityWarnLogged) {
              console.warn('[SessionIntegrity] verifyIntegrity query error:', profileErr.message, '(code:', profileErr.code, ')');
              window.__bigkasIntegrityWarnLogged = true;
            }
          } else {
            const profileToken = profileData?.active_session_token;
            if (profileToken && profileToken !== myToken && active) {
              handleSessionEjection('Logged Out: Another device or browser tab has logged into this account. Disconnecting...', supabase);
              return;
            }
          }
        }

        // Second check: strict device policy if multi-account is disabled
        const isMultiAccountAllowed = await checkSystemParallelAccountPolicy(supabase);
        if (!isMultiAccountAllowed && active) {
          const myFingerprint = getDeviceFingerprint();
          try {
            const { data: conflict } = await supabase
              .from('profiles')
              .select('id, first_name, last_name')
              .neq('id', uid)
              .not('active_session_token', 'is', null)
              .eq('active_device_fingerprint', myFingerprint)
              .maybeSingle();
            if (conflict && conflict.id !== uid && active) {
              const conflictedName = [conflict.first_name, conflict.last_name].filter(Boolean).join(' ') || 'User';
              handleSessionEjection(`Strict Device Lock: Another account (${conflictedName}) is active on this device. Only one account is allowed per device when multi-account parallel sessions is disabled by Admin.`, supabase);
            }
          } catch (deviceErr) {
            console.warn('[SessionIntegrity] Device conflict check error in heartbeat:', deviceErr);
          }
        }

        // Third check: Maintenance Mode
        const maintenance = await checkSystemMaintenanceMode(supabase);
        if (active) setIsMaintenanceMode(maintenance);
      } catch (e) {
        console.warn('[SessionIntegrity] verifyIntegrity unexpected error:', e);
      }
    };

    // Claim session for this instance first, then run initial integrity check
    forceClaimSession(supabase, uid).then(() => {
      if (active) verifyIntegrity();
    }).catch(err => {
      console.warn('[SessionIntegrity] Initial claim error:', err);
      if (active) verifyIntegrity();
    });

    // 2. Supabase Realtime WebSocket subscription
    const channel = supabase
      .channel(`auth-integrity-${uid}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${uid}`,
        },
        (payload) => {
          if (!isClaimedByMe()) return;
          const remoteToken = payload.new?.active_session_token;
          if (remoteToken && remoteToken !== myToken && active) {
            handleSessionEjection('Logged Out: Another device or browser tab has logged into this account. Disconnecting...', supabase);
          }
        }
      )
      .subscribe();

    // 3. BroadcastChannel listener (instant cross-tab ejection within the same browser engine)
    let bc = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('bigkas_session_channel_v2');
        bc.onmessage = (event) => {
          if (!isClaimedByMe()) return;
          const data = event.data;
          if (data && data.type === 'SESSION_CLAIMED' && data.userId === uid && data.token !== myToken && active) {
            handleSessionEjection('Logged Out: Another browser tab has logged into this account. Disconnecting...', supabase);
          }
        };
      } catch (e) {
        // ignore
      }
    }

    // 4. Storage event fallback (for cross-tab where BroadcastChannel is restricted)
    const handleStorageEvent = (event) => {
      if (event.key === 'bigkas_last_claimed_session_event' && event.newValue && active) {
        if (!isClaimedByMe()) return;
        try {
          const data = JSON.parse(event.newValue);
          if (data.type === 'SESSION_CLAIMED' && data.userId === uid && data.token !== myToken && active) {
            handleSessionEjection('Logged Out: Another browser tab has logged into this account. Disconnecting...', supabase);
          }
        } catch (e) {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    // 5. Periodic heartbeat every 2.5 seconds
    const interval = setInterval(() => {
      if (active) verifyIntegrity();
    }, 2500);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageEvent);
      if (channel) supabase.removeChannel(channel);
      if (bc && typeof bc.close === 'function') bc.close();
    };
  }, [user?.id]);

  const isExcludedFromMaintenance =
    isAdminAuthenticated ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin'));

  const showMaintenanceScreen = isMaintenanceMode && !isExcludedFromMaintenance;

  const value = {
    user, isInitializing, isLoading, isAuthenticated: !!user, isAdminAuthenticated, error,
    pendingEmailVerification, pendingEmail, isMaintenanceMode,
    login, logout, register, updateNickname, updateProfile,
    updateUserMetadata,
    changePassword, uploadAvatar, deactivateAccount, deleteAccount, clearError,
    adminLogin, loginWithGoogle, resendVerificationEmail,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <ConfirmationModal
        isOpen={!!sessionEjectedReason}
        title="Session Disconnected"
        message={sessionEjectedReason || 'Another device or browser tab has logged into this account. Only one active account session is allowed at a time.'}
        confirmLabel="OKay"
        cancelLabel={null}
        onConfirm={async () => {
          await finalizeSessionEjection(supabase);
        }}
        onCancel={async () => {
          await finalizeSessionEjection(supabase);
        }}
        type="info"
      />
      {showMaintenanceScreen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999999,
          background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '24px',
            padding: '40px 32px',
            maxWidth: '480px',
            width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'rgba(245, 158, 11, 0.15)',
              border: '2px solid rgba(245, 158, 11, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px auto',
              fontSize: '32px'
            }}>
              🛠️
            </div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 16px 0', color: '#f1f5f9' }}>
              System Under Maintenance
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#94a3b8', margin: '0 0 28px 0' }}>
              Bigkas is currently undergoing scheduled maintenance and system upgrades to improve your experience. Please come back later.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 24px',
                borderRadius: '12px',
                background: '#f59e0b',
                color: '#0f172a',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)'
              }}
            >
              Check Status & Reload
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export default AuthContext;
