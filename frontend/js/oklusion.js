/**
 * Oklusion-Karten: Editor und Viewer für Bildabdeckungen in der OVGU-Karten-App.
 *
 * Stellt interaktive Komponenten bereit, um Oklusion-Karteikarten zu erstellen und
 * anzuzeigen. Der Editor erlaubt Bild-Upload (Drag & Drop), rechteckige und
 * freihandgezeichnete (Lasso) Abdeckungen mit Verschieben und Größenänderung.
 * Der Viewer zeigt Abdeckungen im Lernmodus; Klick deckt einzelne Bereiche auf.
 * Alle Koordinaten werden prozentual relativ zum Bild gespeichert (0–100 %).
 *
 * Importe:
 *   — keine (nutzt ausschließlich Browser-APIs und DOM)
 *
 * Exporte:
 *   - mountOklusionEditor(container, options) — Editor zum Erstellen/Bearbeiten mounten
 *   - mountOklusionViewer(container, card, options) — Viewer zum Lernen mounten
 *
 * Verwendung:
 *   - frontend/js/pages/karten.js Z. 11 (Import), Z. 157, 849
 *     → mountOklusionViewer (Lernansicht), mountOklusionEditor (Karte anlegen)
 *   - frontend/js/flashcard-suggestion-form.js Z. 2 (Import), Z. 400
 *     → mountOklusionEditor (Oklusion-Vorschlag bearbeiten)
 *   - frontend/js/flashcard-view-modal.js Z. 37 (Import), Z. 216
 *     → mountOklusionViewer (Oklusion im Vorschau-Modal)
 *
 * Rückgabe-API (Editor): getData(), loadData(data), reset(), destroy()
 * Rückgabe-API (Viewer): resetRevealed(), destroy()
 *   → resetRevealed: karten.js Z. 72, 213, 226, 299; flashcard-view-modal.js Z. 242
 *   → destroy: karten.js Z. 123, 142; flashcard-view-modal.js Z. 198, 463
 *   → reset: karten.js Z. 858; flashcard-suggestion-form.js Z. 464
 */

/** SVG-Namespace für Lasso-Polygone und Live-Zeichnung. */
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Standard-Maximalgröße für hochgeladene Bilder (2 MB). */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Erlaubte MIME-Typen beim Bild-Upload. */
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 *
 * │--- Funktion: clamp ---│
 *
 * - Begrenzt einen numerischen Wert auf den Bereich [min, max].
 * - Wird für prozentuale Positionen und Mindestgrößen von Abdeckungen genutzt.
 *
 * @param {number} value — Eingabewert
 * @param {number} min — untere Grenze
 * @param {number} max — obere Grenze
 * @returns {number} geklammter Wert
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 *
 * │--- Funktion: serializeOcclusion ---│
 *
 * - Wandelt eine interne Abdeckung in das API-serialisierbare Format um.
 * - Entfernt DOM-Referenzen (el, id); bei Lasso werden points mit exportiert.
 *
 * @param {Object} data — interne Abdeckungsdaten
 * @returns {Object} serialisierbare Abdeckung für Speicherung/API
 */
function serializeOcclusion(data) {
    // Basis-Felder für alle Abdeckungstypen
    const out = { type: data.type, x: data.x, y: data.y, w: data.w, h: data.h };
    // Lasso: Polygon-Punkte relativ zur Bounding-Box mitgeben
    if (data.type === 'lasso' && data.points) out.points = data.points.map((p) => ({ x: p.x, y: p.y }));
    return out;
}

/**
 *
 * │--- Funktion: positionEl ---│
 *
 * - Setzt Position und Größe eines Abdeckungs-DOM-Elements in Prozent.
 * - Koordinaten beziehen sich auf die Stage (Bildcontainer).
 *
 * @param {HTMLElement} el — Abdeckungs-Element
 * @param {{ x: number, y: number, w: number, h: number }} data — prozentuale Bounds
 */
function positionEl(el, data) {
    el.style.left = data.x + '%';
    el.style.top = data.y + '%';
    el.style.width = data.w + '%';
    el.style.height = data.h + '%';
}

