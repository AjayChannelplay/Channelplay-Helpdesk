// Type declaration for connect-pg-simple
declare module 'connect-pg-simple' {
  import { SessionOptions, Store } from 'express-session';

  interface PgStoreOptions {
    pool?: any;
    tableName?: string;
    schemaName?: string;
    ttl?: number;
    createTableIfMissing?: boolean;
    disableTouch?: boolean;
    pruneSessionInterval?: number | boolean;
    errorLog?: (error: Error) => void;
  }

  function connectPgSimple(session: any): {
    new(options: PgStoreOptions): Store;
  };
  
  export = connectPgSimple;
}
