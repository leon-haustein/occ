/**
 * Modal zur Vorschau und Interaktion mit Karteikarten in der OVGU-Karten-App.
 *
 * Stellt ein wiederverwendbares Vollbild-Modal bereit, in dem Karteikarten aller Typen
 * (Standard, Prozess, Mnemo, Oklusion) angezeigt und bedient werden können. Unterstützt
 * zwei Kontexte: ein fest im HTML verankertes Modal (Kartenverwaltung) und ein dynamisch
 * erzeugtes gestapeltes Modal (Vorschau aus dem Kommentar-Panel). Konvertiert außerdem
 * Änderungsvorschlag-Payloads in das interne Kartenformat.
 *
 * Importe:
 *   - mountOklusionViewer (@see frontend/js/oklusion.js) — Oklusion-Karten im Modal rendern
 *   - renderProzessHtml, renderMnemoHtml, renderStandardHtml
 *     (@see frontend/js/flashcard-renderers.js) — HTML für textbasierte Kartentypen
 *
 * Exporte:
 *   - suggestionPayloadToCard(payload) — API-Payload in Karten-Objekt umwandeln
 *   - initFlashcardViewModal({ modal, flashcard, content, closeBtn }) — festes Modal initialisieren
 *   - ensureStackedFlashcardViewModal() — gestapeltes Modal erzeugen oder zurückgeben
 *   - isStackedFlashcardViewModalOpen() — prüfen, ob gestapeltes Modal offen ist
 *   - openFlashcardViewModal(card, options) — Modal mit Karte öffnen
 *   - closeFlashcardViewModal() — aktives Modal schließen
 *   - refreshFlashcardViewModal(card) — geöffnete Karte nach Update neu rendern
 *
 * Verwendung:
 *   - frontend/js/change-suggestions.js Z. 43 (Import), Z. 357, 359
 *     → suggestionPayloadToCard, openFlashcardViewModal (Vorschau aus Kommentaren)
 *   - frontend/js/comments.js Z. 47 (Import), Z. 670
 *     → isStackedFlashcardViewModalOpen (Escape-Handling im Kommentar-Panel)
 *   - frontend/js/pages/kartenverwaltung.js Z. 10–12 (Import), Z. 43, 136, 140, 277
 *     → initFlashcardViewModal, openFlashcardViewModal, refreshFlashcardViewModal
 *
 * Hinweis: closeFlashcardViewModal und ensureStackedFlashcardViewModal werden nur intern
 * oder indirekt über openFlashcardViewModal genutzt.
 */

// Oklusion-Viewer für interaktive Bildabdeckungen im Modal
import { mountOklusionViewer } from './oklusion.js';
// HTML-Renderer für Standard-, Prozess- und Mnemo-Karten
import {
    renderProzessHtml,
    renderMnemoHtml,
    renderStandardHtml
} from './flashcard-renderers.js';

/** Aktuell im Modal angezeigte Karte; null wenn geschlossen. */
let modalCard = null;
/** Ob bei Standard-Karten die Antwortseite sichtbar ist. */
let modalShowingAnswer = false;
/** Aktueller Schrittindex bei Prozess-Karten (0-basiert). */
let modalProzessStepIndex = 0;
/** Set der aufgedeckten Schlüssel-Indizes bei Mnemo-Karten. */
let modalMnemoRevealed = new Set();
/** Referenz auf den Oklusion-Viewer; wird beim Schließen zerstört. */
let modalOklusionViewer = null;

/** Kontext für das fest im HTML verankerte Modal (Kartenverwaltung). */
let kvContext = null;
/** Kontext für das dynamisch erzeugte gestapelte Modal (Kommentar-Vorschau). */
let stackedContext = null;
/** Der gerade aktive Modal-Kontext (kvContext oder stackedContext). */
let activeContext = null;
/** Verhindert mehrfaches Binden des globalen Escape-Handlers. */
let escapeHandlerBound = false;

/** Zuordnung von API-style-Werten zu deutschen Kartentyp-Bezeichnungen. */
const STYLE_TO_TYP = {
    standard: 'Standard',
    prozess: 'Prozess',
    mnemo: 'Mnemo',
    oklusion: 'Oklusion'
};

