const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('../middleware/session');

const router    = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// POST /api/savePhoto
// args: [recordId, fieldKey, base64DataUrl]  (gs_polyfill은 args 배열로 전달)
router.post('/savePhoto', requireAuth, (req, res) => {
  const [recordId, fieldKey, base64DataUrl] = req.body;
  if (!recordId || !fieldKey || !base64DataUrl) {
    return res.json({ success: false, message: '파라미터가 올바르지 않습니다.' });
  }

  // data:image/jpeg;base64,XXXX 형식에서 mime·데이터 분리
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.json({ success: false, message: '이미지 형식이 올바르지 않습니다.' });

  const mime   = match[1];
  const ext    = mime.split('/')[1] || 'jpg';
  const buffer = Buffer.from(match[2], 'base64');

  const filename = `${recordId}_${fieldKey}_${Date.now()}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  const fileUrl = `/uploads/${filename}`;
  res.json({ success: true, url: fileUrl });
});

// POST /api/getPhotoUrl — 저장된 URL 반환 (단순 pass-through, 이미 URL로 저장)
router.post('/getPhotoUrl', requireAuth, (req, res) => {
  const [url] = req.body;
  res.json({ success: true, url: url || '' });
});

module.exports = router;
