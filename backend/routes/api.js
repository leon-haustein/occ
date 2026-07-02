const express = require('express');
const router = express.Router();
const pool = require('../db');

const VALID_ENTITY_TYPES = new Set(['kurs', 'thema', 'karteikarte']);
const VALID_CHANGE_ENTITY_TYPES = new Set(['kurs', 'thema', 'karteikarte']);

const CARD_TYP_TO_STYLE = {
    Standard: 'standard',
    Prozess: 'prozess',
    Mnemo: 'mnemo',
    Oklusion: 'oklusion'
};

function parseVoterKey(req) {
    return req.query.voter_key ? String(req.query.voter_key).trim().slice(0, 64) : null;
}

function mapVoteFields(row) {
    return {
        ...row,
        upvotes: Number(row.upvotes ?? 0),
        downvotes: Number(row.downvotes ?? 0),
        user_vote: row.user_vote == null ? null : Number(row.user_vote),
        comment_count: Number(row.comment_count ?? 0)
    };
}

function feedCountSubquery(entityType) {
    return `(
        SELECT entity_id, COUNT(*) AS comment_count
        FROM (
            SELECT entity_id FROM comments WHERE entity_type = '${entityType}'
            UNION ALL
            SELECT entity_id FROM change_suggestions WHERE entity_type = '${entityType}'
        ) combined
        GROUP BY entity_id
    )`;
}

const MAX_OKLUSION_IMAGE_BYTES = 2 * 1024 * 1024;

function estimateDataUrlBytes(dataUrl) {
    const base64 = String(dataUrl).split(',')[1] || '';
    return Math.ceil(base64.length * 0.75);
}

function validateOklusionPayload(body) {
    const { title, image, occlusions } = body || {};
    if (!image || !String(image).trim()) {
        return { error: 'image required for Oklusion cards' };
    }
    const imageStr = String(image).trim();
    if (!imageStr.startsWith('data:image/')) {
        return { error: 'image must be a data URL' };
    }
    if (estimateDataUrlBytes(imageStr) > MAX_OKLUSION_IMAGE_BYTES) {
        return { error: 'image_too_large', message: 'Bild ist zu groß (max. 2 MB).' };
    }
    if (!Array.isArray(occlusions) || occlusions.length === 0) {
        return { error: 'occlusions array required with at least one occlusion' };
    }
    const normalized = [];
    for (const occ of occlusions) {
        const type = occ && occ.type != null ? String(occ.type).toLowerCase() : '';
        if (type !== 'rect' && type !== 'lasso') {
            return { error: 'invalid occlusion type' };
        }
        const x = Number(occ.x);
        const y = Number(occ.y);
        const w = Number(occ.w);
        const h = Number(occ.h);
        if (![x, y, w, h].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) {
            return { error: 'invalid occlusion bounds' };
        }
        if (w <= 0 || h <= 0) {
            return { error: 'invalid occlusion bounds' };
        }
        const entry = { type, x, y, w, h };
        if (type === 'lasso') {
            if (!Array.isArray(occ.points) || occ.points.length < 3) {
                return { error: 'lasso occlusions require at least 3 points' };
            }
            entry.points = occ.points.map((p) => {
                const px = Number(p.x);
                const py = Number(p.y);
                if (!Number.isFinite(px) || !Number.isFinite(py)) {
                    throw new Error('invalid lasso point');
                }
                return { x: px, y: py };
            });
        }
        normalized.push(entry);
    }
    const titel = title != null && String(title).trim() ? String(title).trim() : null;
    if (!titel) return { error: 'title required for Oklusion cards' };
    return { image: imageStr, occlusions: normalized, titel };
}

