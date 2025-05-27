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

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(compression());

// CORS configuration
app.use(cors({
  origin: function(requestOrigin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests, server-to-server)
    // These are not subject to browser CORS policy in the same way.
    if (!requestOrigin) {
      return callback(null, true); // `true` allows the request. `cors` lib handles ACAO appropriately.
    }
    
    // Define base allowed origins (e.g., for local development)
    const baseAllowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176'
    ];
    
    let dynamicAllowedOrigins = [...baseAllowedOrigins];
    
    // Add FRONTEND_URL from environment variables if it exists
    if (process.env.FRONTEND_URL) {
      dynamicAllowedOrigins.push(process.env.FRONTEND_URL.trim());
    }

    // Add CORS_ALLOWED_ORIGINS from environment variables if it exists (comma-separated list)
    if (process.env.CORS_ALLOWED_ORIGINS) {
      const corsEnvOrigins = process.env.CORS_ALLOWED_ORIGINS.split(',')
        .map(origin => origin.trim())
        .filter(origin => origin); // Filter out any empty strings from split
      dynamicAllowedOrigins.push(...corsEnvOrigins);
    }
    
    // Deduplicate the list of allowed origins
    const finalAllowedOrigins = [...new Set(dynamicAllowedOrigins)];
    
    // For debugging purposes, you can log this on the server
    // console.log('Request Origin:', requestOrigin);
    // console.log('Effective Allowed CORS Origins:', finalAllowedOrigins);
    
    if (finalAllowedOrigins.includes(requestOrigin)) {
      // If the requestOrigin is in our list, reflect it in the ACAO header
      callback(null, requestOrigin);
    } else {
      // If the origin is not allowed
      console.log(`CORS blocked request from: ${requestOrigin}. Not in allowed list: ${JSON.stringify(finalAllowedOrigins)}`);
      callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

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
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // Critical for cross-domain authentication
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    // Add domain for production to share cookies across subdomains
    ...(process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN ? 
      { domain: process.env.COOKIE_DOMAIN } : {})
  }
};

// If we have a cookie domain specified, set it
if (process.env.SESSION_COOKIE_DOMAIN) {
  (sessionConfig.cookie as any).domain = process.env.SESSION_COOKIE_DOMAIN;
}

console.log('Session cookie config:', {
  secure: sessionConfig.cookie?.secure,
  sameSite: sessionConfig.cookie?.sameSite,
  domain: (sessionConfig.cookie as any).domain || 'not set'
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