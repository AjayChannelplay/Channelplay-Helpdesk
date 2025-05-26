// Production startup script with module alias resolution
const moduleAlias = require('module-alias');
const path = require('path');

// Register module aliases for runtime
moduleAlias.addAliases({
  '@': path.resolve(__dirname, 'dist/src'),
  '@/types': path.resolve(__dirname, 'dist/src/types'),
  '@/services': path.resolve(__dirname, 'dist/src/services'),
  '@/middleware': path.resolve(__dirname, 'dist/src/middleware'),
  '@/config': path.resolve(__dirname, 'dist/src/config'),
  '@/utils': path.resolve(__dirname, 'dist/src/utils'),
  '@shared/schema': path.resolve(__dirname, 'dist/database/schema.js')
});

// Start the application
require('./dist/src/index.js');
