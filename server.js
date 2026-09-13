const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname,"zjh.html"));
})

//全局配置
let globalConfig = {
    A_RATE:100,
    B_RATE:100,
    rateBao:10,
    rateShun:12,
    rateJin:15,
    rateTian:2
}
let gameState = {
    chipA:1000,
    chipB:1000,
    pool:200,
    myCards:[],
    enemyCards:[],
    showEnemyCard:false,
    nextConfirmA: false,
    nextConfirmB: false,
    roundEnd: false
}

// 新增：记录玩家准备状态
let readyStatus = {
    A:false,
    B:false
}
let players = {};

function broadcast(data){
    const str = JSON.stringify(data);
    wss.clients.forEach(client=>{
        if(client.readyState === WebSocket.OPEN){
            client.send(str);
        }
    })
}

wss.on('connection', (ws)=>{
    console.log("新玩家连接");
    ws.on('message', (raw)=>{
        const msg = JSON.parse(raw);
        switch(msg.type){
            case "login":{
                const role = msg.name === "1" ? "A" : "B";
                players[role] = ws;
                ws.send(JSON.stringify({type:"loginSuccess", role}));
                broadcast({type:"gameState", state:gameState})
                break;
            }
            case "ready":{
                // 标记当前玩家已准备
                readyStatus[msg.role] = true;
                console.log("准备状态：",readyStatus)
                // ✅关键：两个人都准备好，直接开局倒计时
                if(readyStatus.A && readyStatus.B){
                    //重置准备标记
                    readyStatus.A = false;
                    readyStatus.B = false;
                    broadcast({type:"bothReady"})
                }
                break;
            }
            case "updateAllSetting":{
                globalConfig.A_RATE = msg.A_RATE;
                globalConfig.B_RATE = msg.B_RATE;
                globalConfig.rateBao = msg.rateBao;
                globalConfig.rateShun = msg.rateShun;
                globalConfig.rateJin = msg.rateJin;
                globalConfig.rateTian = msg.rateTian;
                gameState.chipA = msg.chipA;
                gameState.chipB = msg.chipB;
                gameState.pool = msg.pool;
                broadcast({
                    type:"syncAllSetting",
                    ...globalConfig,
                    chipA:gameState.chipA,
                    chipB:gameState.chipB,
                    pool:gameState.pool
                })
                break;
            }
            case "requestNextRound":{
                if(msg.role === "A") gameState.nextConfirmA = true;
                if(msg.role === "B") gameState.nextConfirmB = true;
                if(gameState.nextConfirmA && gameState.nextConfirmB){
                    broadcast({type:"bothConfirmNext"})
                }
                break;
            }
            case "newRound":{
                gameState.nextConfirmA = false;
                gameState.nextConfirmB = false;
                gameState.roundEnd = false;
                broadcast({type:"gameState", state:gameState})
                break;
            }
            case "fold":{
                broadcast({type:"roundEnd"})
                broadcast({type:"result", text: msg.role+"弃牌，本局结束"})
                break;
            }
            case "openCard":{
                broadcast({type:"roundEnd"})
                broadcast({type:"result", text:"双方开牌，结算"})
                break;
            }
            case "resetGame":{
                gameState = {
                    chipA:1000,
                    chipB:1000,
                    pool:200,
                    myCards:[],
                    enemyCards:[],
                    showEnemyCard:false,
                    nextConfirmA: false,
                    nextConfirmB: false,
                    roundEnd: false
                }
                readyStatus = {A:false,B:false};
                broadcast({type:"gameState", state:gameState})
                break;
            }
        }
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>{
    console.log("服务器启动，端口："+PORT)
})
