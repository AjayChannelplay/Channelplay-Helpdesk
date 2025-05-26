// Production startup script with path resolution
const tsConfig = require('./tsconfig.json');
const tsConfigPaths = require('tsconfig-paths');

// Extract paths and baseUrl from tsconfig
const { paths, baseUrl } = tsConfig.compilerOptions;

// Register aliases in Node.js for runtime
tsConfigPaths.register({
  baseUrl,
  paths,
});

// Start the application
require('./dist/src/index.js');
