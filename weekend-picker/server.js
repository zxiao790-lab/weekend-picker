const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 提供静态文件（index.html 等）
app.use(express.static(path.join(__dirname)));

// 健康检查端点（Render 用来判断服务是否存活，会避免误判休眠）
app.get('/health', (req, res) => {
    res.json({ ok: true, clients: wss.clients.size });
});

// 存储所有 WebSocket 客户端
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size);

    ws.on('message', (message) => {
        // 把收到的数据广播给所有客户端（包括发送者自己）
        const data = message.toString();
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

// Render 通过环境变量 PORT 传端口，本地默认 3000
// 必须 listen 0.0.0.0，否则 Render 探测不到
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`✅ 协作服务已启动，端口 ${PORT}`);
});
