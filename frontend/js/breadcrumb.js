/**
 * Brotkrumen-Navigation (Breadcrumb) für die OVGU-Karten-App.
 *
 * Zeigt klickbare Otto-Gesichter als Navigationspfad durch die Ebenen
 * (Studiengang → Kurse → Themen → Karten). Text wird nicht angezeigt;
 * Farbe und Größe kommen aus style.css.
 *
 * Importe:
 *   - OTTO_FACE_SVG (@see frontend/js/vector-graphics.js) — SVG-Icon pro Schritt
 *
 * Exporte:
 *   - renderBreadcrumb(steps, containerId?) — generischer Renderer
 *   - createBreadcrumb(currentLevel, options?) — vordefinierte Ebenen 2–4
 *
 * Verwendung:
 *   - frontend/js/pages/kurse.js Z. 145        → createBreadcrumb()
 *   - frontend/js/pages/themen.js Z. 144        → createBreadcrumb(3, { programId, courseId })
 *   - frontend/js/pages/karten.js Z. 57           → createBreadcrumb(4, { programId, courseId })
 *   - frontend/js/pages/kartenverwaltung.js Z. 248 → renderBreadcrumb(steps)
 *
 * DOM-Ziel: Element mit id="breadcrumb" (Standard) in den Layer-HTML-Seiten.
 */

// Otto-Gesicht als SVG-Markup — wird in jeden Breadcrumb-Schritt eingefügt
import { OTTO_FACE_SVG } from './vector-graphics.js';

/**
 * Rendert eine Liste von Breadcrumb-Schritten als klickbare Links im DOM.
 *
 * Jeder Schritt wird als Link mit Otto-Gesicht dargestellt. Beim Hover zeigt
 * das title-Attribut den Ebenennamen (z. B. „Ebene 2“).
 *
 * @param {Array<{id: string, title: string, href: string}>} steps
 *   Navigations-Schritte: id (CSS-Klasse), title (Tooltip), href (Ziel-URL)
 * @param {string} [containerId='breadcrumb']
 *   ID des HTML-Elements, in das die Navigation geschrieben wird
 * @returns {void}
 *
 * @example
 * // In kartenverwaltung.js — Schritte je nach Kontext (Programm/Kurs/Thema):
 * renderBreadcrumb([
 *   { id: 'index', title: 'Ebene 1', href: 'studiengaenge.html' },
 *   { id: 'layer2', title: 'Ebene 2', href: 'kurse.html?program=1' }
 * ]);
 */
export function renderBreadcrumb(steps, containerId = 'breadcrumb') {
    // Navigations-Container auf der Seite suchen; ohne Element nichts tun
    const breadcrumbContainer = document.getElementById(containerId);
    if (!breadcrumbContainer) return;

    // SVG einmal laden und in der Schleife wiederverwenden (Performance)
    const faceSvg = OTTO_FACE_SVG;
    let htmlOutput = '';

    // Pro Schritt einen Link mit Otto-Gesicht und Ebenen-spezifischer CSS-Klasse bauen
    for (const step of steps) {
        htmlOutput += `
            <a href="${step.href}" class="breadcrumb-step breadcrumb-step--${step.id}" title="${step.title}">
                ${faceSvg}
            </a>
        `;
    }

    // Fertiges HTML in den Container schreiben (ersetzt vorherigen Inhalt)
    breadcrumbContainer.innerHTML = htmlOutput;
}

/**
 * Erzeugt die Standard-Breadcrumb-Navigation für die Layer-Seiten (Ebene 2–4).
 *
 * Auf Ebene N werden nur die N−1 vorherigen Ebenen als klickbare Schritte
 * angezeigt — die aktuelle Seite selbst erscheint nicht im Pfad.
 *
 * @param {number} [currentLevel=2]
 *   Aktuelle Ebene: 2 = Studiengang, 3 = Kurs, 4 = Thema/Karten
 * @param {Object} [options={}]
 * @param {number|null} [options.programId=null]
 *   Studiengang-ID für den Link zu kurse.html?program=…
 * @param {number|null} [options.courseId=null]
 *   Kurs-ID für den Link zu themen.html?course=…
 * @returns {void}
 *
 * @example
 * // themen.js — Index + Studiengang anzeigen (Ebene 3 = Kursseite):
 * createBreadcrumb(3, { programId: course.studiengang_id, courseId });
 */
export function createBreadcrumb(currentLevel = 2, { programId = null, courseId = null } = {}) {
    // Feste Reihenfolge aller Ebenen; hrefs mit Query-Parametern wenn IDs bekannt
    const layers = [
        { id: 'index', title: 'Ebene 1', href: 'studiengaenge.html' },
        {
            id: 'layer2',
            title: 'Ebene 2',
            href: programId != null ? `kurse.html?program=${programId}` : 'kurse.html'
        },
        {
            id: 'layer3',
            title: 'Ebene 3',
            href: courseId != null ? `themen.html?course=${courseId}` : 'themen.html'
        },
        { id: 'layer4', title: 'Ebene 4', href: 'karten.html' }
    ];

    // Nur vorherige Ebenen rendern: Ebene 2 → 1 Schritt, Ebene 3 → 2 Schritte, Ebene 4 → 3 Schritte
    renderBreadcrumb(layers.slice(0, Math.max(0, currentLevel - 1)));
}
