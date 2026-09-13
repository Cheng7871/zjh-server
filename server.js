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
    cardsA:[],
    cardsB:[],
    showEnemyCard:false,
    nextConfirmA: false,
    nextConfirmB: false,
    roundEnd: false
}

let readyStatus = {
    A:false,
    B:false
}
let players = {};
let connections = [];

//广播全部客户端
function broadcast(obj){
    const data = JSON.stringify(obj);
    connections.forEach(ws=>{
        if(ws.readyState === 1) ws.send(data);
    })
}

// 检测游戏是否结束（筹码归零）
function checkGameOver(){
    if(gameState.chipA <= 0){
        broadcast({type:"gameOver", winner:"玩家B"});
        return true;
    }
    if(gameState.chipB <=0){
        broadcast({type:"gameOver", winner:"玩家A"});
        return true;
    }
    return false;
}

wss.on('connection', (ws)=>{
    connections.push(ws);
    ws.on('message', (raw)=>{
        const msg = JSON.parse(raw);
        switch(msg.type){
            case "login":
                const role = msg.name === "1" ? "A" : "B";
                players[role] = ws;
                ws.send(JSON.stringify({type:"loginSuccess", role}));
                broadcast({type:"gameState", state:gameState});
                break;
            case "ready":
                readyStatus[msg.role] = true;
                if(readyStatus.A && readyStatus.B){
                    broadcast({type:"bothReady"});
                }
                break;
            case "newRound":
                gameState.showEnemyCard = false;
                gameState.nextConfirmA = false;
                gameState.nextConfirmB = false;
                gameState.roundEnd = false;
                readyStatus.A = false;
                readyStatus.B = false;
                //发牌逻辑省略，你原有发牌代码放这里
                broadcast({type:"gameState", state:gameState});
                break;
            case "requestNextRound":
                if(msg.role === "A") gameState.nextConfirmA = true;
                if(msg.role === "B") gameState.nextConfirmB = true;
                if(gameState.nextConfirmA && gameState.nextConfirmB){
                    broadcast({type:"bothConfirmNext"});
                }
                broadcast({type:"gameState", state:gameState});
                break;
            case "openCard":
                //开牌结算，扣除筹码、底池分配
                let winner = "玩家A";
                //你的原有牌型对比代码放这里
                if(winner === "玩家A"){
                    gameState.chipA += gameState.pool;
                }else{
                    gameState.chipB += gameState.pool;
                }
                gameState.pool = 0;
                // 结算后检查是否有人输光筹码
                if(!checkGameOver()){
                    broadcast({type:"roundEndSequence", winner});
                }
                broadcast({type:"gameState", state:gameState});
                break;
            case "fullResetGame":
                //全局重置游戏
                gameState = {
                    chipA:1000,
                    chipB:1000,
                    pool:200,
                    cardsA:[],
                    cardsB:[],
                    showEnemyCard:false,
                    nextConfirmA: false,
                    nextConfirmB: false,
                    roundEnd: false
                }
                readyStatus={A:false,B:false};
                broadcast({type:"gameState", state:gameState});
                break;
            case "updateAllSetting":
                globalConfig.A_RATE = msg.A_RATE;
                globalConfig.B_RATE = msg.B_RATE;
                globalConfig.rateBao = msg.rateBao;
                globalConfig.rateShun = msg.rateShun;
                globalConfig.rateJin = msg.rateJin;
                globalConfig.rateTian = msg.rateTian;
                gameState.chipA = msg.chipA;
                gameState.chipB = msg.chipB;
                gameState.pool = msg.pool;
                broadcast({type:"syncAllSetting", ...msg});
                break;
        }
    })
    ws.on('close',()=>{
        const idx = connections.indexOf(ws);
        if(idx>-1) connections.splice(idx,1);
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>{
    console.log("服务器启动，端口：",PORT);
})
