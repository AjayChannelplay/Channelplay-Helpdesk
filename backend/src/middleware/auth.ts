import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import bcrypt from "bcrypt";
import { storage } from "../services/storage";
import { User as SelectUser } from "@shared/schema";
import { mailgunService } from "../mailgun";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  return hash;
}

export async function comparePasswords(supplied: string, stored: string) {
  return await bcrypt.compare(supplied, stored);
}

export function setupAuth(app: Express) {
  passport.use(
    // Use type assertion to work around the passport type issue
    (new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        console.log(`Attempting login for email: ${email}`);
        const user = await storage.getUserByEmail(email);
        
        if (!user) {
          console.log(`No user found with email: ${email}`);
          return done(null, false);
        }
        
        const passwordMatch = await comparePasswords(password, user.password);
        console.log(`Password comparison result: ${passwordMatch}`);
        console.log(`User password stored (first 10 chars): ${user.password.substring(0, 10)}...`);
        
        if (!passwordMatch) {
          return done(null, false);
        }
        
        // Before handling verification or setup requirements, we'll first log that credentials are valid
        console.log(`Valid credentials for user: ${email}`);
        
        // For fixed credentials system - skip all verification and setup checks
        // Users created by admin get direct access with their fixed credentials
        console.log(`User ${email} logging in with fixed credentials - skipping verification`);
        
        // Always proceed with login for valid credentials
        return done(null, user);
      } catch (err) {
        console.error('Login error:', err);
        return done(err);
      }
    })) as passport.Strategy,
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false); // User not found, but not an error
      }
      done(null, user);
    } catch (err) {
      console.error('Error deserializing user:', err);
      done(null, false); // Handle error gracefully
    }
  });

  // Debug middleware to log session information
  const debugSession = (req: any, res: any, next: any) => {
    console.log('🔍 SESSION DEBUG:');
    console.log('- Session ID:', req.sessionID || 'No session ID');
    console.log('- Is Authenticated:', req.isAuthenticated ? req.isAuthenticated() : 'Not available');
    console.log('- User:', req.user ? `ID: ${req.user.id}, Email: ${req.user.email}` : 'No user');
    console.log('- Cookies:', req.headers.cookie || 'No cookies');
    console.log('- Session Data:', req.session);
    next();
  };

  // Enhanced isAuthenticated middleware with better logging and recovery options
  const isAuthenticated = (req: any, res: any, next: any) => {
    console.log(`🔐 Auth Check - Path: ${req.path}, isAuthenticated: ${req.isAuthenticated()}, Session ID: ${req.sessionID || 'none'}`);
    console.log(`🍪 Cookies: ${req.headers.cookie || 'No cookies sent'}`);
    
    // Check for special retry header from frontend session recovery mechanism
    const isRetryAttempt = req.headers['x-session-retry'] === 'true';
    
    if (req.isAuthenticated()) {
      // Update session expiry on each authenticated request to keep it fresh
      if (req.session) {
        req.session.touch();
      }
      
      // Track the last time this session was successfully used
      if (req.session) {
        req.session.lastActive = Date.now();
      }
      
      console.log(`✅ User authenticated: ${req.user?.email}, Role: ${req.user?.role || 'not specified'}`);
      return next();
    }
    
    // Special handling for API requests that should have a session
    // Log detailed diagnostic information to help troubleshoot
    console.log(`❌ Unauthorized request to ${req.path}`);
    console.log(`💭 Request headers: ${JSON.stringify(req.headers)}`);
    
    if (isRetryAttempt) {
      console.log(`⚠️ This was a retry attempt from the frontend - session still invalid`);
    }
    
    // Send a 401 response with information that might help debugging
    return res.status(401).json({ 
      message: "Unauthorized", 
      sessionPresent: !!req.sessionID,
      time: new Date().toISOString()
    });
  };

  app.post("/api/register", debugSession, async (req, res, next) => {
    try {
      const { username, password, name, email } = req.body;
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const user = await storage.createUser({
        username,
        password, // Storage will hash the password
        name,
        email,
        requiresSetup: false // When users register themselves, no setup required
      });

      // Remove password from the response
      const { password: _, ...userWithoutPassword } = user;

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(userWithoutPassword);
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        // Use the message from info if available, otherwise use a generic message
        const errorMessage = info?.message || "Invalid credentials";
        return res.status(401).json({ message: errorMessage });
      }
      
      // Skip verification - mark user as verified automatically
      if (info && info.message === "verification_required") {
        try {
          // Auto-verify user without OTP
          await storage.updateUser(user.id, { isVerified: true });
          console.log(`Auto-verified user ${user.id} - OTP verification disabled`);
        } catch (error) {
          console.error("Error auto-verifying user:", error);
        }
      }
      
      // Skip setup requirement - mark as setup complete automatically
      if (info && info.message === "setup_required") {
        try {
          // Auto-complete setup without requiring password change
          await storage.updateUser(user.id, { requiresSetup: false });
          console.log(`Auto-completed setup for user ${user.id} - setup requirement disabled`);
        } catch (error) {
          console.error("Error auto-completing setup:", error);
        }
      }

      // Log the user in directly - no verification or setup required
      req.login(user, (err: Error | null) => {
        if (err) return next(err);
        
        // Log cookie debug information
        console.log(`User ${user.username} logged in successfully - bypassed verification`);
        
        // Debug session and cookies
        console.log('🔑 LOGIN SESSION DEBUG:');
        console.log('Session ID:', req.sessionID);
        console.log('Session Cookie:', req.session?.cookie);
        console.log('Response Headers to be sent:', res.getHeaders());
        
        // Add cookie debug information to the response for frontend inspection
        const cookieOptions = req.session?.cookie || {};
        
        // Remove password from the response
        const { password, ...userWithoutPassword } = user;
        
        // Log the user's successful login
        console.log(`🔓 Authentication successful for ${user.email} with session ID ${req.sessionID}`);
        console.log(`Cookie settings: secure=${cookieOptions.secure}, sameSite=${cookieOptions.sameSite}, httpOnly=${cookieOptions.httpOnly}`);
        
        return res.status(200).json({
          ...userWithoutPassword,
          _debug: {
            sessionID: req.sessionID,
            cookieSecure: cookieOptions.secure,
            cookieSameSite: cookieOptions.sameSite,
            cookieHttpOnly: cookieOptions.httpOnly,
            cookieDomain: (cookieOptions as any).domain || 'not set'
          }
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    // Remove password from the response
    const { password, ...userWithoutPassword } = req.user as SelectUser;
    res.json(userWithoutPassword);
  });
  
  // Note: The /api/change-password and /api/complete-setup endpoints are now in routes.ts
}
