import { getVoterKey } from './votes.js';
import { COMMENT_ICON_SVG, CHANGE_ICON_SVG, REPORT_ICON_SVG } from './vote-icons.js';
import {
    fetchChangeSuggestions,
    postChangeSuggestion,
    renderChangeSuggestionItem,
    attachChangeSuggestionVoteHandlers,
    attachChangeSuggestionPreviewHandler
} from './change-suggestions.js';
import { isStackedFlashcardViewModalOpen } from './flashcard-view-modal.js';

const COMMENT_NAME_STORAGE = 'ovgu_comment_name';

function getSavedName() {
    return localStorage.getItem(COMMENT_NAME_STORAGE) || '';
}

function saveName(name) {
    localStorage.setItem(COMMENT_NAME_STORAGE, name);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// Badge mit Kommentaranzahl am Kommentar-Icon anzeigen/aktualisieren
export function applyCommentCount(container, count) {
    if (!container) return;
    const btn = container.querySelector('.comment-icon');
    if (!btn) return;
    let badge = btn.querySelector('.comment-count');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'comment-count';
        btn.appendChild(badge);
    }
    badge.textContent = String(count ?? 0);
    btn.classList.toggle('is-active', Number(count) > 0);
}

async function fetchComments(apiBase, entityType, entityId) {
    const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: String(entityId),
        voter_key: getVoterKey()
    });
    const res = await fetch(`${apiBase}/api/comments?${params}`);
    if (!res.ok) throw new Error('Failed to load comments');
    return res.json();
}

async function postComment(apiBase, entityType, entityId, authorName, text) {
    const res = await fetch(`${apiBase}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            author_key: getVoterKey(),
            author_name: authorName,
            text
        })
    });
    if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch (_) {}
        throw new Error(data.error || 'Failed to add comment');
    }
    return res.json();
}

async function deleteComment(apiBase, commentId) {
    const params = new URLSearchParams({ author_key: getVoterKey() });
    const res = await fetch(`${apiBase}/api/comments/${commentId}?${params}`, { method: 'DELETE' });
    return res.ok;
}

async function reportComment(apiBase, commentId) {
    const res = await fetch(`${apiBase}/api/comments/${commentId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voter_key: getVoterKey() })
    });
    if (!res.ok) return null;
    return res.json();
}

function applyReportUI(container, data) {
    if (!container) return;
    const reportBtn = container.querySelector('.report-icon');
    reportBtn?.classList.toggle('is-active', Boolean(data.user_reported));
}

function renderCommentItem(comment) {
    const li = document.createElement('li');
    li.className = 'comment-item';
    li.dataset.commentId = comment.id;
    li.dataset.itemType = 'comment';
    const headAction = comment.is_own
        ? '<button type="button" class="comment-item__delete" title="Kommentar löschen" aria-label="Kommentar löschen">&#10005;</button>'
        : `<button type="button" class="report-icon icon-btn" aria-label="Kommentar melden" title="Melden">${REPORT_ICON_SVG}</button>`;
    li.innerHTML = `
        <div class="comment-item__head">
            <span class="comment-item__author">${escapeHtml(comment.author_name)}</span>
            <span class="comment-item__date">${escapeHtml(formatDate(comment.created_at))}</span>
            ${headAction}
        </div>
        <p class="comment-item__text">${escapeHtml(comment.text)}</p>
    `;
    applyReportUI(li, comment);
    return li;
}

function mergeFeedItems(comments, suggestions) {
    const items = [
        ...comments.map((comment) => ({ kind: 'comment', data: comment, created_at: comment.created_at })),
        ...suggestions.map((suggestion) => ({ kind: 'suggestion', data: suggestion, created_at: suggestion.created_at }))
    ];
    items.sort((a, b) => {
        const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return (b.data.id ?? 0) - (a.data.id ?? 0);
    });
    return items;
}

function supportsChangeSuggestions(changeMode) {
    return changeMode === 'rename' || changeMode === 'flashcard';
}

