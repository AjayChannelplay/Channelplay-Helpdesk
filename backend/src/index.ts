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
// Tell Express we're behind a proxy (Nginx) - needed for secure cookies to work
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
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
// In production, Nginx handles CORS
if (!isProduction) {
  console.log('Development environment: Using Express CORS middleware');
  app.use(cors({
    origin: function(requestOrigin, callback) {
      // Allow requests with no origin
      if (!requestOrigin) {
        return callback(null, true);
      }
      
      logCorsInfo('Request received from origin', requestOrigin);
      
      // Check if the request origin is in our allowed list
      if (allowedOrigins.includes(requestOrigin)) {
        // Critical: We return the EXACT origin that was requested
        callback(null, requestOrigin);
      } else {
        console.error(`CORS blocked request from unauthorized origin: ${requestOrigin}`);
        callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
} else {
  console.log('Production environment: CORS handling disabled in Express - using Nginx CORS headers instead.');
}

// Logging
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration
const sessionConfig: SessionOptions = {
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Use secure only in production, not in development (since localhost is HTTP)
    secure: process.env.NODE_ENV === 'production',  // Only true in production
    httpOnly: true,       // ✅ Security best practice
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for production, 'lax' for development
  }
};

// IMPORTANT: For cross-domain cookies between different domains (CloudFront and api.channelplay.in)
// We ALWAYS set the domain to .channelplay.in in production to enable cross-domain authentication

if (process.env.NODE_ENV === 'production') {
  // Set the domain to .channelplay.in to allow cookies to be shared between subdomains
  const cookieDomain = '.channelplay.in';
  console.log(`🔒 Setting cookie domain to: ${cookieDomain} for cross-domain authentication`);
  (sessionConfig.cookie as any).domain = cookieDomain;
} else {
  console.log('Development environment: Not setting cookie domain');
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