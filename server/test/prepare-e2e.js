const path = require('path');
const { createPreparedTestDb } = require('./helpers/test-db');

const dbPath = path.join(__dirname, '.tmp', 'e2e.db');
createPreparedTestDb(dbPath);

console.log(`[test:e2e] prepared ${dbPath}`);