/**
 *
 * │--- Funktion: buildOcclusionEl ---│
 *
 * - Erzeugt das DOM-Element für eine Abdeckung (Rechteck oder Lasso).
 * - Im Editor-Modus: Löschen-Button und Resize-Handles für Rechtecke.
 * - Bindet Pointer-Events für Verschieben, Resize oder Aufdecken (Preview).
 *
 * @param {Object} data — Abdeckungsdaten (type, x, y, w, h, points?)
 * @param {Object} options — editable, onRemove, onPointerDown, onResize
 * @returns {HTMLElement} fertiges Abdeckungs-Element
 */
function buildOcclusionEl(data, { editable, onRemove, onPointerDown, onResize }) {
    const el = document.createElement('div');
    el.className = 'okl-occ type-' + data.type;
    positionEl(el, data);

    if (editable) {
        // Löschen-Button im Editor
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'okl-occ-delete';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Abdeckung löschen');
        // Klick auf Löschen soll nicht Verschieben auslösen
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            onRemove?.();
        });
        el.appendChild(del);

        // Resize-Handles nur für Rechteck-Abdeckungen (drei Ecken)
        if (data.type === 'rect') {
            ['nw', 'sw', 'se'].forEach((corner) => {
                const handle = document.createElement('div');
                handle.className = 'okl-handle ' + corner;
                handle.addEventListener('pointerdown', (e) => onResize?.(e, corner));
                el.appendChild(handle);
            });
        }
    }

    // Lasso: SVG-Polygon innerhalb der prozentualen Bounding-Box
    if (data.type === 'lasso') {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', data.points.map((p) => p.x + ',' + p.y).join(' '));
        poly.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(poly);
        el.appendChild(svg);
    }

    // Haupt-Pointer-Handler (Verschieben oder Aufdecken)
    el.addEventListener('pointerdown', (e) => onPointerDown?.(e, el));
    return el;
}

/**
 *
 * │--- Funktion: createStageController ---│
 *
 * - Zentrale Steuerlogik für Bild-Stage, Abdeckungen und Lasso-Zeichnung.
 * - editable: true im Editor (verschieben, resize, zeichnen); preview: true im Viewer (aufdecken).
 * - Gibt API-Objekt zurück: loadImage, loadOcclusions, getSerializedOcclusions, destroy, …
 *
 * @param {HTMLElement} root — Container mit .okl-stage, .okl-overlays, .okl-lasso-layer
 * @param {{ editable?: boolean, preview?: boolean }} options — Betriebsmodus
 * @returns {Object} Stage-Controller mit Methoden zur Abdeckungsverwaltung
 */
