require('dotenv').config();
const path = require('path');
const express = require('express');
const { DB_PATH, UPLOAD_DIR } = require('./db');
const { sessionMiddleware } = require('./middleware/session');
const { serveApp } = require('./serve-html');
const { isExplicitTestMode, isTestDbPath, isTestUploadPath } = require('./test-safety');

function createApp() {
  if (process.env.ENABLE_TEST_ROUTES === '1' && (!isExplicitTestMode() || !isTestDbPath(DB_PATH))) {
    throw new Error('ENABLE_TEST_ROUTES requires NODE_ENV=test and a server/test/.tmp database path.');
  }
  if (isExplicitTestMode() && !isTestUploadPath(UPLOAD_DIR)) {
    throw new Error('NODE_ENV=test requires HACCP_UPLOAD_DIR to point to server/test/.tmp.');
  }

  const app = express();

  app.use(sessionMiddleware);
  app.use(express.json({ limit: '10mb' }));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(UPLOAD_DIR));

  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/data'));
  app.use('/api', require('./routes/calendar'));
  app.use('/api', require('./routes/records'));
  app.use('/api', require('./routes/users'));
  app.use('/api', require('./routes/photos'));
  if (process.env.ENABLE_TEST_ROUTES === '1' && isExplicitTestMode() && isTestDbPath(DB_PATH)) {
    app.use('/api', require('./routes/test'));
  }

  app.get('/', serveApp);
  app.get('/index', serveApp);

  return app;
}

const app = createApp();

module.exports = { app, createApp };
