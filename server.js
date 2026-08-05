const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 提供静态文件（index.html 等）
app.use(express.static(path.join(__dirname)));

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ ok: true, clients: wss.clients.size, hasItems: latestItems !== null, hasVotes: latestVotes !== null });
});

// 图片上传代理：前端 POST /upload，server 转发到 imgbb（API key 不暴露在前端）
// body: { image: <base64 字符串，不带 data:image/jpeg;base64, 前缀> }
// 返回: { url: 'https://i.ibb.co/xxx.jpg' }
app.post('/upload', express.json({ limit: '10mb' }), async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: '缺少 image 字段' });
        }
        // API key 优先用环境变量（部署到 Render 时设置 IMGBB_API_KEY）
        // fallback 是默认值（开发用）
        const apiKey = process.env.IMGBB_API_KEY || '3cdf0606b9b57155dcb4760c6bec9fd9';
        const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ image })
        });
        const data = await imgbbResponse.json();
        if (data.success) {
            // 返回 img bb 的展示 URL（viewer 页）+ 直链 URL
            res.json({
                url: data.data.url,                  // 直链（用于 <img src>）
                thumb: data.data.thumb ? data.data.thumb.url : null,
                medium: data.data.medium ? data.data.medium.url : null,
                delete_url: data.data.delete_url
            });
        } else {
            console.error('imgbb 上传失败:', data);
            res.status(500).json({ error: 'imgbb 返回失败', detail: data });
        }
    } catch (e) {
        console.error('上传代理出错:', e);
        res.status(500).json({ error: e.message });
    }
});

// 分别缓存 items 和 votes（投票只广播 votes 时不会覆盖 items 缓存）
let latestItems = null;
let latestVotes = null;

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size, '有 items:', latestItems !== null, '有 votes:', latestVotes !== null);

    // 新客户端连上时，合并推 latestItems + latestVotes 给他
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

        // 把收到的数据广播给所有客户端（包括发送者自己）
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
});
