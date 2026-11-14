/**
 * HTML-Renderer für Karteikarten-Anzeige (Standard, Prozess, Mnemo) in der OVGU-Karten-App.
 *
 * Erzeugt statisches HTML-Markup für die drei textbasierten Kartentypen. Oklusion-Karten
 * werden nicht hier gerendert, sondern über oklusion.js (mountOklusionViewer). Die
 * Aufrufer setzen das zurückgegebene HTML per innerHTML und binden bei Mnemo-Karten
 * zusätzlich Klick-Handler für Schlüssel-Buttons.
 *
 * Importe:
 *   - escapeHtml (@see frontend/js/dom-utils.js) — XSS-sichere Ausgabe von Klartext
 *   - renderMarkdown (@see frontend/js/markdown.js) — Markdown in HTML umwandeln
 *
 * Exporte:
 *   - renderProzessHtml(card, stepIndex) — Prozess-Timeline mit schrittweiser Enthüllung
 *   - renderMnemoHtml(card, revealedIndices) — Mnemo-Chips mit aufdeckbaren Schlüsseln
 *   - renderStandardHtml(card) — Frage-/Antwort-Layout für Standard-Karten
 *
 * Verwendung:
 *   - frontend/js/flashcard-view-modal.js Z. 3–5 (Import), Z. 104, 108, 118 (Aufruf)
 *     → renderProzessHtml, renderMnemoHtml, renderStandardHtml (Vorschau-Modal)
 *   - frontend/js/pages/karten.js Z. 16–18 (Import), Z. 147, 151, 161 (Aufruf)
 *     → renderProzessHtml, renderMnemoHtml, renderStandardHtml (Lernansicht Layer 4)
 */

// XSS-sichere Ausgabe von Klartext (Titel, Schlüssel, Inhalte ohne Markdown)
import { escapeHtml } from './dom-utils.js';
// Markdown-Parser für Fragen, Antworten und Prozessschritte
import { renderMarkdown } from './markdown.js';

/**
 *
 * │--- Funktion: renderProzessHtml ---│
 *
 * - Rendert eine Prozess-Karteikarte als vertikale Timeline mit Schritt-Indikator.
 * - Zeigt nur Schritte bis einschließlich stepIndex; Antworten nur für abgeschlossene Schritte.
 * - Markiert vergangene Schritte als „is-done“, den aktuellen als „is-current“.
 * - Gibt bei fehlenden Schritten nur Titel und leere Timeline zurück.
 *
 * @param {Object} card — Karte mit question (Titel) und steps (Array aus frage/antwort)
 * @param {number} stepIndex — Index des aktuell sichtbaren Schritts (0-basiert)
 * @returns {string} HTML-String für die Prozess-Timeline
 */
export function renderProzessHtml(card, stepIndex) {
    // Kartentitel aus question-Feld; leerer String als Fallback
    const titel = card.question || '';
    // Prozessschritte aus card.steps; leeres Array wenn nicht vorhanden
    const steps = card.steps || [];
    // Anzahl der Schritte für Schleife und Anzeige
    const n = steps.length;
    // Keine Schritte: nur Header mit Titel rendern
    if (n === 0) {
        return '<div class="prozess-timeline"><div class="prozess-header"><span class="prozess-title">' + escapeHtml(titel) + '</span></div></div>';
    }
    // Äußerer Container für die gesamte Timeline
    let html = '<div class="prozess-timeline">';
    // Badge mit Gesamtanzahl der Schritte (Barrierefreiheit über aria-label)
    html += '<div class="prozess-step-max" aria-label="Maximale Schrittanzahl: ' + n + '">';
    // Zahl der Schritte im Badge
    html += '<span class="prozess-step-max-num">' + n + '</span>';
    // Beschriftung „Schritte“ neben der Zahl
    html += '<span class="prozess-step-max-label">Schritte</span></div>';
    // Kopfzeile mit Kartentitel (HTML-escaped)
    html += '<div class="prozess-header"><span class="prozess-title">' + escapeHtml(titel) + '</span></div>';
    // Container für die einzelnen Prozessschritte
    html += '<div class="prozess-steps">';
    // Jeden Schritt bis zum aktuellen Index durchlaufen
    for (let i = 0; i < n; i++) {
        // Schritte nach stepIndex nicht mehr anzeigen (Fortschritt begrenzen)
        if (i > stepIndex) break;
        // CSS-Klasse: erledigt, aktuell oder neutral
        const state = i < stepIndex ? 'is-done' : (i === stepIndex ? 'is-current' : '');
        // Schritt-Wrapper mit Zustandsklasse
        html += '<div class="prozess-step ' + state + '">';
        // Vertikale Linie und Punkt links neben dem Schritt
        html += '<div class="prozess-rail"><span class="prozess-dot"></span></div>';
        // Inhaltsbereich des Schritts (Frage und ggf. Antwort)
        html += '<div class="prozess-body">';
        // Frage-Bereich des Schritts
        html += '<div class="prozess-q">';
        // Fortlaufende Schrittnummer (1-basiert für Anzeige)
        html += '<span class="prozess-q-num">' + (i + 1) + '.</span>';
        // Fragetext als gerendertes Markdown
        html += '<div class="prozess-q-text">' + renderMarkdown(steps[i].frage) + '</div>';
        html += '</div>';
        // Antwort nur für bereits abgeschlossene Schritte (i < stepIndex)
        if (i < stepIndex) {
            html += '<div class="prozess-a">' + renderMarkdown(steps[i].antwort) + '</div>';
        }
        // Schritt-Body und Schritt-Container schließen
        html += '</div></div>';
    }
    // Schritte-Container und Timeline schließen
    html += '</div></div>';
    // Fertiges HTML zurückgeben
    return html;
}

