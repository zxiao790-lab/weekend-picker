const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 提供静态文件（index.html 等）
app.use(express.static(path.join(__dirname)));

// 分别缓存 items 和 votes（原始字符串，不重复 JSON.parse/stringify）
// 限制大小避免内存爆：单个超过 2MB 不缓存
let latestItems = null;
let latestVotes = null;
const MAX_CACHE_SIZE = 2 * 1024 * 1024;  // 2MB

const clients = new Set();

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ ok: true, clients: wss.clients.size, hasItems: latestItems !== null, hasVotes: latestVotes !== null, itemsSize: latestItems ? latestItems.length : 0 });
});

// 简单测试 imgbb API key 是否有效（保留备用）
app.get('/test-imgbb', async (req, res) => {
    res.json({ info: 'imgbb 已弃用，现在用 Cloudinary', cloudinary: 'la5j8aok' });
});

// 图片上传代理（已弃用，前端直接上传到 Cloudinary，不需要 server 代理）
app.post('/upload', (req, res) => {
    res.status(410).json({ error: '已弃用，前端直接上传到 Cloudinary' });
});

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size);

    // 新客户端连上时，直接拼接 latestItems + latestVotes 字符串发给他
    // 不重新 JSON.parse/stringify，避免大字符串重复分配内存
    if (ws.readyState === WebSocket.OPEN && (latestItems || latestVotes)) {
        let payload;
        if (latestItems && latestVotes) {
            payload = '{"items":' + latestItems + ',"votes":' + latestVotes + '}';
        } else if (latestItems) {
            payload = '{"items":' + latestItems + ',"votes":[]}';
        } else {
            payload = '{"items":[],"votes":' + latestVotes + '}';
        }
        try {
            ws.send(payload);
        } catch (e) {
            console.error('推送缓存失败:', e.message);
        }
    }

    ws.on('message', (message) => {
        const data = message.toString();
        try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.type === 'hello') {
                // hello 信号不缓存，只转发
            } else if (parsed && parsed.type === 'ping') {
                // 心跳信号不缓存，只转发
            } else {
                // 数据消息：缓存原始字符串（不重复 parse/stringify）
                // 但限制大小避免内存爆
                if (Array.isArray(parsed.items)) {
                    if (data.length <= MAX_CACHE_SIZE) {
                        latestItems = JSON.stringify(parsed.items);
                    } else {
                        console.log('⚠️ items 数据太大（', data.length, '字节），不缓存');
                        latestItems = null;  // 清空缓存避免不一致
                    }
                }
                if (Array.isArray(parsed.votes)) {
                    if (data.length <= MAX_CACHE_SIZE) {
                        latestVotes = JSON.stringify(parsed.votes);
                    } else {
                        latestVotes = null;
                    }
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