function createStageController(root, { editable = false, preview = false } = {}) {
    const stage = root.querySelector('.okl-stage');
    const stageImg = root.querySelector('.okl-stage__img');
    const overlays = root.querySelector('.okl-overlays');
    const lassoLayer = root.querySelector('.okl-lasso-layer');
    const hint = root.querySelector('.okl-hint');

    let mode = 'none';
    let occId = 0;
    const occlusions = [];
    let drawing = false;
    let drawPoints = [];
    let liveEl = null;

    /**
     *
     * │--- Funktion: setHint ---│
     *
     * - Setzt den Hinweistext unter der Stage (z. B. Lasso-Anleitung).
     *
     */
    function setHint(text) {
        if (hint) hint.textContent = text || '';
    }

    /**
     *
     * │--- Funktion: setMode ---│
     *
     * - Schaltet den Interaktionsmodus (none, lasso) und aktualisiert UI-Hinweise.
     * - Im Lasso-Modus wird die Stage-Klasse is-lasso gesetzt.
     *
     */
    function setMode(newMode) {
        mode = newMode;
        stage.classList.toggle('is-lasso', mode === 'lasso');
        if (mode === 'lasso') {
            setHint('Maustaste gedrückt halten und eine Fläche über das Bild zeichnen.');
        } else if (!preview) {
            setHint('');
        }
    }

    /**
     *
     * │--- Funktion: clearOcclusions ---│
     *
     * - Entfernt alle Abdeckungen aus dem internen Array und dem DOM.
     *
     */
    function clearOcclusions() {
        occlusions.length = 0;
        overlays.innerHTML = '';
    }

    /**
     *
     * │--- Funktion: removeOcclusion ---│
     *
     * - Löscht eine Abdeckung anhand ihrer internen ID aus Array und DOM.
     *
     * @param {number} id — interne Abdeckungs-ID
     */
    function removeOcclusion(id) {
        const idx = occlusions.findIndex((o) => o.id === id);
        if (idx === -1) return;
        const [removed] = occlusions.splice(idx, 1);
        removed.el?.remove();
    }

    /**
     *
     * │--- Funktion: createOcclusion ---│
     *
     * - Legt eine neue Abdeckung an, baut DOM-Element und hängt es in overlays ein.
     * - Vergibt automatisch eine aufsteigende interne ID.
     *
     * @param {Object} data — Abdeckungsdaten ohne id/el
     */
    function createOcclusion(data) {
        data.id = ++occId;
        const el = buildOcclusionEl(data, {
            editable,
            onRemove: () => removeOcclusion(data.id),
            onPointerDown: onOccPointerDown,
            onResize: editable ? (e, corner) => startResize(e, data, el, corner) : null
        });
        data.el = el;
        occlusions.push(data);
        overlays.appendChild(el);
    }

    /**
     *
     * │--- Funktion: onOccPointerDown ---│
     *
     * - Reagiert auf Pointer-Down auf einer Abdeckung.
     * - Preview: Klick toggelt revealed (Aufdecken).
     * - Editor: Drag zum Verschieben mit Pointer-Capture und Clamp an Stage-Grenzen.
     *
     */
    function onOccPointerDown(e, el) {
        const data = occlusions.find((o) => o.el === el);
        if (!data) return;
        // Im Lasso-Modus keine Abdeckung verschieben
        if (mode === 'lasso') return;
        // Viewer: Abdeckung aufdecken/verbergen
        if (preview) {
            el.classList.toggle('revealed');
            return;
        }
        if (!editable) return;
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = data.x;
        const origY = data.y;
        el.setPointerCapture(e.pointerId);

        /** Verschiebt Abdeckung proportional zur Mausbewegung. */
        function move(ev) {
            const dx = (ev.clientX - startX) / rect.width * 100;
            const dy = (ev.clientY - startY) / rect.height * 100;
            data.x = clamp(origX + dx, 0, 100 - data.w);
            data.y = clamp(origY + dy, 0, 100 - data.h);
            positionEl(el, data);
        }
        /** Beendet Drag und entfernt Listener. */
        function up() {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
        }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
    }

    /**
     *
     * │--- Funktion: startResize ---│
     *
     * - Startet Größenänderung einer Rechteck-Abdeckung über ein Resize-Handle.
     * - Unterstützt Ecken nw, sw, se; Mindestgröße MIN = 4 %.
     *
     */
    function startResize(e, data, el, corner) {
        e.preventDefault();
        e.stopPropagation();
        const rect = stage.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const o = { x: data.x, y: data.y, w: data.w, h: data.h };
        const MIN = 4;
        el.setPointerCapture(e.pointerId);

        /** Berechnet neue Bounds je nach gezogener Ecke. */
        function move(ev) {
            const dx = (ev.clientX - startX) / rect.width * 100;
            const dy = (ev.clientY - startY) / rect.height * 100;
            let { x, y, w, h } = o;
            if (corner.indexOf('e') !== -1) w = clamp(o.w + dx, MIN, 100 - o.x);
            if (corner.indexOf('s') !== -1) h = clamp(o.h + dy, MIN, 100 - o.y);
            if (corner.indexOf('w') !== -1) {
                const nx = clamp(o.x + dx, 0, o.x + o.w - MIN);
                w = o.w + (o.x - nx);
                x = nx;
            }
            if (corner.indexOf('n') !== -1) {
                const ny = clamp(o.y + dy, 0, o.y + o.h - MIN);
                h = o.h + (o.y - ny);
                y = ny;
            }
            data.x = x;
            data.y = y;
            data.w = w;
            data.h = h;
            positionEl(el, data);
        }
        function up() {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
        }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
    }

    /**
     *
     * │--- Funktion: addDrawPoint ---│
     *
     * - Fügt einen Punkt zur Lasso-Zeichnung hinzu (prozentuale Stage-Koordinaten).
     * - Ignoriert Punkte, die zu nah am letzten liegen (< 0,5 % Abstand).
     *
     */
    function addDrawPoint(e) {
        const rect = stage.getBoundingClientRect();
        const x = clamp((e.clientX - rect.left) / rect.width * 100, 0, 100);
        const y = clamp((e.clientY - rect.top) / rect.height * 100, 0, 100);
        const last = drawPoints[drawPoints.length - 1];
        if (!last || Math.hypot(last.x - x, last.y - y) > 0.5) drawPoints.push({ x, y });
    }

    /**
     *
     * │--- Funktion: updateLive ---│
     *
     * - Aktualisiert die Live-Polyline während des Lasso-Zeichnens.
     *
     */
    function updateLive() {
        if (liveEl) liveEl.setAttribute('points', drawPoints.map((p) => p.x + ',' + p.y).join(' '));
    }

    /**
     *
     * │--- Funktion: finishLasso ---│
     *
     * - Schließt die Lasso-Zeichnung ab und erzeugt eine Lasso-Abdeckung.
     * - Mindestens 3 Punkte erforderlich; Punkte werden in Bounding-Box normalisiert.
     *
     */
    function finishLasso() {
        if (liveEl) {
            liveEl.remove();
            liveEl = null;
        }
        // Zu wenige Punkte → Zeichnung verwerfen
        if (drawPoints.length < 3) {
            drawPoints = [];
            return;
        }
        const xs = drawPoints.map((p) => p.x);
        const ys = drawPoints.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const w = Math.max(maxX - minX, 0.001);
        const h = Math.max(maxY - minY, 0.001);
        // Punkte relativ zur Bounding-Box (0–100 innerhalb des div)
        const points = drawPoints.map((p) => ({
            x: (p.x - minX) / w * 100,
            y: (p.y - minY) / h * 100
        }));
        createOcclusion({ type: 'lasso', x: minX, y: minY, w, h, points });
        drawPoints = [];
    }

    // Lasso-Pointer-Handler nur im Editor-Modus
    const lassoHandlers = editable ? {
        pointerdown: (e) => {
            if (mode !== 'lasso') return;
            e.preventDefault();
            drawing = true;
            drawPoints = [];
            lassoLayer.setPointerCapture(e.pointerId);
            addDrawPoint(e);
            liveEl = document.createElementNS(SVG_NS, 'polyline');
            liveEl.setAttribute('class', 'okl-live');
            liveEl.setAttribute('vector-effect', 'non-scaling-stroke');
            lassoLayer.appendChild(liveEl);
        },
        pointermove: (e) => {
            if (!drawing) return;
            addDrawPoint(e);
            updateLive();
        },
        pointerup: (e) => {
            if (!drawing) return;
            drawing = false;
            lassoLayer.releasePointerCapture(e.pointerId);
            finishLasso();
        }
    } : null;

    if (lassoHandlers) {
        lassoLayer.addEventListener('pointerdown', lassoHandlers.pointerdown);
        lassoLayer.addEventListener('pointermove', lassoHandlers.pointermove);
        lassoLayer.addEventListener('pointerup', lassoHandlers.pointerup);
    }

    if (preview) stage.classList.add('is-preview');

    return {
        stage,
        stageImg,
        occlusions,
        setMode,
        setHint,
        clearOcclusions,
        createOcclusion,
        /** Setzt die Bildquelle der Stage. */
        loadImage(src) {
            stageImg.src = src;
        },
        /** Lädt Abdeckungen aus serialisierten Daten. */
        loadOcclusions(items) {
            clearOcclusions();
            for (const item of items || []) createOcclusion({ ...item });
        },
        /** Entfernt revealed-Klasse von allen Abdeckungen (Viewer-Reset). */
        resetRevealed() {
            overlays.querySelectorAll('.okl-occ.revealed').forEach((el) => el.classList.remove('revealed'));
        },
        /** Gibt alle Abdeckungen ohne DOM-Referenzen zurück. */
        getSerializedOcclusions() {
            return occlusions.map(serializeOcclusion);
        },
        /** Entfernt Lasso-Event-Listener beim Aufräumen. */
        destroy() {
            if (lassoHandlers) {
                lassoLayer.removeEventListener('pointerdown', lassoHandlers.pointerdown);
                lassoLayer.removeEventListener('pointermove', lassoHandlers.pointermove);
                lassoLayer.removeEventListener('pointerup', lassoHandlers.pointerup);
            }
        }
    };
}

