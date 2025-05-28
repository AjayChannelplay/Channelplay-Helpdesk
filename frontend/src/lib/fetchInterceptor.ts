/**
 * Global fetch interceptor for Channelplay Helpdesk
 * Intercepts all API requests to CloudFront and redirects them to the API server
 */

// Store the original fetch function
const originalFetch = window.fetch;

// Replace the global fetch with our interceptor
window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Only redirect in production environment
  // We use process.env.NODE_ENV which is standard and works in TypeScript without type errors
  if (process.env.NODE_ENV === 'production') {
    let url: string;
    
    // Convert input to string URL
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      // If we can't determine the URL, use the original fetch
      console.log('Fetch interceptor: Unknown input type, using original fetch');
      return originalFetch(input, init);
    }
    
    // Check if this is an API request to CloudFront
    if (url.includes('d1hp5pkc3976q6.cloudfront.net/api/')) {
      // Replace CloudFront domain with API domain
      const newUrl = url.replace('d1hp5pkc3976q6.cloudfront.net/api/', 'api.channelplay.in/api/');
      console.log(`Fetch interceptor: Redirecting request from ${url} to ${newUrl}`);
      
      // Create new request with the updated URL
      if (typeof input === 'string') {
        return originalFetch(newUrl, init);
      } else if (input instanceof Request) {
        // Create a new request with the same properties but different URL
        const newRequest = new Request(newUrl, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          mode: input.mode || 'cors',
          credentials: input.credentials || 'include',
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          integrity: input.integrity
        });
        return originalFetch(newRequest, init);
      } else if (input instanceof URL) {
        return originalFetch(newUrl, init);
      }
    }
  }
  
  // For all other cases, use the original fetch
  return originalFetch(input, init);
};

// Export a function to be called in main.tsx
export function setupFetchInterceptor() {
  console.log('Fetch interceptor initialized');
}
