const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
// 托管静态html文件，index.html、zjh.html都能直接访问
app.use(express.static(path.join(__dirname, './')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log("WebSocket 服务启动成功！");

wss.on('connection', (ws) => {
  console.log("有玩家连上");
  ws.on('message', (raw) => {
    // 收到消息，广播给所有在线人
    wss.clients.forEach(client => {
      if(client.readyState === WebSocket.OPEN){
        client.send(raw);
      }
    })
  })
  ws.on('close', ()=>{
    console.log("玩家断开")
  })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务监听端口 ${PORT}`);
});
