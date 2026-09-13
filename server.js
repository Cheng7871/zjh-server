const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

let players = new Set();

wss.on('connection', (ws) => {
  players.add(ws);
  console.log("有玩家连上");

  ws.on('message', (msg) => {
    for(let client of players) {
      if(client.readyState === WebSocket.OPEN){
        client.send(msg.toString());
      }
    }
  })

  ws.on('close', ()=>{
    players.delete(ws);
    console.log("玩家下线");
  })
})

app.get('/', (req,res)=>{
  res.send("ZJH联机WebSocket服务正常运行！")
})

server.listen(PORT, ()=>{
  console.log(`服务启动，端口${PORT}`)
})
