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

// 分别缓存 items 和 votes
// 解决场景：A 投票时只广播 {votes: [...]}（小数据，不重发大 base64 items），
// server 不能让 votes 消息覆盖 items 缓存——否则新客户端连上时收不到 items。
// 改为分别缓存，新客户端连上时合并推送。
let latestItems = null;    // 原始字符串：'[...]'
let latestVotes = null;    // 原始字符串：'[...]'

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size, '有 items:', latestItems !== null, '有 votes:', latestVotes !== null);

    // 新客户端连上时，合并推 latestItems + latestVotes 给他
    if (ws.readyState === WebSocket.OPEN) {
        const items = latestItems || '[]';
        const votes = latestVotes || '[]';
        const merged = `{"items":${items},"votes":${votes}}`;
        ws.send(merged);
    }

    ws.on('message', (message) => {
        const data = message.toString();
        // 解析消息内容，分别更新 latestItems / latestVotes
        try {
            const parsed = JSON.parse(data);
            // hello 信号不缓存，只广播
            if (parsed && parsed.type === 'hello') {
                // 只转发不缓存
            } else {
                // 数据消息：分别缓存 items 和 votes
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