/**
 *
 * │--- Funktion: suggestionPayloadToCard ---│
 *
 * - Wandelt einen Änderungsvorschlag-Payload in das interne Karten-Objektformat um.
 * - Mappt style-spezifische Feldnamen (titel, title) auf das einheitliche question-Feld.
 * - Gibt null zurück bei ungültigem Payload oder unbekanntem Kartentyp.
 *
 * @param {Object} payload — Vorschlags-Payload vom Server (style, Inhaltsfelder)
 * @returns {Object|null} Karten-Objekt mit typ und typ-spezifischen Feldern
 */
export function suggestionPayloadToCard(payload) {
    // Ungültiger oder fehlender Payload → kein Karten-Objekt
    if (!payload || typeof payload !== 'object') return null;
    // style-Feld normalisieren (trimmen, Kleinbuchstaben)
    const style = String(payload.style || '').trim().toLowerCase();
    // Standard-Karte: Frage und Antwort direkt übernehmen
    if (style === 'standard') {
        return {
            typ: 'Standard',
            question: payload.question,
            answer: payload.answer
        };
    }
    // Prozess-Karte: titel wird zu question, steps bleiben erhalten
    if (style === 'prozess') {
        return {
            typ: 'Prozess',
            question: payload.titel,
            steps: payload.steps || []
        };
    }
    // Mnemo-Karte: title wird zu question, keys bleiben erhalten
    if (style === 'mnemo') {
        return {
            typ: 'Mnemo',
            question: payload.title,
            keys: payload.keys || []
        };
    }
    // Oklusion-Karte: Bild und Abdeckungen übernehmen
    if (style === 'oklusion') {
        return {
            typ: 'Oklusion',
            question: payload.title || 'Oklusion-Karte',
            image: payload.image,
            occlusions: payload.occlusions || []
        };
    }
    // Fallback: style über STYLE_TO_TYP auflösen
    const typ = STYLE_TO_TYP[style];
    if (!typ) return null;
    // Restliche Payload-Felder unverändert mitgeben
    return { typ, ...payload };
}

/**
 *
 * │--- Funktion: attachMnemoHandlers ---│
 *
 * - Bindet Klick-Handler an Mnemo-Schlüssel-Buttons und den „Alle aufdecken“-Button.
 * - Aktualisiert modalMnemoRevealed und rendert die Karte bei jeder Interaktion neu.
 * - stopPropagation verhindert, dass Klicks das Modal-Toggle auslösen.
 *
 * @param {Object} card — Mnemo-Karte mit keys-Array
 * @param {HTMLElement} content — Container-Element mit gerendertem Mnemo-HTML
 */
function attachMnemoHandlers(card, content) {
    // Schlüssel-Liste für Längenprüfung beim „Alle aufdecken“-Button
    const keys = card.keys || [];
    // Jeden Schlüssel-Button mit Toggle-Logik versehen
    content.querySelectorAll('.mnemo-key-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            // Klick nicht an übergeordnete Elemente weitergeben
            e.stopPropagation();
            // Index aus data-key-index lesen
            const idx = parseInt(btn.getAttribute('data-key-index'), 10);
            // Schlüssel umschalten: aufgedeckt → verstecken, sonst → aufdecken
            if (modalMnemoRevealed.has(idx)) {
                modalMnemoRevealed.delete(idx);
            } else {
                modalMnemoRevealed.add(idx);
            }
            // Anzeige mit neuem Aufdeckungsstand aktualisieren
            renderModalCard();
        });
    });
    // Sammel-Button „Alle aufdecken“ / „Alle verstecken“
    const revealAllBtn = content.querySelector('.mnemo-reveal-all-btn');
    if (revealAllBtn) {
        revealAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Wenn alle aufgedeckt: alle verstecken
            if (modalMnemoRevealed.size === keys.length) {
                modalMnemoRevealed.clear();
            } else {
                // Sonst alle Indizes zum Set hinzufügen
                for (let i = 0; i < keys.length; i++) {
                    modalMnemoRevealed.add(i);
                }
            }
            renderModalCard();
        });
    }
}

/**
 *
 * │--- Funktion: renderModalCard ---│
 *
 * - Rendert die aktuelle modalCard im aktiven Modal-Kontext neu.
 * - Wählt Renderer und CSS-Klassen je nach Kartentyp (Prozess, Mnemo, Oklusion, Standard).
 * - Zerstört vorherige Oklusion-Viewer-Instanz vor Neuaufbau.
 *
 */
