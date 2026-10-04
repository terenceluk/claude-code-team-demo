const express = require('express');
const path = require('path');
const fs = require('fs');

require('./db/connection'); // ensures db/waypoint.sqlite exists and schema is applied

const authRoutes = require('./routes/auth');
const pinsRoutes = require('./routes/pins');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/pins', pinsRoutes);
app.use('/api/admin', adminRoutes);

// frontend owns everything under public/. Create it with a placeholder so
// the server boots even before the frontend agent has written real files.
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
const placeholderIndex = path.join(publicDir, 'index.html');
if (!fs.existsSync(placeholderIndex)) {
  fs.writeFileSync(
    placeholderIndex,
    '<!doctype html>\n<html><body><h1>Waypoint</h1><p>Frontend not built yet.</p></body></html>\n'
  );
}
app.use(express.static(publicDir));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Waypoint server listening on http://localhost:${PORT}`);
});
