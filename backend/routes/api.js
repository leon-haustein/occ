const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/programs – alle Studiengänge aus studiengaenge
router.get('/programs', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, studiengang, abschluss FROM studiengaenge ORDER BY studiengang'
        );
        res.json(rows);
    } catch (err) {
        console.error('DB error /api/programs:', err.message);
        res.status(500).json({ error: 'Failed to load study programs' });
    }
});

// GET /api/programs/:id – ein Studiengang (für Breadcrumb)
router.get('/programs/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, studiengang, abschluss FROM studiengaenge WHERE id = ?',
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Program not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('DB error /api/programs/:id', err.message);
        res.status(500).json({ error: 'Failed to load program' });
    }
});

// GET /api/programs/:id/courses – Kurse eines Studiengangs aus kurse
router.get('/programs/:id/courses', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, studiengang_id, name FROM kurse WHERE studiengang_id = ? ORDER BY name',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('DB error /api/programs/:id/courses', err.message);
        res.status(500).json({ error: 'Failed to load courses' });
    }
});

// POST /api/courses – neuen Kurs anlegen
router.post('/courses', async (req, res) => {
    try {
        const { studiengang_id, name } = req.body || {};
        if (!studiengang_id || !name || !String(name).trim()) {
            return res.status(400).json({ error: 'studiengang_id and name required' });
        }
        const [result] = await pool.query(
            'INSERT INTO kurse (studiengang_id, name) VALUES (?, ?)',
            [studiengang_id, String(name).trim()]
        );
        res.status(201).json({ id: result.insertId, studiengang_id, name: String(name).trim() });
    } catch (err) {
        console.error('DB error POST /api/courses', err.message);
        res.status(500).json({ error: 'Failed to add course' });
    }
});

// PATCH /api/courses/:id – Kursname ändern
router.patch('/courses/:id', async (req, res) => {
    try {
        const name = req.body && req.body.name != null ? String(req.body.name).trim() : '';
        if (!name) return res.status(400).json({ error: 'name required' });
        const [result] = await pool.query('UPDATE kurse SET name = ? WHERE id = ?', [name, req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Course not found' });
        res.json({ id: req.params.id, name });
    } catch (err) {
        console.error('DB error PATCH /api/courses', err.message);
        res.status(500).json({ error: 'Failed to update course' });
    }
});

// DELETE /api/courses/:id – Kurs löschen
router.delete('/courses/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM kurse WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Course not found' });
        res.status(204).send();
    } catch (err) {
        console.error('DB error DELETE /api/courses/:id', err.message);
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

// GET /api/courses/:id – ein Kurs (für Breadcrumb)
router.get('/courses/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, studiengang_id, name FROM kurse WHERE id = ?',
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Course not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('DB error /api/courses/:id', err.message);
        res.status(500).json({ error: 'Failed to load course' });
    }
});

// GET /api/courses/:id/topics – Themen eines Kurses aus themen
router.get('/courses/:id/topics', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, kurs_id, name FROM themen WHERE kurs_id = ? ORDER BY name',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('DB error /api/courses/:id/topics', err.message);
        res.status(500).json({ error: 'Failed to load topics' });
    }
});

// POST /api/topics – neues Thema anlegen
router.post('/topics', async (req, res) => {
    try {
        const { kurs_id, name } = req.body || {};
        if (!kurs_id || !name || !String(name).trim()) {
            return res.status(400).json({ error: 'kurs_id and name required' });
        }
        const [result] = await pool.query(
            'INSERT INTO themen (kurs_id, name) VALUES (?, ?)',
            [kurs_id, String(name).trim()]
        );
        res.status(201).json({ id: result.insertId, kurs_id, name: String(name).trim() });
    } catch (err) {
        console.error('DB error POST /api/topics', err.message);
        res.status(500).json({ error: 'Failed to add topic' });
    }
});

// PATCH /api/topics/:id – Themenname ändern
router.patch('/topics/:id', async (req, res) => {
    try {
        const name = req.body && req.body.name != null ? String(req.body.name).trim() : '';
        if (!name) return res.status(400).json({ error: 'name required' });
        const [result] = await pool.query('UPDATE themen SET name = ? WHERE id = ?', [name, req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Topic not found' });
        res.json({ id: req.params.id, name });
    } catch (err) {
        console.error('DB error PATCH /api/topics', err.message);
        res.status(500).json({ error: 'Failed to update topic' });
    }
});

// DELETE /api/topics/:id – Thema löschen
router.delete('/topics/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM themen WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Topic not found' });
        res.status(204).send();
    } catch (err) {
        console.error('DB error DELETE /api/topics/:id', err.message);
        res.status(500).json({ error: 'Failed to delete topic' });
    }
});

