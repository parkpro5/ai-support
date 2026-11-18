const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

app.use(errorHandler);

module.exports = app;
