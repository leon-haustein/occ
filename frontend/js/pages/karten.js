import '../init.js';
import { applyVoteUI, castVote, voterKeyQuery } from '../votes.js';
import {
    UPVOTE_ICON_SVG, DOWNVOTE_ICON_SVG, COMMENT_ICON_SVG, CHANGE_ICON_SVG, DELETE_ICON_SVG,
    typeIcon
} from '../vector-graphics.js';
import { applyCommentCount, openCommentsPanel } from '../comments.js';
import { applySuggestionCount, openChangeSuggestionsPanel, postChangeSuggestion } from '../change-suggestions.js';
import { progressFromEntity, renderMiniBars, ensureProgressBarsHost } from '../progress-bars.js';
import { enhanceField, getFieldValue, fieldHasContent, resetField, parseFieldValue } from '../rich-field.js';
import { mountOklusionEditor, mountOklusionViewer } from '../oklusion.js';
import { API_BASE } from '../config.js';
import { createBreadcrumb } from '../breadcrumb.js';
import { setupCardsManageBtn } from '../layer-nav.js';
import {
    renderProzessHtml,
    renderMnemoHtml,
    renderStandardHtml
} from '../flashcard-renderers.js';
import { apiDelete, showApiError } from '../api.js';

document.querySelector('.upvote-icon')?.insertAdjacentHTML('beforeend', UPVOTE_ICON_SVG);
document.querySelector('.downvote-icon')?.insertAdjacentHTML('beforeend', DOWNVOTE_ICON_SVG);
document.querySelector('.comment-icon')?.insertAdjacentHTML('beforeend', COMMENT_ICON_SVG);
document.querySelector('.change-icon')?.insertAdjacentHTML('beforeend', CHANGE_ICON_SVG);
document.querySelector('.delete-icon')?.insertAdjacentHTML('beforeend', DELETE_ICON_SVG);
let currentFlashcards = [];
let currentCardIndex = 0;
let isShowingAnswer = false;
let prozessStepIndex = 0;
let mnemoRevealedIndices = new Set();
let oklusionViewer = null;
let currentTopicId = null;
let currentTopic = null;
let addFlashcardSetupDone = false;
let openSuggestionFormFn = null;

function getTopicIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('topic');
}

async function loadFlashcards(focusCardId = null) {
    const topicId = getTopicIdFromUrl();
    if (!topicId) {
        document.getElementById('flashcard-content').innerHTML = '<p>Kein Thema gewählt.</p>';
        return;
    }
    currentTopicId = topicId;
    try {
        const topicRes = await fetch(`${API_BASE}/api/topics/${topicId}`);
        if (!topicRes.ok) throw new Error('Topic not found');
        const topic = await topicRes.json();
        currentTopic = topic;
        const [courseRes, cardsRes] = await Promise.all([
            fetch(`${API_BASE}/api/courses/${topic.kurs_id}`),
            fetch(`${API_BASE}/api/topics/${topicId}/flashcards?${voterKeyQuery()}`)
        ]);
        if (!courseRes.ok) throw new Error('Course not found');
        const course = await courseRes.json();
        createBreadcrumb(4, { programId: course.studiengang_id, courseId: course.id });
        const cards = await cardsRes.json();
        currentFlashcards = cards.filter(c =>
            (c.typ === 'Mnemo' && c.question != null) ||
            (c.typ === 'Prozess' && c.question != null) ||
            (c.typ === 'Oklusion' && c.image && c.occlusions?.length > 0) ||
            (c.question != null && c.answer != null)
        );
        currentCardIndex = 0;
        if (focusCardId != null) {
            const idx = currentFlashcards.findIndex(c => c.id === focusCardId);
            if (idx >= 0) currentCardIndex = idx;
        }
        isShowingAnswer = false;
        prozessStepIndex = 0;
        mnemoRevealedIndices.clear();
        oklusionViewer?.resetRevealed();
        displayCurrentCard();
        if (!addFlashcardSetupDone) {
            setupAddFlashcard();
            addFlashcardSetupDone = true;
        }
    } catch (err) {
        console.error('Karten laden fehlgeschlagen:', err);
        document.getElementById('flashcard-content').innerHTML = '<p>Karten konnten nicht geladen werden.</p>';
    }
}

