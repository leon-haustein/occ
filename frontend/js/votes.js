const VOTER_KEY_STORAGE = 'ovgu_voter_key';

// crypto.randomUUID existiert nur in sicheren Kontexten (HTTPS/localhost),
// daher Fallback über crypto.getRandomValues für HTTP-Auslieferung.
function generateVoterKey() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getVoterKey() {
    let key = localStorage.getItem(VOTER_KEY_STORAGE);
    if (!key) {
        key = generateVoterKey();
        localStorage.setItem(VOTER_KEY_STORAGE, key);
    }
    return key;
}

export function voterKeyQuery() {
    return `voter_key=${encodeURIComponent(getVoterKey())}`;
}

export function applyVoteUI(container, data) {
    if (!container) return;

    const upBtn = container.querySelector('[class*="upvote-icon"]');
    const downBtn = container.querySelector('[class*="downvote-icon"]');
    let upCount = container.querySelector('.vote-count--up');
    let downCount = container.querySelector('.vote-count--down');

    if (!upCount && upBtn) {
        upCount = document.createElement('span');
        upCount.className = 'vote-count vote-count--up';
        upBtn.appendChild(upCount);
    }
    if (!downCount && downBtn) {
        downCount = document.createElement('span');
        downCount.className = 'vote-count vote-count--down';
        downBtn.appendChild(downCount);
    }

    if (upCount) upCount.textContent = String(data.upvotes ?? 0);
    if (downCount) downCount.textContent = String(data.downvotes ?? 0);

    upBtn?.classList.toggle('is-active', data.user_vote === 1);
    downBtn?.classList.toggle('is-active', data.user_vote === -1);

    const deleteBtn = container.querySelector('.delete-icon');
    const upvotes = data.upvotes ?? 0;
    const downvotes = data.downvotes ?? 0;
    deleteBtn?.classList.toggle('is-flagged', downvotes - upvotes >= 3);
}

export async function castVote(apiBase, entityType, entityId, direction, container) {
    const res = await fetch(`${apiBase}/api/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            vote: direction,
            voter_key: getVoterKey()
        })
    });

    if (!res.ok) return null;

    const data = await res.json();
    applyVoteUI(container, data);
    return data;
}
