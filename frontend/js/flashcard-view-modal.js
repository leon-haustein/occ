import { mountOklusionViewer } from './oklusion.js';
import { renderMarkdown } from './markdown.js';

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

let modalCard = null;
let modalShowingAnswer = false;
let modalProzessStepIndex = 0;
let modalMnemoRevealed = new Set();
let modalOklusionViewer = null;

let kvContext = null;
let stackedContext = null;
let activeContext = null;
let escapeHandlerBound = false;

const STYLE_TO_TYP = {
    standard: 'Standard',
    prozess: 'Prozess',
    mnemo: 'Mnemo',
    oklusion: 'Oklusion'
};

export function suggestionPayloadToCard(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const style = String(payload.style || '').trim().toLowerCase();
    if (style === 'standard') {
        return {
            typ: 'Standard',
            question: payload.question,
            answer: payload.answer
        };
    }
    if (style === 'prozess') {
        return {
            typ: 'Prozess',
            question: payload.titel,
            steps: payload.steps || []
        };
    }
    if (style === 'mnemo') {
        return {
            typ: 'Mnemo',
            question: payload.title,
            keys: payload.keys || []
        };
    }
    if (style === 'oklusion') {
        return {
            typ: 'Oklusion',
            question: payload.title || 'Oklusion-Karte',
            image: payload.image,
            occlusions: payload.occlusions || []
        };
    }
    const typ = STYLE_TO_TYP[style];
    if (!typ) return null;
    return { typ, ...payload };
}

function renderProzessHtml(card, stepIndex) {
    const titel = card.question || '';
    const steps = card.steps || [];
    const n = steps.length;
    if (n === 0) {
        return '<div class="prozess-timeline"><div class="prozess-header"><span class="prozess-title">' + escapeHtml(titel) + '</span></div></div>';
    }
    let html = '<div class="prozess-timeline">';
    html += '<div class="prozess-step-max" aria-label="Maximale Schrittanzahl: ' + n + '">';
    html += '<span class="prozess-step-max-num">' + n + '</span>';
    html += '<span class="prozess-step-max-label">Schritte</span></div>';
    html += '<div class="prozess-header"><span class="prozess-title">' + escapeHtml(titel) + '</span></div>';
    html += '<div class="prozess-steps">';
    for (let i = 0; i < n; i++) {
        if (i > stepIndex) break;
        const state = i < stepIndex ? 'is-done' : (i === stepIndex ? 'is-current' : '');
        html += '<div class="prozess-step ' + state + '">';
        html += '<div class="prozess-rail"><span class="prozess-dot"></span></div>';
        html += '<div class="prozess-body">';
        html += '<div class="prozess-q">';
        html += '<span class="prozess-q-num">' + (i + 1) + '.</span>';
        html += '<div class="prozess-q-text">' + renderMarkdown(steps[i].frage) + '</div>';
        html += '</div>';
        if (i < stepIndex) {
            html += '<div class="prozess-a">' + renderMarkdown(steps[i].antwort) + '</div>';
        }
        html += '</div></div>';
    }
    html += '</div></div>';
    return html;
}

function renderMnemoHtml(card) {
    const keys = card.keys || [];
    const n = keys.length;
    const allRevealed = modalMnemoRevealed.size === n;
    let html = '<div class="mnemo-chips">';
    html += '<div class="mnemo-header"><span class="mnemo-title">' + escapeHtml(card.question || '') + '</span></div>';
    html += '<div class="mnemo-keys-row">';
    for (let i = 0; i < n; i++) {
        const revealedClass = 'mnemo-key-btn' + (modalMnemoRevealed.has(i) ? ' revealed' : '');
        html += '<button type="button" class="' + revealedClass + '" data-key-index="' + i + '">' + escapeHtml(keys[i].schluessel) + '</button>';
    }
    html += '</div>';
    html += '<div class="mnemo-toolbar"><button type="button" class="mnemo-reveal-all-btn">' + (allRevealed ? 'Alle verstecken' : 'Alle aufdecken') + '</button></div>';
    html += '<div class="mnemo-inhalte">';
    const sortedRevealed = Array.from(modalMnemoRevealed).sort((a, b) => a - b);
    for (const i of sortedRevealed) {
        html += '<div class="mnemo-inhalt-block"><span class="mnemo-inhalt-key">' + escapeHtml(keys[i].schluessel) + ' →</span>';
        html += escapeHtml(keys[i].inhalt) + '</div>';
    }
    html += '</div></div>';
    return html;
}

