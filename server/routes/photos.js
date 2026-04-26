const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { UPLOAD_DIR } = require('../db');

const router = express.Router();

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES    = 5 * 1024 * 1024; // 5MB

function detectImageType(buf) {
  if (buf.length < 4) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  // WebP: RIFF....WEBP
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

// POST /api/savePhoto
// args: [recordId, logId, logTitle, itemLabel, type, base64DataUrl]
router.post('/savePhoto', (req, res) => {
  const [recordId, , , itemLabel, type, base64DataUrl] = req.body;
  const fieldKey = (itemLabel || '') + '_' + (type || '');
  if (!recordId || !base64DataUrl) {
    return res.json({ success: false, message: '파라미터가 올바르지 않습니다.' });
  }

  // data:image/jpeg;base64,XXXX 형식에서 mime·데이터 분리
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return res.json({ success: false, message: '이미지 형식이 올바르지 않습니다.' });

  const declaredMime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(declaredMime)) {
    return res.json({ success: false, message: '허용되지 않는 이미지 형식입니다. (jpeg/png/gif/webp만 가능)' });
  }

  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length > MAX_BYTES) {
    return res.json({ success: false, message: '파일 크기가 너무 큽니다. (최대 5MB)' });
  }

  // 실제 파일 바이트로 이미지 타입 검증
  const detected = detectImageType(buffer);
  if (!detected) {
    return res.json({ success: false, message: '유효하지 않은 이미지 파일입니다.' });
  }

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const filename = `${recordId}_${fieldKey}_${Date.now()}.${detected.ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  res.json({ success: true, url: `/uploads/${filename}` });
});

// POST /api/getPhotoUrl — 저장된 URL 반환 (단순 pass-through, 이미 URL로 저장)
router.post('/getPhotoUrl', (req, res) => {
  const [url] = req.body;
  res.json({ success: true, url: url || '' });
});

module.exports = router;