async function insertOklusionOcclusions(cardId, occlusions) {
    for (let i = 0; i < occlusions.length; i++) {
        const occ = occlusions[i];
        await pool.query(
            `INSERT INTO oklusion_abdeckungen
             (oklusion_karteikarte_id, reihenfolge, typ, pos_x, pos_y, pos_w, pos_h, points)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                cardId,
                i + 1,
                occ.type,
                occ.x,
                occ.y,
                occ.w,
                occ.h,
                occ.type === 'lasso' ? JSON.stringify(occ.points) : null
            ]
        );
    }
}

async function insertOklusionCard(topicId, payload) {
    const [result] = await pool.query(
        'INSERT INTO karteikarten (themen_id, typ) VALUES (?, ?)',
        [topicId, 'Oklusion']
    );
    const karteikarteId = result.insertId;
    await pool.query(
        'INSERT INTO oklusion_karteikarte (karteikarte_id, titel, bild) VALUES (?, ?, ?)',
        [karteikarteId, payload.titel, payload.image]
    );
    await insertOklusionOcclusions(karteikarteId, payload.occlusions);
    return karteikarteId;
}

function hasDuplicateMnemoKeys(keys) {
    const seen = new Set();
    for (const k of keys) {
        const s = (k.schluessel || '').toLowerCase();
        if (!s) continue;
        if (seen.has(s)) return true;
        seen.add(s);
    }
    return false;
}

function previewQuestionFromFlashcardPayload(payload) {
    const style = String(payload.style || '').toLowerCase();
    if (style === 'standard') return String(payload.question || '').trim() || 'Standard-Karte';
    if (style === 'prozess') return String(payload.titel || '').trim() || 'Prozess-Karte';
    if (style === 'mnemo') return String(payload.title || '').trim() || 'Mnemo-Karte';
    if (style === 'oklusion') {
        const t = payload.title != null ? String(payload.title).trim() : '';
        return t || 'Oklusion-Karte';
    }
    return 'Karteikarte';
}

function validateFlashcardChangePayload(payload, cardTyp) {
    if (!payload || typeof payload !== 'object') {
        return { error: 'invalid payload' };
    }
    const style = String(payload.style || '').trim().toLowerCase();
    const expectedStyle = CARD_TYP_TO_STYLE[cardTyp];
    if (!expectedStyle || style !== expectedStyle) {
        return { error: 'payload style must match card type' };
    }

    if (style === 'standard') {
        const question = payload.question != null ? String(payload.question).trim() : '';
        const answer = payload.answer != null ? String(payload.answer).trim() : '';
        if (!question || !answer) {
            return { error: 'question and answer required for Standard cards' };
        }
        return {
            payload: { style: 'standard', question, answer },
            preview_question: question
        };
    }

    if (style === 'prozess') {
        const titel = payload.titel != null ? String(payload.titel).trim() : '';
        if (!titel) return { error: 'titel required for Prozess cards' };
        if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
            return { error: 'steps array required with at least one step' };
        }
        const steps = payload.steps
            .map((step) => ({
                frage: step && step.frage != null ? String(step.frage).trim() : '',
                antwort: step && step.antwort != null ? String(step.antwort).trim() : ''
            }))
            .filter((s) => s.frage || s.antwort);
        if (steps.length === 0) {
            return { error: 'steps array required with at least one step' };
        }
        return {
            payload: { style: 'prozess', titel, steps },
            preview_question: titel
        };
    }

    if (style === 'mnemo') {
        const title = payload.title != null ? String(payload.title).trim() : '';
        if (!title) return { error: 'title required for Mnemo cards' };
        if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
            return { error: 'keys array required with at least one item' };
        }
        const keys = payload.keys
            .map((item) => ({
                schluessel: item && item.schluessel != null ? String(item.schluessel).trim() : '',
                inhalt: item && item.inhalt != null ? String(item.inhalt).trim() : ''
            }))
            .filter((k) => k.schluessel || k.inhalt);
        if (keys.length === 0) {
            return { error: 'keys array required with at least one item' };
        }
        if (hasDuplicateMnemoKeys(keys)) {
            return { error: 'duplicate_mnemo_key' };
        }
        return {
            payload: { style: 'mnemo', title, keys },
            preview_question: title
        };
    }

    if (style === 'oklusion') {
        let okPayload;
        try {
            okPayload = validateOklusionPayload(payload);
        } catch (e) {
            return { error: 'invalid lasso point' };
        }
        if (okPayload.error) return { error: okPayload.error, message: okPayload.message };
        return {
            payload: {
                style: 'oklusion',
                title: okPayload.titel,
                image: okPayload.image,
                occlusions: okPayload.occlusions
            },
            preview_question: previewQuestionFromFlashcardPayload({
                style: 'oklusion',
                title: okPayload.titel
            })
        };
    }

    return { error: 'unsupported card style' };
}

async function applyFlashcardPayload(cardId, payload) {
    const style = String(payload.style || '').toLowerCase();
    if (style === 'standard') {
        await pool.query(
            'UPDATE standard_karteikarte SET frage = ?, antwort = ? WHERE karteikarte_id = ?',
            [payload.question, payload.answer, cardId]
        );
        return;
    }
    if (style === 'prozess') {
        await pool.query(
            'UPDATE prozess_karteikarte SET titel = ? WHERE karteikarte_id = ?',
            [payload.titel, cardId]
        );
        await pool.query('DELETE FROM prozesschritte WHERE prozess_karteikarte_id = ?', [cardId]);
        for (let i = 0; i < payload.steps.length; i++) {
            const step = payload.steps[i];
            await pool.query(
                'INSERT INTO prozesschritte (prozess_karteikarte_id, schritt_nummer, frage, antwort) VALUES (?, ?, ?, ?)',
                [cardId, i + 1, step.frage || '', step.antwort || '']
            );
        }
        return;
    }
    if (style === 'mnemo') {
        await pool.query(
            'UPDATE mnemo_karteikarte SET title = ? WHERE karteikarte_id = ?',
            [payload.title, cardId]
        );
        await pool.query('DELETE FROM mnemo_schluessel_inhalt WHERE mnemo_karteikarte_id = ?', [cardId]);
        for (let i = 0; i < payload.keys.length; i++) {
            const item = payload.keys[i];
            await pool.query(
                'INSERT INTO mnemo_schluessel_inhalt (mnemo_karteikarte_id, schluessel, inhalt, reihenfolge) VALUES (?, ?, ?, ?)',
                [cardId, item.schluessel || '', item.inhalt || '', i + 1]
            );
        }
        return;
    }
    if (style === 'oklusion') {
        const okPayload = validateOklusionPayload(payload);
        if (okPayload.error) throw new Error(okPayload.error);
        await pool.query(
            'UPDATE oklusion_karteikarte SET titel = ?, bild = ? WHERE karteikarte_id = ?',
            [okPayload.titel, okPayload.image, cardId]
        );
        await pool.query('DELETE FROM oklusion_abdeckungen WHERE oklusion_karteikarte_id = ?', [cardId]);
        await insertOklusionOcclusions(cardId, okPayload.occlusions);
    }
}

function mapChangeSuggestionRow(row, voterKey) {
    const base = {
        id: row.id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        suggested_value: row.suggested_value,
        author_name: row.author_name,
        status: row.status,
        created_at: row.created_at,
        applied_at: row.applied_at,
        upvotes: Number(row.upvotes ?? 0),
        downvotes: Number(row.downvotes ?? 0),
        user_vote: row.user_vote == null ? null : Number(row.user_vote),
        is_own: voterKey != null && row.author_key === voterKey
    };
    if (row.entity_type === 'karteikarte') {
        base.suggestion_kind = 'content';
        try {
            base.payload = JSON.parse(row.suggested_value);
            base.preview_question = previewQuestionFromFlashcardPayload(base.payload);
        } catch (_) {
            base.preview_question = 'Karteikarte';
        }
    } else {
        base.suggestion_kind = 'rename';
    }
    return base;
}

function mapOklusionRow(row, occRows) {
    const occlusions = occRows.map((occ) => {
        const entry = {
            type: occ.typ,
            x: Number(occ.pos_x),
            y: Number(occ.pos_y),
            w: Number(occ.pos_w),
            h: Number(occ.pos_h)
        };
        if (occ.typ === 'lasso' && occ.points) {
            entry.points = typeof occ.points === 'string' ? JSON.parse(occ.points) : occ.points;
        }
        return entry;
    });
    return {
        id: row.id,
        themen_id: row.themen_id,
        typ: row.typ,
        erstellungsdatum: row.erstellungsdatum,
        question: row.titel && String(row.titel).trim() ? row.titel : 'Oklusion-Karte',
        answer: null,
        image: row.bild,
        occlusions
    };
}

async function entityExists(entityType, entityId) {
    const table = entityType === 'kurs' ? 'kurse'
        : entityType === 'thema' ? 'themen'
        : 'karteikarten';
    const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [entityId]);
    return rows.length > 0;
}

async function getVoteSummary(entityType, entityId, voterKey = null) {
    const [countRows] = await pool.query(
        `SELECT
            COALESCE(SUM(vote_value = 1), 0) AS upvotes,
            COALESCE(SUM(vote_value = -1), 0) AS downvotes
         FROM votes
         WHERE entity_type = ? AND entity_id = ?`,
        [entityType, entityId]
    );

    let userVote = null;
    if (voterKey) {
        const [userRows] = await pool.query(
            `SELECT vote_value FROM votes
             WHERE entity_type = ? AND entity_id = ? AND voter_key = ?`,
            [entityType, entityId, voterKey]
        );
        if (userRows.length > 0) userVote = userRows[0].vote_value;
    }

    return {
        upvotes: Number(countRows[0].upvotes),
        downvotes: Number(countRows[0].downvotes),
        user_vote: userVote == null ? null : Number(userVote)
    };
}

async function deleteChangeSuggestionsForEntity(entityType, entityId) {
    if (!VALID_CHANGE_ENTITY_TYPES.has(entityType)) return;
    await pool.query(
        'DELETE FROM change_suggestions WHERE entity_type = ? AND entity_id = ?',
        [entityType, entityId]
    );
}

async function deleteChangeSuggestionsForEntities(entityType, entityIds) {
    if (!entityIds.length || !VALID_CHANGE_ENTITY_TYPES.has(entityType)) return;
    await pool.query(
        'DELETE FROM change_suggestions WHERE entity_type = ? AND entity_id IN (?)',
        [entityType, entityIds]
    );
}

async function deleteVotesForEntity(entityType, entityId) {
    await pool.query(
        'DELETE FROM votes WHERE entity_type = ? AND entity_id = ?',
        [entityType, entityId]
    );
    await pool.query(
        'DELETE FROM comments WHERE entity_type = ? AND entity_id = ?',
        [entityType, entityId]
    );
    await deleteChangeSuggestionsForEntity(entityType, entityId);
}

async function deleteCommentsForEntities(entityType, entityIds) {
    if (!entityIds.length) return;
    await pool.query(
        'DELETE FROM comments WHERE entity_type = ? AND entity_id IN (?)',
        [entityType, entityIds]
    );
}

// Kommentare einer Entität laden
async function loadComments(entityType, entityId, voterKey) {
    const [rows] = await pool.query(
        `SELECT c.id, c.entity_type, c.entity_id, c.author_key, c.author_name, c.text, c.created_at,
                COALESCE(rc.report_count, 0) AS report_count,
                (ur.comment_id IS NOT NULL) AS user_reported
         FROM comments c
         LEFT JOIN (
             SELECT comment_id, COUNT(*) AS report_count
             FROM comment_reports
             GROUP BY comment_id
         ) rc ON rc.comment_id = c.id
         LEFT JOIN comment_reports ur
             ON ur.comment_id = c.id
            AND ur.reporter_key = ?
         WHERE c.entity_type = ? AND c.entity_id = ?
         ORDER BY c.created_at DESC, c.id DESC`,
        [voterKey, entityType, entityId]
    );
    return rows.map((row) => ({
        id: row.id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        author_name: row.author_name,
        text: row.text,
        created_at: row.created_at,
        is_own: voterKey != null && row.author_key === voterKey,
        report_count: Number(row.report_count ?? 0),
        user_reported: Boolean(row.user_reported)
    }));
}

async function getCommentReportSummary(commentId, reporterKey) {
    const [countRows] = await pool.query(
        'SELECT COUNT(*) AS report_count FROM comment_reports WHERE comment_id = ?',
        [commentId]
    );
    const [userRows] = await pool.query(
        'SELECT id FROM comment_reports WHERE comment_id = ? AND reporter_key = ?',
        [commentId, reporterKey]
    );
    return {
        report_count: Number(countRows[0].report_count),
        user_reported: userRows.length > 0
    };
}

async function loadChangeSuggestions(entityType, entityId, voterKey) {
    const [rows] = await pool.query(
        `SELECT s.id, s.entity_type, s.entity_id, s.suggested_value, s.author_key, s.author_name,
                s.status, s.created_at, s.applied_at,
                COALESCE(vc.upvotes, 0) AS upvotes,
                COALESCE(vc.downvotes, 0) AS downvotes,
                uv.vote_value AS user_vote
         FROM change_suggestions s
         LEFT JOIN (
             SELECT suggestion_id,
                    SUM(vote_value = 1) AS upvotes,
                    SUM(vote_value = -1) AS downvotes
             FROM change_suggestion_votes
             GROUP BY suggestion_id
         ) vc ON vc.suggestion_id = s.id
         LEFT JOIN change_suggestion_votes uv
             ON uv.suggestion_id = s.id
            AND uv.voter_key = ?
         WHERE s.entity_type = ? AND s.entity_id = ?
         ORDER BY s.created_at DESC, s.id DESC`,
        [voterKey, entityType, entityId]
    );
    return rows.map((row) => mapChangeSuggestionRow(row, voterKey));
}

async function getChangeSuggestionVoteSummary(suggestionId, voterKey) {
    const [countRows] = await pool.query(
        `SELECT
            COALESCE(SUM(vote_value = 1), 0) AS upvotes,
            COALESCE(SUM(vote_value = -1), 0) AS downvotes
         FROM change_suggestion_votes
         WHERE suggestion_id = ?`,
        [suggestionId]
    );

    let userVote = null;
    if (voterKey) {
        const [userRows] = await pool.query(
            'SELECT vote_value FROM change_suggestion_votes WHERE suggestion_id = ? AND voter_key = ?',
            [suggestionId, voterKey]
        );
        if (userRows.length > 0) userVote = userRows[0].vote_value;
    }

    return {
        upvotes: Number(countRows[0].upvotes),
        downvotes: Number(countRows[0].downvotes),
        user_vote: userVote == null ? null : Number(userVote)
    };
}

async function maybeApplyChangeSuggestion(suggestionId, voterKey = null) {
    const [rows] = await pool.query(
        `SELECT s.id, s.entity_type, s.entity_id, s.suggested_value, s.status,
                COALESCE(SUM(v.vote_value = 1), 0) AS upvotes,
                COALESCE(SUM(v.vote_value = -1), 0) AS downvotes
         FROM change_suggestions s
         LEFT JOIN change_suggestion_votes v ON v.suggestion_id = s.id
         WHERE s.id = ?
         GROUP BY s.id, s.entity_type, s.entity_id, s.suggested_value, s.status`,
        [suggestionId]
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    if (row.status !== 'pending') return null;

    const net = Number(row.upvotes) - Number(row.downvotes);
    if (net < 3) return null;

    if (row.entity_type === 'kurs' || row.entity_type === 'thema') {
        const table = row.entity_type === 'kurs' ? 'kurse' : 'themen';
        await pool.query(`UPDATE ${table} SET name = ? WHERE id = ?`, [row.suggested_value, row.entity_id]);
        await pool.query(
            `UPDATE change_suggestions SET status = 'applied', applied_at = NOW() WHERE id = ?`,
            [suggestionId]
        );
        return {
            applied: true,
            new_name: row.suggested_value,
            entity_type: row.entity_type,
            entity_id: Number(row.entity_id)
        };
    }

    if (row.entity_type === 'karteikarte') {
        let payload;
        try {
            payload = JSON.parse(row.suggested_value);
        } catch (_) {
            return null;
        }
        const [cardRows] = await pool.query('SELECT typ FROM karteikarten WHERE id = ?', [row.entity_id]);
        if (cardRows.length === 0) return null;
        const validation = validateFlashcardChangePayload(payload, cardRows[0].typ);
        if (validation.error) return null;

        await applyFlashcardPayload(Number(row.entity_id), validation.payload);
        await pool.query(
            `UPDATE change_suggestions SET status = 'applied', applied_at = NOW() WHERE id = ?`,
            [suggestionId]
        );
        const cards = await loadFlashcardsWhere('k.id = ?', [row.entity_id], voterKey);
        return {
            applied: true,
            updated_card: cards[0] || null,
            entity_type: 'karteikarte',
            entity_id: Number(row.entity_id)
        };
    }

    return null;
}

async function deleteVotesForCourse(courseId) {
    const [topics] = await pool.query('SELECT id FROM themen WHERE kurs_id = ?', [courseId]);
    const topicIds = topics.map((t) => t.id);
    if (topicIds.length > 0) {
        const [cards] = await pool.query(
            'SELECT id FROM karteikarten WHERE themen_id IN (?)',
            [topicIds]
        );
        const cardIds = cards.map((c) => c.id);
        if (cardIds.length > 0) {
            await pool.query(
                "DELETE FROM votes WHERE entity_type = 'karteikarte' AND entity_id IN (?)",
                [cardIds]
            );
            await deleteCommentsForEntities('karteikarte', cardIds);
            await deleteChangeSuggestionsForEntities('karteikarte', cardIds);
        }
        await pool.query(
            "DELETE FROM votes WHERE entity_type = 'thema' AND entity_id IN (?)",
            [topicIds]
        );
        await deleteCommentsForEntities('thema', topicIds);
        await deleteChangeSuggestionsForEntities('thema', topicIds);
    }
    await deleteVotesForEntity('kurs', courseId);
}

async function deleteVotesForTopic(topicId) {
    const [cards] = await pool.query(
        'SELECT id FROM karteikarten WHERE themen_id = ?',
        [topicId]
    );
    const cardIds = cards.map((c) => c.id);
    if (cardIds.length > 0) {
        await pool.query(
            "DELETE FROM votes WHERE entity_type = 'karteikarte' AND entity_id IN (?)",
            [cardIds]
        );
        await deleteCommentsForEntities('karteikarte', cardIds);
        await deleteChangeSuggestionsForEntities('karteikarte', cardIds);
    }
    await deleteVotesForEntity('thema', topicId);
}

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
        const voterKey = parseVoterKey(req);
        const [rows] = await pool.query(
            `SELECT k.id, k.studiengang_id, k.name,
                    COALESCE(vc.upvotes, 0) AS upvotes,
                    COALESCE(vc.downvotes, 0) AS downvotes,
                    uv.vote_value AS user_vote,
                    COALESCE(cc.comment_count, 0) AS comment_count
             FROM kurse k
             LEFT JOIN (
                 SELECT entity_id,
                        SUM(vote_value = 1) AS upvotes,
                        SUM(vote_value = -1) AS downvotes
                 FROM votes
                 WHERE entity_type = 'kurs'
                 GROUP BY entity_id
             ) vc ON vc.entity_id = k.id
             LEFT JOIN ${feedCountSubquery('kurs')} cc ON cc.entity_id = k.id
             LEFT JOIN votes uv
                 ON uv.entity_type = 'kurs'
                AND uv.entity_id = k.id
                AND uv.voter_key = ?
             WHERE k.studiengang_id = ?
             ORDER BY k.name`,
            [voterKey, req.params.id]
        );
        res.json(rows.map(mapVoteFields));
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

// DELETE /api/courses/:id – Kurs löschen
router.delete('/courses/:id', async (req, res) => {
    try {
        const courseId = parseInt(req.params.id, 10);
        const [existing] = await pool.query('SELECT id FROM kurse WHERE id = ?', [courseId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Course not found' });
        await deleteVotesForCourse(courseId);
        await pool.query('DELETE FROM kurse WHERE id = ?', [courseId]);
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
        const voterKey = parseVoterKey(req);
        const [rows] = await pool.query(
            `SELECT t.id, t.kurs_id, t.name,
                    COALESCE(vc.upvotes, 0) AS upvotes,
                    COALESCE(vc.downvotes, 0) AS downvotes,
                    uv.vote_value AS user_vote,
                    COALESCE(cc.comment_count, 0) AS comment_count
             FROM themen t
             LEFT JOIN (
                 SELECT entity_id,
                        SUM(vote_value = 1) AS upvotes,
                        SUM(vote_value = -1) AS downvotes
                 FROM votes
                 WHERE entity_type = 'thema'
                 GROUP BY entity_id
             ) vc ON vc.entity_id = t.id
             LEFT JOIN ${feedCountSubquery('thema')} cc ON cc.entity_id = t.id
             LEFT JOIN votes uv
                 ON uv.entity_type = 'thema'
                AND uv.entity_id = t.id
                AND uv.voter_key = ?
             WHERE t.kurs_id = ?
             ORDER BY t.name`,
            [voterKey, req.params.id]
        );
        res.json(rows.map(mapVoteFields));
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

// DELETE /api/topics/:id – Thema löschen
router.delete('/topics/:id', async (req, res) => {
    try {
        const topicId = parseInt(req.params.id, 10);
        const [existing] = await pool.query('SELECT id FROM themen WHERE id = ?', [topicId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Topic not found' });
        await deleteVotesForTopic(topicId);
        await pool.query('DELETE FROM themen WHERE id = ?', [topicId]);
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

// Karteikarten (inkl. typ-spezifischer Inhalte) für eine frei wählbare Scope-Bedingung laden
async function loadFlashcardsWhere(whereSql, scopeParams, voterKey) {
    const [rows] = await pool.query(
        `SELECT k.id, k.themen_id, k.typ, k.erstellungsdatum,
                COALESCE(s.frage, p.titel, m.title, o.titel, 'Oklusion-Karte') AS question,
                COALESCE(s.antwort, CONCAT('Prozess: ', COALESCE(p.titel, '')), CONCAT('Mnemo: ', COALESCE(m.title, ''))) AS answer,
                o.bild AS image,
                COALESCE(vc.upvotes, 0) AS upvotes,
                COALESCE(vc.downvotes, 0) AS downvotes,
                uv.vote_value AS user_vote,
                COALESCE(cc.comment_count, 0) AS comment_count
         FROM karteikarten k
         LEFT JOIN standard_karteikarte s ON s.karteikarte_id = k.id
         LEFT JOIN prozess_karteikarte p ON p.karteikarte_id = k.id
         LEFT JOIN mnemo_karteikarte m ON m.karteikarte_id = k.id
         LEFT JOIN oklusion_karteikarte o ON o.karteikarte_id = k.id
         LEFT JOIN (
             SELECT entity_id,
                    SUM(vote_value = 1) AS upvotes,
                    SUM(vote_value = -1) AS downvotes
             FROM votes
             WHERE entity_type = 'karteikarte'
             GROUP BY entity_id
         ) vc ON vc.entity_id = k.id
         LEFT JOIN ${feedCountSubquery('karteikarte')} cc ON cc.entity_id = k.id
         LEFT JOIN votes uv
             ON uv.entity_type = 'karteikarte'
            AND uv.entity_id = k.id
            AND uv.voter_key = ?
         WHERE ${whereSql}
         ORDER BY k.erstellungsdatum ASC, k.id ASC`,
        [voterKey, ...scopeParams]
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
    const oklusionIds = rows.filter(r => r.typ === 'Oklusion').map(r => r.id);
    let occlusionsByCard = {};
    if (oklusionIds.length > 0) {
        const [occRows] = await pool.query(
            `SELECT oklusion_karteikarte_id AS card_id, typ, pos_x, pos_y, pos_w, pos_h, points
             FROM oklusion_abdeckungen
             WHERE oklusion_karteikarte_id IN (?) ORDER BY reihenfolge`,
            [oklusionIds]
        );
        for (const row of occRows) {
            const id = row.card_id;
            if (!occlusionsByCard[id]) occlusionsByCard[id] = [];
            const entry = {
                type: row.typ,
                x: Number(row.pos_x),
                y: Number(row.pos_y),
                w: Number(row.pos_w),
                h: Number(row.pos_h)
            };
            if (row.typ === 'lasso' && row.points) {
                entry.points = typeof row.points === 'string' ? JSON.parse(row.points) : row.points;
            }
            occlusionsByCard[id].push(entry);
        }
    }
    return rows.map(row => {
        const out = mapVoteFields({ ...row });
        if (row.typ === 'Prozess' && stepsByCard[row.id]) {
            out.steps = stepsByCard[row.id];
        }
        if (row.typ === 'Mnemo' && keysByCard[row.id]) {
            out.keys = keysByCard[row.id];
        }
        if (row.typ === 'Oklusion') {
            out.image = row.image || null;
            out.occlusions = occlusionsByCard[row.id] || [];
        }
        return out;
    });
}

// GET /api/topics/:id/flashcards – Karteikarten eines Themas (mit Inhalt aus typ-spezifischen Tabellen)
router.get('/topics/:id/flashcards', async (req, res) => {
    try {
        const voterKey = parseVoterKey(req);
        const result = await loadFlashcardsWhere('k.themen_id = ?', [req.params.id], voterKey);
        res.json(result);
    } catch (err) {
        console.error('DB error /api/topics/:id/flashcards', err.message);
        res.status(500).json({ error: 'Failed to load flashcards' });
    }
});

// GET /api/courses/:id/flashcards – alle Karteikarten eines Kurses (über alle Themen)
router.get('/courses/:id/flashcards', async (req, res) => {
    try {
        const voterKey = parseVoterKey(req);
        const result = await loadFlashcardsWhere(
            'k.themen_id IN (SELECT id FROM themen WHERE kurs_id = ?)',
            [req.params.id],
            voterKey
        );
        res.json(result);
    } catch (err) {
        console.error('DB error /api/courses/:id/flashcards', err.message);
        res.status(500).json({ error: 'Failed to load flashcards' });
    }
});

// GET /api/programs/:id/flashcards – alle Karteikarten eines Studiengangs (über alle Kurse und Themen)
router.get('/programs/:id/flashcards', async (req, res) => {
    try {
        const voterKey = parseVoterKey(req);
        const result = await loadFlashcardsWhere(
            `k.themen_id IN (
                SELECT t.id FROM themen t
                JOIN kurse ku ON ku.id = t.kurs_id
                WHERE ku.studiengang_id = ?
            )`,
            [req.params.id],
            voterKey
        );
        res.json(result);
    } catch (err) {
        console.error('DB error /api/programs/:id/flashcards', err.message);
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
        } else if (typ.toLowerCase() === 'oklusion') {
            let payload;
            try {
                payload = validateOklusionPayload(req.body);
            } catch (e) {
                return res.status(400).json({ error: 'invalid lasso point' });
            }
            if (payload.error) {
                const body = { error: payload.error };
                if (payload.message) body.message = payload.message;
                return res.status(400).json(body);
            }
            const karteikarteId = await insertOklusionCard(topic_id, payload);
            const [newRows] = await pool.query(
                `SELECT k.id, k.themen_id, k.typ, k.erstellungsdatum, o.titel, o.bild
                 FROM karteikarten k
                 JOIN oklusion_karteikarte o ON o.karteikarte_id = k.id
                 WHERE k.id = ?`,
                [karteikarteId]
            );
            const [occRows] = await pool.query(
                `SELECT typ, pos_x, pos_y, pos_w, pos_h, points
                 FROM oklusion_abdeckungen
                 WHERE oklusion_karteikarte_id = ?
                 ORDER BY reihenfolge`,
                [karteikarteId]
            );
            res.status(201).json(mapOklusionRow(newRows[0], occRows));
        } else {
            return res.status(400).json({ error: 'Only Standard, Prozess, Mnemo and Oklusion types are supported for creation' });
        }
    } catch (err) {
        console.error('DB error POST /api/flashcards', err.message);
        if (err.code === 'ER_DUP_ENTRY' && String(err.message).includes('mnemo_schluessel_inhalt')) {
            return res.status(409).json({
                error: 'duplicate_mnemo_key',
                message: 'Jeder Schlüssel darf nur einmal vorkommen. Bitte kürzere oder unterschiedliche Schlüssel verwenden.'
            });
        }
        res.status(500).json({ error: 'server_error', message: 'Die Karte konnte nicht gespeichert werden. Bitte später erneut versuchen.' });
    }
});

// DELETE /api/flashcards/:id – Karteikarte löschen
router.delete('/flashcards/:id', async (req, res) => {
    try {
        const cardId = parseInt(req.params.id, 10);
        const [existing] = await pool.query('SELECT id FROM karteikarten WHERE id = ?', [cardId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Flashcard not found' });
        await deleteVotesForEntity('karteikarte', cardId);
        await pool.query('DELETE FROM prozesschritte WHERE prozess_karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM mnemo_schluessel_inhalt WHERE mnemo_karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM oklusion_abdeckungen WHERE oklusion_karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM standard_karteikarte WHERE karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM prozess_karteikarte WHERE karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM mnemo_karteikarte WHERE karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM oklusion_karteikarte WHERE karteikarte_id = ?', [cardId]);
        await pool.query('DELETE FROM karteikarten WHERE id = ?', [cardId]);
        res.status(204).send();
    } catch (err) {
        console.error('DB error DELETE /api/flashcards/:id', err.message);
        res.status(500).json({ error: 'Failed to delete flashcard' });
    }
});

// POST /api/votes – togglebarer Up/Down-Vote
router.post('/votes', async (req, res) => {
    try {
        const { entity_type, entity_id, vote, voter_key } = req.body || {};

        if (!VALID_ENTITY_TYPES.has(entity_type)) {
            return res.status(400).json({ error: 'Invalid entity_type' });
        }
        const entityId = parseInt(entity_id, 10);
        if (!entityId) {
            return res.status(400).json({ error: 'entity_id required' });
        }
        if (vote !== 'up' && vote !== 'down') {
            return res.status(400).json({ error: 'vote must be "up" or "down"' });
        }
        if (!voter_key || !String(voter_key).trim()) {
            return res.status(400).json({ error: 'voter_key required' });
        }

        const voterKey = String(voter_key).trim().slice(0, 64);
        const requestedValue = vote === 'up' ? 1 : -1;

        if (!(await entityExists(entity_type, entityId))) {
            return res.status(404).json({ error: 'Entity not found' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [existing] = await conn.query(
                `SELECT id, vote_value FROM votes
                 WHERE entity_type = ? AND entity_id = ? AND voter_key = ?`,
                [entity_type, entityId, voterKey]
            );

            if (existing.length === 0) {
                await conn.query(
                    `INSERT INTO votes (entity_type, entity_id, vote_value, voter_key)
                     VALUES (?, ?, ?, ?)`,
                    [entity_type, entityId, requestedValue, voterKey]
                );
            } else if (existing[0].vote_value === requestedValue) {
                await conn.query('DELETE FROM votes WHERE id = ?', [existing[0].id]);
            } else {
                await conn.query(
                    'UPDATE votes SET vote_value = ? WHERE id = ?',
                    [requestedValue, existing[0].id]
                );
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        const summary = await getVoteSummary(entity_type, entityId, voterKey);
        res.json({ entity_type, entity_id: entityId, ...summary });
    } catch (err) {
        console.error('DB error POST /api/votes:', err.message);
        res.status(500).json({ error: 'Failed to cast vote' });
    }
});

// GET /api/comments?entity_type=...&entity_id=...&voter_key=... – Kommentare einer Entität
router.get('/comments', async (req, res) => {
    try {
        const entityType = req.query.entity_type;
        const entityId = parseInt(req.query.entity_id, 10);
        if (!VALID_ENTITY_TYPES.has(entityType)) {
            return res.status(400).json({ error: 'Invalid entity_type' });
        }
        if (!entityId) {
            return res.status(400).json({ error: 'entity_id required' });
        }
        const voterKey = parseVoterKey(req);
        const comments = await loadComments(entityType, entityId, voterKey);
        res.json(comments);
    } catch (err) {
        console.error('DB error GET /api/comments:', err.message);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

// POST /api/comments – neuen Kommentar anlegen
router.post('/comments', async (req, res) => {
    try {
        const { entity_type, entity_id, author_key, author_name, text } = req.body || {};

        if (!VALID_ENTITY_TYPES.has(entity_type)) {
            return res.status(400).json({ error: 'Invalid entity_type' });
        }
        const entityId = parseInt(entity_id, 10);
        if (!entityId) {
            return res.status(400).json({ error: 'entity_id required' });
        }
        if (!author_key || !String(author_key).trim()) {
            return res.status(400).json({ error: 'author_key required' });
        }
        const name = author_name == null ? '' : String(author_name).trim().slice(0, 40);
        if (!name) {
            return res.status(400).json({ error: 'author_name required' });
        }
        const commentText = text == null ? '' : String(text).trim();
        if (!commentText) {
            return res.status(400).json({ error: 'text required' });
        }
        if (commentText.length > 2000) {
            return res.status(400).json({ error: 'text too long (max 2000 characters)' });
        }

        if (!(await entityExists(entity_type, entityId))) {
            return res.status(404).json({ error: 'Entity not found' });
        }

        const authorKey = String(author_key).trim().slice(0, 64);
        const [result] = await pool.query(
            `INSERT INTO comments (entity_type, entity_id, author_key, author_name, text)
             VALUES (?, ?, ?, ?, ?)`,
            [entity_type, entityId, authorKey, name, commentText]
        );

        const [rows] = await pool.query(
            'SELECT id, entity_type, entity_id, author_name, text, created_at FROM comments WHERE id = ?',
            [result.insertId]
        );
        res.status(201).json({
            ...rows[0],
            is_own: true,
            report_count: 0,
            user_reported: false
        });
    } catch (err) {
        console.error('DB error POST /api/comments:', err.message);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// POST /api/comments/:id/report – Meldung toggeln; ab 2 Meldungen wird der Kommentar gelöscht
router.post('/comments/:id/report', async (req, res) => {
    try {
        const commentId = parseInt(req.params.id, 10);
        const { voter_key } = req.body || {};

        if (!commentId) return res.status(400).json({ error: 'Invalid comment id' });
        if (!voter_key || !String(voter_key).trim()) {
            return res.status(400).json({ error: 'voter_key required' });
        }

        const reporterKey = String(voter_key).trim().slice(0, 64);

        const [commentRows] = await pool.query('SELECT id FROM comments WHERE id = ?', [commentId]);
        if (commentRows.length === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [existing] = await conn.query(
                'SELECT id FROM comment_reports WHERE comment_id = ? AND reporter_key = ?',
                [commentId, reporterKey]
            );

            if (existing.length === 0) {
                await conn.query(
                    'INSERT INTO comment_reports (comment_id, reporter_key) VALUES (?, ?)',
                    [commentId, reporterKey]
                );
            } else {
                await conn.query('DELETE FROM comment_reports WHERE id = ?', [existing[0].id]);
            }

            const [countRows] = await conn.query(
                'SELECT COUNT(*) AS report_count FROM comment_reports WHERE comment_id = ?',
                [commentId]
            );
            const reportCount = Number(countRows[0].report_count);

            if (reportCount >= 2) {
                await conn.query('DELETE FROM comments WHERE id = ?', [commentId]);
                await conn.commit();
                return res.json({
                    comment_id: commentId,
                    report_count: reportCount,
                    user_reported: true,
                    deleted: true
                });
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        const summary = await getCommentReportSummary(commentId, reporterKey);
        res.json({
            comment_id: commentId,
            ...summary,
            deleted: false
        });
    } catch (err) {
        console.error('DB error POST /api/comments/:id/report:', err.message);
        res.status(500).json({ error: 'Failed to report comment' });
    }
});

// DELETE /api/comments/:id – eigenen Kommentar löschen (author_key muss passen)
router.delete('/comments/:id', async (req, res) => {
    try {
        const commentId = parseInt(req.params.id, 10);
        const authorKey = req.query.author_key ? String(req.query.author_key).trim().slice(0, 64) : null;
        if (!commentId) return res.status(400).json({ error: 'Invalid comment id' });
        if (!authorKey) return res.status(400).json({ error: 'author_key required' });

        const [rows] = await pool.query('SELECT author_key FROM comments WHERE id = ?', [commentId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Comment not found' });
        if (rows[0].author_key !== authorKey) {
            return res.status(403).json({ error: 'Not allowed to delete this comment' });
        }

        await pool.query('DELETE FROM comments WHERE id = ?', [commentId]);
        res.status(204).send();
    } catch (err) {
        console.error('DB error DELETE /api/comments/:id:', err.message);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// GET /api/change-suggestions?entity_type=...&entity_id=...&voter_key=...
router.get('/change-suggestions', async (req, res) => {
    try {
        const entityType = req.query.entity_type;
        const entityId = parseInt(req.query.entity_id, 10);
        if (!VALID_CHANGE_ENTITY_TYPES.has(entityType)) {
            return res.status(400).json({ error: 'Invalid entity_type' });
        }
        if (!entityId) {
            return res.status(400).json({ error: 'entity_id required' });
        }
        const voterKey = parseVoterKey(req);
        const suggestions = await loadChangeSuggestions(entityType, entityId, voterKey);
        res.json(suggestions);
    } catch (err) {
        console.error('DB error GET /api/change-suggestions:', err.message);
        res.status(500).json({ error: 'Failed to load change suggestions' });
    }
});

// POST /api/change-suggestions – neuen Änderungsvorschlag anlegen
router.post('/change-suggestions', async (req, res) => {
    try {
        const { entity_type, entity_id, suggested_value, author_key, author_name } = req.body || {};

        if (!VALID_CHANGE_ENTITY_TYPES.has(entity_type)) {
            return res.status(400).json({ error: 'Invalid entity_type' });
        }
        const entityId = parseInt(entity_id, 10);
        if (!entityId) {
            return res.status(400).json({ error: 'entity_id required' });
        }
        if (!author_key || !String(author_key).trim()) {
            return res.status(400).json({ error: 'author_key required' });
        }
        const name = author_name == null ? '' : String(author_name).trim().slice(0, 40);
        if (!name) {
            return res.status(400).json({ error: 'author_name required' });
        }

        if (!(await entityExists(entity_type, entityId))) {
            return res.status(404).json({ error: 'Entity not found' });
        }

        let storedValue;
        let responseExtras = {};

        if (entity_type === 'karteikarte') {
            let payload = suggested_value;
            if (typeof payload === 'string') {
                try {
                    payload = JSON.parse(payload);
                } catch (_) {
                    return res.status(400).json({ error: 'invalid payload' });
                }
            }
            const [cardRows] = await pool.query('SELECT typ FROM karteikarten WHERE id = ?', [entityId]);
            if (cardRows.length === 0) {
                return res.status(404).json({ error: 'Entity not found' });
            }
            const validation = validateFlashcardChangePayload(payload, cardRows[0].typ);
            if (validation.error) {
                const body = { error: validation.error };
                if (validation.message) body.message = validation.message;
                return res.status(400).json(body);
            }
            storedValue = JSON.stringify(validation.payload);
            responseExtras = {
                suggestion_kind: 'content',
                payload: validation.payload,
                preview_question: validation.preview_question
            };
        } else {
            storedValue = suggested_value == null ? '' : String(suggested_value).trim().slice(0, 40);
            if (!storedValue) {
                return res.status(400).json({ error: 'suggested_value required' });
            }
            responseExtras = { suggestion_kind: 'rename' };
        }

        const authorKey = String(author_key).trim().slice(0, 64);
        const [result] = await pool.query(
            `INSERT INTO change_suggestions
             (entity_type, entity_id, suggested_value, author_key, author_name)
             VALUES (?, ?, ?, ?, ?)`,
            [entity_type, entityId, storedValue, authorKey, name]
        );

        const [rows] = await pool.query(
            `SELECT id, entity_type, entity_id, suggested_value, author_name, status, created_at, applied_at
             FROM change_suggestions WHERE id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            ...mapChangeSuggestionRow({ ...rows[0], upvotes: 0, downvotes: 0, user_vote: null, author_key: authorKey }, authorKey),
            ...responseExtras,
            is_own: true
        });
    } catch (err) {
        console.error('DB error POST /api/change-suggestions:', err.message);
        res.status(500).json({ error: 'Failed to add change suggestion' });
    }
});

