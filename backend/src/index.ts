// Load environment variables from .env file first
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import session, { SessionOptions } from 'express-session';
import passport from 'passport';
import { registerRoutes } from './routes';
import { setupAuth } from './middleware/auth';
import { startGmailAutoPolling } from './services/gmail-auto-polling-clean';

const app = express();
// CRITICAL: Trust proxy (needed for secure cookies behind reverse proxy)
// This is essential for SameSite=None cookies to work correctly
app.set('trust proxy', 1);
console.log('✅ Set trust proxy to 1 - required for secure cookies to work behind proxy');
const PORT = process.env.PORT || 3001;

// Security middleware
// Configure helmet with settings that allow cross-origin cookies
app.use(
  helmet({
    // Disable contentSecurityPolicy in development for easier testing
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    
    // These settings help with cross-origin cookies
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    
    // Ensure we don't interfere with frame handling
    frameguard: {
      action: 'sameorigin'
    }
  })
);
app.use(compression());

// CORS Configuration - Environment-aware approach
// In development: Express handles CORS
// In production: Nginx handles CORS (Express CORS disabled)

// Helper function to log CORS diagnostics
function logCorsInfo(message: string, data: any) {
  console.log(`CORS: ${message}`, JSON.stringify(data));
}

// CRITICAL: We'll explicitly track which origins we have in our env vars to help debug
const frontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim() : null;
const corsAllowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS || '';
const isProduction = process.env.NODE_ENV === 'production';

logCorsInfo('Environment variables', {
  FRONTEND_URL: frontendUrl || 'not set',
  CORS_ALLOWED_ORIGINS: corsAllowedOriginsEnv || 'not set',
  NODE_ENV: process.env.NODE_ENV || 'not set'
});

// Pre-compute allowed origins to ensure no duplicates
const allowedOriginsSet = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176'
]);

// Add the frontend URL if it exists
if (frontendUrl) {
  allowedOriginsSet.add(frontendUrl);
}

// Add additional origins from CORS_ALLOWED_ORIGINS
if (corsAllowedOriginsEnv) {
  corsAllowedOriginsEnv.split(',').forEach(origin => {
    const trimmedOrigin = origin.trim();
    if (trimmedOrigin) {
      allowedOriginsSet.add(trimmedOrigin);
    }
  });
}

// Convert Set to Array for easier usage
const allowedOrigins = Array.from(allowedOriginsSet);
logCorsInfo('Final allowed origins', allowedOrigins);

// Only use Express CORS middleware in development
// Make sure CloudFront domain is in allowed origins list
if (!allowedOrigins.includes('https://d1hp5pkc3976q6.cloudfront.net')) {
  allowedOrigins.push('https://d1hp5pkc3976q6.cloudfront.net');
  console.log('Added CloudFront domain to allowed origins');
}

// Always use Express to handle CORS in both development and production
console.log(`${isProduction ? 'Production' : 'Development'} environment: Using Express CORS middleware`);

// Add a dedicated OPTIONS handler before CORS middleware to ensure preflight requests work correctly
app.options('*', (req, res) => {
  // Log all preflight requests for debugging
  console.log(`🔄 CORS Preflight request to ${req.path} from origin: ${req.headers.origin}`);
  
  // Set CORS headers for preflight requests
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  
  // End preflight request with 204 No Content
  res.status(204).end();
});

// Enhanced CORS Configuration
app.use(cors({
  origin: function(requestOrigin, callback) {
    // Allow requests with no origin
    if (!requestOrigin) {
      console.log('CORS: Request received with no origin');
      return callback(null, true);
    }
    
    // Allow localhost in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`CORS: Development - allowing origin: ${requestOrigin}`);
      callback(null, true);
      return;
    }
    
    // In production, we only allow requests from our CloudFront domain and API domain
    if (requestOrigin.includes('cloudfront.net') || 
        requestOrigin.includes('channelplay.in') ||
        requestOrigin.includes('localhost')) {
      console.log(`CORS: Production - allowing origin: ${requestOrigin}`);
      callback(null, true);
      return;
    }
    
    // Log and reject any other origins
    console.log(`CORS: Rejecting request from unauthorized origin: ${requestOrigin}`);
    callback(new Error(`Origin ${requestOrigin} not allowed by CORS policy`));
  },
  credentials: true, // Critical for cookies to work cross-origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  maxAge: 86400 // Cache preflight request results for 24 hours (in seconds)
}));

