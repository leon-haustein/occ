require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api', apiRouter);

// Kommentar-Tabellen automatisch anlegen, falls noch nicht vorhanden
async function ensureCommentTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS comments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            entity_type ENUM('kurs', 'thema', 'karteikarte') NOT NULL,
            entity_id INT NOT NULL,
            author_key VARCHAR(64) NOT NULL,
            author_name VARCHAR(40) NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_comments_entity (entity_type, entity_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS comment_reports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            comment_id INT NOT NULL,
            reporter_key VARCHAR(64) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_comment_reporter (comment_id, reporter_key),
            CONSTRAINT fk_comment_reports FOREIGN KEY (comment_id)
                REFERENCES comments(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

ensureCommentTables()
    .then(() => console.log('Comment tables ready'))
    .catch((err) => console.error('Failed to ensure comment tables:', err.message));

// Inhaltsspalten auf MEDIUMTEXT erweitern, damit Markdown + Base64-Bilder passen
async function ensureFlashcardColumns() {
    await pool.query('ALTER TABLE standard_karteikarte MODIFY frage MEDIUMTEXT, MODIFY antwort MEDIUMTEXT');
    await pool.query('ALTER TABLE prozesschritte MODIFY frage MEDIUMTEXT, MODIFY antwort MEDIUMTEXT');
}

ensureFlashcardColumns()
    .then(() => console.log('Flashcard content columns ready'))
    .catch((err) => console.error('Failed to ensure flashcard columns:', err.message));

async function ensureOklusionTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS oklusion_karteikarte (
            karteikarte_id INT NOT NULL PRIMARY KEY,
            titel VARCHAR(255) NULL,
            bild MEDIUMTEXT NOT NULL,
            CONSTRAINT fk_oklusion_karteikarte FOREIGN KEY (karteikarte_id)
                REFERENCES karteikarten(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS oklusion_abdeckungen (
            id INT AUTO_INCREMENT PRIMARY KEY,
            oklusion_karteikarte_id INT NOT NULL,
            reihenfolge INT NOT NULL,
            typ ENUM('rect', 'lasso') NOT NULL,
            pos_x DECIMAL(8,4) NOT NULL,
            pos_y DECIMAL(8,4) NOT NULL,
            pos_w DECIMAL(8,4) NOT NULL,
            pos_h DECIMAL(8,4) NOT NULL,
            points JSON NULL,
            INDEX idx_oklusion_abdeckungen_card (oklusion_karteikarte_id),
            CONSTRAINT fk_oklusion_abdeckungen FOREIGN KEY (oklusion_karteikarte_id)
                REFERENCES karteikarten(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

ensureOklusionTables()
    .then(() => console.log('Oklusion tables ready'))
    .catch((err) => console.error('Failed to ensure oklusion tables:', err.message));

async function ensureChangeSuggestionTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS change_suggestions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            entity_type ENUM('kurs', 'thema') NOT NULL,
            entity_id INT NOT NULL,
            suggested_value VARCHAR(40) NOT NULL,
            author_key VARCHAR(64) NOT NULL,
            author_name VARCHAR(40) NOT NULL,
            status ENUM('pending', 'applied') NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            applied_at TIMESTAMP NULL,
            INDEX idx_change_suggestions_entity (entity_type, entity_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS change_suggestion_votes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            suggestion_id INT NOT NULL,
            voter_key VARCHAR(64) NOT NULL,
            vote_value TINYINT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_suggestion_voter (suggestion_id, voter_key),
            CONSTRAINT fk_change_suggestion_votes FOREIGN KEY (suggestion_id)
                REFERENCES change_suggestions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

ensureChangeSuggestionTables()
    .then(() => console.log('Change suggestion tables ready'))
    .catch((err) => console.error('Failed to ensure change suggestion tables:', err.message));

async function upgradeChangeSuggestionSchema() {
    await pool.query(
        "ALTER TABLE change_suggestions MODIFY entity_type ENUM('kurs', 'thema', 'karteikarte') NOT NULL"
    );
    await pool.query(
        'ALTER TABLE change_suggestions MODIFY suggested_value MEDIUMTEXT NOT NULL'
    );
}

upgradeChangeSuggestionSchema()
    .then(() => console.log('Change suggestion schema upgraded'))
    .catch((err) => console.error('Failed to upgrade change suggestion schema:', err.message));

app.listen(PORT, () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});
