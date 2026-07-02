const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const HIGHLIGHT_COLORS = [
    { name: 'orange', title: 'Orange markieren' },
    { name: 'yellow', title: 'Gelb markieren' },
    { name: 'green', title: 'Grün markieren' }
];

function showFieldError(textarea, message) {
    const ownerForm = textarea.closest('.flashcard-type-form');
    const errEl = ownerForm?.querySelector('.flashcard-form-error');
    if (!errEl) return;
    errEl.textContent = message;
    errEl.hidden = false;
}

function surroundSelection(textarea, before, after) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);
    const replacement = before + selected + after;
    textarea.value = value.slice(0, start) + replacement + value.slice(end);
    const cursor = selected ? start + replacement.length : start + before.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
}

function renderPreviewStrip(textarea) {
    const strip = textarea._previewStrip;
    if (!strip) return;
    strip.innerHTML = '';
    (textarea._mdImages || []).forEach((dataUrl, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'image-preview-thumb';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Bildvorschau';
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

function addImageFiles(textarea, files) {
    Array.from(files).forEach((file) => {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return;
        if (file.size > MAX_IMAGE_BYTES) {
            showFieldError(textarea, 'Bild ist zu groß (max. 2 MB): ' + file.name);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            textarea._mdImages.push(reader.result);
            renderPreviewStrip(textarea);
        };
        reader.readAsDataURL(file);
    });
}

export function enhanceField(textarea) {
    if (!textarea || textarea._enhanced) return;
    textarea._enhanced = true;
    textarea._mdImages = [];

    const wrapper = document.createElement('div');
    wrapper.className = 'rich-field';
    textarea.parentNode.insertBefore(wrapper, textarea);

    const toolbar = document.createElement('div');
    toolbar.className = 'rich-toolbar';
    const mkBtn = (label, title, handler, extraClass) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rich-toolbar-btn' + (extraClass ? ' ' + extraClass : '');
        b.title = title;
        b.innerHTML = label;
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = handler;
        return b;
    };
    toolbar.appendChild(mkBtn('<strong>F</strong>', 'Fett', () => surroundSelection(textarea, '**', '**')));
    toolbar.appendChild(mkBtn('<em>K</em>', 'Kursiv', () => surroundSelection(textarea, '*', '*')));
    toolbar.appendChild(mkBtn('<u>U</u>', 'Unterstrichen', () => surroundSelection(textarea, '__', '__')));

    for (const { name, title } of HIGHLIGHT_COLORS) {
        toolbar.appendChild(mkBtn(
            '',
            title,
            () => surroundSelection(textarea, '[' + name + ']', '[/' + name + ']'),
            'rich-toolbar-btn--hl rich-toolbar-btn--hl-' + name
        ));
    }

    toolbar.appendChild(mkBtn('LaTeX', 'Formel (inline)', () => surroundSelection(textarea, '$', '$')));

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

    const strip = document.createElement('div');
    strip.className = 'image-preview-strip';
    wrapper.appendChild(strip);
    textarea._previewStrip = strip;

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

export function getFieldValue(textarea) {
    const text = textarea.value.trim();
    const imgs = (textarea._mdImages || []).map((d) => '![](' + d + ')').join('\n\n');
    return [text, imgs].filter(Boolean).join('\n\n');
}

export function fieldHasContent(textarea) {
    return textarea.value.trim() !== '' || (textarea._mdImages && textarea._mdImages.length > 0);
}

export function resetField(textarea) {
    textarea.value = '';
    textarea._mdImages = [];
    if (textarea._previewStrip) textarea._previewStrip.innerHTML = '';
}

export function parseFieldValue(textarea, value) {
    resetField(textarea);
    if (!value) return;
    const images = [];
    const imgRe = /!\[\]\((data:image\/[^)]+)\)/g;
    let match;
    while ((match = imgRe.exec(value)) !== null) {
        images.push(match[1]);
    }
    const text = value.replace(/!\[\]\((data:image\/[^)]+)\)\n?\n?/g, '').trim();
    textarea.value = text;
    textarea._mdImages = images;
    renderPreviewStrip(textarea);
}