// IMPORTANT: If using this approach, make sure to DISABLE any CORS headers in Nginx
// to avoid duplicate header issues.

// Logging
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration with explicit settings for cross-origin cookies
const sessionConfig: SessionOptions = {
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,  // Resets expiration countdown on every response
  name: 'helpdesk.sid', // Explicit cookie name for better tracking
  proxy: true, // Trust the reverse proxy
  cookie: {
    // IMPORTANT: For cross-domain cookies, secure MUST be true
    secure: true,  // Always use secure cookies for both dev and prod to ensure consistency
    httpOnly: true, // Prevent JavaScript access to the cookie
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // IMPORTANT: For cross-domain cookies, sameSite MUST be 'none'
    sameSite: 'none', // Required for cross-origin cookies
    path: '/'        // Ensure cookie is sent with all requests
  }
};

// Add debug message about session configuration
console.log('📋 Session Configuration:', {
  rolling: sessionConfig.rolling,
  name: sessionConfig.name,
  proxy: sessionConfig.proxy,
  cookie: {
    secure: sessionConfig.cookie?.secure,
    httpOnly: sessionConfig.cookie?.httpOnly,
    sameSite: sessionConfig.cookie?.sameSite,
    path: sessionConfig.cookie?.path,
    maxAge: sessionConfig.cookie?.maxAge,
  }
});

// For cross-domain cookies between completely different domains, we should NOT set a domain
if (process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN) {
  console.log(`🔹 Setting cookie domain to: ${process.env.COOKIE_DOMAIN}`);
  (sessionConfig.cookie as any).domain = process.env.COOKIE_DOMAIN;
} else {
  console.log('🔹 Cross-domain cookies: Not setting domain for cross-domain cookie sharing');
}

// Extra safety: Force secure and sameSite in production regardless of env vars
if (process.env.NODE_ENV === 'production') {
  sessionConfig.cookie!.secure = true;
  sessionConfig.cookie!.sameSite = 'none';
}

// Add detailed session cookie logging
console.log('🍪 Session cookie config:', {
  secure: sessionConfig.cookie?.secure,
  sameSite: sessionConfig.cookie?.sameSite,
  domain: (sessionConfig.cookie as any).domain || 'not set',
  httpOnly: sessionConfig.cookie?.httpOnly,
  maxAge: sessionConfig.cookie?.maxAge,
  environment: process.env.NODE_ENV || 'not set',
  trustProxy: app.get('trust proxy')
});

// Log detailed express config
console.log('📱 Express config:', {
  trustProxy: app.get('trust proxy'),
  environment: process.env.NODE_ENV || 'development',
  behindProxy: true
});

// Force essential settings for cross-origin cookies
if (process.env.NODE_ENV === 'production') {
  console.log('⚠️ Forcing cross-origin cookie settings for production');
  sessionConfig.cookie!.secure = true;
  sessionConfig.cookie!.sameSite = 'none';
  // Don't set domain unless you're using subdomains of the same parent domain
}

app.use(session(sessionConfig));

// Authentication
app.use(passport.initialize());
app.use(passport.session());
setupAuth(app);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
registerRoutes(app).then((server) => {
  console.log('🚀 Backend server starting...');
  
  // Actually start the server listening on the port
  server.listen(PORT, () => {
    console.log(`📡 API available at: http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
    
    // Initialize email auto-polling service
    console.log('📧 Initializing email auto-polling service...');
    startGmailAutoPolling()
      .then(() => {
        console.log('✅ Email auto-polling service initialized successfully');
      })
      .catch(error => {
        console.error('❌ Failed to initialize email auto-polling service:', error);
      });
  });
}).catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

export default app;