import '../init.js';
import { applyVoteUI, castVote, voterKeyQuery } from '../votes.js';
import {
    UPVOTE_ICON_SVG, DOWNVOTE_ICON_SVG, COMMENT_ICON_SVG, CHANGE_ICON_SVG, DELETE_ICON_SVG,
    typeIcon, typeIconKey
} from '../vector-graphics.js';
import { applyCommentCount, openCommentsPanel } from '../comments.js';
import { applySuggestionCount, openChangeSuggestionsPanel } from '../change-suggestions.js';
import { setupFlashcardSuggestionForm } from '../flashcard-suggestion-form.js';
import {
    initFlashcardViewModal,
    openFlashcardViewModal,
    refreshFlashcardViewModal
} from '../flashcard-view-modal.js';
import { renderMarkdown } from '../markdown.js';
import { API_BASE } from '../config.js';
import { escapeHtml } from '../dom-utils.js';
import { renderBreadcrumb } from '../breadcrumb.js';
import { setupCardsManageBtn } from '../layer-nav.js';
import { apiDelete, showApiError } from '../api.js';

let allCards = [];
let openSuggestionFormFn = null;

function getScopeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('topic')) return { type: 'topic', id: params.get('topic') };
    if (params.get('course')) return { type: 'course', id: params.get('course') };
    if (params.get('program')) return { type: 'program', id: params.get('program') };
    return null;
}

function setLayerBrand(scope) {
    const el = document.getElementById('layerBrand');
    if (!el) return;
    const titles = { program: 'Kurse', course: 'Themen', topic: 'Karten' };
    el.textContent = scope ? (titles[scope.type] || '') : '';
}

function applyCardUpdate(updatedCard) {
    const idx = allCards.findIndex((c) => c.id === updatedCard.id);
    if (idx < 0) return;
    allCards[idx] = { ...allCards[idx], ...updatedCard };
    refreshFlashcardViewModal(allCards[idx]);
    renderGrid();
}

