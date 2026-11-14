export class ApiError extends Error {
    constructor(message, status = 0, url = '') {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.url = url;
    }
}

export async function apiFetch(url, options = {}) {
    let res;
    try {
        res = await fetch(url, options);
    } catch (err) {
        console.error('Netzwerkfehler:', url, err);
        throw new ApiError('Netzwerkfehler', 0, url);
    }
    if (!res.ok) {
        console.error('API-Fehler:', url, res.status);
        throw new ApiError(`Anfrage fehlgeschlagen (${res.status})`, res.status, url);
    }
    return res;
}

export async function apiFetchJson(url, options = {}) {
    const res = await apiFetch(url, options);
    return res.json();
}

export async function apiDelete(url) {
    await apiFetch(url, { method: 'DELETE' });
}

let toastTimeout = null;

/** Kurze Fehlermeldung unten auf der Seite (4 s). */
export function showApiError(message = 'Aktion fehlgeschlagen. Bitte später erneut versuchen.') {
    let toast = document.getElementById('api-error-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'api-error-toast';
        toast.setAttribute('role', 'alert');
        toast.className = 'api-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('is-visible'), 4000);
}
