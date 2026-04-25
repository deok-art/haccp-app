const { db } = require('./db');
const { app } = require('./app');
const { ensureDefaultTemplates } = require('./ensure-default-templates');
const { ensureFactoryCalendarDefaults } = require('./factory-calendar');

const PORT = process.env.PORT || 3000;

ensureDefaultTemplates(db);
ensureFactoryCalendarDefaults(db);

app.listen(PORT, () => {
  console.log(`[HACCP] http://localhost:${PORT}`);
});