// GET /api/topics/:id – ein Thema (für Breadcrumb)
router.get('/topics/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, kurs_id, name FROM themen WHERE id = ?',
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Topic not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('DB error /api/topics/:id', err.message);
        res.status(500).json({ error: 'Failed to load topic' });
    }
});

// GET /api/topics/:id/flashcards – Karteikarten eines Themas (mit Inhalt aus typ-spezifischen Tabellen)
router.get('/topics/:id/flashcards', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT k.id, k.themen_id, k.typ, k.erstellungsdatum,
                    COALESCE(s.frage, p.titel, m.title) AS question,
                    COALESCE(s.antwort, CONCAT('Prozess: ', COALESCE(p.titel, '')), CONCAT('Mnemo: ', COALESCE(m.title, ''))) AS answer
             FROM karteikarten k
             LEFT JOIN standard_karteikarte s ON s.karteikarte_id = k.id
             LEFT JOIN prozess_karteikarte p ON p.karteikarte_id = k.id
             LEFT JOIN mnemo_karteikarte m ON m.karteikarte_id = k.id
             WHERE k.themen_id = ?
             ORDER BY k.erstellungsdatum ASC, k.id ASC`,
            [req.params.id]
        );
        const prozessIds = rows.filter(r => r.typ === 'Prozess').map(r => r.id);
        let stepsByCard = {};
        if (prozessIds.length > 0) {
            const [stepRows] = await pool.query(
                `SELECT prozess_karteikarte_id AS card_id, schritt_nummer, frage, antwort
                 FROM prozesschritte
                 WHERE prozess_karteikarte_id IN (?) ORDER BY schritt_nummer`,
                [prozessIds]
            );
            for (const row of stepRows) {
                const id = row.card_id;
                if (!stepsByCard[id]) stepsByCard[id] = [];
                stepsByCard[id].push({ frage: row.frage || '', antwort: row.antwort || '' });
            }
        }
        const mnemoIds = rows.filter(r => r.typ === 'Mnemo').map(r => r.id);
        let keysByCard = {};
        if (mnemoIds.length > 0) {
            const [keyRows] = await pool.query(
                `SELECT mnemo_karteikarte_id AS card_id, schluessel, inhalt
                 FROM mnemo_schluessel_inhalt
                 WHERE mnemo_karteikarte_id IN (?) ORDER BY reihenfolge`,
                [mnemoIds]
            );
            for (const row of keyRows) {
                const id = row.card_id;
                if (!keysByCard[id]) keysByCard[id] = [];
                keysByCard[id].push({ schluessel: row.schluessel || '', inhalt: row.inhalt || '' });
            }
        }
        const result = rows.map(row => {
            const out = { ...row };
            if (row.typ === 'Prozess' && stepsByCard[row.id]) {
                out.steps = stepsByCard[row.id];
            }
            if (row.typ === 'Mnemo' && keysByCard[row.id]) {
                out.keys = keysByCard[row.id];
            }
            return out;
        });
        res.json(result);
    } catch (err) {
        console.error('DB error /api/topics/:id/flashcards', err.message);
        res.status(500).json({ error: 'Failed to load flashcards' });
    }
});

// POST /api/flashcards – neue Karteikarte anlegen (Standard: karteikarten + standard_karteikarte)
router.post('/flashcards', async (req, res) => {
    try {
        const { topic_id, question, answer, style } = req.body || {};
        const typ = (style && String(style).trim()) ? String(style).trim() : 'standard';
        if (!topic_id) {
            return res.status(400).json({ error: 'topic_id required' });
        }
        if (typ.toLowerCase() === 'standard') {
            if (question == null || answer == null || !String(question).trim() || !String(answer).trim()) {
                return res.status(400).json({ error: 'question and answer required for Standard cards' });
            }
            const [result] = await pool.query(
                'INSERT INTO karteikarten (themen_id, typ) VALUES (?, ?)',
                [topic_id, 'Standard']
            );
            const karteikarteId = result.insertId;
            await pool.query(
                'INSERT INTO standard_karteikarte (karteikarte_id, frage, antwort) VALUES (?, ?, ?)',
                [karteikarteId, String(question).trim(), String(answer).trim()]
            );
            const [newRows] = await pool.query(
                `SELECT k.id, k.themen_id, k.typ, k.erstellungsdatum, s.frage AS question, s.antwort AS answer
                 FROM karteikarten k
                 JOIN standard_karteikarte s ON s.karteikarte_id = k.id
                 WHERE k.id = ?`,
                [karteikarteId]
            );
            res.status(201).json(newRows[0]);
        } else if (typ.toLowerCase() === 'prozess') {
            const { titel, steps } = req.body || {};
            if (!titel || !String(titel).trim()) {
                return res.status(400).json({ error: 'titel required for Prozess cards' });
            }
            if (!Array.isArray(steps) || steps.length === 0) {
                return res.status(400).json({ error: 'steps array required with at least one step (frage, antwort)' });
            }
            const [result] = await pool.query(
                'INSERT INTO karteikarten (themen_id, typ) VALUES (?, ?)',
                [topic_id, 'Prozess']
            );
            const karteikarteId = result.insertId;
            await pool.query(
                'INSERT INTO prozess_karteikarte (karteikarte_id, titel) VALUES (?, ?)',
                [karteikarteId, String(titel || '').trim()]
            );
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const frage = step && step.frage != null ? String(step.frage).trim() : '';
                const antwort = step && step.antwort != null ? String(step.antwort).trim() : '';
                if (!frage && !antwort) continue;
                await pool.query(
                    'INSERT INTO prozesschritte (prozess_karteikarte_id, schritt_nummer, frage, antwort) VALUES (?, ?, ?, ?)',
                    [karteikarteId, i + 1, frage, antwort]
                );
            }
            const [newRows] = await pool.query(
                `SELECT k.id, k.themen_id, k.typ, k.erstellungsdatum, p.titel AS question,
                        CONCAT('Prozess: ', p.titel) AS answer
                 FROM karteikarten k
                 JOIN prozess_karteikarte p ON p.karteikarte_id = k.id
                 WHERE k.id = ?`,
                [karteikarteId]
            );
            res.status(201).json(newRows[0]);
        } else if (typ.toLowerCase() === 'mnemo') {
            const { title, keys } = req.body || {};
            if (!title || !String(title).trim()) {
                return res.status(400).json({ error: 'title required for Mnemo cards' });
            }
            if (!Array.isArray(keys) || keys.length === 0) {
                return res.status(400).json({ error: 'keys array required with at least one item (schluessel, inhalt)' });
            }
            const [result] = await pool.query(
                'INSERT INTO karteikarten (themen_id, typ) VALUES (?, ?)',
                [topic_id, 'Mnemo']
            );
            const karteikarteId = result.insertId;
            await pool.query(
                'INSERT INTO mnemo_karteikarte (karteikarte_id, title) VALUES (?, ?)',
                [karteikarteId, String(title).trim()]
            );
            for (let i = 0; i < keys.length; i++) {
                const item = keys[i];
                const schluessel = item && item.schluessel != null ? String(item.schluessel).trim() : '';
                const inhalt = item && item.inhalt != null ? String(item.inhalt).trim() : '';
                if (!schluessel && !inhalt) continue;
                await pool.query(
                    'INSERT INTO mnemo_schluessel_inhalt (mnemo_karteikarte_id, schluessel, inhalt, reihenfolge) VALUES (?, ?, ?, ?)',
                    [karteikarteId, schluessel || '', inhalt || '', i + 1]
                );
            }
            const [newRows] = await pool.query(
                `SELECT k.id, k.themen_id, k.typ, k.erstellungsdatum, m.title AS question,
                        CONCAT('Mnemo: ', m.title) AS answer
                 FROM karteikarten k
                 JOIN mnemo_karteikarte m ON m.karteikarte_id = k.id
                 WHERE k.id = ?`,
                [karteikarteId]
            );
            res.status(201).json(newRows[0]);
        } else {
            return res.status(400).json({ error: 'Only Standard, Prozess and Mnemo types are supported for creation' });
        }
    } catch (err) {
        console.error('DB error POST /api/flashcards', err.message);
        res.status(500).json({ error: 'Failed to add flashcard' });
    }
});

module.exports = router;
