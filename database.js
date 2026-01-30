const Database = require('better-sqlite3');
const db = new Database('crawler.db');

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Initialize tables
const init = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS crawls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root_url TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crawl_id INTEGER,
            url TEXT NOT NULL,
            type TEXT,
            status_code INTEGER,
            source_page_url TEXT,
            FOREIGN KEY(crawl_id) REFERENCES crawls(id)
        );

        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crawl_id INTEGER,
            message TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(crawl_id) REFERENCES crawls(id)
        );
    `);
};

module.exports = {
    db,
    init
};