function renderStandardHtml(card) {
    const q = renderMarkdown(card.question);
    const a = renderMarkdown(card.answer);
    return `
        <div class="standard-indicator" aria-hidden="true">
            <span class="standard-dot standard-dot--q"></span>
            <span class="standard-dot standard-dot--a"></span>
        </div>
        <div class="standard-side standard-side--question"><div class="standard-side-text" lang="de">${q}</div></div>
        <div class="standard-side standard-side--answer"><div class="standard-side-text" lang="de">${a}</div></div>`;
}

function attachMnemoHandlers(card, content) {
    const keys = card.keys || [];
    content.querySelectorAll('.mnemo-key-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-key-index'), 10);
            if (modalMnemoRevealed.has(idx)) {
                modalMnemoRevealed.delete(idx);
            } else {
                modalMnemoRevealed.add(idx);
            }
            renderModalCard();
        });
    });
    const revealAllBtn = content.querySelector('.mnemo-reveal-all-btn');
    if (revealAllBtn) {
        revealAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (modalMnemoRevealed.size === keys.length) {
                modalMnemoRevealed.clear();
            } else {
                for (let i = 0; i < keys.length; i++) {
                    modalMnemoRevealed.add(i);
                }
            }
            renderModalCard();
        });
    }
}

function renderModalCard() {
    if (!activeContext || !modalCard) return;
    const { flashcard, content } = activeContext;
    const isProzess = modalCard.typ === 'Prozess' && modalCard.steps && modalCard.steps.length > 0;
    const isMnemo = modalCard.typ === 'Mnemo' && modalCard.keys && modalCard.keys.length > 0;
    const isOklusion = modalCard.typ === 'Oklusion' && modalCard.image && modalCard.occlusions?.length > 0;
    modalOklusionViewer?.destroy();
    modalOklusionViewer = null;
    if (isProzess) {
        flashcard.classList.add('prozess-flashcard');
        flashcard.classList.remove('mnemo-flashcard', 'showing-answer', 'standard-flashcard', 'oklusion-flashcard');
        content.innerHTML = renderProzessHtml(modalCard, modalProzessStepIndex);
    } else if (isMnemo) {
        flashcard.classList.add('mnemo-flashcard');
        flashcard.classList.remove('prozess-flashcard', 'showing-answer', 'standard-flashcard', 'oklusion-flashcard');
        content.innerHTML = renderMnemoHtml(modalCard);
        attachMnemoHandlers(modalCard, content);
    } else if (isOklusion) {
        flashcard.classList.add('oklusion-flashcard');
        flashcard.classList.remove('prozess-flashcard', 'mnemo-flashcard', 'showing-answer', 'standard-flashcard');
        content.innerHTML = '';
        modalOklusionViewer = mountOklusionViewer(content, modalCard);
    } else {
        flashcard.classList.remove('prozess-flashcard', 'mnemo-flashcard', 'oklusion-flashcard');
        flashcard.classList.add('standard-flashcard');
        content.innerHTML = renderStandardHtml(modalCard);
        flashcard.classList.toggle('showing-answer', modalShowingAnswer);
    }
}

function resetModalState() {
    modalShowingAnswer = false;
    modalProzessStepIndex = 0;
    modalMnemoRevealed.clear();
    modalOklusionViewer?.resetRevealed?.();
}

