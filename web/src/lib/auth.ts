/**
 * Auth helpers that wrap the generated API for token management.
 * This module handles localStorage token storage which cannot be auto-generated.
 */

import {
  loginApiV1AuthLoginPost,
  registerApiV1AuthRegisterPost,
  type UserLogin,
  type UserRegister,
  type AuthResponse,
  type UserResponse,
} from '@/generated/api';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

/**
 * Login and store credentials in localStorage.
 */
export async function login(credentials: UserLogin): Promise<AuthResponse> {
  const response = await loginApiV1AuthLoginPost(credentials);

  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, response.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  }

  return response;
}

/**
 * Register a new user and store credentials in localStorage.
 */
export async function register(data: UserRegister): Promise<AuthResponse> {
  const response = await registerApiV1AuthRegisterPost(data);

  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, response.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  }

  return response;
}

/**
 * Clear stored credentials and redirect to login.
 */
export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

/**
 * Get the currently logged in user from localStorage.
 * Returns null if not logged in or data is corrupted.
 */
export function getCurrentUser(): UserResponse | null {
  if (typeof window === 'undefined') return null;

  try {
    const userJson = localStorage.getItem(USER_KEY);
    if (!userJson || userJson === 'undefined' || userJson === 'null') {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return JSON.parse(userJson);
  } catch {
    // Clear corrupted data
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

/**
 * Check if user is authenticated (has a token).
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(TOKEN_KEY);
}

/**
 * Get the stored auth token.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
