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
    // 强制转成字符串文本，解决Blob二进制乱码问题
    let msg = rawData.toString();
    // 广播文本给所有人
    wss.clients.forEach(client => {
      if(client.readyState === WebSocket.OPEN){
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
