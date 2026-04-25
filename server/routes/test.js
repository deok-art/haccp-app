const express = require('express');
const { db, DB_PATH } = require('../db');
const { resetTestDb, cleanUploads } = require('../test/helpers/test-db');
const { isExplicitTestMode, isTestDbPath } = require('../test-safety');

const router = express.Router();

router.post('/testReset', (req, res) => {
  if (!isExplicitTestMode() || !isTestDbPath(DB_PATH)) {
    return res.status(403).json({
      success: false,
      message: '테스트 전용 DB에서만 사용할 수 있습니다.',
    });
  }
  resetTestDb(db);
  cleanUploads();
  res.json({ success: true });
});

module.exports = router;