function createCardTile(card) {
    const container = document.getElementById('links-container');
    const tile = document.createElement('div');
    tile.className = 'link-item';
    tile.dataset.cardId = card.id;
    tile.innerHTML = `
        <span class="kv-typ-icon kv-typ-icon--${typeIconKey(card.typ)}" title="${escapeHtml(card.typ || '')}" aria-label="${escapeHtml(card.typ || '')}">${typeIcon(card.typ)}</span>
        <div class="link-content">
            <div class="course-title">${renderMarkdown(card.question || '')}</div>
        </div>
        <div class="sticker-bar">
            <button type="button" class="upvote-icon icon-btn" aria-label="Karte positiv bewerten" title="Positiv bewerten">
                ${UPVOTE_ICON_SVG}
            </button>
            <button type="button" class="downvote-icon icon-btn" aria-label="Karte negativ bewerten" title="Negativ bewerten">
                ${DOWNVOTE_ICON_SVG}
            </button>
            <button type="button" class="comment-icon icon-btn" aria-label="Karte kommentieren" title="Kommentieren">
                ${COMMENT_ICON_SVG}
            </button>
            <button type="button" class="change-icon icon-btn" aria-label="Kartenänderung vorschlagen" title="Änderung vorschlagen">
                ${CHANGE_ICON_SVG}
            </button>
            <button type="button" class="delete-icon" aria-label="Karteikarte löschen" title="Karteikarte löschen">
                ${DELETE_ICON_SVG}
            </button>
        </div>
    `;

    const voteContainer = tile.querySelector('.sticker-bar');
    applyVoteUI(voteContainer, {
        upvotes: card.upvotes ?? 0,
        downvotes: card.downvotes ?? 0,
        user_vote: card.user_vote ?? null
    });
    applyCommentCount(voteContainer, card.comment_count ?? 0);
    applySuggestionCount(voteContainer, card.suggestion_count ?? 0);
    tile.querySelector('.upvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const data = await castVote(API_BASE, 'karteikarte', card.id, 'up', voteContainer);
        if (data) {
            card.upvotes = data.upvotes;
            card.downvotes = data.downvotes;
            card.user_vote = data.user_vote;
        }
    });
    tile.querySelector('.downvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const data = await castVote(API_BASE, 'karteikarte', card.id, 'down', voteContainer);
        if (data) {
            card.upvotes = data.upvotes;
            card.downvotes = data.downvotes;
            card.user_vote = data.user_vote;
        }
    });
    tile.querySelector('.comment-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openCommentsPanel(API_BASE, 'karteikarte', card.id, {
            title: card.question || 'Karteikarte',
            onCountChange: (count) => {
                card.comment_count = count;
                applyCommentCount(voteContainer, count);
            }
        });
    });
    tile.querySelector('.change-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openChangeSuggestionsPanel(API_BASE, 'karteikarte', card.id, {
            title: card.question || 'Karteikarte',
            mode: 'flashcard',
            onChangeRequest: ({ authorName, addSuggestion }) => {
                if (openSuggestionFormFn) {
                    openSuggestionFormFn(card, authorName, addSuggestion);
                }
            },
            onCardApplied: applyCardUpdate,
            onCountChange: (count) => {
                card.suggestion_count = count;
                applySuggestionCount(voteContainer, count);
            }
        });
    });
    tile.querySelector('.delete-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!confirm('Karteikarte wirklich löschen?')) return;
        try {
            await apiDelete(`${API_BASE}/api/flashcards/${card.id}`);
            allCards = allCards.filter(c => c.id !== card.id);
            renderGrid();
        } catch (err) {
            showApiError('Karteikarte konnte nicht gelöscht werden.');
        }
    });

    tile.setAttribute('tabindex', '0');
    tile.setAttribute('role', 'button');
    tile.title = card.question || '';
    tile.addEventListener('click', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        openFlashcardViewModal(card);
    });
    tile.addEventListener('keydown', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFlashcardViewModal(card); }
    });
    container.appendChild(tile);
}

/* ---------- Filterfunktion (Typ, Volltext, Sortierung) ---------- */

