require('dotenv').config();
const path    = require('path');
const express = require('express');
const { sessionMiddleware } = require('./middleware/session');
const { serveApp } = require('./serve-html');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(sessionMiddleware);
app.use(express.json({ limit: '10mb' }));

// 정적 파일 (gs_polyfill.js, uploads 등)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API 라우터
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/data'));
app.use('/api', require('./routes/records'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/photos'));

// SPA 진입점 — 모든 비-API GET 요청
app.get('/', serveApp);
app.get('/index', serveApp);

app.listen(PORT, () => {
  console.log(`[HACCP] http://localhost:${PORT}`);
});
