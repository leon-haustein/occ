/**
 * Änderungsvorschläge (Umbenennung und Karteikarten-Inhalt) für die OVGU-Karten-App.
 *
 * Lädt, erstellt und rendert community-basierte Vorschläge zur Änderung von
 * Kurs-/Themen-Namen oder Karteikarten-Inhalten. Vorschläge können im
 * Kommentar-Panel abgestimmt werden; bei ausreichend positiver Bewertung
 * wendet der Server sie automatisch an.
 *
 * Importe:
 *   - getVoterKey, applyVoteUI (@see frontend/js/votes.js) — anonyme ID und Vote-UI
 *   - typeIcon, typeIconKey, UPVOTE_ICON_SVG, DOWNVOTE_ICON_SVG
 *     (@see frontend/js/vector-graphics.js) — Typ-Icons und Vote-Buttons
 *   - openFlashcardViewModal, suggestionPayloadToCard
 *     (@see frontend/js/flashcard-view-modal.js) — Vorschau-Modal für Karten
 *   - escapeHtml (@see frontend/js/dom-utils.js) — XSS-sichere Textausgabe
 *   - apiFetchJson, showApiError (@see frontend/js/api.js) — API-Aufrufe
 *
 * Exporte:
 *   - fetchChangeSuggestions(apiBase, entityType, entityId) — Vorschläge laden
 *   - postChangeSuggestion(...) — neuen Vorschlag anlegen
 *   - voteChangeSuggestion(apiBase, suggestionId, direction) — abstimmen
 *   - renderChangeSuggestionItem(suggestion) — Listeneintrag rendern
 *   - updateChangeSuggestionVotes(li, data) — Vote-UI nach Abstimmung aktualisieren
 *   - attachChangeSuggestionPreviewHandler(li, suggestion) — Klick auf Karten-Vorschau
 *   - attachChangeSuggestionVoteHandlers(li, suggestion, apiBase, callbacks) — Vote-Buttons
 *   - applySuggestionCount(container, count) — Badge am Änderungs-Icon setzen
 *   - openChangeSuggestionsPanel(apiBase, entityType, entityId, options) — Panel öffnen
 *
 * Verwendung:
 *   - frontend/js/pages/kurse.js, themen.js, karten.js, kartenverwaltung.js
 *   - frontend/js/flashcard-suggestion-form.js → postChangeSuggestion (Karten-Payload)
 */

// Anonyme Nutzer-ID und Vote-Zähler-UI für Vorschlags-Abstimmungen
import { getVoterKey, applyVoteUI } from './votes.js';
// Kartentyp-Icons und Up-/Down-SVG für Vote-Buttons
import { typeIcon, typeIconKey, UPVOTE_ICON_SVG, DOWNVOTE_ICON_SVG, CHANGE_ICON_SVG } from './vector-graphics.js';
import { openFlashcardViewModal, suggestionPayloadToCard, isStackedFlashcardViewModalOpen } from './flashcard-view-modal.js';
import { escapeHtml } from './dom-utils.js';
import { apiFetchJson, showApiError } from './api.js';
import { COMMENT_NAME_STORAGE } from './comments.js';

const AUTHOR_NAME_STORAGE = COMMENT_NAME_STORAGE;

/**
 *
 * │--- Funktion: formatDate ---│
 *
 * - Wandelt einen ISO-Zeitstempel in ein deutsches Datums-/Zeitformat um.
 * - Gibt einen leeren String zurück, wenn das Datum ungültig ist.
 *
 * @param {string} isoString — ISO-8601-Zeitstempel vom Server
 * @returns {string} Formatiertes Datum (TT.MM.JJJJ, HH:MM) oder leer
 */
