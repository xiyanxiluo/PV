/* =====================================================================
   PV Project Manager — Backend Server
   Node.js + Express + JSON file storage + JWT
   Zero native dependencies — works anywhere without compilation
   ===================================================================== */

// ---- Imports ----
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// ---- Config ----
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pv_manager_secret_' + Math.random().toString(36).slice(2);
const JWT_EXPIRY = '7d';
const BCRYPT_ROUNDS = 10;
const DB_PATH = path.join(__dirname, 'pv_data.json');

const app = express();

// ---- JSON File Database ----
let DB = { users: [], projects: [], drafts: [] };
let nextUserId = 1;
let nextDraftId = 1;

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const raw = fs.readFileSync(DB_PATH, 'utf-8');
            DB = JSON.parse(raw);
            // Ensure all arrays exist
            DB.users = DB.users || [];
            DB.projects = DB.projects || [];
            DB.drafts = DB.drafts || [];
            // Recalculate next IDs
            nextUserId = DB.users.reduce((max, u) => Math.max(max, u.id + 1), 1);
            nextDraftId = DB.drafts.reduce((max, d) => Math.max(max, d.id + 1), 1);
            console.log('  已加载数据库: ' + DB.users.length + ' 用户, ' + DB.projects.length + ' 项目');
        }
    } catch (e) {
        console.error('  数据库读取失败，使用空数据库:', e.message);
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(DB, null, 2), 'utf-8');
    } catch (e) {
        console.error('  数据库写入失败:', e.message);
    }
}

loadDB();

// ---- Middleware ----
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ---- Auth Middleware ----
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录，请先登录' });
    }
    try {
        req.user = jwt.verify(header.slice(7), JWT_SECRET); // { userId, username }
        next();
    } catch (err) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
}

// ---- Validation ----
function validateUsername(username) {
    if (!username || username.length < 3 || username.length > 20) return false;
    if (!/^[a-zA-Z一-龥]/.test(username)) return false;
    return /^[a-zA-Z0-9_一-龥]+$/.test(username);
}

function validatePassword(password) {
    return password && password.length >= 6;
}

function nowISO() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// =====================================================================
// AUTH ROUTES
// =====================================================================