function renderModalCard() {
    // Ohne aktiven Kontext oder Karte nichts rendern
    if (!activeContext || !modalCard) return;
    // DOM-Referenzen aus dem aktiven Kontext entpacken
    const { flashcard, content } = activeContext;
    // Kartentyp-Flags für Verzweigung
    const isProzess = modalCard.typ === 'Prozess' && modalCard.steps && modalCard.steps.length > 0;
    const isMnemo = modalCard.typ === 'Mnemo' && modalCard.keys && modalCard.keys.length > 0;
    const isOklusion = modalCard.typ === 'Oklusion' && modalCard.image && modalCard.occlusions?.length > 0;
    // Alten Oklusion-Viewer aufräumen
    modalOklusionViewer?.destroy();
    modalOklusionViewer = null;
    // Prozess-Karte rendern
    if (isProzess) {
        flashcard.classList.add('prozess-flashcard');
        flashcard.classList.remove('mnemo-flashcard', 'showing-answer', 'standard-flashcard', 'oklusion-flashcard');
        content.innerHTML = renderProzessHtml(modalCard, modalProzessStepIndex);
    } else if (isMnemo) {
        // Mnemo-Karte rendern und Interaktions-Handler binden
        flashcard.classList.add('mnemo-flashcard');
        flashcard.classList.remove('prozess-flashcard', 'showing-answer', 'standard-flashcard', 'oklusion-flashcard');
        content.innerHTML = renderMnemoHtml(modalCard, modalMnemoRevealed);
        attachMnemoHandlers(modalCard, content);
    } else if (isOklusion) {
        // Oklusion-Karte über dedizierten Viewer mounten
        flashcard.classList.add('oklusion-flashcard');
        flashcard.classList.remove('prozess-flashcard', 'mnemo-flashcard', 'showing-answer', 'standard-flashcard');
        content.innerHTML = '';
        modalOklusionViewer = mountOklusionViewer(content, modalCard);
    } else {
        // Standard-Karte: Frage/Antwort mit showing-answer-Toggle
        flashcard.classList.remove('prozess-flashcard', 'mnemo-flashcard', 'oklusion-flashcard');
        flashcard.classList.add('standard-flashcard');
        content.innerHTML = renderStandardHtml(modalCard);
        flashcard.classList.toggle('showing-answer', modalShowingAnswer);
    }
}

/**
 *
 * │--- Funktion: resetModalState ---│
 *
 * - Setzt alle interaktiven Modal-Zustände auf Anfangswerte zurück.
 * - Wird beim Öffnen einer neuen Karte und beim Refresh aufgerufen.
 *
 */
function resetModalState() {
    // Standard: Antwortseite versteckt
    modalShowingAnswer = false;
    // Prozess: wieder beim ersten Schritt starten
    modalProzessStepIndex = 0;
    // Mnemo: keine Schlüssel aufgedeckt
    modalMnemoRevealed.clear();
    // Oklusion: aufgedeckte Bereiche zurücksetzen (falls Viewer existiert)
    modalOklusionViewer?.resetRevealed?.();
}

/**
 *
 * │--- Funktion: toggleModalCard ---│
 *
 * - Reagiert auf Klick auf die Karte im Modal (Frage/Antwort umschalten oder Schritt vor).
 * - Mnemo- und Oklusion-Karten: keine Aktion (eigene Interaktionselemente).
 * - Prozess-Karten: Schrittindex erhöhen, nach letztem Schritt wieder von vorn.
 * - Standard-Karten: showing-answer per CSS-Klasse umschalten.
 *
 */
function toggleModalCard() {
    if (!modalCard || !activeContext) return;
    // Mnemo hat eigene Buttons — Klick auf Karte ignorieren
    const isMnemo = modalCard.typ === 'Mnemo' && modalCard.keys && modalCard.keys.length > 0;
    if (isMnemo) return;
    // Oklusion hat eigene Abdeckungen — Klick ignorieren
    const isOklusion = modalCard.typ === 'Oklusion' && modalCard.image && modalCard.occlusions?.length > 0;
    if (isOklusion) return;
    const isProzess = modalCard.typ === 'Prozess' && modalCard.steps && modalCard.steps.length > 0;
    if (isProzess) {
        // Nächsten Prozessschritt anzeigen; nach Ende wieder bei 0
        const n = modalCard.steps.length;
        modalProzessStepIndex += 1;
        if (modalProzessStepIndex > n) modalProzessStepIndex = 0;
        renderModalCard();
    } else {
        // Standard: Antwortseite ein-/ausblenden
        modalShowingAnswer = !modalShowingAnswer;
        activeContext.flashcard.classList.toggle('showing-answer', modalShowingAnswer);
    }
}

