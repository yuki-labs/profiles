/**
 * Per-element HTML renderers for profile embeds.
 * Each function returns a styled HTML fragment.
 */

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap');`;

function baseStyles(theme) {
    const primary = theme?.primaryColor || '#6366f1';
    return `
        ${FONTS}
        :root {
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --text-secondary: #cbd5e1;
            --primary: ${primary};
            --border: rgba(255,255,255,0.06);
            --glass-border: rgba(255,255,255,0.08);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: transparent;
            color: var(--text);
        }
        .embed-container {
            background: var(--card-bg);
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid var(--border);
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            max-width: 440px;
            width: 100%;
        }
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Individual element renderers ──

export function renderAvatar(profile) {
    const name = escapeHtml(profile.name);
    if (profile.avatar) {
        return `<img class="el-avatar" src="${escapeHtml(profile.avatar)}" alt="${name}" />`;
    }
    return `<div class="el-avatar el-avatar-placeholder">${(profile.name || '?').charAt(0)}</div>`;
}

export function renderName(profile) {
    return `<h1 class="el-name">${escapeHtml(profile.name) || 'Unnamed'}</h1>`;
}

export function renderTitle(profile) {
    return `<p class="el-title">${escapeHtml(profile.title) || ''}</p>`;
}

export function renderBio(profile) {
    if (!profile.bio) return '';
    return `<p class="el-bio">${escapeHtml(profile.bio)}</p>`;
}

export function renderSkills(profile) {
    if (!profile.skills?.length) return '';
    const tags = profile.skills.map(s =>
        `<span class="el-skill">${escapeHtml(s)}</span>`
    ).join('');
    return `<div class="el-skills">${tags}</div>`;
}

export function renderSocials(profile) {
    if (!profile.socials?.length) return '';
    const links = profile.socials.map(s =>
        `<a class="el-social-btn" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.platform)}</a>`
    ).join('');
    return `<div class="el-socials">${links}</div>`;
}

export function renderContact(profile) {
    const items = [];
    if (profile.location) items.push(`<div class="el-meta-item">📍 ${escapeHtml(profile.location)}</div>`);
    if (profile.email) items.push(`<div class="el-meta-item">✉️ ${escapeHtml(profile.email)}</div>`);
    if (profile.website) {
        const display = profile.website.replace(/^https?:\/\//, '');
        items.push(`<div class="el-meta-item">🌐 <a href="${escapeHtml(profile.website)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${escapeHtml(display)}</a></div>`);
    }
    if (items.length === 0) return '';
    return `<div class="el-contact">${items.join('')}</div>`;
}

// ── Element CSS ──

function elementStyles() {
    return `
        .el-avatar {
            width: 90px; height: 90px; border-radius: 50%;
            object-fit: cover; border: 3px solid var(--card-bg);
            display: flex; align-items: center; justify-content: center;
        }
        .el-avatar-placeholder {
            background: #334155; font-size: 36px; font-weight: bold;
            color: var(--primary); font-family: 'Outfit', sans-serif;
        }
        .el-name {
            font-family: 'Outfit', sans-serif; font-size: 22px;
            font-weight: 700; letter-spacing: -0.02em;
        }
        .el-title {
            color: var(--primary); font-size: 14px; font-weight: 500; margin-top: 4px;
        }
        .el-bio {
            font-size: 14px; color: var(--text-secondary); line-height: 1.6;
            padding: 16px 20px;
        }
        .el-skills {
            display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 20px;
        }
        .el-skill {
            padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
            background: color-mix(in srgb, var(--primary) 15%, transparent);
            color: var(--primary);
        }
        .el-socials {
            display: flex; flex-direction: column; gap: 8px; padding: 12px 20px;
        }
        .el-social-btn {
            display: block; padding: 10px 14px; background: #334155;
            border-radius: 8px; color: white; text-decoration: none;
            font-size: 13px; font-weight: 500; text-align: center;
            transition: background 0.2s, transform 0.2s;
        }
        .el-social-btn:hover { background: #475569; transform: translateX(4px); }
        .el-contact {
            display: flex; flex-direction: column; gap: 8px; padding: 12px 20px;
            font-size: 13px; color: var(--text-muted);
        }
        .el-meta-item { display: flex; align-items: center; gap: 6px; }
        .el-header {
            padding: 24px 20px; text-align: center;
            background: linear-gradient(to bottom, #334155, var(--card-bg));
            border-bottom: 2px solid var(--primary);
            display: flex; flex-direction: column; align-items: center; gap: 12px;
        }
        .el-section { padding: 4px 0; }
        .embed-loading {
            padding: 40px; text-align: center; color: var(--text-muted);
            font-size: 14px;
        }
        .embed-error {
            padding: 40px; text-align: center; color: #ef4444; font-size: 14px;
        }
    `;
}

// ── Assemble a full embed page ──

const RENDERERS = {
    avatar: renderAvatar,
    name: renderName,
    title: renderTitle,
    bio: renderBio,
    skills: renderSkills,
    socials: renderSocials,
    contact: renderContact,
};

const ALL_ELEMENTS = ['avatar', 'name', 'title', 'bio', 'contact', 'skills', 'socials'];

/**
 * Render selected profile elements as an HTML fragment.
 * @param {object} profile - Profile data
 * @param {string[]} showElements - Elements to render (empty = all)
 * @returns {string} HTML
 */
export function renderElements(profile, showElements) {
    const elements = showElements.length > 0 ? showElements : ALL_ELEMENTS;
    let html = '';

    // Group header elements (avatar, name, title) into a header block
    const headerEls = elements.filter(e => ['avatar', 'name', 'title'].includes(e));
    const bodyEls = elements.filter(e => !['avatar', 'name', 'title'].includes(e));

    if (headerEls.length > 0) {
        const headerContent = headerEls.map(el => RENDERERS[el]?.(profile) || '').join('');
        html += `<div class="el-header">${headerContent}</div>`;
    }

    if (bodyEls.length > 0) {
        const bodyContent = bodyEls.map(el => {
            const rendered = RENDERERS[el]?.(profile) || '';
            return rendered ? `<div class="el-section">${rendered}</div>` : '';
        }).join('');
        html += bodyContent;
    }

    return html;
}

/**
 * Generate a complete self-contained HTML embed page.
 */
export function renderPage(profile, showElements) {
    const content = renderElements(profile, showElements);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(profile.name || 'Profile')}</title>
    <style>${baseStyles(profile.theme)}${elementStyles()}</style>
</head>
<body>
    <div class="embed-container">${content}</div>
</body>
</html>`;
}

/**
 * Generate a loading page.
 */
export function renderLoadingPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>${baseStyles({})}${elementStyles()}</style>
</head>
<body>
    <div class="embed-container">
        <div class="embed-loading">Loading profile...</div>
    </div>
</body>
</html>`;
}

/**
 * Generate an error page.
 */
export function renderErrorPage(message) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>${baseStyles({})}${elementStyles()}</style>
</head>
<body>
    <div class="embed-container">
        <div class="embed-error">${escapeHtml(message)}</div>
    </div>
</body>
</html>`;
}