function attachMnemoHandlers(card) {
    const flashcardContent = document.getElementById('flashcard-content');
    const keys = card.keys || [];
    flashcardContent.querySelectorAll('.mnemo-key-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-key-index'), 10);
            if (mnemoRevealedIndices.has(idx)) {
                mnemoRevealedIndices.delete(idx);
            } else {
                mnemoRevealedIndices.add(idx);
            }
            displayCurrentCard();
        });
    });
    const revealAllBtn = flashcardContent.querySelector('.mnemo-reveal-all-btn');
    if (revealAllBtn) {
        revealAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (mnemoRevealedIndices.size === keys.length) {
                mnemoRevealedIndices.clear();
            } else {
                for (let i = 0; i < keys.length; i++) {
                    mnemoRevealedIndices.add(i);
                }
            }
            displayCurrentCard();
        });
    }
}

function displayCurrentCard() {
    const flashcardContent = document.getElementById('flashcard-content');
    const flashcard = document.getElementById('flashcard');
    const ratingRow = document.getElementById('spaced-rep-buttons');
    const deleteBtn = document.querySelector('.delete-icon');
    if (currentFlashcards.length === 0) {
        flashcardContent.innerHTML = '<p>Noch keine Karten. Nutze + um eine Karteikarte hinzuzufügen.</p>';
        flashcard.classList.remove('showing-answer', 'prozess-flashcard', 'mnemo-flashcard', 'standard-flashcard', 'oklusion-flashcard');
        oklusionViewer?.destroy();
        oklusionViewer = null;
        if (ratingRow) ratingRow.style.visibility = 'hidden';
        if (deleteBtn) deleteBtn.style.visibility = 'hidden';
        renderMiniBars(
            ensureProgressBarsHost(flashcardContent),
            progressFromEntity(currentTopic)
        );
        return;
    }
    if (ratingRow) ratingRow.style.visibility = '';
    if (deleteBtn) deleteBtn.style.visibility = '';
    if (currentCardIndex >= currentFlashcards.length) {
        currentCardIndex = 0;
    }
    const currentCard = currentFlashcards[currentCardIndex];
    const isProzess = currentCard.typ === 'Prozess' && currentCard.steps && currentCard.steps.length > 0;
    const isMnemo = currentCard.typ === 'Mnemo' && currentCard.keys && currentCard.keys.length > 0;
    const isOklusion = currentCard.typ === 'Oklusion' && currentCard.image && currentCard.occlusions?.length > 0;
    oklusionViewer?.destroy();
    oklusionViewer = null;
    if (isProzess) {
        flashcard.classList.add('prozess-flashcard');
        flashcard.classList.remove('mnemo-flashcard', 'showing-answer', 'standard-flashcard', 'oklusion-flashcard');
        flashcardContent.innerHTML = renderProzessHtml(currentCard, prozessStepIndex);
    } else if (isMnemo) {
        flashcard.classList.add('mnemo-flashcard');
        flashcard.classList.remove('prozess-flashcard', 'showing-answer', 'standard-flashcard', 'oklusion-flashcard');
        flashcardContent.innerHTML = renderMnemoHtml(currentCard, mnemoRevealedIndices);
        attachMnemoHandlers(currentCard);
    } else if (isOklusion) {
        flashcard.classList.add('oklusion-flashcard');
        flashcard.classList.remove('prozess-flashcard', 'mnemo-flashcard', 'showing-answer', 'standard-flashcard');
        flashcardContent.innerHTML = '';
        oklusionViewer = mountOklusionViewer(flashcardContent, currentCard);
    } else {
        flashcard.classList.remove('prozess-flashcard', 'mnemo-flashcard', 'oklusion-flashcard');
        flashcard.classList.add('standard-flashcard');
        flashcardContent.innerHTML = renderStandardHtml(currentCard);
        flashcard.classList.toggle('showing-answer', isShowingAnswer);
    }
    updateFlashcardVoteUI();
}

