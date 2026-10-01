'use strict';

const seed = require('../data/seed.json');
const { loadConfig } = require('./config');
const { createApp } = require('./app');

const config = loadConfig();
const { app, stop } = createApp({ seed, config });

const server = app.listen(config.port, () => {
  console.log(`Money Home running at http://localhost:${config.port}`);
  if (config.fxStatic) console.log('FX_STATIC on: rates are frozen for the demo');
});

const shutdown = () => {
  stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
