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
let latestItems = null;
let latestVotes = null;
const MAX_CACHE_SIZE = 1 * 1024 * 1024;  // 1MB，超过不缓存避免内存爆

const clients = new Set();

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ ok: true, clients: wss.clients.size, hasItems: latestItems !== null, hasVotes: latestVotes !== null, itemsSize: latestItems ? latestItems.length : 0 });
});

// 工具：过滤 item.images 里的 base64（只保留 http 开头的 URL）
// 返回 { cleaned: 是否修改过, items: 清洗后的 items 数组 }
function cleanItemImages(items) {
    let modified = false;
    const cleaned = items.map(item => {
        if (!item || !Array.isArray(item.images)) return item;
        const originalLen = item.images.length;
        const cleanImages = item.images.filter(src => typeof src === 'string' && src.startsWith('http'));
        if (cleanImages.length !== originalLen) {
            modified = true;
            return { ...item, images: cleanImages };
        }
        return item;
    });
    return { modified, items: cleaned };
}

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🟢 新用户连接，当前在线:', clients.size, '有 items:', latestItems !== null, '有 votes:', latestVotes !== null);

    // 新客户端连上时，合并推 latestItems + latestVotes 给他
    if (ws.readyState === WebSocket.OPEN) {
        // 直接字符串拼接，不重新 parse/stringify，省内存
        const itemsStr = latestItems || '[]';
        const votesStr = latestVotes || '[]';
        const payload = '{"items":' + itemsStr + ',"votes":' + votesStr + '}';
        ws.send(payload);
    }

    ws.on('message', (message) => {
        let data = message.toString();

        try {
            const parsed = JSON.parse(data);
            // hello 信号不缓存，只转发
            if (parsed && parsed.type === 'hello') {
                // 不缓存，直接广播给所有
            } else if (parsed && typeof parsed === 'object') {
                // 数据消息：主动过滤 base64 图片（避免缓存大数据撑爆内存）
                if (Array.isArray(parsed.items)) {
                    const { modified, items: cleanedItems } = cleanItemImages(parsed.items);
                    if (modified) {
                        parsed.items = cleanedItems;
                        data = JSON.stringify(parsed);  // 重新序列化（清洗后小很多）
                        console.log('🧹 过滤掉 base64 图片，消息大小: ', data.length, '字节');
                    }
                }
                // 缓存（限制大小）
                if (Array.isArray(parsed.items)) {
                    const itemsStr = JSON.stringify(parsed.items);
                    if (itemsStr.length <= MAX_CACHE_SIZE) {
                        latestItems = itemsStr;
                    } else {
                        console.log('⚠️ items 太大（', itemsStr.length, '字节），不缓存');
                        latestItems = null;
                    }
                }
                if (Array.isArray(parsed.votes)) {
                    const votesStr = JSON.stringify(parsed.votes);
                    if (votesStr.length <= MAX_CACHE_SIZE) {
                        latestVotes = votesStr;
                    } else {
                        latestVotes = null;
                    }
                }
            }
        } catch (e) { /* 不是 JSON，忽略 */ }

        // 把数据广播给所有客户端（包括发送者自己）
        // 注意：data 可能已经被清洗过（base64 过滤后），所以所有客户端都会收到清洗版
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
