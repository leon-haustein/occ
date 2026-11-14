/**
 * Sicherer Markdown-Renderer für Karteikarten-Inhalte in der OVGU-Karten-App.
 *
 * Wandelt eine eingeschränkte Markdown-Teilmenge in HTML um, ohne beliebiges HTML
 * zuzulassen (XSS-Schutz durch escapeHtml). Unterstützt Fettdruck, Kursiv, Unterstreichen,
 * farbige Hintergrund-Markierungen, LaTeX-Formeln (KaTeX), Aufzählungslisten und
 * eingebettete Base64-Bilder. Mathe- und Bild-Platzhalter werden vor dem Escaping
 * extrahiert und nach der Inline-Verarbeitung wieder eingesetzt.
 *
 * Importe:
 *   - katex (@see frontend/vendor/katex/katex.mjs) — LaTeX zu HTML rendern
 *   - escapeHtml (@see frontend/js/dom-utils.js) — XSS-sichere Textausgabe
 *
 * Exporte:
 *   - renderMarkdown(text) — Markdown-String in sicheres HTML umwandeln
 *
 * Verwendung:
 *   - frontend/js/flashcard-renderers.js Z. 28 (Import), Z. 83, 87, 165, 167
 *     → renderMarkdown (Prozess-Schritte, Standard-Frage/Antwort)
 *   - frontend/js/pages/kartenverwaltung.js Z. 14 (Import), Z. 55
 *     → renderMarkdown (Kartentitel in der Kachel-Ansicht)
 */

// KaTeX-Bibliothek für Inline- und Block-LaTeX
import katex from '../vendor/katex/katex.mjs';
// HTML-Escaping für alle Nutzertexte vor der Markdown-Verarbeitung
import { escapeHtml } from './dom-utils.js';

/** Erlaubt nur Base64-Daten-URLs für eingebettete Bilder (png, jpeg, gif, webp). */
const ALLOWED_IMAGE_PREFIX = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
/** Farben für [orange|yellow|green]…[/…]-Hintergrund-Markierungen. */
const HIGHLIGHT_COLORS = ['orange', 'yellow', 'green'];

/**
 *
 * │--- Funktion: applyInlineBasic ---│
 *
 * - Wendet grundlegende Inline-Markdown-Syntax auf bereits escaped Text an.
 * - Unterstützt **fett**, __unterstrichen__ und *kursiv* (in dieser Reihenfolge).
 * - Wird auch rekursiv innerhalb von Highlight-Markierungen aufgerufen.
 *
 * @param {string} escaped — HTML-escaped Klartext
 * @returns {string} Text mit strong, u und em Tags
 */
function applyInlineBasic(escaped) {
    let out = escaped;
    // **text** → <strong>text</strong>
    out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    // __text__ → <u>text</u>
    out = out.replace(/__([^_]+?)__/g, '<u>$1</u>');
    // *text* → <em>text</em> (nach **, damit kein Konflikt entsteht)
    out = out.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    return out;
}

/**
 *
 * │--- Funktion: applyInline ---│
 *
 * - Wendet farbige Hintergrund-Markierungen und danach Basis-Inline-Syntax an.
 * - Erkennt [orange], [yellow], [green] mit schließendem [/farbe]-Tag.
 * - Inhalt innerhalb der Markierung durchläuft zusätzlich applyInlineBasic.
 *
 * @param {string} escaped — HTML-escaped Klartext
 * @returns {string} Text mit mark- und Inline-Formatierungs-Tags
 */
function applyInline(escaped) {
    let out = escaped;
    // Jede Highlight-Farbe durch eigenes Regex ersetzen
    for (const color of HIGHLIGHT_COLORS) {
        const re = new RegExp('\\[' + color + '\\]([\\s\\S]+?)\\[\\/' + color + '\\]', 'g');
        out = out.replace(re, (match, inner) =>
            '<mark class="md-hl md-hl--' + color + '">' + applyInlineBasic(inner) + '</mark>'
        );
    }
    // Verbleibenden Text mit Fett/Kursiv/Unterstrichen formatieren
    return applyInlineBasic(out);
}

/**
 *
 * │--- Funktion: renderMathToken ---│
 *
 * - Rendert einen extrahierten LaTeX-Token mit KaTeX zu HTML.
 * - Block-Formeln ($$…$$) erhalten ein div.md-math-block, Inline ($…$) ein span.
 * - Bei Fehler wird der Rohtext escaped zurückgegeben (Fallback-Anzeige).
 *
 * @param {{ latex: string, display: boolean }} token — LaTeX-Inhalt und Anzeigemodus
 * @returns {string} KaTeX-HTML oder escaped Fallback
 */
function renderMathToken(token) {
    try {
        // KaTeX rendern; throwOnError: false verhindert Abbruch bei ungültigem LaTeX
        const html = katex.renderToString(token.latex, {
            throwOnError: false,
            displayMode: token.display
        });
        // Block-Formel in eigenem Container
        if (token.display) {
            return '<div class="md-math-block">' + html + '</div>';
        }
        // Inline-Formel in span
        return '<span class="md-math-inline">' + html + '</span>';
    } catch (_) {
        // Bei Exception: Original-LaTeX escaped anzeigen
        const raw = token.display ? '$$' + token.latex + '$$' : '$' + token.latex + '$';
        return escapeHtml(raw);
    }
}

