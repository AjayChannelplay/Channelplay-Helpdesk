import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Define API base URL based on environment
const API_BASE_URL = import.meta.env.PROD
  ? 'https://api.channelplay.in' // Production uses full URL to backend
  : ''; // Local development uses Vite proxy with relative paths

// Helper to ensure URL has correct API base
const getFullApiUrl = (url: string) => {
  // If the URL already starts with http, assume it's a complete URL
  if (url.startsWith('http')) {
    return url;
  }
  
  // Format the path properly (ensure it starts with a slash)
  const formattedPath = url.startsWith('/') ? url : `/${url}`;
  
  if (import.meta.env.PROD) {
    // In production, we DO NOT remove the /api prefix anymore
    // The backend routes expect the /api prefix even on api.channelplay.in
    
    // Ensure it starts with /api
    const apiPath = formattedPath.startsWith('/api') 
      ? formattedPath 
      : `/api${formattedPath}`;
    
    return `${API_BASE_URL}${apiPath}`;
  } else {
    // In development, ensure the path starts with /api for the Vite proxy
    return formattedPath.startsWith('/api') 
      ? formattedPath 
      : `/api${formattedPath}`;
  }
};

// Track last successful session time to help with session management
let lastSuccessfulSessionTime: number | null = null;
let sessionRefreshInProgress = false;

// Function to check if we have a recent successful session
const hasRecentSession = () => {
  if (!lastSuccessfulSessionTime) return false;
  // Consider a session valid if it was successful in the last 5 minutes
  return (Date.now() - lastSuccessfulSessionTime) < 5 * 60 * 1000;
};

// Function to attempt session refresh if authentication fails
async function attemptSessionRefresh(): Promise<boolean> {
  // Avoid multiple simultaneous refresh attempts
  if (sessionRefreshInProgress) return false;
  
  try {
    sessionRefreshInProgress = true;
    console.log('🔄 Attempting to refresh session...');
    
    // Try to hit the /api/user endpoint to check session
    const checkUrl = getFullApiUrl('/api/user');
    const response = await fetch(checkUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    if (response.ok) {
      console.log('✅ Session refresh successful');
      lastSuccessfulSessionTime = Date.now();
      return true;
    }
    
    console.log('❌ Session refresh failed');
    return false;
  } catch (error) {
    console.error('Error refreshing session:', error);
    return false;
  } finally {
    sessionRefreshInProgress = false;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const fullUrl = getFullApiUrl(url);
  
  // Only log in development to avoid exposing sensitive data in production
  if (!import.meta.env.PROD) {
    console.log(`Making ${method} request to: ${fullUrl}`);
  }
  
  // Add a special debugging header if we've had a recent successful session
  // This helps diagnose issues where cookies aren't being properly sent
  const extraHeaders: Record<string, string> = {};
  if (hasRecentSession()) {
    extraHeaders['X-Recent-Session'] = 'true';
  }
  
  // In production, we need to set withCredentials to true for cross-origin requests
  // This ensures cookies are sent with the request
  let res = await fetch(fullUrl, {
    method,
    mode: "cors",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      "Accept": "application/json",
      // The following header helps identify AJAX requests
      "X-Requested-With": "XMLHttpRequest",
      ...extraHeaders
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include", // Always include credentials for cookies
  });

  // For GET requests, if we get a 401 and we haven't tried refreshing the session, try to refresh
  if (res.status === 401 && method === 'GET' && !url.includes('/api/login')) {
    console.warn(`401 Unauthorized for ${url} - Attempting session recovery...`);
    
    const refreshSuccessful = await attemptSessionRefresh();
    if (refreshSuccessful) {
      // Retry the original request with the refreshed session
      console.log(`Retrying ${method} ${url} with refreshed session`);
      res = await fetch(fullUrl, {
        method,
        mode: "cors",
        headers: {
          ...(data ? { "Content-Type": "application/json" } : {}),
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Session-Retry": "true"
        },
        body: data ? JSON.stringify(data) : undefined,
        credentials: "include",
      });
      
      // If the retry was successful, update session time and return
      if (res.ok) {
        console.log(`✅ Retry successful for ${url}`);
        lastSuccessfulSessionTime = Date.now();
        return res;
      }
    }
    
    // If refresh didn't work or retry failed, redirect to login
    console.warn("Session recovery failed - redirecting to login");
    window.location.href = '/auth';
    throw new Error("401: Unauthorized - Your session has expired. Please log in again.");
  }

  // If HTTP status is 403, it means verification required
  if (res.status === 403) {
    const data = await res.json();
    console.log("403 response data:", data);
    
    // Handle verification required scenario
    if (data.userExists && data.username) {
      // Store username in session storage for verification page
      console.log('Storing username in session storage:', data.username);
      sessionStorage.setItem('pendingVerification', data.username);
      
      // Throw a special error for the mutation to handle
      throw new Error("Account verification required");
    } else if (data.message && data.message.includes('verification')) {
      // Generic verification error without specific username
      throw new Error("Account verification required");
    }
  }
  
  if (!res.ok && res.status !== 403) {
    // Handle other errors
    await throwIfResNotOk(res);
  }
  
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw" | "redirect";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = getFullApiUrl(queryKey[0] as string);
    console.log(`Query fetching from: ${url}`);
    
    try {
      const res = await fetch(url, {
        credentials: "include", // Always include credentials for auth cookies
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest' // Helps with CORS in some environments
        },
        mode: 'cors' // Explicitly set CORS mode for cross-domain requests
      });

      // Log authentication status in production to help debug
      if (import.meta.env.PROD) {
        console.log(`API auth status: ${url} → ${res.status}`);
      }

      // Handle 401 based on behavior parameter
      if (res.status === 401) {
        console.warn("Authentication failed - status 401");
        if (unauthorizedBehavior === "returnNull") {
          return null;
        } else if (unauthorizedBehavior === "redirect") {
          // Redirect to login page
          window.location.href = '/auth';
          return null;
        }
        // If "throw", continue to the throwIfResNotOk below
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      console.error(`API request failed for ${url}:`, error);
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
