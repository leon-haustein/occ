const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function serializeOcclusion(data) {
    const out = { type: data.type, x: data.x, y: data.y, w: data.w, h: data.h };
    if (data.type === 'lasso' && data.points) out.points = data.points.map((p) => ({ x: p.x, y: p.y }));
    return out;
}

function positionEl(el, data) {
    el.style.left = data.x + '%';
    el.style.top = data.y + '%';
    el.style.width = data.w + '%';
    el.style.height = data.h + '%';
}

function buildOcclusionEl(data, { editable, onRemove, onPointerDown, onResize }) {
    const el = document.createElement('div');
    el.className = 'okl-occ type-' + data.type;
    positionEl(el, data);

    if (editable) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'okl-occ-delete';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Abdeckung löschen');
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            onRemove?.();
        });
        el.appendChild(del);

        if (data.type === 'rect') {
            ['nw', 'sw', 'se'].forEach((corner) => {
                const handle = document.createElement('div');
                handle.className = 'okl-handle ' + corner;
                handle.addEventListener('pointerdown', (e) => onResize?.(e, corner));
                el.appendChild(handle);
            });
        }
    }

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

    el.addEventListener('pointerdown', (e) => onPointerDown?.(e, el));
    return el;
}

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

    function setHint(text) {
        if (hint) hint.textContent = text || '';
    }

    function setMode(newMode) {
        mode = newMode;
        stage.classList.toggle('is-lasso', mode === 'lasso');
        if (mode === 'lasso') {
            setHint('Maustaste gedrückt halten und eine Fläche über das Bild zeichnen.');
        } else if (!preview) {
            setHint('');
        }
    }

    function clearOcclusions() {
        occlusions.length = 0;
        overlays.innerHTML = '';
    }

    function removeOcclusion(id) {
        const idx = occlusions.findIndex((o) => o.id === id);
        if (idx === -1) return;
        const [removed] = occlusions.splice(idx, 1);
        removed.el?.remove();
    }

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

    function onOccPointerDown(e, el) {
        const data = occlusions.find((o) => o.el === el);
        if (!data) return;
        if (mode === 'lasso') return;
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

        function move(ev) {
            const dx = (ev.clientX - startX) / rect.width * 100;
            const dy = (ev.clientY - startY) / rect.height * 100;
            data.x = clamp(origX + dx, 0, 100 - data.w);
            data.y = clamp(origY + dy, 0, 100 - data.h);
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

    function startResize(e, data, el, corner) {
        e.preventDefault();
        e.stopPropagation();
        const rect = stage.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const o = { x: data.x, y: data.y, w: data.w, h: data.h };
        const MIN = 4;
        el.setPointerCapture(e.pointerId);

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

    function addDrawPoint(e) {
        const rect = stage.getBoundingClientRect();
        const x = clamp((e.clientX - rect.left) / rect.width * 100, 0, 100);
        const y = clamp((e.clientY - rect.top) / rect.height * 100, 0, 100);
        const last = drawPoints[drawPoints.length - 1];
        if (!last || Math.hypot(last.x - x, last.y - y) > 0.5) drawPoints.push({ x, y });
    }

    function updateLive() {
        if (liveEl) liveEl.setAttribute('points', drawPoints.map((p) => p.x + ',' + p.y).join(' '));
    }

    function finishLasso() {
        if (liveEl) {
            liveEl.remove();
            liveEl = null;
        }
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
        const points = drawPoints.map((p) => ({
            x: (p.x - minX) / w * 100,
            y: (p.y - minY) / h * 100
        }));
        createOcclusion({ type: 'lasso', x: minX, y: minY, w, h, points });
        drawPoints = [];
    }

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
        loadImage(src) {
            stageImg.src = src;
        },
        loadOcclusions(items) {
            clearOcclusions();
            for (const item of items || []) createOcclusion({ ...item });
        },
        resetRevealed() {
            overlays.querySelectorAll('.okl-occ.revealed').forEach((el) => el.classList.remove('revealed'));
        },
        getSerializedOcclusions() {
            return occlusions.map(serializeOcclusion);
        },
        destroy() {
            if (lassoHandlers) {
                lassoLayer.removeEventListener('pointerdown', lassoHandlers.pointerdown);
                lassoLayer.removeEventListener('pointermove', lassoHandlers.pointermove);
                lassoLayer.removeEventListener('pointerup', lassoHandlers.pointerup);
            }
        }
    };
}

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

export function mountOklusionEditor(container, options = {}) {
    const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    let imageDataUrl = null;
    let currentObjectUrl = null;
    let controller = null;
    let lassoActive = false;

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

    function setOcclusionToolsVisible(visible) {
        addRectBtn.hidden = !visible;
        lassoBtn.hidden = !visible;
        if (!visible) {
            lassoActive = false;
            lassoBtn.classList.remove('is-active');
            controller?.setMode('none');
        }
    }

    function showWorkspace() {
        uploadZone.hidden = true;
        workspace.hidden = false;
        if (!controller) {
            controller = createStageController(workspace, { editable: true });
        }
        setOcclusionToolsVisible(true);
    }

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

    changeImgBtn.addEventListener('click', () => {
        workspace.hidden = true;
        uploadZone.hidden = false;
        fileInput.value = '';
        imageDataUrl = null;
        controller?.clearOcclusions();
        setOcclusionToolsVisible(false);
    });

    addRectBtn.addEventListener('click', () => {
        if (!controller) return;
        controller.setMode('none');
        lassoActive = false;
        lassoBtn.classList.remove('is-active');
        controller.createOcclusion({ type: 'rect', x: 35, y: 35, w: 30, h: 25 });
    });

    lassoBtn.addEventListener('click', () => {
        if (!controller) return;
        lassoActive = !lassoActive;
        controller.setMode(lassoActive ? 'lasso' : 'none');
        lassoBtn.classList.toggle('is-active', lassoActive);
    });

    return {
        getData() {
            if (!imageDataUrl) return null;
            const occlusions = controller?.getSerializedOcclusions() ?? [];
            return { image: imageDataUrl, occlusions };
        },
        loadData(data) {
            if (!data || !data.image) return;
            imageDataUrl = data.image;
            showWorkspace();
            controller?.clearOcclusions();
            controller?.setMode('none');
            controller?.loadImage(imageDataUrl);
            controller?.loadOcclusions(data.occlusions || []);
        },
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
        destroy() {
            controller?.destroy();
            container.innerHTML = '';
        }
    };
}

export function mountOklusionViewer(container, card, options = {}) {
    container.innerHTML = `
        <div class="okl-viewer">
            ${buildStageMarkup()}
        </div>`;

    const controller = createStageController(container.querySelector('.okl-viewer'), {
        editable: false,
        preview: true
    });
    controller.loadImage(card.image);
    controller.loadOcclusions(card.occlusions || []);

    return {
        resetRevealed() {
            controller.resetRevealed();
        },
        destroy() {
            controller.destroy();
            container.innerHTML = '';
        }
    };
}
