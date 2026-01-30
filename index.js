const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { init, db } = require('./database');
const { runCrawler } = require('./crawler');

const app = express();
const port = 3000;

// Configure Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Initialize DB
init();

app.use(express.json());
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API: Start a crawl
app.post('/api/crawl', upload.none(), (req, res) => {
  const { url, maxPages, urlKeyword, isSitemap } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Create pending entry immediately to return ID
  const insert = db.prepare('INSERT INTO crawls (root_url) VALUES (?)');
  const info = insert.run(url);
  const crawlId = info.lastInsertRowid;

  // Run asynchronously
  const limit = maxPages ? parseInt(maxPages) : 100;

  runCrawler(url, crawlId, limit, urlKeyword, isSitemap === 'true').catch(console.error);

  res.json({ message: 'Crawl started', crawlId });
});

// API: Get logs for a crawl
app.get('/api/crawls/:id/logs', (req, res) => {
  const { id } = req.params;
  const logs = db.prepare('SELECT * FROM logs WHERE crawl_id = ? ORDER BY id ASC').all(BigInt(id));
  res.json(logs);
});

// API: Get crawl history
app.get('/api/crawls', (req, res) => {
  const crawls = db.prepare('SELECT * FROM crawls ORDER BY id DESC').all();
  res.json(crawls);
});

// API: Get crawl details (resources)
app.get('/api/crawls/:id', (req, res) => {
  const { id } = req.params;
  const resources = db.prepare('SELECT * FROM resources WHERE crawl_id = ?').all(BigInt(id));
  res.json(resources);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
