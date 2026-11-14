import '../init.js';
import { applyVoteUI, castVote, voterKeyQuery } from '../votes.js';
import { UPVOTE_ICON_SVG, DOWNVOTE_ICON_SVG, COMMENT_ICON_SVG, CHANGE_ICON_SVG, DELETE_ICON_SVG } from '../vector-graphics.js';
import { applyCommentCount, openCommentsPanel } from '../comments.js';
import { applySuggestionCount, openChangeSuggestionsPanel } from '../change-suggestions.js';
import { progressFromEntity, renderMiniBars } from '../progress-bars.js';
import { API_BASE } from '../config.js';
import { escapeHtml } from '../dom-utils.js';
import { createBreadcrumb } from '../breadcrumb.js';
import { setupCardsManageBtn } from '../layer-nav.js';
import { apiDelete, apiFetchJson, showApiError } from '../api.js';

function getCourseIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('course');
}

function createTopicElement(topic, courseId) {
    const container = document.getElementById('topics-container');
    const topicDiv = document.createElement('div');
    topicDiv.className = 'topic-item';
    topicDiv.dataset.topicId = topic.id;
    topicDiv.innerHTML = `
        <div class="topic-content">
            <div class="topic-title" data-topic-id="${topic.id}">${escapeHtml(topic.name)}</div>
            <div class="sr-progress-bars"></div>
        </div>
        <div class="sticker-bar">
            <button type="button" class="upvote-icon icon-btn" aria-label="Thema positiv bewerten" title="Positiv bewerten">
                ${UPVOTE_ICON_SVG}
            </button>
            <button type="button" class="downvote-icon icon-btn" aria-label="Thema negativ bewerten" title="Negativ bewerten">
                ${DOWNVOTE_ICON_SVG}
            </button>
            <button type="button" class="comment-icon icon-btn" aria-label="Thema kommentieren" title="Kommentieren">
                ${COMMENT_ICON_SVG}
            </button>
            <button type="button" class="change-icon icon-btn" aria-label="Thema umbenennen vorschlagen" title="Änderung vorschlagen">
                ${CHANGE_ICON_SVG}
            </button>
            <button type="button" class="delete-icon" aria-label="Thema löschen" title="Thema löschen">
                ${DELETE_ICON_SVG}
            </button>
        </div>
    `;
    renderMiniBars(topicDiv.querySelector('.sr-progress-bars'), progressFromEntity(topic));
    const deleteBtn = topicDiv.querySelector('.delete-icon');
    const goToTopic = () => { window.location.href = `karten.html?topic=${encodeURIComponent(topic.id)}`; };
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!confirm('Thema wirklich löschen?')) return;
        try {
            await apiDelete(`${API_BASE}/api/topics/${topic.id}`);
            topicDiv.remove();
        } catch (err) {
            showApiError('Thema konnte nicht gelöscht werden.');
        }
    });
    const voteContainer = topicDiv.querySelector('.sticker-bar');
    applyVoteUI(voteContainer, {
        upvotes: topic.upvotes ?? 0,
        downvotes: topic.downvotes ?? 0,
        user_vote: topic.user_vote ?? null
    });
    topicDiv.querySelector('.upvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await castVote(API_BASE, 'thema', topic.id, 'up', voteContainer);
    });
    topicDiv.querySelector('.downvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await castVote(API_BASE, 'thema', topic.id, 'down', voteContainer);
    });
    applyCommentCount(voteContainer, topic.comment_count ?? 0);
    applySuggestionCount(voteContainer, topic.suggestion_count ?? 0);
    topicDiv.querySelector('.comment-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openCommentsPanel(API_BASE, 'thema', topic.id, {
            title: topic.name,
            onCountChange: (count) => applyCommentCount(voteContainer, count)
        });
    });
    topicDiv.querySelector('.change-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openChangeSuggestionsPanel(API_BASE, 'thema', topic.id, {
            title: topic.name,
            mode: 'rename',
            changePlaceholder: 'Neuen Themennamen vorschlagen…',
            onCountChange: (count) => applySuggestionCount(voteContainer, count),
            onNameApplied: (newName) => {
                topic.name = newName;
                topicDiv.querySelector('.topic-title').textContent = newName;
                topicDiv.title = newName;
            }
        });
    });
    topicDiv.addEventListener('click', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        goToTopic();
    });
    topicDiv.setAttribute('tabindex', '0');
    topicDiv.setAttribute('role', 'button');
    topicDiv.title = topic.name;
    topicDiv.addEventListener('keydown', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToTopic(); }
    });
    container.appendChild(topicDiv);
}

function setupAddTopic(courseId) {
    const addBtn = document.getElementById('addTopicBtn');
    const form = document.getElementById('addTopicForm');
    const input = document.getElementById('newTopicName');
    const saveBtn = document.getElementById('saveNewTopicBtn');
    const cancelBtn = document.getElementById('cancelAddTopicBtn');
    addBtn.addEventListener('click', () => { form.style.display = 'flex'; input.value = ''; input.focus(); });
    cancelBtn.addEventListener('click', () => { form.style.display = 'none'; input.value = ''; });
    saveBtn.addEventListener('click', addTopic);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTopic(); });
    function addTopic() {
        const name = input.value.trim();
        if (!name) return;
        apiFetchJson(`${API_BASE}/api/topics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kurs_id: courseId, name })
        })
            .then((topic) => {
                form.style.display = 'none';
                input.value = '';
                const container = document.getElementById('topics-container');
                const p = container.querySelector('p');
                if (p) p.remove();
                createTopicElement(topic, courseId);
            })
            .catch(() => showApiError('Thema konnte nicht angelegt werden.'));
    }
}

async function loadTopics() {
    const courseId = getCourseIdFromUrl();
    if (!courseId) {
        document.getElementById('topics-container').innerHTML = '<p>Kein Kurs gewählt.</p>';
        return;
    }
    try {
        const courseRes = await fetch(`${API_BASE}/api/courses/${courseId}`);
        if (!courseRes.ok) throw new Error('Course not found');
        const course = await courseRes.json();
        const topicsRes = await fetch(`${API_BASE}/api/courses/${courseId}/topics?${voterKeyQuery()}`);
        if (!topicsRes.ok) throw new Error('Topics failed');
        const topics = await topicsRes.json();
        createBreadcrumb(3, { programId: course.studiengang_id, courseId });
        const container = document.getElementById('topics-container');
        container.innerHTML = '';
        if (topics.length > 0) {
            topics.forEach(topic => createTopicElement(topic, courseId));
        } else {
            container.innerHTML = '<p>Noch keine Themen. Nutze + um ein Thema hinzuzufügen.</p>';
        }
        setupAddTopic(courseId);
    } catch (err) {
        console.error('Themen laden fehlgeschlagen:', err);
        document.getElementById('topics-container').innerHTML = '<p>Themen konnten nicht geladen werden.</p>';
    }
}

setupCardsManageBtn(() => {
    const courseId = getCourseIdFromUrl();
    return courseId ? `Kartenverwaltung.html?course=${encodeURIComponent(courseId)}` : null;
});

window.addEventListener('load', () => {
    loadTopics();
});