function cardSearchText(card) {
    const parts = [card.question, card.answer];
    if (card.typ === 'Oklusion') parts.push('Oklusion');
    for (const step of card.steps || []) {
        parts.push(step.frage, step.antwort);
    }
    for (const key of card.keys || []) {
        parts.push(key.schluessel, key.inhalt);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
}

function getFilteredCards() {
    const query = document.getElementById('kvSearchInput').value.trim().toLowerCase();
    const sort = document.getElementById('kvSortSelect').value;
    const typeFilter = document.getElementById('kvTypeSelect').value;
    let cards = allCards.filter(c => typeFilter === 'alle' || c.typ === typeFilter);
    if (query) {
        cards = cards.filter(c => cardSearchText(c).includes(query));
    }
    cards = cards.slice();
    if (sort === 'neueste') {
        cards.sort((a, b) => new Date(b.erstellungsdatum) - new Date(a.erstellungsdatum) || b.id - a.id);
    } else if (sort === 'aelteste') {
        cards.sort((a, b) => new Date(a.erstellungsdatum) - new Date(b.erstellungsdatum) || a.id - b.id);
    } else if (sort === 'upvotes') {
        cards.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    } else if (sort === 'downvotes') {
        cards.sort((a, b) => (b.downvotes || 0) - (a.downvotes || 0));
    }
    return cards;
}

function renderGrid() {
    const container = document.getElementById('links-container');
    container.innerHTML = '';
    const cards = getFilteredCards();
    if (cards.length === 0) {
        container.innerHTML = allCards.length === 0
            ? '<p>Keine Karteikarten vorhanden.</p>'
            : '<p>Keine Karteikarten gefunden.</p>';
        return;
    }
    cards.forEach(card => createCardTile(card));
}

function setupFilters() {
    document.getElementById('kvTypeSelect').addEventListener('change', renderGrid);
    document.getElementById('kvSearchInput').addEventListener('input', renderGrid);
    document.getElementById('kvSortSelect').addEventListener('change', renderGrid);
}

/* ---------- Laden ---------- */

async function resolveScopeContext(scope) {
    // Liefert Karten-Endpoint und Breadcrumb-Schritte je nach Herkunft
    if (scope.type === 'topic') {
        const topicRes = await fetch(`${API_BASE}/api/topics/${scope.id}`);
        if (!topicRes.ok) throw new Error('Topic not found');
        const topic = await topicRes.json();
        const courseRes = await fetch(`${API_BASE}/api/courses/${topic.kurs_id}`);
        if (!courseRes.ok) throw new Error('Course not found');
        const course = await courseRes.json();
        return {
            endpoint: `${API_BASE}/api/topics/${scope.id}/flashcards`,
            breadcrumb: [
                { id: 'index', title: 'Ebene 1', href: 'studiengaenge.html' },
                { id: 'layer2', title: 'Ebene 2', href: `kurse.html?program=${course.studiengang_id}` },
                { id: 'layer3', title: 'Ebene 3', href: `themen.html?course=${course.id}` }
            ]
        };
    }
    if (scope.type === 'course') {
        const courseRes = await fetch(`${API_BASE}/api/courses/${scope.id}`);
        if (!courseRes.ok) throw new Error('Course not found');
        const course = await courseRes.json();
        return {
            endpoint: `${API_BASE}/api/courses/${scope.id}/flashcards`,
            breadcrumb: [
                { id: 'index', title: 'Ebene 1', href: 'studiengaenge.html' },
                { id: 'layer2', title: 'Ebene 2', href: `kurse.html?program=${course.studiengang_id}` }
            ]
        };
    }
    const programRes = await fetch(`${API_BASE}/api/programs/${scope.id}`);
    if (!programRes.ok) throw new Error('Program not found');
    return {
        endpoint: `${API_BASE}/api/programs/${scope.id}/flashcards`,
        breadcrumb: [
            { id: 'index', title: 'Ebene 1', href: 'studiengaenge.html' }
        ]
    };
}

async function loadCards() {
    const container = document.getElementById('links-container');
    const scope = getScopeFromUrl();
    setLayerBrand(scope);
    if (!scope) {
        container.innerHTML = '<p>Kein Studiengang, Kurs oder Thema gewählt.</p>';
        return;
    }
    try {
        const context = await resolveScopeContext(scope);
        renderBreadcrumb(context.breadcrumb);
        const cardsRes = await fetch(`${context.endpoint}?${voterKeyQuery()}`);
        if (!cardsRes.ok) throw new Error('Flashcards failed');
        const cards = await cardsRes.json();
        allCards = cards.filter(c => c.question != null);
        renderGrid();
    } catch (err) {
        console.error('Karteikarten laden fehlgeschlagen:', err);
        container.innerHTML = '<p>Karteikarten konnten nicht geladen werden.</p>';
    }
}

setupCardsManageBtn(() => {
    const scope = getScopeFromUrl();
    if (!scope) return null;
    const targets = {
        topic: `karten.html?topic=${encodeURIComponent(scope.id)}`,
        course: `themen.html?course=${encodeURIComponent(scope.id)}`,
        program: `kurse.html?program=${encodeURIComponent(scope.id)}`
    };
    return targets[scope.type] || null;
});

window.addEventListener('load', () => {
    const { openSuggestionForm } = setupFlashcardSuggestionForm(API_BASE);
    openSuggestionFormFn = openSuggestionForm;
    initFlashcardViewModal({
        modal: document.getElementById('kvCardModal'),
        flashcard: document.getElementById('kvFlashcard'),
        content: document.getElementById('kv-flashcard-content'),
        closeBtn: document.getElementById('kvCloseBtn')
    });
    setupFilters();
    loadCards();
});
