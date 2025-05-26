import { SessionData } from 'express-session';

declare module 'express-session' {
  interface SessionData {
    passport?: {
      user?: any;
    };
  }
  
  export interface Store {
    all: (callback: (err: any, sessions: any) => void) => void;
    destroy: (sid: string, callback?: (err?: any) => void) => void;
    clear: (callback?: (err?: any) => void) => void;
    length: (callback: (err: any, length: number) => void) => void;
    get: (sid: string, callback: (err: any, session?: SessionData | null) => void) => void;
    set: (sid: string, session: SessionData, callback?: (err?: any) => void) => void;
    touch: (sid: string, session: SessionData, callback?: (err?: any) => void) => void;
  }
  
  export interface SessionOptions {
    secret: string | string[];
    name?: string;
    cookie?: CookieOptions;
    genid?: (req: any) => string;
    rolling?: boolean;
    resave?: boolean;
    proxy?: boolean;
    saveUninitialized?: boolean;
    store?: Store;
    unset?: string;
  }
  
  export interface CookieOptions {
    maxAge?: number;
    signed?: boolean;
    expires?: Date;
    httpOnly?: boolean;
    path?: string;
    domain?: string;
    secure?: boolean | 'auto';
    sameSite?: boolean | 'lax' | 'strict' | 'none';
  }
  
  // Make the function callable
  export default function session(options: SessionOptions): any;
}