function formatDate(isoString) {
    // ISO-String in Date-Objekt parsen
    const date = new Date(isoString);
    // Bei ungültigem Datum nichts anzeigen
    if (Number.isNaN(date.getTime())) return '';
    // Deutsche Lokalisierung mit Tag, Monat, Jahr, Stunde und Minute
    return date.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/** Zuordnung von Payload-style-Werten zu deutschen Kartentyp-Bezeichnungen. */
const STYLE_TO_TYP = {
    standard: 'Standard',
    prozess: 'Prozess',
    mnemo: 'Mnemo',
    oklusion: 'Oklusion'
};

/**
 *
 * │--- Funktion: previewQuestionFromSuggestion ---│
 *
 * - Ermittelt den Anzeige-Titel für einen Karteikarten-Vorschlag.
 * - Nutzt preview_question vom Server oder leitet den Titel aus dem Payload ab.
 *
 * @param {object} suggestion — Änderungsvorschlag-Objekt
 * @returns {string} Titel für die Vorschau-Kachel
 */
function previewQuestionFromSuggestion(suggestion) {
    // Vom Server vorberechneter Titel hat Vorrang
    if (suggestion.preview_question) return suggestion.preview_question;
    // Aus Payload je nach Kartentyp den passenden Titel extrahieren
    if (suggestion.payload) {
        const p = suggestion.payload;
        if (p.style === 'standard') return p.question || 'Standard-Karte';
        if (p.style === 'prozess') return p.titel || 'Prozess-Karte';
        if (p.style === 'mnemo') return p.title || 'Mnemo-Karte';
        if (p.style === 'oklusion') return (p.title && String(p.title).trim()) || 'Oklusion-Karte';
    }
    // Fallback wenn keine brauchbaren Daten vorliegen
    return 'Karteikarte';
}

/**
 *
 * │--- Funktion: previewTypFromSuggestion ---│
 *
 * - Ermittelt den Kartentyp (Standard, Prozess, …) für die Vorschau.
 * - Mappt den style-Wert aus dem Payload über STYLE_TO_TYP.
 *
 * @param {object} suggestion — Änderungsvorschlag-Objekt
 * @returns {string} Deutscher Kartentyp-Name
 */
function previewTypFromSuggestion(suggestion) {
    // style aus Payload in lesbaren Typnamen umwandeln
    if (suggestion.payload?.style) {
        return STYLE_TO_TYP[suggestion.payload.style] || suggestion.payload.style;
    }
    // Ohne Payload-Style Standard annehmen
    return 'Standard';
}

/**
 *
 * │--- Funktion: renderFlashcardSuggestionPreview ---│
 *
 * - Erzeugt HTML für die Mini-Vorschau einer Karteikarte im Vorschlags-Eintrag.
 * - Zeigt Typ-Icon und Titel analog zur Kartenverwaltungs-Kachel.
 *
 * @param {object} suggestion — Inhaltsvorschlag mit payload
 * @returns {string} HTML-Markup für .change-suggestion-item__preview
 */
function renderFlashcardSuggestionPreview(suggestion) {
    // Titel und Kartentyp aus Vorschlagsdaten ableiten
    const title = previewQuestionFromSuggestion(suggestion);
    const typ = previewTypFromSuggestion(suggestion);
    // HTML-Kachel mit Icon und Titel zurückgeben
    return `
        <div class="change-suggestion-item__preview">
            <div class="link-item change-suggestion-card-preview">
                <span class="kv-typ-icon kv-typ-icon--${typeIconKey(typ)}" title="${escapeHtml(typ)}" aria-label="${escapeHtml(typ)}">${typeIcon(typ)}</span>
                <div class="link-content">
                    <div class="course-title">${escapeHtml(title)}</div>
                </div>
            </div>
        </div>
    `;
}

/**
 *
 * │--- Funktion: fetchChangeSuggestions ---│
 *
 * - Lädt alle Änderungsvorschläge zu einer Entität per GET /api/change-suggestions.
 * - Übergibt entity_type, entity_id und voter_key als Query-Parameter.
 *
 * @param {string} apiBase — Basis-URL der API
 * @param {string} entityType — Entitätstyp (kurs, thema, karteikarte)
 * @param {number|string} entityId — ID der Entität
 * @returns {Promise<Array>} Liste der Vorschlags-Objekte
 */
export async function fetchChangeSuggestions(apiBase, entityType, entityId) {
    // Query-Parameter für Typ, ID und anonymen Nutzer zusammenstellen
    const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: String(entityId),
        voter_key: getVoterKey()
    });
    // Vorschläge vom Server als JSON laden
    return apiFetchJson(`${apiBase}/api/change-suggestions?${params}`);
}