/**
 *
 * │--- Funktion: buildStageMarkup ---│
 *
 * - Erzeugt das HTML-Markup für Bild-Stage, Lasso-Layer und Hinweiszeile.
 * - Wird von Editor und Viewer gemeinsam genutzt.
 *
 * @returns {string} HTML-String für Stage-Bereich
 */
function buildStageMarkup() {
    return `
        <div class="okl-stage-wrap">
            <div class="okl-stage">
                <img class="okl-stage__img" alt="">
                <svg class="okl-lasso-layer" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
                <div class="okl-overlays"></div>
            </div>
        </div>
        <p class="okl-hint"></p>`;
}

/**
 *
 * │--- Funktion: mountOklusionEditor ---│
 *
 * - Mountet den vollständigen Oklusion-Editor in den übergebenen Container.
 * - Unterstützt Upload per Klick, Drag & Drop und Dateiauswahl.
 * - Toolbar: Rechteck hinzufügen, Lasso zeichnen, Bild ändern.
 * - Gibt API zurück: getData(), loadData(), reset(), destroy().
 *
 * @param {HTMLElement} container — Ziel-Container im DOM
 * @param {{ maxImageBytes?: number, onError?: Function }} options — Größenlimit und Fehler-Callback
 * @returns {{ getData, loadData, reset, destroy }} Editor-API
 */