/**
 *
 * │--- Funktion: bindContextEvents ---│
 *
 * - Bindet Schließen-, Overlay- und Karten-Klick-Events an einen Modal-Kontext.
 * - Wird nur einmal pro Kontext ausgeführt (context.bound-Flag).
 *
 * @param {Object} context — Modal-Kontext mit modal, flashcard, content, closeBtn
 */
function bindContextEvents(context) {
    // Events nur einmal pro Kontext registrieren
    if (context.bound) return;
    context.bound = true;

    // Schließen-Button schließt nur, wenn dieser Kontext aktiv ist
    context.closeBtn.addEventListener('click', () => {
        if (activeContext === context) closeFlashcardViewModal();
    });
    // Klick auf den dunklen Overlay-Hintergrund schließt das Modal
    context.modal.addEventListener('click', (e) => {
        if (e.target === context.modal && activeContext === context) closeFlashcardViewModal();
    });
    // Klick auf die Karte toggelt Frage/Antwort oder Prozessschritt
    context.flashcard.addEventListener('click', (e) => {
        if (activeContext !== context) return;
        // Klicks auf Oklusion-Abdeckungen nicht als Karten-Toggle werten
        if (e.target.closest('.okl-occ')) return;
        toggleModalCard();
    });
}

/**
 *
 * │--- Funktion: bindEscapeHandler ---│
 *
 * - Registriert einen globalen Escape-Listener zum Schließen des Modals.
 * - Gestapeltes Modal hat Vorrang; stopPropagation verhindert Schließen des Kommentar-Panels.
 *
 */
function bindEscapeHandler() {
    if (escapeHandlerBound) return;
    escapeHandlerBound = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Gestapeltes Modal zuerst schließen und Event nicht weitergeben
        if (stackedContext?.modal.classList.contains('is-open')) {
            e.stopPropagation();
            closeFlashcardViewModal();
            return;
        }
        // Festes KV-Modal schließen
        if (kvContext?.modal.classList.contains('is-open')) {
            closeFlashcardViewModal();
        }
    });
}

/**
 *
 * │--- Funktion: createStackedModalElements ---│
 *
 * - Erzeugt das gestapelte Modal dynamisch und hängt es an document.body an.
 * - Wird für Vorschau aus dem Kommentar-Panel über dem bestehenden UI genutzt.
 *
 * @returns {Object} Modal-Kontext mit modal, flashcard, content, closeBtn, stacked, bound
 */
function createStackedModalElements() {
    // Overlay-Container erstellen
    const modal = document.createElement('div');
    modal.id = 'flashcardViewModal';
    modal.className = 'kv-card-modal kv-card-modal--stacked';
    modal.setAttribute('aria-hidden', 'true');
    // Dialog-Markup mit Schließen-Button und Karten-Container
    modal.innerHTML = `
        <div class="kv-modal-card-wrap" role="dialog" aria-modal="true" aria-label="Karteikarte">
            <button type="button" class="close-btn" title="Zurück" aria-label="Zurück">&#10005;</button>
            <div class="flashcard" id="flashcardViewFlashcard">
                <div class="flashcard-content" id="flashcardViewContent"></div>
            </div>
        </div>
    `;
    // Modal ins DOM einfügen (über anderen Overlays)
    document.body.appendChild(modal);
    // Kontext-Objekt mit Referenzen auf die relevanten Elemente zurückgeben
    return {
        modal,
        flashcard: modal.querySelector('#flashcardViewFlashcard'),
        content: modal.querySelector('#flashcardViewContent'),
        closeBtn: modal.querySelector('.close-btn'),
        stacked: true,
        bound: false
    };
}