function updateFlashcardVoteUI() {
    const card = currentFlashcards[currentCardIndex];
    if (!card) return;
    applyVoteUI(document.querySelector('.sticker-bar'), {
        upvotes: card.upvotes ?? 0,
        downvotes: card.downvotes ?? 0,
        user_vote: card.user_vote ?? null
    });
    applyCommentCount(document.querySelector('.sticker-bar'), card.comment_count ?? 0);
    applySuggestionCount(document.querySelector('.sticker-bar'), card.suggestion_count ?? 0);
    renderMiniBars(
        ensureProgressBarsHost(document.getElementById('flashcard-content')),
        progressFromEntity(currentTopic)
    );
}

// Toggle: for Prozess cards advance step; for Standard toggle question/answer; Mnemo uses key buttons only
function toggleFlashcard() {
    const currentCard = currentFlashcards[currentCardIndex];
    const isMnemo = currentCard && currentCard.typ === 'Mnemo' && currentCard.keys && currentCard.keys.length > 0;
    if (isMnemo) return;
    const isOklusion = currentCard && currentCard.typ === 'Oklusion' && currentCard.image && currentCard.occlusions?.length > 0;
    if (isOklusion) return;
    const isProzess = currentCard && currentCard.typ === 'Prozess' && currentCard.steps && currentCard.steps.length > 0;
    if (isProzess) {
        const n = currentCard.steps.length;
        prozessStepIndex += 1;
        if (prozessStepIndex > n) prozessStepIndex = 0;
        displayCurrentCard();
    } else {
        isShowingAnswer = !isShowingAnswer;
        document.getElementById('flashcard').classList.toggle('showing-answer', isShowingAnswer);
    }
}

async function deleteCurrentFlashcard() {
    const card = currentFlashcards[currentCardIndex];
    if (!card) return;
    if (!confirm('Karteikarte wirklich löschen?')) return;
    try {
        await apiDelete(`${API_BASE}/api/flashcards/${card.id}`);
        currentFlashcards.splice(currentCardIndex, 1);
        if (currentCardIndex >= currentFlashcards.length && currentCardIndex > 0) {
            currentCardIndex = currentFlashcards.length - 1;
        }
        prozessStepIndex = 0;
        mnemoRevealedIndices.clear();
        oklusionViewer?.resetRevealed();
        isShowingAnswer = false;
        displayCurrentCard();
    } catch (err) {
        showApiError('Karteikarte konnte nicht gelöscht werden.');
    }
}

// Go to next card (rating buttons: do not show answer, just advance)
function goToNextCard() {
    if (currentFlashcards.length === 0) return;
    prozessStepIndex = 0;
    mnemoRevealedIndices.clear();
    oklusionViewer?.resetRevealed();
    currentCardIndex = (currentCardIndex + 1) % currentFlashcards.length;
    isShowingAnswer = false;
    displayCurrentCard();
}

// Setup event listeners
function setupEventListeners() {
    const flashcard = document.getElementById('flashcard');
    const deleteBtn = document.querySelector('.delete-icon');
    const commentBtn = document.querySelector('.comment-icon');
    const changeBtn = document.querySelector('.change-icon');
    const ratingButtons = document.querySelectorAll('.spaced-rep-buttons button');

    // Click on flashcard to toggle question/answer
    flashcard.addEventListener('click', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        if (e.target.closest('.okl-occ')) return;
        toggleFlashcard();
    });

    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteCurrentFlashcard();
        });
    }

    document.querySelector('.upvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = currentFlashcards[currentCardIndex];
        if (!card) return;
        const voteContainer = document.querySelector('.sticker-bar');
        const data = await castVote(API_BASE, 'karteikarte', card.id, 'up', voteContainer);
        if (data) {
            card.upvotes = data.upvotes;
            card.downvotes = data.downvotes;
            card.user_vote = data.user_vote;
        }
    });

    document.querySelector('.downvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = currentFlashcards[currentCardIndex];
        if (!card) return;
        const voteContainer = document.querySelector('.sticker-bar');
        const data = await castVote(API_BASE, 'karteikarte', card.id, 'down', voteContainer);
        if (data) {
            card.upvotes = data.upvotes;
            card.downvotes = data.downvotes;
            card.user_vote = data.user_vote;
        }
    });

    if (commentBtn) {
        commentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = currentFlashcards[currentCardIndex];
            if (!card) return;
            openCommentsPanel(API_BASE, 'karteikarte', card.id, {
                title: card.question || 'Karteikarte',
                onCountChange: (count) => {
                    card.comment_count = count;
                    applyCommentCount(document.querySelector('.sticker-bar'), count);
                }
            });
        });
    }

    if (changeBtn) {
        changeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = currentFlashcards[currentCardIndex];
            if (!card) return;
            openChangeSuggestionsPanel(API_BASE, 'karteikarte', card.id, {
                title: card.question || 'Karteikarte',
                mode: 'flashcard',
                onChangeRequest: ({ authorName, addSuggestion }) => {
                    if (openSuggestionFormFn) {
                        openSuggestionFormFn(card, authorName, addSuggestion);
                    }
                },
                onCardApplied: (updatedCard) => {
                    const idx = currentFlashcards.findIndex((c) => c.id === updatedCard.id);
                    if (idx >= 0) {
                        currentFlashcards[idx] = { ...currentFlashcards[idx], ...updatedCard };
                        if (idx === currentCardIndex) {
                            prozessStepIndex = 0;
                            mnemoRevealedIndices.clear();
                            oklusionViewer?.resetRevealed();
                            isShowingAnswer = false;
                            displayCurrentCard();
                        }
                    }
                },
                onCountChange: (count) => {
                    card.suggestion_count = count;
                    applySuggestionCount(document.querySelector('.sticker-bar'), count);
                }
            });
        });
    }

    // Rating buttons 1–5: advance to next card only
    ratingButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            goToNextCard();
        });
    });
}

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

