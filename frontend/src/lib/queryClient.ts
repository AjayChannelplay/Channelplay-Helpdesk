import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Helper to get the base API URL
const getApiBaseUrl = () => {
  // In development, use relative URLs to leverage Vite's proxy
  if (import.meta.env.DEV) {
    return '';
  }
  // In production, use the configured API URL or the correct production API
  return import.meta.env.VITE_API_URL || 'https://api.channelplay.in';
};

// Helper to ensure URL has correct API base
const getFullApiUrl = (url: string) => {
  // If the URL already starts with http, assume it's a complete URL
  if (url.startsWith('http')) {
    return url;
  }
  
  // In development, just ensure the URL starts with /api
  if (import.meta.env.DEV) {
    // Make sure the URL starts with a slash
    const formattedUrl = url.startsWith('/') ? url : `/${url}`;
    // Ensure it starts with /api
    return formattedUrl.startsWith('/api') ? formattedUrl : `/api${formattedUrl}`;
  }
  
  // For production, prepend the API base URL
  const formattedUrl = url.startsWith('/') ? url : `/${url}`;
  return `${getApiBaseUrl()}${formattedUrl}`;
};

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const fullUrl = getFullApiUrl(url);
  console.log(`Making ${method} request to: ${fullUrl}`);
  
  const res = await fetch(fullUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  // Handle 401 Unauthorized - Session expired or not logged in
  if (res.status === 401) {
    console.warn("401 Unauthorized - Session expired or not logged in");
    // For fixed credentials system - redirect to login page directly
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
