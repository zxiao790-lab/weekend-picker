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
    res.json({ ok: true, clients: wss.clients.size, hasData: latestData !== null });
});

// 缓存最近一次收到的 DATA（让新连上的客户端能立刻看到历史数据）
// 注意：server 重启会清空此缓存，要做永久存储需要数据库
let latestData = null;

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size, '有历史数据:', latestData !== null);

    // 新客户端连上时，立刻把缓存的历史数据推送给他
    if (latestData && ws.readyState === WebSocket.OPEN) {
        ws.send(latestData);
    }

    ws.on('message', (message) => {
        const data = message.toString();
        // 更新缓存（只缓存数组格式的数据消息，不缓存 hello 信号）
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                latestData = data;  // 原始字符串缓存
            }
        } catch (e) { /* hello 信号等非数据消息，跳过 */ }

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