app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!validateUsername(username)) {
            return res.status(400).json({ error: '用户名需3-20个字符，字母或中文开头，可含数字和下划线' });
        }
        if (!validatePassword(password)) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }
        if (DB.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
            return res.status(409).json({ error: '该用户名已被注册，请更换用户名' });
        }

        const user = {
            id: nextUserId++,
            username,
            password_hash: bcrypt.hashSync(password, BCRYPT_ROUNDS),
            created_at: nowISO(),
        };
        DB.users.push(user);
        saveDB();

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        res.json({ token, username });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        const user = DB.users.find(u => u.username === username);
        if (!user) {
            return res.status(401).json({ error: '用户名不存在' });
        }
        if (!bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: '密码错误' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        res.json({ token, username: user.username });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// =====================================================================
// PROJECT ROUTES (auth required)
// =====================================================================

app.get('/api/projects', authMiddleware, (req, res) => {
    try {
        const projects = DB.projects
            .filter(p => p.user_id === req.user.userId)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .map(p => ({
                id: p.project_id,
                name: p.name,
                location: p.location,
                generationMode: p.generation_mode,
                createdAt: p.created_at,
                updatedAt: p.updated_at,
                rawData: typeof p.raw_data === 'string' ? JSON.parse(p.raw_data) : p.raw_data,
            }));
        res.json(projects);
    } catch (err) {
        console.error('Get projects error:', err);
        res.status(500).json({ error: '获取项目列表失败' });
    }
});

app.post('/api/projects', authMiddleware, (req, res) => {
    try {
        const { id, name, location, generationMode, rawData } = req.body;
        const projectId = id || ('pv_' + Date.now());
        const ts = nowISO();

        const existingIdx = DB.projects.findIndex(
            p => p.user_id === req.user.userId && p.project_id === projectId
        );

        if (existingIdx >= 0) {
            // Update
            DB.projects[existingIdx].name = name || '';
            DB.projects[existingIdx].location = location || '';
            DB.projects[existingIdx].generation_mode = generationMode || '';
            DB.projects[existingIdx].raw_data = rawData || {};
            DB.projects[existingIdx].updated_at = ts;
        } else {
            // Create
            DB.projects.push({
                id: DB.projects.length + 1, // internal auto-increment ID
                user_id: req.user.userId,
                project_id: projectId,
                name: name || '',
                location: location || '',
                generation_mode: generationMode || '',
                raw_data: rawData || {},
                created_at: ts,
                updated_at: ts,
            });
        }

        saveDB();
        res.json({ id: projectId, name, location, generationMode, rawData });
    } catch (err) {
        console.error('Save project error:', err);
        res.status(500).json({ error: '保存项目失败' });
    }
});

app.delete('/api/projects/:id', authMiddleware, (req, res) => {
    try {
        const idx = DB.projects.findIndex(
            p => p.user_id === req.user.userId && p.project_id === req.params.id
        );
        if (idx < 0) {
            return res.status(404).json({ error: '项目未找到' });
        }
        DB.projects.splice(idx, 1);
        saveDB();
        res.json({ success: true });
    } catch (err) {
        console.error('Delete project error:', err);
        res.status(500).json({ error: '删除项目失败' });
    }
});

// =====================================================================
// DRAFT ROUTES (auth required)
// =====================================================================

app.get('/api/draft', authMiddleware, (req, res) => {
    try {
        const draft = DB.drafts.find(d => d.user_id === req.user.userId);
        const rawData = draft ? (typeof draft.raw_data === 'string' ? JSON.parse(draft.raw_data) : draft.raw_data) : null;
        res.json({ rawData });
    } catch (err) {
        console.error('Get draft error:', err);
        res.status(500).json({ error: '获取草稿失败' });
    }
});

app.put('/api/draft', authMiddleware, (req, res) => {
    try {
        const { rawData } = req.body;
        const ts = nowISO();

        const existingIdx = DB.drafts.findIndex(d => d.user_id === req.user.userId);
        if (existingIdx >= 0) {
            DB.drafts[existingIdx].raw_data = rawData || {};
            DB.drafts[existingIdx].updated_at = ts;
        } else {
            DB.drafts.push({
                id: nextDraftId++,
                user_id: req.user.userId,
                raw_data: rawData || {},
                updated_at: ts,
            });
        }

        saveDB();
        res.json({ success: true });
    } catch (err) {
        console.error('Save draft error:', err);
        res.status(500).json({ error: '保存草稿失败' });
    }
});

// =====================================================================
// MIGRATION — import localStorage data to server
// =====================================================================

app.post('/api/migrate', authMiddleware, (req, res) => {
    try {
        const { projects, draft } = req.body;
        let count = 0;

        for (const p of (projects || [])) {
            const exists = DB.projects.some(
                r => r.user_id === req.user.userId && r.project_id === p.id
            );
            if (!exists) {
                const ts = nowISO();
                DB.projects.push({
                    id: DB.projects.length + 1,
                    user_id: req.user.userId,
                    project_id: p.id,
                    name: p.name || '',
                    location: p.location || '',
                    generation_mode: p.generationMode || '',
                    raw_data: p.rawData || {},
                    created_at: p.createdAt ? new Date(p.createdAt).toISOString().replace('T', ' ').slice(0, 19) : ts,
                    updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString().replace('T', ' ').slice(0, 19) : ts,
                });
                count++;
            }
        }

        let draftMigrated = false;
        if (draft && !DB.drafts.some(d => d.user_id === req.user.userId)) {
            DB.drafts.push({
                id: nextDraftId++,
                user_id: req.user.userId,
                raw_data: draft,
                updated_at: nowISO(),
            });
            draftMigrated = true;
        }

        saveDB();
        res.json({ count, draftMigrated });
    } catch (err) {
        console.error('Migration error:', err);
        res.status(500).json({ error: '数据迁移失败' });
    }
});

// =====================================================================
// PING — connectivity check
// =====================================================================

app.get('/api/ping', (req, res) => {
    res.json({ ok: true, time: Date.now() });
});

// =====================================================================
// STATIC FILES — serve the HTML frontend
// =====================================================================

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '光伏项目信息表单.html'));
});

// =====================================================================
// START
// =====================================================================

app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║  光伏项目管理系统 — 后端服务已启动       ║');
    console.log('  ║  http://localhost:' + String(PORT).padEnd(18) + '       ║');
    console.log('  ║  数据文件: pv_data.json                  ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
});