// Öffnet das Kommentar-Panel für eine Entität.
// options.title: Überschrift im Panel
// options.changeMode: 'rename' | 'flashcard' aktiviert Änderungsvorschläge
// options.changePlaceholder: Platzhalter für Namensvorschlag (rename)
// options.onCountChange(newCount): wird bei Hinzufügen/Löschen aufgerufen (für das Badge)
// options.onNameApplied(newName): wird aufgerufen wenn ein Umbenennungsvorschlag angenommen wurde
// options.onChangeRequest({ authorName, addSuggestion }): flashcard-Modus – Formular öffnen
// options.onCardApplied(updatedCard): flashcard-Modus – Karte nach Auto-Apply aktualisieren
export function openCommentsPanel(apiBase, entityType, entityId, options = {}) {
    document.querySelector('.comments-modal')?.remove();

    const {
        title = 'Kommentare',
        changeMode = null,
        changePlaceholder = 'Neuen Namen vorschlagen…',
        onCountChange,
        onNameApplied,
        onChangeRequest,
        onCardApplied
    } = options;
    let commentsCount = 0;
    let suggestionsCount = 0;
    let panelTitle = title;
    const hasSuggestions = supportsChangeSuggestions(changeMode);
    const filterMarkup = hasSuggestions ? `
            <div class="comments-panel__filter" role="tablist" aria-label="Feed filtern">
                <button type="button" class="comments-panel__filter-tab is-active" role="tab" aria-selected="true" aria-label="Kommentare, 0 Einträge" data-filter="comments">Kommentare <span class="comments-panel__filter-count">0</span></button>
                <button type="button" class="comments-panel__filter-tab" role="tab" aria-selected="false" aria-label="Vorschläge, 0 Einträge" data-filter="suggestions">Vorschläge <span class="comments-panel__filter-count">0</span></button>
            </div>` : '';

    const modal = document.createElement('div');
    modal.className = 'comments-modal';
    modal.innerHTML = `
        <div class="comments-panel" role="dialog" aria-modal="true" aria-label="Kommentare">
            <button type="button" class="close-btn" title="Schließen" aria-label="Schließen">&#10005;</button>
            <div class="comments-panel__header">
                <h3>${escapeHtml(panelTitle)}</h3>
            </div>${filterMarkup}
            <ul class="comments-list${hasSuggestions ? ' is-filter-comments' : ''}">
                <li class="comments-list__status">Einträge werden geladen…</li>
            </ul>
            <div class="comment-form" hidden>
                <div class="comment-form-error" role="alert" hidden></div>
                <input type="text" class="comment-form__name" placeholder="Dein Name" maxlength="40">
                <div class="comment-form__text-wrap">
                    <textarea class="comment-form__text" placeholder="Kommentar schreiben…" rows="3" maxlength="2000"></textarea>
                    <button type="button" class="comment-form__submit" title="Absenden" aria-label="Absenden">&#8594;</button>
                </div>
            </div>
            <div class="change-form" hidden>
                <div class="change-form-error" role="alert" hidden></div>
                <input type="text" class="change-form__name" placeholder="Dein Name" maxlength="40">
                <div class="change-form__value-wrap">
                    <input type="text" class="change-form__value" placeholder="${escapeHtml(changePlaceholder)}" maxlength="40">
                    <button type="button" class="change-form__submit">Hinzufügen</button>
                </div>
            </div>
            <div class="comments-panel__footer">
                <button type="button" class="comments-panel__compose">${COMMENT_ICON_SVG} Kommentieren</button>
                <button type="button" class="comments-panel__change"${hasSuggestions ? '' : ' hidden'}>${CHANGE_ICON_SVG} Änderung</button>
            </div>
            <div class="comments-panel__flashcard-error" role="alert" hidden></div>
        </div>
    `;
    document.body.appendChild(modal);

    const panel = modal.querySelector('.comments-panel');
    const headerTitle = modal.querySelector('.comments-panel__header h3');
    const list = modal.querySelector('.comments-list');
    const form = modal.querySelector('.comment-form');
    const changeForm = modal.querySelector('.change-form');
    const footer = modal.querySelector('.comments-panel__footer');
    const composeBtn = modal.querySelector('.comments-panel__compose');
    const changeBtn = modal.querySelector('.comments-panel__change');
    const nameInput = modal.querySelector('.comment-form__name');
    const textInput = modal.querySelector('.comment-form__text');
    const submitBtn = modal.querySelector('.comment-form__submit');
    const errorEl = modal.querySelector('.comment-form-error');
    const changeNameInput = changeForm?.querySelector('.change-form__name');
    const changeValueInput = changeForm?.querySelector('.change-form__value');
    const changeSubmitBtn = changeForm?.querySelector('.change-form__submit');
    const changeErrorEl = changeForm?.querySelector('.change-form-error');
    const flashcardErrorEl = modal.querySelector('.comments-panel__flashcard-error');

    nameInput.value = getSavedName();
    if (changeNameInput) changeNameInput.value = getSavedName();

    function syncTotalCount() {
        if (typeof onCountChange === 'function') {
            onCountChange(commentsCount + suggestionsCount);
        }
    }

    function updateFilterTabCounts() {
        if (!hasSuggestions) return;
        const commentsTab = panel.querySelector('[data-filter="comments"]');
        const suggestionsTab = panel.querySelector('[data-filter="suggestions"]');
        const commentsCountEl = commentsTab?.querySelector('.comments-panel__filter-count');
        const suggestionsCountEl = suggestionsTab?.querySelector('.comments-panel__filter-count');
        if (commentsCountEl) commentsCountEl.textContent = String(commentsCount);
        if (suggestionsCountEl) suggestionsCountEl.textContent = String(suggestionsCount);
        if (commentsTab) {
            commentsTab.setAttribute('aria-label', `Kommentare, ${commentsCount} Einträge`);
        }
        if (suggestionsTab) {
            suggestionsTab.setAttribute('aria-label', `Vorschläge, ${suggestionsCount} Einträge`);
        }
    }

    function setFeedCounts(comments, suggestions) {
        commentsCount = comments;
        suggestionsCount = suggestions;
        syncTotalCount();
        updateFilterTabCounts();
    }

    function hasAnyFeedItems() {
        return Boolean(list.querySelector('.comment-item, .change-suggestion-item'));
    }

    function renderEmptyState() {
        list.innerHTML = '<li class="comments-list__status">Noch keine Einträge. Schreib den ersten Kommentar oder schlage eine Änderung vor!</li>';
    }

    function updateFilteredEmptyState() {
        list.querySelectorAll('.comments-list__status').forEach((el) => el.remove());
        if (!hasAnyFeedItems()) {
            renderEmptyState();
            return;
        }
        if (!hasSuggestions) return;
        const filter = list.classList.contains('is-filter-suggestions') ? 'suggestions' : 'comments';
        const hasComments = list.querySelector('.comment-item');
        const hasSuggestionItems = list.querySelector('.change-suggestion-item');
        if (filter === 'comments' && !hasComments && hasSuggestionItems) {
            const li = document.createElement('li');
            li.className = 'comments-list__status';
            li.textContent = 'Noch keine Kommentare.';
            list.appendChild(li);
        } else if (filter === 'suggestions' && !hasSuggestionItems && hasComments) {
            const li = document.createElement('li');
            li.className = 'comments-list__status';
            li.textContent = 'Noch keine Vorschläge.';
            list.appendChild(li);
        }
    }

    function setFeedFilter(filter) {
        panel.querySelectorAll('.comments-panel__filter-tab').forEach((tab) => {
            const active = tab.dataset.filter === filter;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        list.classList.toggle('is-filter-comments', filter === 'comments');
        list.classList.toggle('is-filter-suggestions', filter === 'suggestions');
        updateFilteredEmptyState();
    }

    if (hasSuggestions) {
        panel.querySelectorAll('.comments-panel__filter-tab').forEach((tab) => {
            tab.addEventListener('click', () => setFeedFilter(tab.dataset.filter));
        });
    }

    function openForm() {
        if (changeForm) changeForm.hidden = true;
        form.hidden = false;
        footer.hidden = true;
        flashcardErrorEl.hidden = true;
        hideError();
        hideChangeError();
        (nameInput.value.trim() ? textInput : nameInput).focus();
    }

    function closeForm() {
        form.hidden = true;
        footer.hidden = false;
        hideError();
    }

    function openChangeForm() {
        form.hidden = true;
        if (changeForm) changeForm.hidden = false;
        footer.hidden = true;
        flashcardErrorEl.hidden = true;
        hideError();
        hideChangeError();
        (changeNameInput.value.trim() ? changeValueInput : changeNameInput).focus();
    }

    function closeChangeForm() {
        if (changeForm) changeForm.hidden = true;
        footer.hidden = false;
        hideChangeError();
    }

    composeBtn.addEventListener('click', openForm);
    changeBtn?.addEventListener('click', () => {
        if (changeMode === 'flashcard') {
            const authorName = getSavedName().trim();
            if (!authorName) {
                flashcardErrorEl.textContent = 'Bitte gib zuerst deinen Namen an (über „Kommentieren“ oder im Formular).';
                flashcardErrorEl.hidden = false;
                openForm();
                return;
            }
            flashcardErrorEl.hidden = true;
            if (typeof onChangeRequest === 'function') {
                onChangeRequest({
                    authorName,
                    addSuggestion: addSuggestionToFeed
                });
            }
            return;
        }
        openChangeForm();
    });

    function close() {
        modal.remove();
        document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(e) {
        if (e.key !== 'Escape') return;
        if (isStackedFlashcardViewModalOpen()) return;
        const typeModal = document.getElementById('flashcardTypeModal');
        if (typeModal?.classList.contains('is-open')) {
            typeModal
                .querySelector('.flashcard-type-form-wrap:has(.flashcard-type-form.is-open) .close-btn')
                ?.click();
            return;
        }
        close();
    }
    document.addEventListener('keydown', onKeydown);
    modal.addEventListener('click', (e) => {
        if (!panel.contains(e.target)) close();
    });
    modal.querySelector('.close-btn').addEventListener('click', close);

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
    function hideError() {
        errorEl.textContent = '';
        errorEl.hidden = true;
    }
    function showChangeError(message) {
        changeErrorEl.textContent = message;
        changeErrorEl.hidden = false;
    }
    function hideChangeError() {
        changeErrorEl.textContent = '';
        changeErrorEl.hidden = true;
    }

    function incrementCommentsCount() {
        commentsCount += 1;
        syncTotalCount();
        updateFilterTabCounts();
    }

    function decrementCommentsCount() {
        commentsCount = Math.max(0, commentsCount - 1);
        syncTotalCount();
        updateFilterTabCounts();
    }

    function incrementSuggestionsCount() {
        suggestionsCount += 1;
        syncTotalCount();
        updateFilterTabCounts();
    }

    function handleNameApplied(newName) {
        panelTitle = newName;
        headerTitle.textContent = newName;
        if (typeof onNameApplied === 'function') onNameApplied(newName);
    }

    function handleCardApplied(updatedCard) {
        if (updatedCard?.question) {
            panelTitle = updatedCard.question;
            headerTitle.textContent = updatedCard.question;
        }
        if (typeof onCardApplied === 'function') onCardApplied(updatedCard);
    }

    const voteCallbacks = {
        onNameApplied: handleNameApplied,
        onCardApplied: handleCardApplied
    };

    function attachCommentHandlers(li, comment) {
        li.querySelector('.comment-item__delete')?.addEventListener('click', async () => {
            if (!confirm('Kommentar wirklich löschen?')) return;
            const ok = await deleteComment(apiBase, comment.id);
            if (ok) {
                li.remove();
                decrementCommentsCount();
                updateFilteredEmptyState();
            }
        });

        li.querySelector('.report-icon')?.addEventListener('click', async () => {
            const data = await reportComment(apiBase, comment.id);
            if (!data) return;
            if (data.deleted) {
                li.remove();
                decrementCommentsCount();
                updateFilteredEmptyState();
                return;
            }
            applyReportUI(li, data);
        });
    }

    function attachSuggestionHandlers(li, suggestion) {
        attachChangeSuggestionVoteHandlers(li, suggestion, apiBase, voteCallbacks);
        attachChangeSuggestionPreviewHandler(li, suggestion);
    }

    function addSuggestionToFeed(suggestion) {
        list.querySelector('.comments-list__status')?.remove();
        const li = renderChangeSuggestionItem(suggestion);
        attachSuggestionHandlers(li, suggestion);
        list.prepend(li);
        incrementSuggestionsCount();
        updateFilteredEmptyState();
    }

    function renderFeed(comments, suggestions) {
        list.innerHTML = '';
        setFeedCounts(comments.length, suggestions.length);
        const items = mergeFeedItems(comments, suggestions);
        if (items.length === 0) {
            renderEmptyState();
            return;
        }
        for (const item of items) {
            if (item.kind === 'comment') {
                const li = renderCommentItem(item.data);
                attachCommentHandlers(li, item.data);
                list.appendChild(li);
            } else {
                const li = renderChangeSuggestionItem(item.data);
                attachSuggestionHandlers(li, item.data);
                list.appendChild(li);
            }
        }
        updateFilteredEmptyState();
    }

    const loadCommentsPromise = fetchComments(apiBase, entityType, entityId);
    const loadSuggestionsPromise = supportsChangeSuggestions(changeMode)
        ? fetchChangeSuggestions(apiBase, entityType, entityId)
        : Promise.resolve([]);

    Promise.all([loadCommentsPromise, loadSuggestionsPromise])
        .then(([comments, suggestions]) => {
            renderFeed(comments, suggestions);
        })
        .catch(() => {
            list.innerHTML = '<li class="comments-list__status">Einträge konnten nicht geladen werden.</li>';
        });

    submitBtn.addEventListener('click', async () => {
        hideError();
        const name = nameInput.value.trim();
        const text = textInput.value.trim();
        if (!name) {
            showError('Bitte gib deinen Namen an.');
            nameInput.focus();
            return;
        }
        if (!text) {
            showError('Bitte schreibe einen Kommentar.');
            textInput.focus();
            return;
        }
        submitBtn.disabled = true;
        try {
            const comment = await postComment(apiBase, entityType, entityId, name, text);
            saveName(name);
            textInput.value = '';
            list.querySelector('.comments-list__status')?.remove();
            const li = renderCommentItem(comment);
            attachCommentHandlers(li, comment);
            list.prepend(li);
            incrementCommentsCount();
            closeForm();
            updateFilteredEmptyState();
        } catch (e) {
            showError('Der Kommentar konnte nicht gespeichert werden. Bitte später erneut versuchen.');
        } finally {
            submitBtn.disabled = false;
        }
    });

    if (changeSubmitBtn) {
        changeSubmitBtn.addEventListener('click', async () => {
            hideChangeError();
            const name = changeNameInput.value.trim();
            const value = changeValueInput.value.trim();
            if (!name) {
                showChangeError('Bitte gib deinen Namen an.');
                changeNameInput.focus();
                return;
            }
            if (!value) {
                showChangeError('Bitte schlage einen neuen Namen vor.');
                changeValueInput.focus();
                return;
            }
            changeSubmitBtn.disabled = true;
            try {
                const suggestion = await postChangeSuggestion(apiBase, entityType, entityId, name, value);
                saveName(name);
                changeValueInput.value = '';
                addSuggestionToFeed(suggestion);
                closeChangeForm();
            } catch (e) {
                showChangeError('Der Vorschlag konnte nicht gespeichert werden. Bitte später erneut versuchen.');
            } finally {
                changeSubmitBtn.disabled = false;
            }
        });
    }
}
