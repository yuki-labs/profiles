const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data', 'profiles');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// POST: Save a profile
app.post('/api/profiles', (req, res) => {
    try {
        const profileData = req.body;
        const id = nanoid(10);
        const filePath = path.join(DATA_DIR, `${id}.json`);

        fs.writeFileSync(filePath, JSON.stringify(profileData, null, 2));

        const shareUrl = `${req.protocol}://${req.get('host')}/p/${id}`;
        res.json({ id, shareUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

// GET: Retrieve profile data
app.get('/api/profiles/:id', (req, res) => {
    try {
        const { id } = req.params;
        const filePath = path.join(DATA_DIR, `${id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve profile' });
    }
});

// GET: Render embeddable page
app.get('/p/:id', (req, res) => {
    const { id } = req.params;
    const filePath = path.join(DATA_DIR, `${id}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Profile not found');
    }

    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // A standalone, minimalist HTML representation for embedding
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${profile.name || 'Profile'}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap');
        :root {
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --primary: ${profile.theme.primaryColor || '#6366f1'};
        }
        body {
            margin: 0;
            padding: 20px;
            font-family: 'Inter', sans-serif;
            background: transparent;
            color: var(--text);
            display: flex;
            justify-content: center;
        }
        .card {
            background: var(--card-bg);
            border-radius: 16px;
            width: 100%;
            max-width: 400px;
            overflow: hidden;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.05);
        }
        .header {
            padding: 30px 20px;
            background: linear-gradient(to bottom, #334155, #1e293b);
            text-align: center;
            border-bottom: 2px solid var(--primary);
        }
        .avatar {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            border: 3px solid var(--card-bg);
            margin: 0 auto 15px;
            object-fit: cover;
            background: #334155;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 40px;
            font-weight: bold;
            color: var(--primary);
        }
        h1 { font-family: 'Outfit', sans-serif; margin: 0; font-size: 24px; }
        .title { color: var(--primary); font-size: 14px; font-weight: 500; margin-top: 5px; }
        .body { padding: 25px; }
        .bio { font-size: 14px; color: #cbd5e1; line-height: 1.6; margin: 0 0 20px 0; }
        .meta { font-size: 13px; color: var(--text-muted); display: flex; flex-direction: column; gap: 8px; }
        .skills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
        .skill { padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; background: rgba(99, 102, 241, 0.1); color: var(--primary); }
        .socials { display: flex; flex-direction: column; gap: 10px; margin-top: 25px; }
        .social-btn { 
            display: block; 
            padding: 10px; 
            background: #334155; 
            border-radius: 8px; 
            color: white; 
            text-decoration: none; 
            font-size: 13px; 
            font-weight: 500;
            text-align: center;
            transition: transform 0.2s;
        }
        .social-btn:hover { transform: translateX(5px); background: #475569; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            ${profile.avatar ? `<img src="${profile.avatar}" class="avatar">` : `<div class="avatar">${(profile.name || '?').charAt(0)}</div>`}
            <h1>${profile.name || 'Unnamed'}</h1>
            <div class="title">${profile.title || ''}</div>
        </div>
        <div class="body">
            ${profile.bio ? `<p class="bio">${profile.bio}</p>` : ''}
            <div class="meta">
                ${profile.location ? `<div>📍 ${profile.location}</div>` : ''}
                ${profile.email ? `<div>✉️ ${profile.email}</div>` : ''}
                ${profile.website ? `<div>🌐 <a href="${profile.website}" style="color: inherit; text-decoration: none;">${profile.website.replace(/^https?:\/\//, '')}</a></div>` : ''}
            </div>
            ${profile.skills.length > 0 ? `
                <div class="skills">
                    ${profile.skills.map(s => `<span class="skill">${s}</span>`).join('')}
                </div>
            ` : ''}
            <div class="socials">
                ${profile.socials.map(s => `<a href="${s.url}" class="social-btn" target="_blank">${s.platform}</a>`).join('')}
            </div>
        </div>
    </div>
</body>
</html>
  `;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