/**
 *
 * │--- Funktion: postChangeSuggestion ---│
 *
 * - Erstellt einen neuen Änderungsvorschlag per POST /api/change-suggestions.
 * - suggested_value ist ein String (Umbenennung) oder ein Objekt (Karten-Payload).
 *
 * @param {string} apiBase — Basis-URL der API
 * @param {string} entityType — Entitätstyp
 * @param {number|string} entityId — ID der Entität
 * @param {string} authorName — Anzeigename des Autors
 * @param {string|object} suggestedValue — Neuer Name oder Karten-Payload
 * @returns {Promise<object>} Neu erstelltes Vorschlags-Objekt
 */
export async function postChangeSuggestion(apiBase, entityType, entityId, authorName, suggestedValue) {
    // Bei Karteikarten kann suggestedValue ein Payload-Objekt sein
    const value = entityType === 'karteikarte' && typeof suggestedValue === 'object'
        ? suggestedValue
        : suggestedValue;
    // Vorschlag per POST anlegen
    return apiFetchJson(`${apiBase}/api/change-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            author_key: getVoterKey(),
            author_name: authorName,
            suggested_value: value
        })
    });
}

/**
 *
 * │--- Funktion: voteChangeSuggestion ---│
 *
 * - Sendet eine Up-/Down-Bewertung für einen Vorschlag an die API.
 * - Bei Fehler wird eine Meldung angezeigt und null zurückgegeben.
 *
 * @param {string} apiBase — Basis-URL der API
 * @param {number|string} suggestionId — ID des Vorschlags
 * @param {'up'|'down'} direction — Bewertungsrichtung
 * @returns {Promise<object|null>} Vote-Daten inkl. applied/new_name/updated_card oder null
 */
export async function voteChangeSuggestion(apiBase, suggestionId, direction) {
    try {
        // Abstimmung per POST an den Vote-Endpunkt senden
        return await apiFetchJson(`${apiBase}/api/change-suggestions/${suggestionId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vote: direction, voter_key: getVoterKey() })
        });
    } catch (err) {
        // Fehler dem Nutzer anzeigen
        showApiError('Bewertung konnte nicht gespeichert werden.');
        return null;
    }
}

/**
 *
 * │--- Funktion: renderChangeSuggestionItem ---│
 *
 * - Erzeugt ein li-Element für einen Änderungsvorschlag im Kommentar-Feed.
 * - Unterscheidet Namens- und Inhaltsvorschläge sowie bereits angewandte Vorschläge.
 * - Bindet Vote-Zähler ein, sofern der Vorschlag noch offen ist.
 *
 * @param {object} suggestion — Vorschlags-Objekt vom Server
 * @returns {HTMLLIElement} Gerenderter Listeneintrag
 */