export function mountOklusionEditor(container, options = {}) {
    const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    let imageDataUrl = null;
    let currentObjectUrl = null;
    let controller = null;
    let lassoActive = false;

    // Editor-Markup: Upload-Zone, Toolbar und Stage
    container.innerHTML = `
        <div class="okl-editor">
            <div class="okl-upload" role="button" tabindex="0" aria-label="Bild hochladen">
                <input type="file" class="okl-file-input" accept="image/*" hidden>
                <p class="okl-upload-text">Bild hierher ziehen oder klicken</p>
                <p class="okl-upload-hint">PNG, JPG, GIF, WEBP (max. 2 MB)</p>
            </div>
            <div class="okl-editor-workspace" hidden>
                <div class="okl-toolbar">
                    <button type="button" class="okl-btn okl-btn--icon okl-add-rect" title="Rechteck hinzufügen" aria-label="Rechteck hinzufügen" hidden>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>
                    </button>
                    <button type="button" class="okl-btn okl-btn--icon okl-lasso-btn" title="Fläche zeichnen" aria-label="Fläche zeichnen" hidden>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4C7 4 3 7 3 11c0 3 2.4 5.3 6 6.2c0 1.4-.6 2.2-1.6 2.6c1.8.3 3.3-.4 3.9-1.9c.2 0 .5.1.7.1c5 0 9-3 9-7s-4-7-9-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.5" stroke-linejoin="round"/></svg>
                    </button>
                    <button type="button" class="okl-btn okl-change-img">Bild ändern</button>
                </div>
                ${buildStageMarkup()}
            </div>
        </div>`;

    const uploadZone = container.querySelector('.okl-upload');
    const fileInput = container.querySelector('.okl-file-input');
    const workspace = container.querySelector('.okl-editor-workspace');
    const addRectBtn = container.querySelector('.okl-add-rect');
    const lassoBtn = container.querySelector('.okl-lasso-btn');
    const changeImgBtn = container.querySelector('.okl-change-img');

    /** Zeigt oder versteckt Rechteck- und Lasso-Buttons in der Toolbar. */
    function setOcclusionToolsVisible(visible) {
        addRectBtn.hidden = !visible;
        lassoBtn.hidden = !visible;
        if (!visible) {
            lassoActive = false;
            lassoBtn.classList.remove('is-active');
            controller?.setMode('none');
        }
    }

    /** Wechselt von Upload-Ansicht zur Bearbeitungs-Workspace-Ansicht. */
    function showWorkspace() {
        uploadZone.hidden = true;
        workspace.hidden = false;
        if (!controller) {
            controller = createStageController(workspace, { editable: true });
        }
        setOcclusionToolsVisible(true);
    }

    /** Liest Datei ein, prüft Typ/Größe und lädt Bild in die Stage. */
    function loadFile(file) {
        if (!file || !ACCEPTED_IMAGE_TYPES.includes(file.type)) return false;
        if (file.size > maxImageBytes) {
            options.onError?.('Bild ist zu groß (max. 2 MB).');
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
            imageDataUrl = reader.result;
            showWorkspace();
            controller.clearOcclusions();
            controller.setMode('none');
            controller.loadImage(imageDataUrl);
        };
        reader.readAsDataURL(file);
        return true;
    }

    // Upload-Zone: Klick öffnet Dateiauswahl
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
    });
    // Drag-over: visuelles Feedback
    ['dragover', 'dragenter'].forEach((ev) => {
        uploadZone.addEventListener(ev, (e) => {
            e.preventDefault();
            uploadZone.classList.add('is-dragover');
        });
    });
    ['dragleave', 'dragend'].forEach((ev) => {
        uploadZone.addEventListener(ev, (e) => {
            if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('is-dragover');
        });
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('is-dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) loadFile(file);
    });

    // Zurück zur Upload-Ansicht, Bild und Abdeckungen verwerfen
    changeImgBtn.addEventListener('click', () => {
        workspace.hidden = true;
        uploadZone.hidden = false;
        fileInput.value = '';
        imageDataUrl = null;
        controller?.clearOcclusions();
        setOcclusionToolsVisible(false);
    });

    // Standard-Rechteck in der Bildmitte einfügen
    addRectBtn.addEventListener('click', () => {
        if (!controller) return;
        controller.setMode('none');
        lassoActive = false;
        lassoBtn.classList.remove('is-active');
        controller.createOcclusion({ type: 'rect', x: 35, y: 35, w: 30, h: 25 });
    });

    // Lasso-Modus ein-/ausschalten
    lassoBtn.addEventListener('click', () => {
        if (!controller) return;
        lassoActive = !lassoActive;
        controller.setMode(lassoActive ? 'lasso' : 'none');
        lassoBtn.classList.toggle('is-active', lassoActive);
    });

    return {
        /** Gibt Bild (Data-URL) und serialisierte Abdeckungen zurück; null ohne Bild. */
        getData() {
            if (!imageDataUrl) return null;
            const occlusions = controller?.getSerializedOcclusions() ?? [];
            return { image: imageDataUrl, occlusions };
        },
        /** Lädt bestehende Oklusion-Daten (Bearbeiten/Vorschlag). */
        loadData(data) {
            if (!data || !data.image) return;
            imageDataUrl = data.image;
            showWorkspace();
            controller?.clearOcclusions();
            controller?.setMode('none');
            controller?.loadImage(imageDataUrl);
            controller?.loadOcclusions(data.occlusions || []);
        },
        /** Setzt Editor auf Anfangszustand (Upload sichtbar). */
        reset() {
            if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
            imageDataUrl = null;
            fileInput.value = '';
            workspace.hidden = true;
            uploadZone.hidden = false;
            controller?.clearOcclusions();
            setOcclusionToolsVisible(false);
        },
        /** Controller zerstören und Container leeren. */
        destroy() {
            controller?.destroy();
            container.innerHTML = '';
        }
    };
}

