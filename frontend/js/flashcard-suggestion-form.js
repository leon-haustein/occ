import { postChangeSuggestion } from './change-suggestions.js';
import { mountOklusionEditor } from './oklusion.js';
import { enhanceField, getFieldValue, fieldHasContent, resetField, parseFieldValue } from './rich-field.js';

function showFormError(formEl, message) {
    if (!formEl) return;
    const errEl = formEl.querySelector('.flashcard-form-error');
    if (!errEl) return;
    errEl.textContent = message;
    errEl.hidden = false;
}

function hideFormError(formEl) {
    if (!formEl) return;
    const errEl = formEl.querySelector('.flashcard-form-error');
    if (!errEl) return;
    errEl.textContent = '';
    errEl.hidden = true;
}

function hasDuplicateMnemoKeys(keys) {
    const seen = new Set();
    for (const k of keys) {
        const s = (k.schluessel || '').toLowerCase();
        if (!s) continue;
        if (seen.has(s)) return true;
        seen.add(s);
    }
    return false;
}

// Formular für Flashcard-Änderungsvorschläge (Typ-Modal, vorbefüllt, POST /change-suggestions)
export function setupFlashcardSuggestionForm(apiBase) {
    const typeModal = document.getElementById('flashcardTypeModal');
    const standardForm = document.getElementById('flashcardStandardForm');
    const standardQuestion = document.getElementById('standardQuestion');
    const standardAnswer = document.getElementById('standardAnswer');
    const standardCancelBtn = document.getElementById('standardCancelBtn');
    const standardSubmitBtn = document.getElementById('standardSubmitBtn');
    const prozessForm = document.getElementById('flashcardProzessForm');
    const prozessTitel = document.getElementById('prozessTitel');
    const prozessStepsContainer = document.getElementById('prozessStepsContainer');
    const prozessAddStepBtn = document.getElementById('prozessAddStepBtn');
    const prozessCancelBtn = document.getElementById('prozessCancelBtn');
    const prozessSubmitBtn = document.getElementById('prozessSubmitBtn');
    const mnemoForm = document.getElementById('flashcardMnemoForm');
    const mnemoTitel = document.getElementById('mnemoTitel');
    const mnemoKeysContainer = document.getElementById('mnemoKeysContainer');
    const mnemoAddKeyBtn = document.getElementById('mnemoAddKeyBtn');
    const mnemoCancelBtn = document.getElementById('mnemoCancelBtn');
    const mnemoSubmitBtn = document.getElementById('mnemoSubmitBtn');
    const oklusionForm = document.getElementById('flashcardOklusionForm');
    const oklusionTitel = document.getElementById('oklusionTitel');
    const oklusionEditorHost = document.getElementById('oklusionEditorHost');
    const oklusionCancelBtn = document.getElementById('oklusionCancelBtn');
    const oklusionSubmitBtn = document.getElementById('oklusionSubmitBtn');
    const typeForms = [standardForm, prozessForm, mnemoForm, oklusionForm].filter(Boolean);

    if (!typeModal || typeForms.length === 0) {
        return { openSuggestionForm: () => {} };
    }

    let oklusionEditor = null;
    let suggestionContext = null;

    const mnemoPlaceholders = [
        { key: 'z.B. Re', detail: 'Reich' },
        { key: 'z.B. St', detail: 'Stamm' },
        { key: 'z.B. Kl', detail: 'Klasse' },
        { key: 'z.B. Or', detail: 'Ordnung' },
        { key: 'z.B. Fa', detail: 'Familie' },
        { key: 'z.B. Ga', detail: 'Gattung' },
        { key: 'z.B. Sp', detail: 'Spezies' }
    ];

    function setSuggestSubmitLabels() {
        [standardSubmitBtn, prozessSubmitBtn, mnemoSubmitBtn, oklusionSubmitBtn].forEach((btn) => {
            if (btn) btn.textContent = 'Vorschlag senden';
        });
    }

    function resetSubmitLabels() {
        [standardSubmitBtn, prozessSubmitBtn, mnemoSubmitBtn, oklusionSubmitBtn].forEach((btn) => {
            if (btn) btn.textContent = 'Hinzufügen';
        });
    }

    function clearSuggestionContext() {
        suggestionContext = null;
        resetSubmitLabels();
    }

    async function submitSuggestionPayload(payload, closeFn, activeForm) {
        const onSubmitted = suggestionContext?.onSubmitted;
        const cardId = suggestionContext?.cardId;
        const authorName = suggestionContext?.authorName;
        try {
            const suggestion = await postChangeSuggestion(apiBase, 'karteikarte', cardId, authorName, payload);
            onSubmitted?.(suggestion);
            closeFn();
        } catch (_) {
            showFormError(activeForm, 'Der Vorschlag konnte nicht gespeichert werden. Bitte später erneut versuchen.');
        }
    }

    function getProzessBlockFields(block) {
        return {
            frage: block.querySelector('[data-field="frage"]'),
            antwort: block.querySelector('[data-field="antwort"]')
        };
    }

    function getMnemoBlockFields(block) {
        return {
            schluessel: block.querySelector('[data-field="schluessel"]'),
            inhalt: block.querySelector('[data-field="inhalt"]')
        };
    }

    function updateProzessRemoveButtons() {
        if (!prozessStepsContainer) return;
        const blocks = prozessStepsContainer.querySelectorAll('.flashcard-entry-block');
        const single = blocks.length <= 1;
        blocks.forEach((block) => {
            const btn = block.querySelector('.flashcard-entry-remove');
            if (btn) {
                btn.disabled = single;
                btn.hidden = single;
            }
        });
    }

    function updateMnemoRemoveButtons() {
        if (!mnemoKeysContainer) return;
        const blocks = mnemoKeysContainer.querySelectorAll('.flashcard-entry-block');
        const single = blocks.length <= 1;
        blocks.forEach((block) => {
            const btn = block.querySelector('.flashcard-entry-remove');
            if (btn) {
                btn.disabled = single;
                btn.hidden = single;
            }
        });
    }

    function renumberProzessSteps() {
        if (!prozessStepsContainer) return;
        prozessStepsContainer.querySelectorAll('.flashcard-entry-block').forEach((block, i) => {
            const num = i + 1;
            const label = block.querySelector('.flashcard-entry-header label');
            const removeBtn = block.querySelector('.flashcard-entry-remove');
            const { frage, antwort } = getProzessBlockFields(block);
            if (label) {
                label.textContent = `Schritt ${num}`;
                if (frage) label.htmlFor = frage.id = `prozessSchritt${num}`;
            }
            if (antwort) {
                antwort.id = `prozessSchritt${num}Detail`;
                antwort.setAttribute('aria-label', `Schritt ${num} Detail`);
            }
            if (removeBtn) removeBtn.setAttribute('aria-label', `Schritt ${num} entfernen`);
        });
    }

    function renumberMnemoKeys() {
        if (!mnemoKeysContainer) return;
        mnemoKeysContainer.querySelectorAll('.flashcard-entry-block').forEach((block, i) => {
            const num = i + 1;
            const label = block.querySelector('.flashcard-entry-header label');
            const removeBtn = block.querySelector('.flashcard-entry-remove');
            const { schluessel, inhalt } = getMnemoBlockFields(block);
            if (label) {
                label.textContent = `Schlüssel ${num}`;
                if (schluessel) label.htmlFor = schluessel.id = `mnemoSchluessel${num}`;
            }
            if (inhalt) {
                inhalt.id = `mnemoSchluessel${num}Detail`;
                inhalt.setAttribute('aria-label', `Schlüssel ${num} Detail`);
            }
            if (removeBtn) removeBtn.setAttribute('aria-label', `Schlüssel ${num} entfernen`);
        });
    }

    function createProzessStepBlock(stepNum) {
        const block = document.createElement('div');
        block.className = 'flashcard-entry-block';
        block.dataset.entryType = 'prozess';

        const header = document.createElement('div');
        header.className = 'flashcard-entry-header';

        const label = document.createElement('label');
        label.htmlFor = `prozessSchritt${stepNum}`;
        label.textContent = `Schritt ${stepNum}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'flashcard-entry-remove';
        removeBtn.title = 'Schritt entfernen';
        removeBtn.setAttribute('aria-label', `Schritt ${stepNum} entfernen`);
        removeBtn.textContent = '×';
        removeBtn.onclick = () => removeProzessStepBlock(block);

        header.appendChild(label);
        header.appendChild(removeBtn);

        const frage = document.createElement('textarea');
        frage.id = `prozessSchritt${stepNum}`;
        frage.dataset.field = 'frage';
        frage.placeholder = '…';
        frage.rows = 3;

        const antwort = document.createElement('textarea');
        antwort.id = `prozessSchritt${stepNum}Detail`;
        antwort.dataset.field = 'antwort';
        antwort.placeholder = '…';
        antwort.rows = 3;
        antwort.setAttribute('aria-label', `Schritt ${stepNum} Detail`);

        block.appendChild(header);
        block.appendChild(frage);
        block.appendChild(antwort);
        prozessStepsContainer.appendChild(block);
        enhanceField(frage);
        enhanceField(antwort);
        updateProzessRemoveButtons();
        return block;
    }

    function removeProzessStepBlock(block) {
        if (!prozessStepsContainer) return;
        if (prozessStepsContainer.querySelectorAll('.flashcard-entry-block').length <= 1) return;
        block.remove();
        renumberProzessSteps();
        updateProzessRemoveButtons();
    }

    function resetProzessSteps() {
        if (!prozessStepsContainer) return;
        prozessStepsContainer.innerHTML = '';
        createProzessStepBlock(1);
    }

    function collectProzessStepsFromDom() {
        if (!prozessStepsContainer) return [];
        return Array.from(prozessStepsContainer.querySelectorAll('.flashcard-entry-block')).map((block) => {
            const { frage, antwort } = getProzessBlockFields(block);
            return {
                frage: frage ? getFieldValue(frage) : '',
                antwort: antwort ? getFieldValue(antwort) : ''
            };
        });
    }

    function createMnemoKeyBlock(keyNum, ph) {
        const placeholders = ph || { key: '…', detail: '…' };
        const block = document.createElement('div');
        block.className = 'flashcard-entry-block';
        block.dataset.entryType = 'mnemo';

        const header = document.createElement('div');
        header.className = 'flashcard-entry-header';

        const label = document.createElement('label');
        label.htmlFor = `mnemoSchluessel${keyNum}`;
        label.textContent = `Schlüssel ${keyNum}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'flashcard-entry-remove';
        removeBtn.title = 'Schlüssel entfernen';
        removeBtn.setAttribute('aria-label', `Schlüssel ${keyNum} entfernen`);
        removeBtn.textContent = '×';
        removeBtn.onclick = () => removeMnemoKeyBlock(block);

        header.appendChild(label);
        header.appendChild(removeBtn);

        const schluessel = document.createElement('input');
        schluessel.type = 'text';
        schluessel.id = `mnemoSchluessel${keyNum}`;
        schluessel.dataset.field = 'schluessel';
        schluessel.placeholder = placeholders.key;
        schluessel.maxLength = 500;

        const inhalt = document.createElement('input');
        inhalt.type = 'text';
        inhalt.id = `mnemoSchluessel${keyNum}Detail`;
        inhalt.dataset.field = 'inhalt';
        inhalt.placeholder = placeholders.detail;
        inhalt.maxLength = 500;
        inhalt.setAttribute('aria-label', `Schlüssel ${keyNum} Detail`);

        block.appendChild(header);
        block.appendChild(schluessel);
        block.appendChild(inhalt);
        mnemoKeysContainer.appendChild(block);
        updateMnemoRemoveButtons();
        return block;
    }

    function removeMnemoKeyBlock(block) {
        if (!mnemoKeysContainer) return;
        if (mnemoKeysContainer.querySelectorAll('.flashcard-entry-block').length <= 1) return;
        block.remove();
        renumberMnemoKeys();
        updateMnemoRemoveButtons();
    }

    function resetMnemoKeys() {
        if (!mnemoKeysContainer) return;
        mnemoKeysContainer.innerHTML = '';
        createMnemoKeyBlock(1, mnemoPlaceholders[0]);
    }

    function collectMnemoKeysFromDom() {
        if (!mnemoKeysContainer) return [];
        return Array.from(mnemoKeysContainer.querySelectorAll('.flashcard-entry-block')).map((block) => {
            const { schluessel, inhalt } = getMnemoBlockFields(block);
            return {
                schluessel: schluessel ? schluessel.value.trim() : '',
                inhalt: inhalt ? inhalt.value.trim() : ''
            };
        });
    }

    function initProzessStepBlocks() {
        if (!prozessStepsContainer) return;
        prozessStepsContainer.querySelectorAll('.flashcard-entry-block').forEach((block) => {
            const btn = block.querySelector('.flashcard-entry-remove');
            if (btn) btn.onclick = () => removeProzessStepBlock(block);
            const { frage, antwort } = getProzessBlockFields(block);
            if (frage) enhanceField(frage);
            if (antwort) enhanceField(antwort);
        });
        updateProzessRemoveButtons();
    }

    function initMnemoKeyBlocks() {
        if (!mnemoKeysContainer) return;
        mnemoKeysContainer.querySelectorAll('.flashcard-entry-block').forEach((block) => {
            const btn = block.querySelector('.flashcard-entry-remove');
            if (btn) btn.onclick = () => removeMnemoKeyBlock(block);
        });
        updateMnemoRemoveButtons();
    }

    function addProzessStepField() {
        const count = prozessStepsContainer.querySelectorAll('.flashcard-entry-block').length;
        createProzessStepBlock(count + 1);
    }

    function addMnemoKeyField(keyNum, ph) {
        createMnemoKeyBlock(keyNum, ph);
    }

    function prefillStandardForm(card) {
        parseFieldValue(standardQuestion, card.question || '');
        parseFieldValue(standardAnswer, card.answer || '');
    }

    function prefillProzessForm(card) {
        if (prozessTitel) prozessTitel.value = card.question || '';
        if (!prozessStepsContainer) return;
        prozessStepsContainer.innerHTML = '';
        const steps = card.steps || [];
        if (steps.length === 0) {
            createProzessStepBlock(1);
            return;
        }
        steps.forEach((step, i) => {
            createProzessStepBlock(i + 1);
            const block = prozessStepsContainer.lastElementChild;
            const { frage, antwort } = getProzessBlockFields(block);
            if (frage) parseFieldValue(frage, step.frage || '');
            if (antwort) parseFieldValue(antwort, step.antwort || '');
        });
    }

    function prefillMnemoForm(card) {
        if (mnemoTitel) mnemoTitel.value = card.question || '';
        if (!mnemoKeysContainer) return;
        mnemoKeysContainer.innerHTML = '';
        const keys = card.keys || [];
        if (keys.length === 0) {
            createMnemoKeyBlock(1, mnemoPlaceholders[0]);
            return;
        }
        keys.forEach((key, i) => {
            createMnemoKeyBlock(i + 1, mnemoPlaceholders[i] || { key: '…', detail: '…' });
            const block = mnemoKeysContainer.lastElementChild;
            const { schluessel, inhalt } = getMnemoBlockFields(block);
            if (schluessel) schluessel.value = key.schluessel || '';
            if (inhalt) inhalt.value = key.inhalt || '';
        });
    }

    function ensureOklusionEditor() {
        if (!oklusionEditor && oklusionEditorHost) {
            oklusionEditor = mountOklusionEditor(oklusionEditorHost, {
                onError: (msg) => showFormError(oklusionForm, msg)
            });
        }
        return oklusionEditor;
    }

    function prefillOklusionForm(card) {
        if (oklusionTitel) {
            oklusionTitel.value = card.question && card.question !== 'Oklusion-Karte' ? card.question : '';
        }
        ensureOklusionEditor()?.loadData({
            image: card.image,
            occlusions: card.occlusions || []
        });
    }

    function ensureOverlayOnBody(el) {
        if (el && el.parentElement !== document.body) {
            document.body.appendChild(el);
        }
    }

    function closeTypeModal() {
        typeModal.classList.remove('is-open');
        typeModal.setAttribute('aria-hidden', 'true');
        typeForms.forEach((f) => f.classList.remove('is-open'));
    }

    function openTypeForm(activeForm) {
        closeTypeModal();
        ensureOverlayOnBody(typeModal);
        activeForm.classList.add('is-open');
        typeModal.classList.add('is-open');
        typeModal.setAttribute('aria-hidden', 'false');
    }

    function closeStandardForm() {
        hideFormError(standardForm);
        resetField(standardQuestion);
        resetField(standardAnswer);
        clearSuggestionContext();
        closeTypeModal();
    }

    function closeProzessForm() {
        hideFormError(prozessForm);
        if (prozessTitel) prozessTitel.value = '';
        resetProzessSteps();
        clearSuggestionContext();
        closeTypeModal();
    }

    function closeMnemoForm() {
        hideFormError(mnemoForm);
        if (mnemoTitel) mnemoTitel.value = '';
        resetMnemoKeys();
        clearSuggestionContext();
        closeTypeModal();
    }

    function closeOklusionForm() {
        hideFormError(oklusionForm);
        if (oklusionTitel) oklusionTitel.value = '';
        oklusionEditor?.reset();
        clearSuggestionContext();
        closeTypeModal();
    }

    function openSuggestionForm(card, authorName, onSubmitted) {
        suggestionContext = { cardId: card.id, authorName, onSubmitted };
        setSuggestSubmitLabels();
        const typ = card.typ;
        if (typ === 'Standard') {
            hideFormError(standardForm);
            prefillStandardForm(card);
            openTypeForm(standardForm);
        } else if (typ === 'Prozess') {
            hideFormError(prozessForm);
            prefillProzessForm(card);
            openTypeForm(prozessForm);
        } else if (typ === 'Mnemo') {
            hideFormError(mnemoForm);
            prefillMnemoForm(card);
            openTypeForm(mnemoForm);
        } else if (typ === 'Oklusion') {
            hideFormError(oklusionForm);
            prefillOklusionForm(card);
            openTypeForm(oklusionForm);
        }
    }

    enhanceField(standardQuestion);
    enhanceField(standardAnswer);
    initProzessStepBlocks();
    initMnemoKeyBlocks();

    if (standardCancelBtn) standardCancelBtn.onclick = closeStandardForm;
    if (standardSubmitBtn) {
        standardSubmitBtn.onclick = async () => {
            hideFormError(standardForm);
            if (!fieldHasContent(standardQuestion) || !fieldHasContent(standardAnswer)) {
                showFormError(standardForm, 'Bitte Frage und Antwort ausfüllen.');
                return;
            }
            await submitSuggestionPayload(
                { style: 'standard', question: getFieldValue(standardQuestion), answer: getFieldValue(standardAnswer) },
                closeStandardForm,
                standardForm
            );
        };
    }

    if (prozessCancelBtn) prozessCancelBtn.onclick = closeProzessForm;
    if (prozessAddStepBtn) {
        prozessAddStepBtn.onclick = () => {
            addProzessStepField();
        };
    }
    if (prozessSubmitBtn) {
        prozessSubmitBtn.onclick = async () => {
            hideFormError(prozessForm);
            const titel = prozessTitel ? prozessTitel.value.trim() : '';
            if (!titel) {
                showFormError(prozessForm, 'Bitte einen Titel eingeben.');
                return;
            }
            const steps = collectProzessStepsFromDom().filter((s) => s.frage || s.antwort);
            if (steps.length === 0) {
                showFormError(prozessForm, 'Bitte mindestens einen Prozessschritt ausfüllen.');
                return;
            }
            await submitSuggestionPayload({ style: 'prozess', titel, steps }, closeProzessForm, prozessForm);
        };
    }

    if (mnemoCancelBtn) mnemoCancelBtn.onclick = closeMnemoForm;
    if (mnemoAddKeyBtn) {
        mnemoAddKeyBtn.onclick = () => {
            const count = mnemoKeysContainer.querySelectorAll('.flashcard-entry-block').length;
            addMnemoKeyField(count + 1, mnemoPlaceholders[count] || { key: '…', detail: '…' });
        };
    }
    if (mnemoSubmitBtn) {
        mnemoSubmitBtn.onclick = async () => {
            hideFormError(mnemoForm);
            const title = mnemoTitel ? mnemoTitel.value.trim() : '';
            if (!title) {
                showFormError(mnemoForm, 'Bitte einen Titel eingeben.');
                return;
            }
            const filledKeys = collectMnemoKeysFromDom().filter((k) => k.schluessel || k.inhalt);
            if (filledKeys.length === 0) {
                showFormError(mnemoForm, 'Bitte mindestens einen Schlüssel mit Inhalt ausfüllen.');
                return;
            }
            if (hasDuplicateMnemoKeys(filledKeys)) {
                showFormError(mnemoForm, 'Jeder Schlüssel darf nur einmal vorkommen. Bitte kürzere oder unterschiedliche Schlüssel verwenden.');
                return;
            }
            await submitSuggestionPayload({ style: 'mnemo', title, keys: filledKeys }, closeMnemoForm, mnemoForm);
        };
    }

    if (oklusionCancelBtn) oklusionCancelBtn.onclick = closeOklusionForm;
    if (oklusionSubmitBtn) {
        oklusionSubmitBtn.onclick = async () => {
            hideFormError(oklusionForm);
            const editor = ensureOklusionEditor();
            const data = editor?.getData();
            if (!data || !data.image) {
                showFormError(oklusionForm, 'Bitte ein Bild hochladen.');
                return;
            }
            if (!data.occlusions || data.occlusions.length === 0) {
                showFormError(oklusionForm, 'Bitte mindestens eine Abdeckung hinzufügen.');
                return;
            }
            const title = oklusionTitel?.value.trim() || '';
            if (!title) {
                showFormError(oklusionForm, 'Bitte einen Titel eingeben.');
                return;
            }
            await submitSuggestionPayload({
                style: 'oklusion',
                title,
                image: data.image,
                occlusions: data.occlusions
            }, closeOklusionForm, oklusionForm);
        };
    }

    return { openSuggestionForm };
}
