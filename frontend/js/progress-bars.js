/**
 * Mini-Fortschrittsbalken (Spaced Repetition) für die OVGU-Karten-App.
 *
 * Rendert kompakte Säulendiagramme mit drei Kategorien (Rot, Gelb, Grün) zur
 * Visualisierung des Lernfortschritts. Die Werte stammen aus API-Entitäten
 * (Kurs, Thema) und werden relativ zum Maximum skaliert. Zahlen ab 1000 werden
 * kompakt als „1,0k“ formatiert.
 *
 * Importe:
 *   — keine (reine DOM-Hilfsfunktionen ohne externe Module)
 *
 * Exporte:
 *   - formatCompactCount(n) — Zahl kompakt für die Balkenbeschriftung formatieren
 *   - progressFromEntity(entity) — Rot/Gelb/Grün aus API-Entität extrahieren
 *   - renderMiniBars(host, data) — Mini-Balken in ein DOM-Element rendern
 *   - ensureProgressBarsHost(contentEl) — Host in link/topic/flashcard-content sicherstellen
 *
 * Verwendung:
 *   - frontend/js/pages/kurse.js — progressFromEntity, renderMiniBars (link-content)
 *   - frontend/js/pages/themen.js — progressFromEntity, renderMiniBars (topic-content)
 *   - frontend/js/pages/karten.js — progressFromEntity, renderMiniBars, ensureProgressBarsHost (flashcard-content)
 *
 * Hinweis: formatCompactCount wird derzeit nur intern in renderMiniBars genutzt,
 * ist aber exportiert für Wiederverwendung.
 */

/** Definition der drei Fortschrittskategorien mit Schlüssel, Label und Farbe. */
const CATEGORIES = [
    { key: 'red', label: 'Rot', color: '#ff5722' },
    { key: 'yellow', label: 'Gelb', color: '#ffdf00' },
    { key: 'green', label: 'Grün', color: '#a1db58' }
];

/**
 *
 * │--- Funktion: formatCompactCount ---│
 *
 * - Formatiert eine Zahl für die kompakte Anzeige über den Mini-Balken.
 * - Werte unter 1000 werden unverändert als String zurückgegeben.
 * - Ab 1000: eine Nachkommastelle mit deutschem Komma, Suffix „k“ (z. B. „1,2k“).
 *
 * @param {number} n — anzuzeigende Zahl
 * @returns {string} formatierte Zahl als Text
 */
export function formatCompactCount(n) {
    // Kleine Zahlen direkt ausgeben
    if (n < 1000) return String(n);
    // Durch 1000 teilen, eine Dezimalstelle, Punkt durch Komma ersetzen
    return `${(n / 1000).toFixed(1).replace('.', ',')}k`;
}

/**
 *
 * │--- Funktion: progressFromEntity ---│
 *
 * - Liest Spaced-Repetition-Zähler (Rot, Gelb, Grün) aus einer API-Entität.
 * - Unterstützt sr_red/sr_yellow/sr_green und Fallback auf red/yellow/green.
 * - Ungültige oder fehlende Werte werden zu 0 normalisiert.
 *
 * @param {Object|null|undefined} entity — Kurs-, Themen- oder anderes API-Objekt
 * @returns {{ red: number, yellow: number, green: number }} Fortschrittsdaten
 */
export function progressFromEntity(entity) {
    return {
        red: Number(entity?.sr_red ?? entity?.red ?? 0) || 0,
        yellow: Number(entity?.sr_yellow ?? entity?.yellow ?? 0) || 0,
        green: Number(entity?.sr_green ?? entity?.green ?? 0) || 0
    };
}

/**
 *
 * │--- Funktion: ensureProgressBarsHost ---│
 *
 * - Stellt einen direkten .sr-progress-bars-Container in einem Content-Element bereit.
 * - Wird nach innerHTML-Updates benötigt (z. B. flashcard-content), damit der Host erhalten bleibt.
 *
 * @param {HTMLElement|null|undefined} contentEl — link-content, topic-content oder flashcard-content
 * @returns {HTMLElement|null} vorhandener oder neu erzeugter Host
 */
export function ensureProgressBarsHost(contentEl) {
    if (!contentEl) return null;
    let host = contentEl.querySelector(':scope > .sr-progress-bars');
    if (!host) {
        host = document.createElement('div');
        host.className = 'sr-progress-bars';
        contentEl.appendChild(host);
    }
    return host;
}

/**
 *
 * │--- Funktion: renderMiniBars ---│
 *
 * - Rendert drei Mini-Säulen (Rot, Gelb, Grün) in den übergebenen Container.
 * - Balkenhöhe skaliert relativ zum Maximum der drei Werte (mindestens 1).
 * - Setzt CSS-Klassen, role="img" und aria-label für Barrierefreiheit.
 * - Bricht ab, wenn host null/undefined ist.
 *
 * @param {HTMLElement|null|undefined} host — Ziel-Container im DOM
 * @param {{ red: number, yellow: number, green: number }} data — Fortschrittswerte
 */
export function renderMiniBars(host, data) {
    // Ohne Container nichts rendern
    if (!host) return;

    // Maximum für relative Skalierung; mindestens 1 verhindert Division durch 0
    const max = Math.max(data.red, data.yellow, data.green, 1);
    // Beschreibender Text für Screenreader
    const ariaLabel = `Fortschritt: Rot ${data.red}, Gelb ${data.yellow}, Grün ${data.green}`;

    // Pro Kategorie eine Spalte mit Zahl und farbigem Balken erzeugen
    const cols = CATEGORIES.map(cat => {
        const n = data[cat.key];
        // Mindesthöhe 2 %, sonst proportional zu max (0–100 %)
        const h = Math.max(2, Math.round((n / max) * 100));
        return `<div class="progress-mini-bars__col" title="${cat.label}: ${n}">
            <span class="progress-mini-bars__n">${formatCompactCount(n)}</span>
            <div class="progress-mini-bars__bar" style="height:${h}%; background:${cat.color}"></div>
        </div>`;
    }).join('');

    // Container-Klassen und ARIA-Attribute setzen
    host.className = 'sr-progress-bars progress-mini-bars';
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', ariaLabel);
    // HTML der drei Spalten einfügen
    host.innerHTML = cols;
}
