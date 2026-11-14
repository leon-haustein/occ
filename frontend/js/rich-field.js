/**
 * Rich-Text-Felder für Flashcard-Formulare (Markdown, Bilder, Formatierung).
 *
 * Wandelt einfache <textarea>-Elemente in bearbeitbare Felder mit Toolbar um:
 * Fett, Kursiv, Unterstrichen, farbige Markierungen, LaTeX und Bild-Upload.
 * Bilder werden als Base64-Data-URLs gespeichert und beim Speichern als
 * Markdown-Bildsyntax (![](data:…)) an den Text angehängt.
 *
 * Importe:
 *   (keine — reines Browser-DOM-Modul ohne externe Abhängigkeiten)
 *
 * Exporte:
 *   - enhanceField(textarea)      — Textarea mit Toolbar und Bildvorschau ausstatten
 *   - getFieldValue(textarea)     — Text + eingebettete Bilder als Markdown-String
 *   - fieldHasContent(textarea)   — Prüfen ob Text oder Bilder vorhanden sind
 *   - resetField(textarea)        — Feld leeren (Text, Bilder, Vorschau)
 *   - parseFieldValue(textarea, value) — Gespeicherten Markdown-String ins Feld laden
 *
 * Verwendung:
 *   - frontend/js/pages/karten.js Z. 581–582, 690–691, 715–716, 732–733,
 *     789–790, 825–826, 895, 899–900
 *   - frontend/js/flashcard-suggestion-form.js Z. 224–225, 333–334, 358–359,
 *     375–376, 439–440, 492–493, 501, 506
 *
 * DOM/CSS-Bezug: Klassen .rich-field, .rich-toolbar, .image-preview-strip
 *   (Styling in frontend/style.css ab ca. Z. 1521)
 */

// Maximale Dateigröße pro Bild: 2 Megabyte
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Erlaubte Bildformate für Upload und Drag-and-Drop
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Farben für die Highlight-Buttons in der Toolbar (orange, gelb, grün)
const HIGHLIGHT_COLORS = [
    { name: 'orange', title: 'Orange markieren' },
    { name: 'yellow', title: 'Gelb markieren' },
    { name: 'green', title: 'Grün markieren' }
];

/**
 *
 * │--- Funktion: showFieldError ---│
 *
 * Zeigt eine Fehlermeldung im zugehörigen Flashcard-Formular an.
 * @param {HTMLTextAreaElement} textarea — Feld, aus dem das Formular ermittelt wird
 * @param {string} message — Anzuzeigender Fehlertext
 */
function showFieldError(textarea, message) {
    // Übergeordnetes Formular-Element suchen
    const ownerForm = textarea.closest('.flashcard-type-form');
    // Fehler-Box im Formular finden
    const errEl = ownerForm?.querySelector('.flashcard-form-error');
    if (!errEl) return;
    // Meldung einsetzen und sichtbar machen
    errEl.textContent = message;
    errEl.hidden = false;
}

/**
 *
 * │--- Funktion: surroundSelection ---│
 *
 * Umschließt die aktuelle Textauswahl mit einem Präfix und Suffix (z. B. **fett**).
 * @param {HTMLTextAreaElement} textarea — Ziel-Textarea
 * @param {string} before — Zeichenkette vor der Auswahl (z. B. '**')
 * @param {string} after — Zeichenkette nach der Auswahl (z. B. '**')
 */
function surroundSelection(textarea, before, after) {
    // Start- und Endposition der Markierung im Text
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    // Markierten Teil extrahieren
    const selected = value.slice(start, end);
    // Neuen Text mit Formatierung drumherum zusammenbauen
    const replacement = before + selected + after;
    textarea.value = value.slice(0, start) + replacement + value.slice(end);
    // Cursor hinter die Einfügung setzen (oder hinter before, wenn nichts markiert war)
    const cursor = selected ? start + replacement.length : start + before.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
}

/**
 *
 * │--- Funktion: renderPreviewStrip ---│
 *
 * Aktualisiert die Bildvorschau-Leiste unter dem Textfeld.
 * @param {HTMLTextAreaElement} textarea — Feld mit _previewStrip und _mdImages
 */