// POST /api/change-suggestions/:id/vote – togglebarer Up/Down-Vote
router.post('/change-suggestions/:id/vote', async (req, res) => {
    try {
        const suggestionId = parseInt(req.params.id, 10);
        const { vote, voter_key } = req.body || {};

        if (!suggestionId) return res.status(400).json({ error: 'Invalid suggestion id' });
        if (vote !== 'up' && vote !== 'down') {
            return res.status(400).json({ error: 'vote must be "up" or "down"' });
        }
        if (!voter_key || !String(voter_key).trim()) {
            return res.status(400).json({ error: 'voter_key required' });
        }

        const voterKey = String(voter_key).trim().slice(0, 64);
        const requestedValue = vote === 'up' ? 1 : -1;

        const [suggestionRows] = await pool.query(
            'SELECT id, status FROM change_suggestions WHERE id = ?',
            [suggestionId]
        );
        if (suggestionRows.length === 0) {
            return res.status(404).json({ error: 'Change suggestion not found' });
        }
        if (suggestionRows[0].status !== 'pending') {
            return res.status(400).json({ error: 'Change suggestion is no longer pending' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [existing] = await conn.query(
                'SELECT id, vote_value FROM change_suggestion_votes WHERE suggestion_id = ? AND voter_key = ?',
                [suggestionId, voterKey]
            );

            if (existing.length === 0) {
                await conn.query(
                    'INSERT INTO change_suggestion_votes (suggestion_id, voter_key, vote_value) VALUES (?, ?, ?)',
                    [suggestionId, voterKey, requestedValue]
                );
            } else if (existing[0].vote_value === requestedValue) {
                await conn.query('DELETE FROM change_suggestion_votes WHERE id = ?', [existing[0].id]);
            } else {
                await conn.query(
                    'UPDATE change_suggestion_votes SET vote_value = ? WHERE id = ?',
                    [requestedValue, existing[0].id]
                );
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        const summary = await getChangeSuggestionVoteSummary(suggestionId, voterKey);
        const appliedResult = await maybeApplyChangeSuggestion(suggestionId, voterKey);

        res.json({
            suggestion_id: suggestionId,
            ...summary,
            status: appliedResult ? 'applied' : 'pending',
            ...(appliedResult || {})
        });
    } catch (err) {
        console.error('DB error POST /api/change-suggestions/:id/vote:', err.message);
        res.status(500).json({ error: 'Failed to vote on change suggestion' });
    }
});

module.exports = router;