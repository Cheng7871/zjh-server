const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, './')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log("WebSocket 服务启动成功！");

wss.on('connection', (ws) => {
  console.log("有玩家连上");
  ws.on('message', (rawData) => {
    let msg = rawData.toString();
    // 广播：跳过发送消息的本人，发给其他所有人
    wss.clients.forEach(client => {
      if(client !== ws && client.readyState === WebSocket.OPEN){
        client.send(msg);
      }
    })
  })
  ws.on('close', ()=>{
    console.log("玩家断开连接")
  })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务监听端口 ${PORT}`);
});