function renderPreviewStrip(textarea) {
    const strip = textarea._previewStrip;
    if (!strip) return;
    // Alle bisherigen Vorschaubilder entfernen
    strip.innerHTML = '';
    // Für jedes gespeicherte Bild ein Miniatur-Element erzeugen
    (textarea._mdImages || []).forEach((dataUrl, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'image-preview-thumb';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Bildvorschau';
        // Entfernen-Button pro Bild
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'image-preview-remove';
        remove.setAttribute('aria-label', 'Bild entfernen');
        remove.textContent = '×';
        remove.onclick = () => {
            textarea._mdImages.splice(idx, 1);
            renderPreviewStrip(textarea);
        };
        thumb.appendChild(img);
        thumb.appendChild(remove);
        strip.appendChild(thumb);
    });
}

/**
 *
 * │--- Funktion: addImageFiles ---│
 *
 * Liest Bilddateien ein und hängt sie als Base64-Data-URLs an das Textarea an.
 * @param {HTMLTextAreaElement} textarea — Ziel-Feld (_mdImages wird befüllt)
 * @param {FileList|File[]} files — Hochgeladene oder per Drag-and-Drop abgelegte Dateien
 */
function addImageFiles(textarea, files) {
    Array.from(files).forEach((file) => {
        // Ungültige Formate still überspringen
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return;
        // Zu große Dateien mit Fehlermeldung ablehnen
        if (file.size > MAX_IMAGE_BYTES) {
            showFieldError(textarea, 'Bild ist zu groß (max. 2 MB): ' + file.name);
            return;
        }
        // Datei asynchron als Data-URL einlesen
        const reader = new FileReader();
        reader.onload = () => {
            textarea._mdImages.push(reader.result);
            renderPreviewStrip(textarea);
        };
        reader.readAsDataURL(file);
    });
}

/**
 *
 * │--- Funktion: enhanceField ---│
 *
 * Statet ein Textarea mit Toolbar, Bild-Upload und Drag-and-Drop aus.
 * Wird nur einmal pro Element ausgeführt (_enhanced-Flag verhindert Doppelaufruf).
 *
 * @param {HTMLTextAreaElement} textarea — Rohes Textarea aus dem Flashcard-Formular
 * @returns {void}
 *
 * @example
 * // karten.js — Standard-Frage- und Antwortfeld aufwerten:
 * enhanceField(standardQuestion);
 * enhanceField(standardAnswer);
 */
export function enhanceField(textarea) {
    // Bereits aufgewertete oder fehlende Felder ignorieren
    if (!textarea || textarea._enhanced) return;
    textarea._enhanced = true;
    // Array für eingebettete Bilder (Data-URLs) initialisieren
    textarea._mdImages = [];

    // Wrapper um Toolbar, Textarea und Vorschau-Leiste legen
    const wrapper = document.createElement('div');
    wrapper.className = 'rich-field';
    textarea.parentNode.insertBefore(wrapper, textarea);

    // Toolbar mit Formatierungs-Buttons aufbauen
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-toolbar';
    /**
     *
     * │--- Funktion: mkBtn ---│
     *
     * Erzeugt einen Toolbar-Button mit mousedown-Schutz für die Textauswahl.
     */
    const mkBtn = (label, title, handler, extraClass) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rich-toolbar-btn' + (extraClass ? ' ' + extraClass : '');
        b.title = title;
        b.innerHTML = label;
        // Mousedown verhindern, damit die Textauswahl im Textarea erhalten bleibt
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = handler;
        return b;
    };

    // Markdown-Formatierung: Fett, Kursiv, Unterstrichen
    toolbar.appendChild(mkBtn('<strong>F</strong>', 'Fett', () => surroundSelection(textarea, '**', '**')));
    toolbar.appendChild(mkBtn('<em>K</em>', 'Kursiv', () => surroundSelection(textarea, '*', '*')));
    toolbar.appendChild(mkBtn('<u>U</u>', 'Unterstrichen', () => surroundSelection(textarea, '__', '__')));

    // Highlight-Buttons für jede Farbe aus HIGHLIGHT_COLORS
    for (const { name, title } of HIGHLIGHT_COLORS) {
        toolbar.appendChild(mkBtn(
            '',
            title,
            () => surroundSelection(textarea, '[' + name + ']', '[/' + name + ']'),
            'rich-toolbar-btn--hl rich-toolbar-btn--hl-' + name
        ));
    }

    // Inline-LaTeX: Auswahl mit $ … $ umschließen
    toolbar.appendChild(mkBtn('LaTeX', 'Formel (inline)', () => surroundSelection(textarea, '$', '$')));

    // Verstecktes Datei-Input für Bild-Upload
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
    fileInput.multiple = true;
    fileInput.className = 'rich-file-input';
    fileInput.onchange = () => {
        addImageFiles(textarea, fileInput.files);
        fileInput.value = '';
    };
    toolbar.appendChild(mkBtn('Bild', 'Bild hinzufügen', () => fileInput.click()));
    toolbar.appendChild(fileInput);

    wrapper.appendChild(toolbar);
    wrapper.appendChild(textarea);

    // Vorschau-Leiste für hochgeladene Bilder unter dem Textfeld
    const strip = document.createElement('div');
    strip.className = 'image-preview-strip';
    wrapper.appendChild(strip);
    textarea._previewStrip = strip;

    // Drag-and-Drop: visuelles Feedback beim Ziehen über das Feld
    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        wrapper.classList.add('is-dragover');
    });
    wrapper.addEventListener('dragleave', (e) => {
        if (!wrapper.contains(e.relatedTarget)) wrapper.classList.remove('is-dragover');
    });
    wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        wrapper.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files) addImageFiles(textarea, e.dataTransfer.files);
    });
}