/**
 *
 * │--- Funktion: replaceMathPlaceholders ---│
 *
 * - Ersetzt Platzhalter \u0000MATH{n}\u0000 im HTML durch gerenderte KaTeX-Ausgabe.
 * - Wird nach dem Escaping aufgerufen, damit LaTeX nicht zerstört wird.
 *
 * @param {string} html — HTML-String mit Math-Platzhaltern
 * @param {Array<{ latex: string, display: boolean }>} mathTokens — extrahierte Formeln
 * @returns {string} HTML mit eingesetzten Formeln
 */
function replaceMathPlaceholders(html, mathTokens) {
    return html.replace(/\u0000MATH(\d+)\u0000/g, (m, i) => {
        const token = mathTokens[Number(i)];
        return token ? renderMathToken(token) : '';
    });
}

/**
 *
 * │--- Funktion: extractMath ---│
 *
 * - Extrahiert Block- ($$…$$) und Inline-Formeln ($…$) aus dem Rohtext.
 * - Ersetzt sie durch unsichtbare Platzhalter, damit Escaping sie nicht verändert.
 * - Block-Formeln werden vor Inline-Formeln verarbeitet (greedy Block-Match zuerst).
 *
 * @param {string} raw — unverarbeiteter Markdown-Text
 * @returns {{ text: string, mathTokens: Array }} Text mit Platzhaltern und Token-Liste
 */
function extractMath(raw) {
    const mathTokens = [];
    // Block-LaTeX: $$ … $$ (mehrzeilig erlaubt)
    let out = raw.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex) => {
        const idx = mathTokens.length;
        mathTokens.push({ latex: String(latex).trim(), display: true });
        return '\u0000MATH' + idx + '\u0000';
    });
    // Inline-LaTeX: $ … $ (keine Zeilenumbrüche im Inhalt)
    out = out.replace(/\$([^$\n]+?)\$/g, (match, latex) => {
        const idx = mathTokens.length;
        mathTokens.push({ latex: String(latex).trim(), display: false });
        return '\u0000MATH' + idx + '\u0000';
    });
    return { text: out, mathTokens };
}

/**
 *
 * │--- Funktion: renderMarkdown ---│
 *
 * - Hauptfunktion: wandelt Markdown-Text in sicheres HTML für Karteikarten um.
 * - Verarbeitet zeilenweise: Listen (- ), Bilder, Math-only-Zeilen, Leerzeilen, Fließtext.
 * - Bilder nur als erlaubte Base64-Daten-URLs; alles andere wird verworfen.
 * - Gibt leeren String bei null/undefined zurück.
 *
 * @param {string|null|undefined} text — Markdown-Eingabe
 * @returns {string} Sicheres HTML für innerHTML-Einbettung
 */
export function renderMarkdown(text) {
    // null/undefined → leere Ausgabe
    if (text == null) return '';
    const raw = String(text);
    // Bild-Platzhalter sammeln (nur erlaubte Base64-URLs)
    const images = [];
    const withImagePlaceholders = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const trimmed = String(url).trim();
        // Nicht erlaubte URLs komplett entfernen (Sicherheit)
        if (!ALLOWED_IMAGE_PREFIX.test(trimmed)) {
            return '';
        }
        const idx = images.length;
        images.push({ alt: String(alt || ''), url: trimmed });
        return '\u0000IMG' + idx + '\u0000';
    });

    // LaTeX extrahieren und durch Math-Platzhalter ersetzen
    const { text: withMathPlaceholders, mathTokens } = extractMath(withImagePlaceholders);

    // Zeilenweise Verarbeitung (Windows- und Unix-Zeilenumbrüche)
    const lines = withMathPlaceholders.split(/\r?\n/);
    let html = '';
    let inList = false;
    // Hilfsfunktion: offene ul-Liste schließen
    const closeList = () => {
        if (inList) {
            html += '</ul>';
            inList = false;
        }
    };

    for (const line of lines) {
        // Aufzählung: Zeile beginnt mit "- "
        const listMatch = line.match(/^\s*-\s+(.*)$/);
        if (listMatch) {
            if (!inList) {
                html += '<ul>';
                inList = true;
            }
            // Listeneintrag: escapen, Inline-Markdown, Math-Platzhalter ersetzen
            html += '<li>' + replaceMathPlaceholders(applyInline(escapeHtml(listMatch[1])), mathTokens) + '</li>';
            continue;
        }
        closeList();
        // Zeile enthält nur ein Bild-Platzhalter
        const imgOnly = line.match(/^\u0000IMG(\d+)\u0000$/);
        if (imgOnly) {
            const img = images[Number(imgOnly[1])];
            if (img) {
                html += '<img class="md-image" src="' + img.url + '" alt="' + escapeHtml(img.alt) + '">';
            }
            continue;
        }
        // Zeile enthält nur eine Math-Formel (Block oder Inline)
        const mathOnly = line.match(/^\u0000MATH(\d+)\u0000$/);
        if (mathOnly) {
            const token = mathTokens[Number(mathOnly[1])];
            if (token) html += renderMathToken(token);
            continue;
        }
        // Leerzeile → Zeilenumbruch
        if (line.trim() === '') {
            html += '<br>';
            continue;
        }
        // Normaler Fließtext in span.md-line
        html += '<span class="md-line">' + replaceMathPlaceholders(applyInline(escapeHtml(line)), mathTokens) + '</span>';
    }
    closeList();

    // Verbleibende Bild-Platzholder in Fließtext-Zeilen ersetzen
    html = html.replace(/\u0000IMG(\d+)\u0000/g, (m, i) => {
        const img = images[Number(i)];
        return img ? '<img class="md-image" src="' + img.url + '" alt="' + escapeHtml(img.alt) + '">' : '';
    });
    // Verbleibende Math-Platzhalter ersetzen
    html = replaceMathPlaceholders(html, mathTokens);

    return html;
}
