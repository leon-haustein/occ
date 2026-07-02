import { getVoterKey, applyVoteUI } from './votes.js';
import { typeIcon, typeIconKey } from './type-icons.js';
import { UPVOTE_ICON_SVG, DOWNVOTE_ICON_SVG } from './vote-icons.js';
import { openFlashcardViewModal, suggestionPayloadToCard } from './flashcard-view-modal.js';

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

const STYLE_TO_TYP = {
    standard: 'Standard',
    prozess: 'Prozess',
    mnemo: 'Mnemo',
    oklusion: 'Oklusion'
};

function previewQuestionFromSuggestion(suggestion) {
    if (suggestion.preview_question) return suggestion.preview_question;
    if (suggestion.payload) {
        const p = suggestion.payload;
        if (p.style === 'standard') return p.question || 'Standard-Karte';
        if (p.style === 'prozess') return p.titel || 'Prozess-Karte';
        if (p.style === 'mnemo') return p.title || 'Mnemo-Karte';
        if (p.style === 'oklusion') return (p.title && String(p.title).trim()) || 'Oklusion-Karte';
    }
    return 'Karteikarte';
}

function previewTypFromSuggestion(suggestion) {
    if (suggestion.payload?.style) {
        return STYLE_TO_TYP[suggestion.payload.style] || suggestion.payload.style;
    }
    return 'Standard';
}

function renderFlashcardSuggestionPreview(suggestion) {
    const title = previewQuestionFromSuggestion(suggestion);
    const typ = previewTypFromSuggestion(suggestion);
    return `
        <div class="change-suggestion-item__preview">
            <div class="link-item change-suggestion-card-preview">
                <span class="kv-typ-icon kv-typ-icon--${typeIconKey(typ)}" title="${escapeHtml(typ)}" aria-label="${escapeHtml(typ)}">${typeIcon(typ)}</span>
                <div class="link-content">
                    <div class="course-title">${escapeHtml(title)}</div>
                </div>
            </div>
        </div>
    `;
}

export async function fetchChangeSuggestions(apiBase, entityType, entityId) {
    const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: String(entityId),
        voter_key: getVoterKey()
    });
    const res = await fetch(`${apiBase}/api/change-suggestions?${params}`);
    if (!res.ok) throw new Error('Failed to load change suggestions');
    return res.json();
}

export async function postChangeSuggestion(apiBase, entityType, entityId, authorName, suggestedValue) {
    const value = entityType === 'karteikarte' && typeof suggestedValue === 'object'
        ? suggestedValue
        : suggestedValue;
    const res = await fetch(`${apiBase}/api/change-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            author_key: getVoterKey(),
            author_name: authorName,
            suggested_value: value
        })
    });
    if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch (_) {}
        throw new Error(data.error || 'Failed to add change suggestion');
    }
    return res.json();
}

export async function voteChangeSuggestion(apiBase, suggestionId, direction) {
    const res = await fetch(`${apiBase}/api/change-suggestions/${suggestionId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: direction, voter_key: getVoterKey() })
    });
    if (!res.ok) return null;
    return res.json();
}

export function renderChangeSuggestionItem(suggestion) {
    const li = document.createElement('li');
    const isApplied = suggestion.status === 'applied';
    const isContent = suggestion.suggestion_kind === 'content' || suggestion.entity_type === 'karteikarte';
    li.className = `change-suggestion-item${isApplied ? ' change-suggestion-item--applied' : ''}`;
    li.dataset.suggestionId = suggestion.id;
    li.dataset.itemType = 'change-suggestion';

    const voteButtons = isApplied ? '' : `
        <div class="change-suggestion-item__actions">
            <button type="button" class="upvote-icon icon-btn" aria-label="Vorschlag positiv bewerten" title="Positiv bewerten">
                ${UPVOTE_ICON_SVG}
            </button>
            <button type="button" class="downvote-icon icon-btn" aria-label="Vorschlag negativ bewerten" title="Negativ bewerten">
                ${DOWNVOTE_ICON_SVG}
            </button>
        </div>
    `;

    const badge = isApplied
        ? 'Angewendet'
        : (isContent ? 'Inhaltsvorschlag' : 'Namensvorschlag');

    const body = isContent
        ? renderFlashcardSuggestionPreview(suggestion)
        : `<p class="change-suggestion-item__value">${escapeHtml(suggestion.suggested_value)}</p>`;

    li.innerHTML = `
        <div class="change-suggestion-item__head">
            <span class="change-suggestion-item__badge">${badge}</span>
            <span class="change-suggestion-item__author">${escapeHtml(suggestion.author_name)}</span>
            <span class="change-suggestion-item__date">${escapeHtml(formatDate(suggestion.created_at))}</span>
        </div>
        ${body}
        ${voteButtons}
    `;

    if (!isApplied) {
        applyVoteUI(li.querySelector('.change-suggestion-item__actions'), {
            upvotes: suggestion.upvotes ?? 0,
            downvotes: suggestion.downvotes ?? 0,
            user_vote: suggestion.user_vote ?? null
        });
    }

    return li;
}

export function updateChangeSuggestionVotes(li, data) {
    if (data.status === 'applied') {
        li.classList.add('change-suggestion-item--applied');
        li.querySelector('.change-suggestion-item__badge').textContent = 'Angewendet';
        li.querySelector('.change-suggestion-item__actions')?.remove();
        return;
    }

    applyVoteUI(li.querySelector('.change-suggestion-item__actions'), data);
}

export function attachChangeSuggestionPreviewHandler(li, suggestion) {
    const isContent = suggestion.suggestion_kind === 'content' || suggestion.entity_type === 'karteikarte';
    if (!isContent || !suggestion.payload) return;

    const preview = li.querySelector('.change-suggestion-item__preview');
    if (!preview) return;

    preview.setAttribute('role', 'button');
    preview.setAttribute('tabindex', '0');
    preview.setAttribute('aria-label', 'Vorschlag anzeigen');

    function openPreview(e) {
        e.stopPropagation();
        const card = suggestionPayloadToCard(suggestion.payload);
        if (!card) return;
        openFlashcardViewModal(card, { useStacked: true });
    }

    preview.addEventListener('click', openPreview);
    preview.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPreview(e);
        }
    });
}

export function attachChangeSuggestionVoteHandlers(li, suggestion, apiBase, callbacks = {}) {
    if (suggestion.status === 'applied') return;

    const upBtn = li.querySelector('.upvote-icon');
    const downBtn = li.querySelector('.downvote-icon');

    async function handleVote(direction) {
        const data = await voteChangeSuggestion(apiBase, suggestion.id, direction);
        if (!data) return;
        updateChangeSuggestionVotes(li, data);
        if (data.applied) {
            if (data.updated_card && typeof callbacks.onCardApplied === 'function') {
                callbacks.onCardApplied(data.updated_card);
            } else if (data.new_name && typeof callbacks.onNameApplied === 'function') {
                callbacks.onNameApplied(data.new_name);
            }
        }
    }

    upBtn?.addEventListener('click', () => handleVote('up'));
    downBtn?.addEventListener('click', () => handleVote('down'));
}
