const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 提供静态文件（index.html 等）
app.use(express.static(path.join(__dirname)));

// 分别缓存 items 和 votes
let latestItems = null;
let latestVotes = null;

const clients = new Set();

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ ok: true, clients: wss.clients.size, hasItems: latestItems !== null, hasVotes: latestVotes !== null, imgbbConfigured: !!process.env.IMGBB_API_KEY });
});

// 简单测试 imgbb API key 是否有效
app.get('/test-imgbb', async (req, res) => {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
        return res.json({ error: 'IMGBB_API_KEY 环境变量未配置' });
    }
    try {
        const testBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const formData = new FormData();
        formData.append('image', testBase64);
        const r = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: formData
        });
        const data = await r.json();
        res.json({
            httpStatus: r.status,
            imgbbResponse: data
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 图片上传代理：前端 POST /upload，server 转发到 imgbb
// body: { image: <base64 字符串，不带 data:image/jpeg;base64, 前缀> }
// 返回: { url: 'https://i.ibb.co/xxx.jpg' }
app.post('/upload', express.json({ limit: '15mb' }), async (req, res) => {
    try {
        const apiKey = process.env.IMGBB_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: '服务器未配置 IMGBB_API_KEY 环境变量' });
        }
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: '缺少 image 字段' });
        }

        // 用 multipart/form-data 格式
        const formData = new FormData();
        formData.append('image', image);

        const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: formData
        });

        const data = await imgbbResponse.json();

        if (data.success && data.data && data.data.url) {
            res.json({
                url: data.data.url,
                thumb: data.data.thumb ? data.data.thumb.url : null,
                medium: data.data.medium ? data.data.medium.url : null
            });
        } else {
            console.error('imgbb 上传失败 HTTP', imgbbResponse.status, ':', JSON.stringify(data));
            res.status(500).json({
                error: 'imgbb 拒绝上传',
                httpStatus: imgbbResponse.status,
                imgbbError: data
            });
        }
    } catch (e) {
        console.error('上传代理出错:', e);
        res.status(500).json({ error: 'server 错误: ' + e.message });
    }
});

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size, '有 items:', latestItems !== null, '有 votes:', latestVotes !== null);

    if (ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
            items: latestItems ? JSON.parse(latestItems) : [],
            votes: latestVotes ? JSON.parse(latestVotes) : []
        });
        ws.send(payload);
    }

    ws.on('message', (message) => {
        const data = message.toString();
        try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.type === 'hello') {
                // hello 信号不缓存，只转发
            } else {
                if (Array.isArray(parsed.items)) {
                    latestItems = JSON.stringify(parsed.items);
                }
                if (Array.isArray(parsed.votes)) {
                    latestVotes = JSON.stringify(parsed.votes);
                }
            }
        } catch (e) { /* 不是 JSON，忽略 */ }

        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('🔴 用户断开，当前在线:', clients.size);
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`✅ 协作服务已启动，端口 ${PORT}`);
    if (!process.env.IMGBB_API_KEY) {
        console.log('⚠️  警告：IMGBB_API_KEY 环境变量未配置，图片上传功能不可用');
        console.log('   在 Render Dashboard → Environment → 添加 IMGBB_API_KEY = <你的 key>');
    } else {
        console.log('✅ IMGBB_API_KEY 已配置');
    }
});