/**
 *
 * │--- Funktion: mountOklusionViewer ---│
 *
 * - Mountet den schreibgeschützten Oklusion-Viewer zum Lernen/Vorschauen.
 * - Klick auf Abdeckungen deckt Bereiche auf (preview-Modus).
 * - Gibt resetRevealed() und destroy() für Lifecycle-Management zurück.
 *
 * @param {HTMLElement} container — Ziel-Container
 * @param {{ image: string, occlusions: Array }} card — Oklusion-Karte mit Bild und Abdeckungen
 * @param {Object} [options] — reserviert für zukünftige Optionen
 * @returns {{ resetRevealed, destroy }} Viewer-API
 */
export function mountOklusionViewer(container, card, options = {}) {
    container.innerHTML = `
        <div class="okl-viewer">
            ${buildStageMarkup()}
        </div>`;

    // Viewer: nicht editierbar, preview=true für Aufdecken per Klick
    const controller = createStageController(container.querySelector('.okl-viewer'), {
        editable: false,
        preview: true
    });
    controller.loadImage(card.image);
    controller.loadOcclusions(card.occlusions || []);

    return {
        /** Setzt alle aufgedeckten Bereiche zurück. */
        resetRevealed() {
            controller.resetRevealed();
        },
        /** Event-Listener entfernen und Container leeren. */
        destroy() {
            controller.destroy();
            container.innerHTML = '';
        }
    };
}
