/**
 * Custom fetch wrapper for orval-generated API client.
 * Handles authentication and base URL configuration.
 *
 * This file is used by the generated API client and should NOT
 * be modified for specific API calls - use the generated hooks instead.
 */

const getBaseUrl = (): string => {
  // In browser, use current origin (nginx proxies /api/ to backend)
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Server-side or fallback
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
};

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
};

// Type for orval's request config
interface RequestConfig<TData = unknown> {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: TData;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Custom fetcher for orval-generated React Query hooks.
 * Handles auth headers, base URL, and error responses.
 */
export const customFetch = async <TResponse, TData = unknown>(
  config: RequestConfig<TData>
): Promise<TResponse> => {
  const baseUrl = getBaseUrl();
  const token = getAuthToken();

  // Build URL with query params if present
  let url = `${baseUrl}${config.url}`;
  if (config.params) {
    const searchParams = new URLSearchParams();
    Object.entries(config.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const headers: Record<string, string> = {
    ...config.headers,
  };

  // Add auth token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Determine if we need to send JSON or FormData
  const isFormData = config.data instanceof FormData;
  if (!isFormData && config.data !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: config.method,
    headers,
    body: isFormData
      ? (config.data as FormData)
      : config.data !== undefined
        ? JSON.stringify(config.data)
        : undefined,
    signal: config.signal,
  });

  // Handle 401 - redirect to login
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  // Handle empty responses (204 No Content, etc.)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as TResponse;
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    // Handle Pydantic validation errors
    if (Array.isArray(errorData.detail)) {
      const messages = errorData.detail.map((e: { msg: string; loc: string[] }) =>
        `${e.loc?.join('.')}: ${e.msg}`
      ).join(', ');
      throw new Error(messages || `Request failed with status ${response.status}`);
    }
    throw new Error(errorData.detail || `Request failed with status ${response.status}`);
  }

  return response.json();
};

export default customFetch;