function mapFlashcardError(data, status) {
    if (data && data.message) return data.message;
    if (data && data.error === 'duplicate_mnemo_key') {
        return 'Jeder Schlüssel darf nur einmal vorkommen. Bitte kürzere oder unterschiedliche Schlüssel verwenden.';
    }
    if (status === 400 && data && data.error) {
        const apiErrors = {
            'topic_id required': 'Bitte zuerst ein Thema auswählen.',
            'question and answer required for Standard cards': 'Bitte Frage und Antwort ausfüllen.',
            'titel required for Prozess cards': 'Bitte einen Titel eingeben.',
            'steps array required with at least one step (frage, antwort)': 'Bitte mindestens einen Prozessschritt ausfüllen.',
            'title required for Mnemo cards': 'Bitte einen Titel eingeben.',
            'title required for Oklusion cards': 'Bitte einen Titel eingeben.',
            'keys array required with at least one item (schluessel, inhalt)': 'Bitte mindestens einen Schlüssel mit Inhalt ausfüllen.',
            'image required for Oklusion cards': 'Bitte ein Bild hochladen.',
            'image_too_large': 'Bild ist zu groß (max. 2 MB).',
            'occlusions array required with at least one occlusion': 'Bitte mindestens eine Abdeckung hinzufügen.',
            'invalid occlusion type': 'Ungültiger Abdeckungstyp.',
            'invalid occlusion bounds': 'Ungültige Abdeckungsposition.',
            'lasso occlusions require at least 3 points': 'Freihand-Flächen benötigen mindestens 3 Punkte.'
        };
        if (data.error === 'image_too_large') return apiErrors.image_too_large;
        return apiErrors[data.error] || data.error;
    }
    return 'Die Karte konnte nicht gespeichert werden. Bitte Eingaben prüfen und erneut versuchen.';
}

