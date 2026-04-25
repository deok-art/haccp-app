const path = require('path');

function normalizePath(targetPath) {
  return path.resolve(String(targetPath || '')).replace(/\\/g, '/');
}

function isTestDbPath(dbPath) {
  return normalizePath(dbPath).includes('/test/.tmp/');
}

function isTestUploadPath(uploadPath) {
  return normalizePath(uploadPath).includes('/test/.tmp/');
}

function isExplicitTestMode() {
  return process.env.NODE_ENV === 'test';
}

function getDatabasePath(database) {
  const row = database.prepare("PRAGMA database_list").get();
  return row && row.file ? row.file : '';
}

function assertTestDbPath(dbPath, label) {
  if (isTestDbPath(dbPath)) return;
  throw new Error(`${label || 'database'} must point to server/test/.tmp`);
}

function assertTestDatabase(database, label) {
  assertTestDbPath(getDatabasePath(database), label || 'database');
}

function assertTestUploadPath(uploadPath, label) {
  if (isTestUploadPath(uploadPath)) return;
  throw new Error(`${label || 'upload dir'} must point to server/test/.tmp`);
}

module.exports = {
  assertTestDatabase,
  assertTestDbPath,
  assertTestUploadPath,
  getDatabasePath,
  isExplicitTestMode,
  isTestDbPath,
  isTestUploadPath,
  normalizePath,
};