function toggleModalCard() {
    if (!modalCard || !activeContext) return;
    const isMnemo = modalCard.typ === 'Mnemo' && modalCard.keys && modalCard.keys.length > 0;
    if (isMnemo) return;
    const isOklusion = modalCard.typ === 'Oklusion' && modalCard.image && modalCard.occlusions?.length > 0;
    if (isOklusion) return;
    const isProzess = modalCard.typ === 'Prozess' && modalCard.steps && modalCard.steps.length > 0;
    if (isProzess) {
        const n = modalCard.steps.length;
        modalProzessStepIndex += 1;
        if (modalProzessStepIndex > n) modalProzessStepIndex = 0;
        renderModalCard();
    } else {
        modalShowingAnswer = !modalShowingAnswer;
        activeContext.flashcard.classList.toggle('showing-answer', modalShowingAnswer);
    }
}

function bindContextEvents(context) {
    if (context.bound) return;
    context.bound = true;

    context.closeBtn.addEventListener('click', () => {
        if (activeContext === context) closeFlashcardViewModal();
    });
    context.modal.addEventListener('click', (e) => {
        if (e.target === context.modal && activeContext === context) closeFlashcardViewModal();
    });
    context.flashcard.addEventListener('click', (e) => {
        if (activeContext !== context) return;
        if (e.target.closest('.okl-occ')) return;
        toggleModalCard();
    });
}

function bindEscapeHandler() {
    if (escapeHandlerBound) return;
    escapeHandlerBound = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (stackedContext?.modal.classList.contains('is-open')) {
            e.stopPropagation();
            closeFlashcardViewModal();
            return;
        }
        if (kvContext?.modal.classList.contains('is-open')) {
            closeFlashcardViewModal();
        }
    });
}

function createStackedModalElements() {
    const modal = document.createElement('div');
    modal.id = 'flashcardViewModal';
    modal.className = 'kv-card-modal kv-card-modal--stacked';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="kv-modal-card-wrap" role="dialog" aria-modal="true" aria-label="Karteikarte">
            <button type="button" class="close-btn" title="Zurück" aria-label="Zurück">&#10005;</button>
            <div class="flashcard" id="flashcardViewFlashcard">
                <div class="flashcard-content" id="flashcardViewContent"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return {
        modal,
        flashcard: modal.querySelector('#flashcardViewFlashcard'),
        content: modal.querySelector('#flashcardViewContent'),
        closeBtn: modal.querySelector('.close-btn'),
        stacked: true,
        bound: false
    };
}

export function initFlashcardViewModal({ modal, flashcard, content, closeBtn }) {
    if (!modal || !flashcard || !content || !closeBtn) return;
    kvContext = { modal, flashcard, content, closeBtn, stacked: false, bound: false };
    bindContextEvents(kvContext);
    bindEscapeHandler();
}

export function ensureStackedFlashcardViewModal() {
    if (!stackedContext) {
        stackedContext = createStackedModalElements();
        bindContextEvents(stackedContext);
        bindEscapeHandler();
    }
    return stackedContext;
}

export function isStackedFlashcardViewModalOpen() {
    return Boolean(stackedContext?.modal.classList.contains('is-open'));
}

export function openFlashcardViewModal(card, { useStacked = false } = {}) {
    if (!card) return;
    const context = useStacked ? ensureStackedFlashcardViewModal() : kvContext;
    if (!context) return;

    if (activeContext && activeContext !== context && activeContext.modal.classList.contains('is-open')) {
        closeFlashcardViewModal();
    }

    activeContext = context;
    modalCard = card;
    resetModalState();
    renderModalCard();
    context.modal.classList.add('is-open');
    context.modal.setAttribute('aria-hidden', 'false');
}

export function closeFlashcardViewModal() {
    if (!activeContext) return;
    activeContext.modal.classList.remove('is-open');
    activeContext.modal.setAttribute('aria-hidden', 'true');
    modalOklusionViewer?.destroy();
    modalOklusionViewer = null;
    modalCard = null;
    activeContext = null;
}

export function refreshFlashcardViewModal(card) {
    if (!modalCard || !card?.id || modalCard.id !== card.id) return;
    modalCard = card;
    resetModalState();
    renderModalCard();
}
