// Sicherer Markdown-Renderer für Flashcard-Inhalte.
// Unterstützte Teilmenge: **fett**, *kursiv*, __unterstrichen__,
// [orange|yellow|green]…[/…] Hintergrund-Markierung,
// $inline$ und $$block$$ LaTeX (KaTeX), "- " Listen,
// ![](data:image/...) Base64-Bilder. Beliebiges HTML wird escaped (Sicherheit).

import katex from '../vendor/katex/katex.mjs';

const ALLOWED_IMAGE_PREFIX = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const HIGHLIGHT_COLORS = ['orange', 'yellow', 'green'];

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function applyInlineBasic(escaped) {
    let out = escaped;
    out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+?)__/g, '<u>$1</u>');
    out = out.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    return out;
}

function applyInline(escaped) {
    let out = escaped;
    for (const color of HIGHLIGHT_COLORS) {
        const re = new RegExp('\\[' + color + '\\]([\\s\\S]+?)\\[\\/' + color + '\\]', 'g');
        out = out.replace(re, (match, inner) =>
            '<mark class="md-hl md-hl--' + color + '">' + applyInlineBasic(inner) + '</mark>'
        );
    }
    return applyInlineBasic(out);
}

function renderMathToken(token) {
    try {
        const html = katex.renderToString(token.latex, {
            throwOnError: false,
            displayMode: token.display
        });
        if (token.display) {
            return '<div class="md-math-block">' + html + '</div>';
        }
        return '<span class="md-math-inline">' + html + '</span>';
    } catch (_) {
        const raw = token.display ? '$$' + token.latex + '$$' : '$' + token.latex + '$';
        return escapeHtml(raw);
    }
}

function replaceMathPlaceholders(html, mathTokens) {
    return html.replace(/\u0000MATH(\d+)\u0000/g, (m, i) => {
        const token = mathTokens[Number(i)];
        return token ? renderMathToken(token) : '';
    });
}

function extractMath(raw) {
    const mathTokens = [];
    let out = raw.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex) => {
        const idx = mathTokens.length;
        mathTokens.push({ latex: String(latex).trim(), display: true });
        return '\u0000MATH' + idx + '\u0000';
    });
    out = out.replace(/\$([^$\n]+?)\$/g, (match, latex) => {
        const idx = mathTokens.length;
        mathTokens.push({ latex: String(latex).trim(), display: false });
        return '\u0000MATH' + idx + '\u0000';
    });
    return { text: out, mathTokens };
}

export function renderMarkdown(text) {
    if (text == null) return '';
    const raw = String(text);
    const images = [];
    const withImagePlaceholders = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const trimmed = String(url).trim();
        if (!ALLOWED_IMAGE_PREFIX.test(trimmed)) {
            return '';
        }
        const idx = images.length;
        images.push({ alt: String(alt || ''), url: trimmed });
        return '\u0000IMG' + idx + '\u0000';
    });

    const { text: withMathPlaceholders, mathTokens } = extractMath(withImagePlaceholders);

    const lines = withMathPlaceholders.split(/\r?\n/);
    let html = '';
    let inList = false;
    const closeList = () => {
        if (inList) {
            html += '</ul>';
            inList = false;
        }
    };

    for (const line of lines) {
        const listMatch = line.match(/^\s*-\s+(.*)$/);
        if (listMatch) {
            if (!inList) {
                html += '<ul>';
                inList = true;
            }
            html += '<li>' + replaceMathPlaceholders(applyInline(escapeHtml(listMatch[1])), mathTokens) + '</li>';
            continue;
        }
        closeList();
        const imgOnly = line.match(/^\u0000IMG(\d+)\u0000$/);
        if (imgOnly) {
            const img = images[Number(imgOnly[1])];
            if (img) {
                html += '<img class="md-image" src="' + img.url + '" alt="' + escapeHtml(img.alt) + '">';
            }
            continue;
        }
        const mathOnly = line.match(/^\u0000MATH(\d+)\u0000$/);
        if (mathOnly) {
            const token = mathTokens[Number(mathOnly[1])];
            if (token) html += renderMathToken(token);
            continue;
        }
        if (line.trim() === '') {
            html += '<br>';
            continue;
        }
        html += '<span class="md-line">' + replaceMathPlaceholders(applyInline(escapeHtml(line)), mathTokens) + '</span>';
    }
    closeList();

    html = html.replace(/\u0000IMG(\d+)\u0000/g, (m, i) => {
        const img = images[Number(i)];
        return img ? '<img class="md-image" src="' + img.url + '" alt="' + escapeHtml(img.alt) + '">' : '';
    });
    html = replaceMathPlaceholders(html, mathTokens);

    return html;
}
