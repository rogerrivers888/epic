// Metro configuration for a workspace package.
//
// Dependencies hoist to the monorepo root, so Metro has to be told to watch the
// root and to resolve modules from both node_modules directories. Without this
// the bundler resolves react-native from apps/web only and fails.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
// A worktree whose node_modules is a symlink to the main checkout: Metro has
// to watch and resolve the real directory, not the link.
const fs = require('node:fs');
const realModules = fs.realpathSync(path.resolve(workspaceRoot, 'node_modules'));

config.watchFolders = [workspaceRoot, realModules];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  realModules,
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