/**
 *
 * │--- Funktion: initFlashcardViewModal ---│
 *
 * - Initialisiert das fest im HTML verankerte Modal der Kartenverwaltung.
 * - Speichert DOM-Referenzen in kvContext und bindet Events sowie Escape-Handler.
 *
 * @param {Object} options — modal, flashcard, content, closeBtn (DOM-Elemente)
 */
export function initFlashcardViewModal({ modal, flashcard, content, closeBtn }) {
    // Ohne alle vier Elemente keine Initialisierung
    if (!modal || !flashcard || !content || !closeBtn) return;
    // Kontext für Kartenverwaltungs-Modal anlegen
    kvContext = { modal, flashcard, content, closeBtn, stacked: false, bound: false };
    bindContextEvents(kvContext);
    bindEscapeHandler();
}

/**
 *
 * │--- Funktion: ensureStackedFlashcardViewModal ---│
 *
 * - Erstellt das gestapelte Modal beim ersten Aufruf und gibt den Kontext zurück.
 * - Bei weiteren Aufrufen wird der bestehende stackedContext wiederverwendet.
 *
 * @returns {Object} Kontext des gestapelten Modals
 */
export function ensureStackedFlashcardViewModal() {
    if (!stackedContext) {
        stackedContext = createStackedModalElements();
        bindContextEvents(stackedContext);
        bindEscapeHandler();
    }
    return stackedContext;
}

/**
 *
 * │--- Funktion: isStackedFlashcardViewModalOpen ---│
 *
 * - Prüft, ob das dynamisch erzeugte gestapelte Modal gerade sichtbar ist.
 * - Wird vom Kommentar-Panel genutzt, um Escape-Handling zu koordinieren.
 *
 * @returns {boolean} true wenn gestapeltes Modal offen ist
 */
export function isStackedFlashcardViewModalOpen() {
    return Boolean(stackedContext?.modal.classList.contains('is-open'));
}

/**
 *
 * │--- Funktion: openFlashcardViewModal ---│
 *
 * - Öffnet das Modal mit der übergebenen Karte (KV- oder gestapeltes Modal).
 * - Schließt ein anderes offenes Modal, setzt Zustand zurück und rendert die Karte.
 *
 * @param {Object} card — Karten-Objekt zum Anzeigen
 * @param {Object} [options] — Optionen, z. B. useStacked: true für Kommentar-Vorschau
 */
export function openFlashcardViewModal(card, { useStacked = false } = {}) {
    if (!card) return;
    // Kontext je nach Aufrufer wählen
    const context = useStacked ? ensureStackedFlashcardViewModal() : kvContext;
    if (!context) return;

    // Anderes offenes Modal schließen, bevor neues geöffnet wird
    if (activeContext && activeContext !== context && activeContext.modal.classList.contains('is-open')) {
        closeFlashcardViewModal();
    }

    activeContext = context;
    modalCard = card;
    resetModalState();
    renderModalCard();
    // Modal sichtbar machen (CSS-Klasse und ARIA)
    context.modal.classList.add('is-open');
    context.modal.setAttribute('aria-hidden', 'false');
}

/**
 *
 * │--- Funktion: closeFlashcardViewModal ---│
 *
 * - Schließt das aktuell aktive Modal und räumt Viewer sowie Zustand auf.
 *
 */
export function closeFlashcardViewModal() {
    if (!activeContext) return;
    // Modal visuell schließen
    activeContext.modal.classList.remove('is-open');
    activeContext.modal.setAttribute('aria-hidden', 'true');
    // Oklusion-Viewer zerstören und Referenzen zurücksetzen
    modalOklusionViewer?.destroy();
    modalOklusionViewer = null;
    modalCard = null;
    activeContext = null;
}

/**
 *
 * │--- Funktion: refreshFlashcardViewModal ---│
 *
 * - Aktualisiert die im Modal angezeigte Karte, wenn dieselbe Karte (gleiche id) geändert wurde.
 * - Setzt Interaktionszustand zurück und rendert neu (z. B. nach Kommentar-Änderung).
 *
 * @param {Object} card — Aktualisiertes Karten-Objekt mit id
 */
export function refreshFlashcardViewModal(card) {
    // Nur refreshen, wenn Modal offen ist und dieselbe Karte betroffen ist
    if (!modalCard || !card?.id || modalCard.id !== card.id) return;
    modalCard = card;
    resetModalState();
    renderModalCard();
}
