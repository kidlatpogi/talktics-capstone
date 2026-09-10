/**
 * authApi.js — thin wrappers around supabase.auth for components that prefer a named API.
 * Most auth logic now lives in AuthContext.jsx.
 */
import { supabase } from './supabaseClient.js';

export const PENDING_SIGNUP_PASSWORD_KEY = 'bigkas_pending_signup_password_v1';

function popPendingSignupPassword() {
  if (typeof window === 'undefined') return '';
  const password = window.sessionStorage.getItem(PENDING_SIGNUP_PASSWORD_KEY) || '';
  window.sessionStorage.removeItem(PENDING_SIGNUP_PASSWORD_KEY);
  return password;
}

export const authApi = {
  login:  (email, password) => supabase.auth.signInWithPassword({ email, password }),
  register: (email, password, name) =>
    supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
      },
    }),
  logout: () => supabase.auth.signOut(),
  getSession: () => supabase.auth.getSession(),
  getUser: () => supabase.auth.getUser(),
  updateUser: (updates) => supabase.auth.updateUser(updates),

  /**
   * Verify a 6-digit email OTP submitted by the user after registration.
   * Supports standard signup OTP (type: 'signup') and email OTP fallback (type: 'email').
   * @param {string} email - The email address the OTP was sent to.
   * @param {string} token - The 6-digit OTP code entered by the user.
   * @returns {Promise<{ data, error }>}
   */
  verifyEmailOtp: async (email, token) => {
    let response = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    if (response.error) {
      const fallbackResponse = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (!fallbackResponse.error) {
        response = fallbackResponse;
      }
    }
    if (response.error) return response;

    const pendingPassword = popPendingSignupPassword();
    if (pendingPassword) {
      const { error } = await supabase.auth.updateUser({ password: pendingPassword });
      if (error) return { ...response, error };
    }

    if (response.data?.user?.id && email) {
      await supabase
        .from('profiles')
        .update({ email: email.trim().toLowerCase() })
        .eq('id', response.data.user.id)
        .catch(() => {});
    }

    return response;
  },

  /**
   * Resend the verification OTP code to the given address.
   * @param {string} email
   * @returns {Promise<{ data, error }>}
   */
  resendSignupOtp: async (email) => {
    const signupResend = await supabase.auth.resend({ type: 'signup', email });
    if (!signupResend.error) return signupResend;

    return supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
  },
};

export default authApi;