async function postFlashcard(payload) {
    const res = await fetch(`${API_BASE}/api/flashcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    let data = {};
    try {
        data = await res.json();
    } catch (_) {}
    return { ok: res.ok, status: res.status, data };
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

function setupAddFlashcard() {
    const addBtn = document.getElementById('addFlashcardBtn');
    const modal = document.getElementById('flashcardStyleModal');
    const form = document.getElementById('flashcardStyleForm');
    const cancelBtn = document.getElementById('cancelFlashcardBtn');
    const styleOptions = form.querySelectorAll('.flashcard-style-option');
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
    const typeModal = document.getElementById('flashcardTypeModal');
    const typeForms = [standardForm, prozessForm, mnemoForm, oklusionForm].filter(Boolean);
    if (!addBtn || !modal || !form || !typeModal) return;
    let oklusionEditor = null;
    let formMode = 'create';
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

    function resetFormMode() {
        formMode = 'create';
        suggestionContext = null;
        if (standardSubmitBtn) standardSubmitBtn.textContent = 'Hinzufügen';
        if (prozessSubmitBtn) prozessSubmitBtn.textContent = 'Hinzufügen';
        if (mnemoSubmitBtn) mnemoSubmitBtn.textContent = 'Hinzufügen';
        if (oklusionSubmitBtn) oklusionSubmitBtn.textContent = 'Hinzufügen';
    }

    function setSuggestSubmitLabels() {
        if (standardSubmitBtn) standardSubmitBtn.textContent = 'Vorschlag senden';
        if (prozessSubmitBtn) prozessSubmitBtn.textContent = 'Vorschlag senden';
        if (mnemoSubmitBtn) mnemoSubmitBtn.textContent = 'Vorschlag senden';
        if (oklusionSubmitBtn) oklusionSubmitBtn.textContent = 'Vorschlag senden';
    }

    async function submitSuggestionPayload(payload, closeFn, activeForm) {
        const onSubmitted = suggestionContext?.onSubmitted;
        try {
            const suggestion = await postChangeSuggestion(
                API_BASE,
                'karteikarte',
                suggestionContext.cardId,
                suggestionContext.authorName,
                payload
            );
            onSubmitted?.(suggestion);
            closeFn();
        } catch (e) {
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

    function prefillOklusionForm(card) {
        if (oklusionTitel) oklusionTitel.value = card.question && card.question !== 'Oklusion-Karte' ? card.question : '';
        ensureOklusionEditor()?.loadData({
            image: card.image,
            occlusions: card.occlusions || []
        });
    }

    function openSuggestionForm(card, authorName, onSubmitted) {
        formMode = 'suggest';
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

    openSuggestionFormFn = openSuggestionForm;

    enhanceField(standardQuestion);
    enhanceField(standardAnswer);
    initProzessStepBlocks();
    initMnemoKeyBlocks();

    function closeStyleForm() {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
    function openForm() {
        ensureOverlayOnBody(modal);
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
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
    function getOpenTypeForm() {
        return typeForms.find((f) => f.classList.contains('is-open'));
    }
    function closeStandardForm() {
        hideFormError(standardForm);
        resetField(standardQuestion);
        resetField(standardAnswer);
        resetFormMode();
        closeTypeModal();
    }
    function closeProzessForm() {
        hideFormError(prozessForm);
        if (prozessTitel) prozessTitel.value = '';
        resetProzessSteps();
        resetFormMode();
        closeTypeModal();
    }
    function closeMnemoForm() {
        hideFormError(mnemoForm);
        if (mnemoTitel) mnemoTitel.value = '';
        resetMnemoKeys();
        resetFormMode();
        closeTypeModal();
    }
    function ensureOklusionEditor() {
        if (!oklusionEditor && oklusionEditorHost) {
            oklusionEditor = mountOklusionEditor(oklusionEditorHost, {
                onError: (msg) => showFormError(oklusionForm, msg)
            });
        }
        return oklusionEditor;
    }
    function closeOklusionForm() {
        hideFormError(oklusionForm);
        if (oklusionTitel) oklusionTitel.value = '';
        oklusionEditor?.reset();
        resetFormMode();
        closeTypeModal();
    }
    function closeActiveTypeForm() {
        const openForm = getOpenTypeForm();
        if (openForm === standardForm) closeStandardForm();
        else if (openForm === prozessForm) closeProzessForm();
        else if (openForm === mnemoForm) closeMnemoForm();
        else if (openForm === oklusionForm) closeOklusionForm();
    }

    addBtn.onclick = openForm;
    cancelBtn.onclick = closeStyleForm;
    styleOptions.forEach(btn => {
        btn.onclick = () => {
            const style = btn.dataset.style;
            closeStyleForm();
            if (style === 'standard') {
                hideFormError(standardForm);
                openTypeForm(standardForm);
            } else if (style === 'prozess') {
                hideFormError(prozessForm);
                resetProzessSteps();
                openTypeForm(prozessForm);
            } else if (style === 'mnemo') {
                hideFormError(mnemoForm);
                resetMnemoKeys();
                if (mnemoForm) openTypeForm(mnemoForm);
            } else if (style === 'oklusion') {
                hideFormError(oklusionForm);
                if (oklusionTitel) oklusionTitel.value = '';
                ensureOklusionEditor()?.reset();
                if (oklusionForm) openTypeForm(oklusionForm);
            }
        };
    });
    standardCancelBtn.onclick = closeStandardForm;
    standardSubmitBtn.onclick = async () => {
        hideFormError(standardForm);
        if (!fieldHasContent(standardQuestion) || !fieldHasContent(standardAnswer)) {
            showFormError(standardForm, 'Bitte Frage und Antwort ausfüllen.');
            return;
        }
        const question = getFieldValue(standardQuestion);
        const answer = getFieldValue(standardAnswer);
        if (formMode === 'suggest') {
            await submitSuggestionPayload({ style: 'standard', question, answer }, closeStandardForm, standardForm);
            return;
        }
        if (!currentTopicId) {
            showFormError(standardForm, 'Bitte zuerst ein Thema auswählen.');
            return;
        }
        try {
            const result = await postFlashcard({ topic_id: currentTopicId, question, answer, style: 'standard' });
            if (!result.ok) {
                showFormError(standardForm, mapFlashcardError(result.data, result.status));
                return;
            }
            closeStandardForm();
            await loadFlashcards(result.data.id);
        } catch (e) {
            showFormError(standardForm, 'Die Karte konnte nicht gespeichert werden. Bitte später erneut versuchen.');
        }
    };

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
            if (formMode === 'suggest') {
                await submitSuggestionPayload({ style: 'prozess', titel, steps }, closeProzessForm, prozessForm);
                return;
            }
            if (!currentTopicId) {
                showFormError(prozessForm, 'Bitte zuerst ein Thema auswählen.');
                return;
            }
            try {
                const result = await postFlashcard({ topic_id: currentTopicId, style: 'prozess', titel, steps });
                if (!result.ok) {
                    showFormError(prozessForm, mapFlashcardError(result.data, result.status));
                    return;
                }
                closeProzessForm();
                await loadFlashcards(result.data.id);
            } catch (e) {
                showFormError(prozessForm, 'Die Karte konnte nicht gespeichert werden. Bitte später erneut versuchen.');
            }
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
            if (formMode === 'suggest') {
                await submitSuggestionPayload({ style: 'mnemo', title, keys: filledKeys }, closeMnemoForm, mnemoForm);
                return;
            }
            if (!currentTopicId) {
                showFormError(mnemoForm, 'Bitte zuerst ein Thema auswählen.');
                return;
            }
            try {
                const result = await postFlashcard({ topic_id: currentTopicId, style: 'mnemo', title, keys: filledKeys });
                if (!result.ok) {
                    showFormError(mnemoForm, mapFlashcardError(result.data, result.status));
                    return;
                }
                closeMnemoForm();
                await loadFlashcards(result.data.id);
            } catch (e) {
                showFormError(mnemoForm, 'Die Karte konnte nicht gespeichert werden. Bitte später erneut versuchen.');
            }
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
            const payload = {
                style: 'oklusion',
                title,
                image: data.image,
                occlusions: data.occlusions
            };
            if (formMode === 'suggest') {
                await submitSuggestionPayload(payload, closeOklusionForm, oklusionForm);
                return;
            }
            if (!currentTopicId) {
                showFormError(oklusionForm, 'Bitte zuerst ein Thema auswählen.');
                return;
            }
            try {
                const result = await postFlashcard({ topic_id: currentTopicId, ...payload });
                if (!result.ok) {
                    showFormError(oklusionForm, mapFlashcardError(result.data, result.status));
                    return;
                }
                closeOklusionForm();
                await loadFlashcards(result.data.id);
            } catch (e) {
                showFormError(oklusionForm, 'Die Karte konnte nicht gespeichert werden. Bitte später erneut versuchen.');
            }
        };
    }
}

setupCardsManageBtn(() => {
    const topicId = getTopicIdFromUrl();
    return topicId ? `Kartenverwaltung.html?topic=${encodeURIComponent(topicId)}` : null;
});

function injectStyleOptionIcons() {
    document.querySelectorAll('.flashcard-style-option').forEach(btn => {
        const host = btn.querySelector('.style-option-icon');
        if (host) host.innerHTML = typeIcon(btn.dataset.style);
    });
}

window.addEventListener('load', function() {
    loadFlashcards();
    setupEventListeners();
    injectStyleOptionIcons();
});