export function renderChangeSuggestionItem(suggestion) {
    // Listeneintrag als Container anlegen
    const li = document.createElement('li');
    // Status und Art des Vorschlags ermitteln
    const isApplied = suggestion.status === 'applied';
    const isContent = suggestion.suggestion_kind === 'content' || suggestion.entity_type === 'karteikarte';
    // CSS-Klassen und Datenattribute setzen
    li.className = `change-suggestion-item${isApplied ? ' change-suggestion-item--applied' : ''}`;
    li.dataset.suggestionId = suggestion.id;
    li.dataset.itemType = 'change-suggestion';

    // Vote-Buttons nur bei noch offenen Vorschlägen anzeigen
    const voteButtons = isApplied ? '' : `
        <div class="change-suggestion-item__actions">
            <button type="button" class="upvote-icon icon-btn" aria-label="Vorschlag positiv bewerten" title="Positiv bewerten">
                ${UPVOTE_ICON_SVG}
            </button>
            <button type="button" class="downvote-icon icon-btn" aria-label="Vorschlag negativ bewerten" title="Negativ bewerten">
                ${DOWNVOTE_ICON_SVG}
            </button>
        </div>
    `;

    // Badge-Text je nach Status und Vorschlagsart
    const badge = isApplied
        ? 'Angewendet'
        : (isContent ? 'Inhaltsvorschlag' : 'Namensvorschlag');

    // Inhalt: Karten-Vorschau oder vorgeschlagener Name als Text
    const body = isContent
        ? renderFlashcardSuggestionPreview(suggestion)
        : `<p class="change-suggestion-item__value">${escapeHtml(suggestion.suggested_value)}</p>`;

    // HTML für Kopfzeile, Inhalt und Vote-Buttons einfügen
    li.innerHTML = `
        <div class="change-suggestion-item__head">
            <span class="change-suggestion-item__badge">${badge}</span>
            <span class="change-suggestion-item__author">${escapeHtml(suggestion.author_name)}</span>
            <span class="change-suggestion-item__date">${escapeHtml(formatDate(suggestion.created_at))}</span>
        </div>
        ${body}
        ${voteButtons}
    `;

    // Vote-Zähler und aktiven Button-Zustand setzen (nur bei offenen Vorschlägen)
    if (!isApplied) {
        applyVoteUI(li.querySelector('.change-suggestion-item__actions'), {
            upvotes: suggestion.upvotes ?? 0,
            downvotes: suggestion.downvotes ?? 0,
            user_vote: suggestion.user_vote ?? null
        });
    }

    // Fertigen Eintrag zurückgeben
    return li;
}

/**
 *
 * │--- Funktion: updateChangeSuggestionVotes ---│
 *
 * - Aktualisiert Vote-Zähler nach einer Abstimmung im Listeneintrag.
 * - Markiert angewandte Vorschläge und entfernt die Vote-Buttons.
 *
 * @param {HTMLLIElement} li — Listeneintrag des Vorschlags
 * @param {object} data — Server-Antwort nach voteChangeSuggestion
 */
export function updateChangeSuggestionVotes(li, data) {
    // Vorschlag wurde angewendet → UI auf „Angewendet“ umstellen
    if (data.status === 'applied') {
        li.classList.add('change-suggestion-item--applied');
        li.querySelector('.change-suggestion-item__badge').textContent = 'Angewendet';
        li.querySelector('.change-suggestion-item__actions')?.remove();
        return;
    }

    // Vote-Zähler und Button-Zustand aktualisieren
    applyVoteUI(li.querySelector('.change-suggestion-item__actions'), data);
}

/**
 *
 * │--- Funktion: attachChangeSuggestionPreviewHandler ---│
 *
 * - Macht die Karten-Vorschau klickbar und per Tastatur bedienbar.
 * - Öffnet beim Klick das gestapelte Flashcard-View-Modal mit dem Vorschlags-Payload.
 *
 * @param {HTMLLIElement} li — Listeneintrag des Vorschlags
 * @param {object} suggestion — Vorschlags-Objekt mit payload
 */