/**
 *
 * │--- Funktion: getFieldValue ---│
 *
 * Liest den vollständigen Feldinhalt als Markdown-String (Text + Bilder).
 *
 * @param {HTMLTextAreaElement} textarea — Aufgewertetes Textarea
 * @returns {string} Getrimmter Text, optional gefolgt von ![](data:…)-Blöcken
 *
 * @example
 * // karten.js — beim Speichern einer Standard-Karte:
 * const question = getFieldValue(standardQuestion);
 */
export function getFieldValue(textarea) {
    const text = textarea.value.trim();
    // Jedes Bild als Markdown-Bildsyntax anfügen
    const imgs = (textarea._mdImages || []).map((d) => '![](' + d + ')').join('\n\n');
    // Text und Bilder mit Leerzeile verbinden; leere Teile weglassen
    return [text, imgs].filter(Boolean).join('\n\n');
}

/**
 *
 * │--- Funktion: fieldHasContent ---│
 *
 * Prüft, ob das Feld ausgefüllt ist (Text und/oder mindestens ein Bild).
 *
 * @param {HTMLTextAreaElement} textarea — Aufgewertetes Textarea
 * @returns {boolean} true wenn Text nicht leer oder Bilder vorhanden
 *
 * @example
 * // karten.js — Validierung vor dem Speichern:
 * if (!fieldHasContent(standardQuestion) || !fieldHasContent(standardAnswer)) { … }
 */
export function fieldHasContent(textarea) {
    return textarea.value.trim() !== '' || (textarea._mdImages && textarea._mdImages.length > 0);
}

/**
 *
 * │--- Funktion: resetField ---│
 *
 * Setzt Text, Bildliste und Vorschau-Leiste zurück.
 *
 * @param {HTMLTextAreaElement} textarea — Aufgewertetes Textarea
 * @returns {void}
 *
 * @example
 * // karten.js — Formular nach erfolgreichem Speichern leeren:
 * resetField(standardQuestion);
 */
export function resetField(textarea) {
    textarea.value = '';
    textarea._mdImages = [];
    if (textarea._previewStrip) textarea._previewStrip.innerHTML = '';
}

/**
 *
 * │--- Funktion: parseFieldValue ---│
 *
 * Lädt einen gespeicherten Markdown-String zurück ins Textarea (z. B. beim Bearbeiten).
 * Trennt eingebettete ![](data:…)-Bilder vom Fließtext.
 *
 * @param {HTMLTextAreaElement} textarea — Aufgewertetes Textarea
 * @param {string} value — Gespeicherter Inhalt aus der Datenbank
 * @returns {void}
 *
 * @example
 * // karten.js — bestehende Karte in das Formular laden:
 * parseFieldValue(standardQuestion, card.question || '');
 */
export function parseFieldValue(textarea, value) {
    resetField(textarea);
    if (!value) return;
    const images = [];
    // Alle Markdown-Bilder mit Data-URL aus dem String extrahieren
    const imgRe = /!\[\]\((data:image\/[^)]+)\)/g;
    let match;
    while ((match = imgRe.exec(value)) !== null) {
        images.push(match[1]);
    }
    // Bild-Markdown aus dem String entfernen; Rest ist der sichtbare Text
    const text = value.replace(/!\[\]\((data:image\/[^)]+)\)\n?\n?/g, '').trim();
    textarea.value = text;
    textarea._mdImages = images;
    renderPreviewStrip(textarea);
}
