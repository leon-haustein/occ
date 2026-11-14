/**
 * Anonyme Up-/Down-Bewertungen für die OVGU-Karten-App.
 *
 * Verwaltet einen persistenten voter_key im localStorage, damit das Backend
 * erkennen kann, ob der aktuelle Browser bereits abgestimmt hat — ohne Login.
 * Aktualisiert Vote-Zähler und Button-Zustände im DOM und sendet Bewertungen
 * an POST /api/votes.
 *
 * Importe:
 *   - apiFetchJson, showApiError (@see frontend/js/api.js) — API-Aufruf und Fehleranzeige
 *
 * Exporte:
 *   - getVoterKey() — anonyme Browser-ID lesen oder erzeugen
 *   - voterKeyQuery() — Query-String voter_key=… für GET-Anfragen
 *   - applyVoteUI(container, data) — Zähler, is-active, is-flagged im DOM setzen
 *   - castVote(apiBase, entityType, entityId, direction, container) — Vote speichern
 *
 * Verwendung:
 *   - frontend/js/comments.js Z. 52, 64, 72, 80           → getVoterKey() (Kommentare)
 *   - frontend/js/change-suggestions.js Z. 62, 77, 89       → getVoterKey()
 *   - frontend/js/change-suggestions.js Z. 135, 153         → applyVoteUI() (Änderungsvorschläge)
 *   - frontend/js/pages/kurse.js Z. 57, 65, 70, 141       → applyVoteUI, castVote, voterKeyQuery (Kurse)
 *   - frontend/js/pages/themen.js Z. 57, 65, 70, 142       → applyVoteUI, castVote, voterKeyQuery (Themen)
 *   - frontend/js/pages/karten.js Z. 54, 168, 256, 269     → applyVoteUI, castVote, voterKeyQuery (Karteikarten)
 *   - frontend/js/pages/kartenverwaltung.js Z. 72, 81, 91, 250 → applyVoteUI, castVote, voterKeyQuery
 *
 * Hinweis: Änderungsvorschläge nutzen einen eigenen Vote-Endpunkt in change-suggestions.js,
 * verwenden aber weiterhin getVoterKey und applyVoteUI aus diesem Modul.
 */

import { apiFetchJson, showApiError } from './api.js';

/** LocalStorage-Schlüssel für die anonyme Voter-ID pro Browser. */
const VOTER_KEY_STORAGE = 'ovgu_voter_key';

/**
 * 
 * │--- Funktion: generateVoterKey ---│
 * 
 *
 * - Erzeugt eine zufällige UUID als anonyme Nutzer-ID.
 *
 * - crypto.randomUUID existiert nur in sicheren Kontexten (HTTPS/localhost);
 * Fallback über crypto.getRandomValues für HTTP-Auslieferung.
 *
 * @returns {string} UUID-ähnliche Zeichenkette
 */
function generateVoterKey() {
    // Native UUID-Funktion nutzen, wenn der Browser sie bereitstellt
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // Fallback: 16 zufällige Bytes (128 Bit)
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // UUID-v4-Version (Bits 4–7 von Byte 6 auf „0100“)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // RFC-4122-Varianten-Bitfeld (Bits 6–7 von Byte 8 auf „10“)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    // Jedes Byte als zweistellige Hex-Zeichenkette
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    // Standard-UUID-Format mit Bindestrichen
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 
 * │--- Funktion: getVoterKey ---│
 * 
 *
 * Liefert die persistente Voter-ID; legt sie beim ersten Aufruf an und speichert sie.
 *
 * @returns {string} Gespeicherter oder neu erzeugter voter_key
 */
export function getVoterKey() {
    // Bereits gespeicherten Schlüssel laden
    let key = localStorage.getItem(VOTER_KEY_STORAGE);
    if (!key) {
        // Beim ersten Besuch neuen Schlüssel erzeugen und für spätere Aufrufe ablegen
        key = generateVoterKey();
        localStorage.setItem(VOTER_KEY_STORAGE, key);
    }
    return key;
}

/**
 * 
 * │--- Funktion: voterKeyQuery ---│
 * 
 *
 * Baut den Query-Parameter für GET-Anfragen, damit das Backend user_vote mitliefert.
 *
 * @returns {string} URL-kodierter Query-String, z. B. „voter_key=abc-123“
 */
export function voterKeyQuery() {
    return `voter_key=${encodeURIComponent(getVoterKey())}`;
}

/**
 * 
 * │--- Funktion: applyVoteUI ---│
 * 
 *
 * - Aktualisiert Up-/Down-Zähler, Button-Zustände und die Löschen-Markierung im DOM.
 *
 * - Erwartet data mit { upvotes, downvotes, user_vote } (user_vote: 1, -1 oder null).
 * - Sucht innerhalb von container nach .upvote-icon, .downvote-icon und .delete-icon.
 *
 * @param {HTMLElement|null} container — z. B. .sticker-bar oder .change-suggestion-item__actions
 * @param {{ upvotes?: number, downvotes?: number, user_vote?: number|null }} data — Vote-Daten vom Server
 * @returns {void}
 */
export function applyVoteUI(container, data) {
    // Ohne Container nichts zu aktualisieren
    if (!container) return;

    const upBtn = container.querySelector('[class*="upvote-icon"]');
    const downBtn = container.querySelector('[class*="downvote-icon"]');
    let upCount = container.querySelector('.vote-count--up');
    let downCount = container.querySelector('.vote-count--down');

    // Fehlende Zähler-Spans in den Buttons anlegen
    if (!upCount && upBtn) {
        upCount = document.createElement('span');
        upCount.className = 'vote-count vote-count--up';
        upBtn.appendChild(upCount);
    }
    if (!downCount && downBtn) {
        downCount = document.createElement('span');
        downCount.className = 'vote-count vote-count--down';
        downBtn.appendChild(downCount);
    }

    if (upCount) upCount.textContent = String(data.upvotes ?? 0);
    if (downCount) downCount.textContent = String(data.downvotes ?? 0);

    // Aktiven Button markieren, wenn der Nutzer bereits abgestimmt hat
    upBtn?.classList.toggle('is-active', data.user_vote === 1);
    downBtn?.classList.toggle('is-active', data.user_vote === -1);

    // Löschen-Button hervorheben bei Netto ≥ 3 Downvotes
    const deleteBtn = container.querySelector('.delete-icon');
    const upvotes = data.upvotes ?? 0;
    const downvotes = data.downvotes ?? 0;
    deleteBtn?.classList.toggle('is-flagged', downvotes - upvotes >= 3);
}

/**
 * 
 * │--- Funktion: castVote ---│
 * 
 *
 * Sendet eine Bewertung an die API und aktualisiert danach die Vote-UI im Container.
 *
 * @param {string} apiBase — Basis-URL der API (z. B. aus config.js)
 * @param {string} entityType — Entitätstyp: „kurs“, „thema“ oder „karteikarte“
 * @param {number|string} entityId — ID der bewerteten Entität
 * @param {'up'|'down'} direction — Bewertungsrichtung
 * @param {HTMLElement|null} container — DOM-Container für applyVoteUI
 * @returns {Promise<object|null>} API-Antwort mit Vote-Daten oder null bei Fehler
 */
export async function castVote(apiBase, entityType, entityId, direction, container) {
    try {
        const data = await apiFetchJson(`${apiBase}/api/votes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entity_type: entityType,
                entity_id: entityId,
                vote: direction,
                voter_key: getVoterKey()
            })
        });
        applyVoteUI(container, data);
        return data;
    } catch (err) {
        showApiError('Bewertung konnte nicht gespeichert werden.');
        return null;
    }
}