export function attachChangeSuggestionPreviewHandler(li, suggestion) {
    // Nur für Inhaltsvorschläge mit Payload
    const isContent = suggestion.suggestion_kind === 'content' || suggestion.entity_type === 'karteikarte';
    if (!isContent || !suggestion.payload) return;

    // Vorschau-Container im Eintrag suchen
    const preview = li.querySelector('.change-suggestion-item__preview');
    if (!preview) return;

    // Als fokussierbaren Button für Barrierefreiheit markieren
    preview.setAttribute('role', 'button');
    preview.setAttribute('tabindex', '0');
    preview.setAttribute('aria-label', 'Vorschlag anzeigen');

    /**
     *
     * │--- Funktion: openPreview ---│
     *
     * - Wandelt den Payload in ein Karten-Objekt um und öffnet das Vorschau-Modal.
     * - stopPropagation verhindert ungewolltes Schließen des Kommentar-Panels.
     */
    function openPreview(e) {
        e.stopPropagation();
        const card = suggestionPayloadToCard(suggestion.payload);
        if (!card) return;
        openFlashcardViewModal(card, { useStacked: true });
    }

    // Klick und Tastatur (Enter/Leerzeichen) öffnen die Vorschau
    preview.addEventListener('click', openPreview);
    preview.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPreview(e);
        }
    });
}

/**
 *
 * │--- Funktion: attachChangeSuggestionVoteHandlers ---│
 *
 * - Bindet Up-/Down-Klick-Handler an die Vote-Buttons eines Vorschlags.
 * - Ruft bei Auto-Apply die Callbacks onCardApplied oder onNameApplied auf.
 *
 * @param {HTMLLIElement} li — Listeneintrag des Vorschlags
 * @param {object} suggestion — Vorschlags-Objekt
 * @param {string} apiBase — Basis-URL der API
 * @param {object} [callbacks={}] — onNameApplied, onCardApplied nach Auto-Apply
 */
export function attachChangeSuggestionVoteHandlers(li, suggestion, apiBase, callbacks = {}) {
    // Bereits angewandte Vorschläge haben keine Vote-Buttons mehr
    if (suggestion.status === 'applied') return;

    const upBtn = li.querySelector('.upvote-icon');
    const downBtn = li.querySelector('.downvote-icon');

    /**
     *
     * │--- Funktion: handleVote ---│
     *
     * - Sendet die Abstimmung an die API und aktualisiert die UI.
     * - Benachrichtigt den Aufrufer, wenn der Vorschlag automatisch angewendet wurde.
     */
    async function handleVote(direction) {
        const data = await voteChangeSuggestion(apiBase, suggestion.id, direction);
        if (!data) return;
        updateChangeSuggestionVotes(li, data);
        // Nach Auto-Apply Panel-Titel bzw. Karte im Aufrufer aktualisieren
        if (data.applied) {
            if (data.updated_card && typeof callbacks.onCardApplied === 'function') {
                callbacks.onCardApplied(data.updated_card);
            } else if (data.new_name && typeof callbacks.onNameApplied === 'function') {
                callbacks.onNameApplied(data.new_name);
            }
        }
    }

    // Up- und Down-Button mit handleVote verknüpfen
    upBtn?.addEventListener('click', () => handleVote('up'));
    downBtn?.addEventListener('click', () => handleVote('down'));
}

function getSavedName() {
    return localStorage.getItem(AUTHOR_NAME_STORAGE) || '';
}

function saveName(name) {
    localStorage.setItem(AUTHOR_NAME_STORAGE, name);
}

export function applySuggestionCount(container, count) {
    if (!container) return;
    const btn = container.querySelector('.change-icon');
    if (!btn) return;
    let badge = btn.querySelector('.suggestion-count');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'suggestion-count';
        btn.appendChild(badge);
    }
    badge.textContent = String(count ?? 0);
    btn.classList.toggle('is-active', Number(count) > 0);
}

