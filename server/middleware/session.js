const session = require('express-session');

const secret = process.env.SESSION_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[HACCP] SESSION_SECRET 환경변수가 설정되지 않았습니다. 서버를 시작할 수 없습니다.');
  }
  console.warn('[HACCP 경고] SESSION_SECRET 미설정 — 개발 환경에서만 허용됩니다.');
}

const sessionMiddleware = session({
  secret:            secret || 'haccp-dev-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000   // 8시간
  }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
}

module.exports = { sessionMiddleware, requireAuth };
