const session = require('express-session');

const sessionMiddleware = session({
  secret:            process.env.SESSION_SECRET || 'haccp-dev-secret',
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