export function openChangeSuggestionsPanel(apiBase, entityType, entityId, options = {}) {
    document.querySelector('.change-suggestions-modal')?.remove();

    const {
        title = 'Änderungsvorschläge',
        mode = 'rename',
        changePlaceholder = 'Neuen Namen vorschlagen…',
        onCountChange,
        onNameApplied,
        onCardApplied,
        onChangeRequest
    } = options;

    let suggestionsCount = 0;
    let panelTitle = title;
    const isFlashcardMode = mode === 'flashcard';
    const isRenameMode = mode === 'rename';

    const renameFormMarkup = isRenameMode ? `
            <div class="change-form" hidden>
                <div class="change-form-error" role="alert" hidden></div>
                <input type="text" class="change-form__name" placeholder="Dein Name" maxlength="40">
                <div class="change-form__value-wrap">
                    <input type="text" class="change-form__value" placeholder="${escapeHtml(changePlaceholder)}" maxlength="40">
                    <button type="button" class="change-form__submit">Hinzufügen</button>
                </div>
            </div>` : '';

    const modal = document.createElement('div');
    modal.className = 'change-suggestions-modal';
    modal.innerHTML = `
        <div class="change-suggestions-panel" role="dialog" aria-modal="true" aria-label="Änderungsvorschläge">
            <button type="button" class="close-btn" title="Schließen" aria-label="Schließen">&#10005;</button>
            <div class="change-suggestions-panel__header">
                <h3>${escapeHtml(panelTitle)}</h3>
            </div>
            <ul class="change-suggestions-list">
                <li class="change-suggestions-list__status">Vorschläge werden geladen…</li>
            </ul>${renameFormMarkup}
            <div class="change-suggestions-panel__footer">
                <button type="button" class="change-suggestions-panel__compose">${CHANGE_ICON_SVG} Änderung vorschlagen</button>
            </div>
            <div class="change-suggestions-panel__flashcard-error" role="alert" hidden></div>
        </div>
    `;
    document.body.appendChild(modal);

    const panel = modal.querySelector('.change-suggestions-panel');
    const headerTitle = modal.querySelector('.change-suggestions-panel__header h3');
    const list = modal.querySelector('.change-suggestions-list');
    const changeForm = modal.querySelector('.change-form');
    const footer = modal.querySelector('.change-suggestions-panel__footer');
    const composeBtn = modal.querySelector('.change-suggestions-panel__compose');
    const changeNameInput = changeForm?.querySelector('.change-form__name');
    const changeValueInput = changeForm?.querySelector('.change-form__value');
    const changeSubmitBtn = changeForm?.querySelector('.change-form__submit');
    const changeErrorEl = changeForm?.querySelector('.change-form-error');
    const flashcardErrorEl = modal.querySelector('.change-suggestions-panel__flashcard-error');

    if (changeNameInput) changeNameInput.value = getSavedName();

    function syncCount() {
        if (typeof onCountChange === 'function') {
            onCountChange(suggestionsCount);
        }
    }

    function setSuggestionsCount(count) {
        suggestionsCount = count;
        syncCount();
    }

    function incrementSuggestionsCount() {
        suggestionsCount += 1;
        syncCount();
    }

    function renderEmptyState() {
        list.innerHTML = '<li class="change-suggestions-list__status">Noch keine Vorschläge. Schlag die erste Änderung vor!</li>';
    }

    function updateEmptyState() {
        list.querySelectorAll('.change-suggestions-list__status').forEach((el) => el.remove());
        if (!list.querySelector('.change-suggestion-item')) {
            renderEmptyState();
        }
    }

    function handleNameApplied(newName) {
        panelTitle = newName;
        headerTitle.textContent = newName;
        if (typeof onNameApplied === 'function') onNameApplied(newName);
    }

    function handleCardApplied(updatedCard) {
        if (updatedCard?.question) {
            panelTitle = updatedCard.question;
            headerTitle.textContent = updatedCard.question;
        }
        if (typeof onCardApplied === 'function') onCardApplied(updatedCard);
    }

    const voteCallbacks = {
        onNameApplied: handleNameApplied,
        onCardApplied: handleCardApplied
    };

    function attachSuggestionHandlers(li, suggestion) {
        attachChangeSuggestionVoteHandlers(li, suggestion, apiBase, voteCallbacks);
        attachChangeSuggestionPreviewHandler(li, suggestion);
    }

    function addSuggestionToFeed(suggestion) {
        list.querySelector('.change-suggestions-list__status')?.remove();
        const li = renderChangeSuggestionItem(suggestion);
        attachSuggestionHandlers(li, suggestion);
        list.prepend(li);
        incrementSuggestionsCount();
        updateEmptyState();
    }

    function renderFeed(suggestions) {
        list.innerHTML = '';
        setSuggestionsCount(suggestions.length);
        if (suggestions.length === 0) {
            renderEmptyState();
            return;
        }
        const sorted = [...suggestions].sort((a, b) => {
            const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (timeDiff !== 0) return timeDiff;
            return (b.id ?? 0) - (a.id ?? 0);
        });
        for (const suggestion of sorted) {
            const li = renderChangeSuggestionItem(suggestion);
            attachSuggestionHandlers(li, suggestion);
            list.appendChild(li);
        }
    }

    function openChangeForm() {
        if (!isRenameMode || !changeForm) return;
        changeForm.hidden = false;
        footer.hidden = true;
        flashcardErrorEl.hidden = true;
        hideChangeError();
        (changeNameInput.value.trim() ? changeValueInput : changeNameInput).focus();
    }

    function closeChangeForm() {
        if (changeForm) changeForm.hidden = true;
        footer.hidden = false;
        hideChangeError();
    }

    function showChangeError(message) {
        changeErrorEl.textContent = message;
        changeErrorEl.hidden = false;
    }

    function hideChangeError() {
        changeErrorEl.textContent = '';
        changeErrorEl.hidden = true;
    }

    composeBtn.addEventListener('click', () => {
        if (isFlashcardMode) {
            const authorName = getSavedName().trim();
            if (!authorName) {
                flashcardErrorEl.textContent = 'Bitte gib zuerst deinen Namen an (über das Kommentar-Icon).';
                flashcardErrorEl.hidden = false;
                return;
            }
            flashcardErrorEl.hidden = true;
            if (typeof onChangeRequest === 'function') {
                onChangeRequest({
                    authorName,
                    addSuggestion: addSuggestionToFeed
                });
            }
            return;
        }
        openChangeForm();
    });

    function close() {
        modal.remove();
        document.removeEventListener('keydown', onKeydown);
    }

    function onKeydown(e) {
        if (e.key !== 'Escape') return;
        if (isStackedFlashcardViewModalOpen()) return;
        const typeModal = document.getElementById('flashcardTypeModal');
        if (typeModal?.classList.contains('is-open')) {
            typeModal
                .querySelector('.flashcard-type-form-wrap:has(.flashcard-type-form.is-open) .close-btn')
                ?.click();
            return;
        }
        close();
    }

    document.addEventListener('keydown', onKeydown);
    modal.addEventListener('click', (e) => {
        if (!panel.contains(e.target)) close();
    });
    modal.querySelector('.close-btn').addEventListener('click', close);

    fetchChangeSuggestions(apiBase, entityType, entityId)
        .then((suggestions) => renderFeed(suggestions))
        .catch((err) => {
            console.error('Vorschläge laden fehlgeschlagen:', err);
            list.innerHTML = '<li class="change-suggestions-list__status">Vorschläge konnten nicht geladen werden.</li>';
        });

    if (isRenameMode && changeSubmitBtn) {
        changeSubmitBtn.addEventListener('click', async () => {
            hideChangeError();
            const name = changeNameInput.value.trim();
            const value = changeValueInput.value.trim();
            if (!name) {
                showChangeError('Bitte gib deinen Namen an.');
                changeNameInput.focus();
                return;
            }
            if (!value) {
                showChangeError('Bitte schlage einen neuen Namen vor.');
                changeValueInput.focus();
                return;
            }
            changeSubmitBtn.disabled = true;
            try {
                const suggestion = await postChangeSuggestion(apiBase, entityType, entityId, name, value);
                saveName(name);
                changeValueInput.value = '';
                addSuggestionToFeed(suggestion);
                closeChangeForm();
            } catch (e) {
                showChangeError('Der Vorschlag konnte nicht gespeichert werden. Bitte später erneut versuchen.');
            } finally {
                changeSubmitBtn.disabled = false;
            }
        });
    }
}
