/**
 * Kommentare für Entitäten der OVGU-Karten-App.
 *
 * Stellt ein modales Kommentar-Panel bereit, in dem Nutzer Kommentare schreiben,
 * melden und löschen können. Der Kommentarzähler am Icon in der Sticker-Leiste
 * wird über applyCommentCount aktualisiert.
 *
 * Importe:
 *   - getVoterKey (@see frontend/js/votes.js) — anonyme Nutzer-ID für API-Aufrufe
 *   - COMMENT_ICON_SVG, REPORT_ICON_SVG (@see frontend/js/vector-graphics.js)
 *   - escapeHtml (@see frontend/js/dom-utils.js) — XSS-sichere Textausgabe
 *   - apiFetchJson, apiDelete, showApiError (@see frontend/js/api.js)
 *
 * Exporte:
 *   - applyCommentCount(container, count) — Badge am Kommentar-Icon setzen
 *   - openCommentsPanel(apiBase, entityType, entityId, options) — Panel öffnen
 *
 * Verwendung:
 *   - frontend/js/pages/kurse.js, themen.js, karten.js, kartenverwaltung.js
 */

import { getVoterKey } from './votes.js';
import { COMMENT_ICON_SVG, REPORT_ICON_SVG } from './vector-graphics.js';
import { escapeHtml } from './dom-utils.js';
import { apiFetchJson, apiDelete, showApiError } from './api.js';

/** LocalStorage-Schlüssel für den zuletzt eingegebenen Anzeigenamen. */
export const COMMENT_NAME_STORAGE = 'ovgu_comment_name';

function getSavedName() {
    return localStorage.getItem(COMMENT_NAME_STORAGE) || '';
}

function saveName(name) {
    localStorage.setItem(COMMENT_NAME_STORAGE, name);
}

function formatDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

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
    return apiFetchJson(`${apiBase}/api/comments?${params}`);
}

async function postComment(apiBase, entityType, entityId, authorName, text) {
    return apiFetchJson(`${apiBase}/api/comments`, {
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
}

async function deleteComment(apiBase, commentId) {
    const params = new URLSearchParams({ author_key: getVoterKey() });
    await apiDelete(`${apiBase}/api/comments/${commentId}?${params}`);
}

async function reportComment(apiBase, commentId) {
    return apiFetchJson(`${apiBase}/api/comments/${commentId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voter_key: getVoterKey() })
    });
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

export function openCommentsPanel(apiBase, entityType, entityId, options = {}) {
    document.querySelector('.comments-modal')?.remove();

    const {
        title = 'Kommentare',
        onCountChange
    } = options;

    let commentsCount = 0;

    const modal = document.createElement('div');
    modal.className = 'comments-modal';
    modal.innerHTML = `
        <div class="comments-panel" role="dialog" aria-modal="true" aria-label="Kommentare">
            <button type="button" class="close-btn" title="Schließen" aria-label="Schließen">&#10005;</button>
            <div class="comments-panel__header">
                <h3>${escapeHtml(title)}</h3>
            </div>
            <ul class="comments-list">
                <li class="comments-list__status">Kommentare werden geladen…</li>
            </ul>
            <div class="comment-form" hidden>
                <div class="comment-form-error" role="alert" hidden></div>
                <input type="text" class="comment-form__name" placeholder="Dein Name" maxlength="40">
                <div class="comment-form__text-wrap">
                    <textarea class="comment-form__text" placeholder="Kommentar schreiben…" rows="3" maxlength="2000"></textarea>
                    <button type="button" class="comment-form__submit" title="Absenden" aria-label="Absenden">&#8594;</button>
                </div>
            </div>
            <div class="comments-panel__footer">
                <button type="button" class="comments-panel__compose">${COMMENT_ICON_SVG} Kommentieren</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const panel = modal.querySelector('.comments-panel');
    const list = modal.querySelector('.comments-list');
    const form = modal.querySelector('.comment-form');
    const footer = modal.querySelector('.comments-panel__footer');
    const composeBtn = modal.querySelector('.comments-panel__compose');
    const nameInput = modal.querySelector('.comment-form__name');
    const textInput = modal.querySelector('.comment-form__text');
    const submitBtn = modal.querySelector('.comment-form__submit');
    const errorEl = modal.querySelector('.comment-form-error');

    nameInput.value = getSavedName();

    function syncCount() {
        if (typeof onCountChange === 'function') {
            onCountChange(commentsCount);
        }
    }

    function setCommentsCount(count) {
        commentsCount = count;
        syncCount();
    }

    function incrementCommentsCount() {
        commentsCount += 1;
        syncCount();
    }

    function decrementCommentsCount() {
        commentsCount = Math.max(0, commentsCount - 1);
        syncCount();
    }

    function renderEmptyState() {
        list.innerHTML = '<li class="comments-list__status">Noch keine Kommentare. Schreib den ersten!</li>';
    }

    function updateEmptyState() {
        list.querySelectorAll('.comments-list__status').forEach((el) => el.remove());
        if (!list.querySelector('.comment-item')) {
            renderEmptyState();
        }
    }

    function openForm() {
        form.hidden = false;
        footer.hidden = true;
        hideError();
        (nameInput.value.trim() ? textInput : nameInput).focus();
    }

    function closeForm() {
        form.hidden = true;
        footer.hidden = false;
        hideError();
    }

    composeBtn.addEventListener('click', openForm);

    function close() {
        modal.remove();
        document.removeEventListener('keydown', onKeydown);
    }

    function onKeydown(e) {
        if (e.key !== 'Escape') return;
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

    function attachCommentHandlers(li, comment) {
        li.querySelector('.comment-item__delete')?.addEventListener('click', async () => {
            if (!confirm('Kommentar wirklich löschen?')) return;
            try {
                await deleteComment(apiBase, comment.id);
                li.remove();
                decrementCommentsCount();
                updateEmptyState();
            } catch (err) {
                showApiError('Kommentar konnte nicht gelöscht werden.');
            }
        });

        li.querySelector('.report-icon')?.addEventListener('click', async () => {
            try {
                const data = await reportComment(apiBase, comment.id);
                if (data.deleted) {
                    li.remove();
                    decrementCommentsCount();
                    updateEmptyState();
                    return;
                }
                applyReportUI(li, data);
            } catch (err) {
                showApiError('Kommentar konnte nicht gemeldet werden.');
            }
        });
    }

    function renderFeed(comments) {
        list.innerHTML = '';
        setCommentsCount(comments.length);
        if (comments.length === 0) {
            renderEmptyState();
            return;
        }
        const sorted = [...comments].sort((a, b) => {
            const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (timeDiff !== 0) return timeDiff;
            return (b.id ?? 0) - (a.id ?? 0);
        });
        for (const comment of sorted) {
            const li = renderCommentItem(comment);
            attachCommentHandlers(li, comment);
            list.appendChild(li);
        }
    }

    fetchComments(apiBase, entityType, entityId)
        .then((comments) => renderFeed(comments))
        .catch((err) => {
            console.error('Kommentare laden fehlgeschlagen:', err);
            list.innerHTML = '<li class="comments-list__status">Kommentare konnten nicht geladen werden.</li>';
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
            updateEmptyState();
        } catch (e) {
            showError('Der Kommentar konnte nicht gespeichert werden. Bitte später erneut versuchen.');
        } finally {
            submitBtn.disabled = false;
        }
    });
}
