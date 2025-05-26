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
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests)
    if(!origin) return callback(null, true);
    
    // Define allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176'
    ];
    
    // Add environment variable if it exists
    if (process.env.FRONTEND_URL) {
      allowedOrigins.push(process.env.FRONTEND_URL);
    }

    // Add CORS_ALLOWED_ORIGINS if it exists (comma-separated list)
    if (process.env.CORS_ALLOWED_ORIGINS) {
      const corsOrigins = process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
      allowedOrigins.push(...corsOrigins);
    }
    
    console.log('Allowed CORS origins:', allowedOrigins);
    
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      console.log('CORS blocked request from:', origin);
      callback(null, false);
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
    // Adjust sameSite based on environment
    // For dev (HTTP, localhost different ports): 'lax' is needed because secure:false
    // For prod (HTTPS): 'lax' is a good default. Use 'none' if truly cross-domain and secure:true.
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
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