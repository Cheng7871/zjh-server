const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, './')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 游戏房间：固定玩家A、B
let room = {
    playerA: { ws: null, name: "1", chip: 1000, ready: false },
    playerB: { ws: null, name: "2", chip: 1000, ready: false },
    pool: 200,
    cards: {A:[], B:[]}
};

// 生成手牌
function createCards() {
    const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    const suits = ["♠","♥","♦","♣"];
    let all = [];
    for (const r of ranks) for (const s of suits) all.push(r + s);
    const cA = [], cB = [];
    for(let i=0;i<3;i++) cA.push(all[Math.floor(Math.random()*all.length)]);
    for(let i=0;i<3;i++) cB.push(all[Math.floor(Math.random()*all.length)]);
    return {A:cA, B:cB};
}

// 单独发消息给某个玩家
function sendTo(ws, msg){
    ws.send(JSON.stringify(msg));
}
// 广播给两个人
function broadcast(msg){
    if(room.playerA.ws) room.playerA.ws.send(JSON.stringify(msg));
    if(room.playerB.ws) room.playerB.ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        const data = JSON.parse(raw.toString());

        // 玩家登录：提交名字，绑定A/B
        if(data.type === "login"){
            const userName = data.name.trim();
            if(userName === "1"){
                // 玩家A
                if(room.playerA.ws !== null){
                    sendTo(ws, {type:"msg", text:"玩家A已经有人了！"});
                    return;
                }
                room.playerA.ws = ws;
                sendTo(ws, {type:"loginSuccess", role:"A"});
                broadcast({type:"playerJoin", name:"1", role:"A"});
            }else if(userName === "2"){
                //玩家B
                if(room.playerB.ws !== null){
                    sendTo(ws, {type:"msg", text:"玩家B已经有人了！"});
                    return;
                }
                room.playerB.ws = ws;
                sendTo(ws, {type:"loginSuccess", role:"B"});
                broadcast({type:"playerJoin", name:"2", role:"B"});
            }else{
                sendTo(ws, {type:"msg", text:"名字只能填 1 或者 2！"});
            }
        }

        //准备
        if(data.type === "ready"){
            if(data.role === "A") room.playerA.ready = true;
            if(data.role === "B") room.playerB.ready = true;
            //两人全部准备，发牌
            if(room.playerA.ready && room.playerB.ready){
                broadcast({type:"countdownStart"});
                setTimeout(()=>{
                    const cardData = createCards();
                    room.cards.A = cardData.A;
                    room.cards.B = cardData.B;
                    //分别发各自手牌
                    sendTo(room.playerA.ws, {type:"newCard", myCards:room.cards.A, enemyCards:room.cards.B});
                    sendTo(room.playerB.ws, {type:"newCard", myCards:room.cards.B, enemyCards:room.cards.A});
                },3000);
            }
        }

        //下注
        if(data.type === "bet"){
            const num = data.num;
            if(data.role === "A"){
                if(num > room.playerA.chip){
                    sendTo(ws, {type:"msg", text:"余额不足，下注失败"});
                    return;
                }
                room.playerA.chip -= num;
                room.pool += num;
            }else{
                if(num > room.playerB.chip){
                    sendTo(ws, {type:"msg", text:"余额不足，下注失败"});
                    return;
                }
                room.playerB.chip -= num;
                room.pool += num;
            }
            //同步筹码界面
            broadcast({
                type:"syncState",
                chipA: room.playerA.chip,
                chipB: room.playerB.chip,
                pool: room.pool
            })
        }

        //弃牌
        if(data.type === "fold"){
            broadcast({type:"fold", who:data.role});
        }
        //开牌
        if(data.type === "openCard"){
            broadcast({type:"showAllCard"});
        }
        //重置游戏
        if(data.type === "reset"){
            room.playerA.ready = false;
            room.playerB.ready = false;
            room.playerA.chip = 1000;
            room.playerB.chip = 1000;
            room.pool = 200;
            room.cards = {A:[], B:[]};
            broadcast({
                type:"reset",
                chipA: room.playerA.chip,
                chipB: room.playerB.chip,
                pool: room.pool
            });
        }
    })

    ws.on('close', ()=>{
        //玩家断开，清空席位
        if(room.playerA.ws === ws){
            room.playerA.ws = null;
            room.playerA.ready = false;
            broadcast({type:"playerLeave", role:"A"});
        }
        if(room.playerB.ws === ws){
            room.playerB.ws = null;
            room.playerB.ready = false;
            broadcast({type:"playerLeave", role:"B"});
        }
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log("服务启动"));
