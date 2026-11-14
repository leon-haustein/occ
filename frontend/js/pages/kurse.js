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

function getProgramIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('program');
}

function createCourseElement(course, programId) {
    const container = document.getElementById('links-container');
    const courseDiv = document.createElement('div');
    courseDiv.className = 'link-item';
    courseDiv.dataset.courseId = course.id;
    courseDiv.innerHTML = `
        <div class="link-content">
            <div class="course-title" data-course-id="${course.id}">${escapeHtml(course.name)}</div>
            <div class="sr-progress-bars"></div>
        </div>
        <div class="sticker-bar">
            <button type="button" class="upvote-icon icon-btn" aria-label="Kurs positiv bewerten" title="Positiv bewerten">
                ${UPVOTE_ICON_SVG}
            </button>
            <button type="button" class="downvote-icon icon-btn" aria-label="Kurs negativ bewerten" title="Negativ bewerten">
                ${DOWNVOTE_ICON_SVG}
            </button>
            <button type="button" class="comment-icon icon-btn" aria-label="Kurs kommentieren" title="Kommentieren">
                ${COMMENT_ICON_SVG}
            </button>
            <button type="button" class="change-icon icon-btn" aria-label="Kurs umbenennen vorschlagen" title="Änderung vorschlagen">
                ${CHANGE_ICON_SVG}
            </button>
            <button type="button" class="delete-icon" aria-label="Kurs löschen" title="Kurs löschen">
                ${DELETE_ICON_SVG}
                </button>
        </div>
    `;
    renderMiniBars(courseDiv.querySelector('.sr-progress-bars'), progressFromEntity(course));
    const deleteBtn = courseDiv.querySelector('.delete-icon');
    const goToCourse = () => { window.location.href = `themen.html?course=${encodeURIComponent(course.id)}`; };
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!confirm('Kurs wirklich löschen?')) return;
        try {
            await apiDelete(`${API_BASE}/api/courses/${course.id}`);
            courseDiv.remove();
        } catch (err) {
            showApiError('Kurs konnte nicht gelöscht werden.');
        }
    });
    const voteContainer = courseDiv.querySelector('.sticker-bar');
    applyVoteUI(voteContainer, {
        upvotes: course.upvotes ?? 0,
        downvotes: course.downvotes ?? 0,
        user_vote: course.user_vote ?? null
    });
    courseDiv.querySelector('.upvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await castVote(API_BASE, 'kurs', course.id, 'up', voteContainer);
    });
    courseDiv.querySelector('.downvote-icon')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await castVote(API_BASE, 'kurs', course.id, 'down', voteContainer);
    });
    applyCommentCount(voteContainer, course.comment_count ?? 0);
    applySuggestionCount(voteContainer, course.suggestion_count ?? 0);
    courseDiv.querySelector('.comment-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openCommentsPanel(API_BASE, 'kurs', course.id, {
            title: course.name,
            onCountChange: (count) => applyCommentCount(voteContainer, count)
        });
    });
    courseDiv.querySelector('.change-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openChangeSuggestionsPanel(API_BASE, 'kurs', course.id, {
            title: course.name,
            mode: 'rename',
            changePlaceholder: 'Neuen Kursnamen vorschlagen…',
            onCountChange: (count) => applySuggestionCount(voteContainer, count),
            onNameApplied: (newName) => {
                course.name = newName;
                courseDiv.querySelector('.course-title').textContent = newName;
                courseDiv.title = newName;
            }
        });
    });
    courseDiv.addEventListener('click', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        goToCourse();
    });
    courseDiv.setAttribute('tabindex', '0');
    courseDiv.setAttribute('role', 'button');
    courseDiv.title = course.name;
    courseDiv.addEventListener('keydown', (e) => {
        if (e.target.closest('.sticker-bar')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToCourse(); }
    });
    container.appendChild(courseDiv);
}

function setupAddCourse(programId) {
    const addBtn = document.getElementById('addCourseBtn');
    const form = document.getElementById('addCourseForm');
    const input = document.getElementById('newCourseName');
    const saveBtn = document.getElementById('saveNewCourseBtn');
    const cancelBtn = document.getElementById('cancelAddCourseBtn');
    addBtn.addEventListener('click', () => { form.style.display = 'flex'; input.value = ''; input.focus(); });
    cancelBtn.addEventListener('click', () => { form.style.display = 'none'; input.value = ''; });
    saveBtn.addEventListener('click', addCourse);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCourse(); });
    function addCourse() {
        const name = input.value.trim();
        if (!name) return;
        apiFetchJson(`${API_BASE}/api/courses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studiengang_id: programId, name })
        })
            .then((course) => {
                form.style.display = 'none';
                input.value = '';
                const container = document.getElementById('links-container');
                const p = container.querySelector('p');
                if (p) p.remove();
                createCourseElement(course, programId);
            })
            .catch(() => showApiError('Kurs konnte nicht angelegt werden.'));
    }
}

async function loadCourses() {
    const programId = getProgramIdFromUrl();
    if (!programId) {
        document.getElementById('links-container').innerHTML = '<p>Kein Studiengang gewählt.</p>';
        return;
    }
    try {
        const [programRes, coursesRes] = await Promise.all([
            fetch(`${API_BASE}/api/programs/${programId}`),
            fetch(`${API_BASE}/api/programs/${programId}/courses?${voterKeyQuery()}`)
        ]);
        if (!programRes.ok) throw new Error('Program not found');
        if (!coursesRes.ok) throw new Error('Courses failed');
        const courses = await coursesRes.json();
        createBreadcrumb();
        const container = document.getElementById('links-container');
        container.innerHTML = '';
        if (courses.length > 0) {
            courses.forEach(course => createCourseElement(course, programId));
        } else {
            container.innerHTML = '<p>Noch keine Kurse. Nutze + um einen Kurs hinzuzufügen.</p>';
        }
        setupAddCourse(programId);
    } catch (err) {
        console.error('Kurse laden fehlgeschlagen:', err);
        document.getElementById('links-container').innerHTML = '<p>Kurse konnten nicht geladen werden.</p>';
    }
}

setupCardsManageBtn(() => {
    const programId = getProgramIdFromUrl();
    return programId ? `Kartenverwaltung.html?program=${encodeURIComponent(programId)}` : null;
});

window.addEventListener('load', () => {
    loadCourses();
});