/**
 *
 * │--- Funktion: renderMnemoHtml ---│
 *
 * - Rendert eine Mnemo-Karte mit Schlüssel-Chips und optional sichtbaren Inhalten.
 * - revealedIndices steuert, welche Schlüssel aufgedeckt sind (Set von Indizes).
 * - Button „Alle aufdecken“ / „Alle verstecken“ je nach Aufdeckungsstand.
 * - Aufgedeckte Inhalte werden sortiert unter den Chips angezeigt.
 *
 * @param {Object} card — Karte mit question (Titel) und keys (Array aus schluessel/inhalt)
 * @param {Set<number>} [revealedIndices] — Indizes der aufgedeckten Schlüssel; Standard: leeres Set
 * @returns {string} HTML-String für Mnemo-Chips und Inhaltsblöcke
 */
export function renderMnemoHtml(card, revealedIndices) {
    // Schlüssel-Liste der Mnemo-Karte
    const keys = card.keys || [];
    // Anzahl der Schlüssel
    const n = keys.length;
    // Aufgedeckte Indizes; leeres Set wenn nicht übergeben
    const revealed = revealedIndices ?? new Set();
    // Prüfen, ob alle Schlüssel bereits aufgedeckt sind (für Toolbar-Button-Text)
    const allRevealed = revealed.size === n;
    // Äußerer Container für Mnemo-Layout
    let html = '<div class="mnemo-chips">';
    // Kopfzeile mit Kartentitel
    html += '<div class="mnemo-header"><span class="mnemo-title">' + escapeHtml(card.question || '') + '</span></div>';
    // Zeile mit klickbaren Schlüssel-Buttons
    html += '<div class="mnemo-keys-row">';
    // Für jeden Schlüssel einen Button erzeugen
    for (let i = 0; i < n; i++) {
        // CSS-Klasse „revealed“, wenn dieser Index aufgedeckt ist
        const revealedClass = 'mnemo-key-btn' + (revealed.has(i) ? ' revealed' : '');
        // Button mit data-key-index für Event-Handler im Aufrufer
        html += '<button type="button" class="' + revealedClass + '" data-key-index="' + i + '">' + escapeHtml(keys[i].schluessel) + '</button>';
    }
    html += '</div>';
    // Toolbar mit Sammel-Aktion alle aufdecken/verstecken
    html += '<div class="mnemo-toolbar"><button type="button" class="mnemo-reveal-all-btn">' + (allRevealed ? 'Alle verstecken' : 'Alle aufdecken') + '</button></div>';
    // Bereich für die angezeigten Inhalte aufgedeckter Schlüssel
    html += '<div class="mnemo-inhalte">';
    // Aufgedeckte Indizes numerisch sortieren für konsistente Reihenfolge
    const sortedRevealed = Array.from(revealed).sort((a, b) => a - b);
    // Für jeden aufgedeckten Schlüssel einen Inhaltsblock rendern
    for (const i of sortedRevealed) {
        // Block: Schlüssel → Inhalt (Inhalt als escaped Klartext)
        html += '<div class="mnemo-inhalt-block"><span class="mnemo-inhalt-key">' + escapeHtml(keys[i].schluessel) + ' →</span>';
        html += escapeHtml(keys[i].inhalt) + '</div>';
    }
    // Inhalte- und Haupt-Container schließen
    html += '</div></div>';
    return html;
}

/**
 *
 * │--- Funktion: renderStandardHtml ---│
 *
 * - Rendert eine Standard-Karteikarte mit Frage- und Antwortseite.
 * - Frage und Antwort werden als Markdown interpretiert.
 * - Enthält visuelle Indikatoren (Punkte) für Frage- und Antwortseite.
 * - Sichtbarkeit der Antwortseite steuert der Aufrufer per CSS-Klasse showing-answer.
 *
 * @param {Object} card — Karte mit question und answer
 * @returns {string} HTML-String für Standard-Flashcard-Layout
 */
export function renderStandardHtml(card) {
    // Frage als gerendertes Markdown
    const q = renderMarkdown(card.question);
    // Antwort als gerendertes Markdown
    const a = renderMarkdown(card.answer);
    // Template mit Indikatoren und beiden Seiten (Frage/Antwort)
    return `
        <div class="standard-indicator" aria-hidden="true">
            <span class="standard-dot standard-dot--q"></span>
            <span class="standard-dot standard-dot--a"></span>
        </div>
        <div class="standard-side standard-side--question"><div class="standard-side-text" lang="de">${q}</div></div>
        <div class="standard-side standard-side--answer"><div class="standard-side-text" lang="de">${a}</div></div>`;
}
