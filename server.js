const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, './')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 房间数据
let room = {
    playerA: { ws: null, name: "1", chip: 1000, ready: false },
    playerB: { ws: null, name: "2", chip: 1000, ready: false },
    pool: 200,
    cards: {A:[], B:[]}
};

// 生成3张手牌
function createCards() {
    const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    const suits = ["♠","♥","♦","♣"];
    let allCards = [];
    for (const r of ranks) for (const s of suits) allCards.push(r + s);
    const cardA = [], cardB = [];
    for(let i=0;i<3;i++) cardA.push(allCards[Math.floor(Math.random()*allCards.length)]);
    for(let i=0;i<3;i++) cardB.push(allCards[Math.floor(Math.random()*allCards.length)]);
    return {A:cardA, B:cardB};
}

// 单独发给单个玩家
function sendTo(ws, data){
    ws.send(JSON.stringify(data));
}
// 广播给两个玩家
function broadcast(data){
    if(room.playerA.ws) room.playerA.ws.send(JSON.stringify(data));
    if(room.playerB.ws) room.playerB.ws.send(JSON.stringify(data));
}

wss.on('connection', (ws) => {
    ws.on('message', (rawMsg) => {
        const data = JSON.parse(rawMsg.toString());

        // 登录逻辑：提交名字绑定角色
        if(data.type === "login"){
            const userName = data.name.trim();
            if(userName === "1"){
                if(room.playerA.ws !== null){
                    sendTo(ws, {type:"msg", text:"玩家A席位已被占用！换名字2登录"});
                    return;
                }
                room.playerA.ws = ws;
                sendTo(ws, {type:"loginSuccess", role:"A"});
                broadcast({type:"playerJoin", name:"1", role:"A"});
            }else if(userName === "2"){
                if(room.playerB.ws !== null){
                    sendTo(ws, {type:"msg", text:"玩家B席位已被占用！换名字1登录"});
                    return;
                }
                room.playerB.ws = ws;
                sendTo(ws, {type:"loginSuccess", role:"B"});
                broadcast({type:"playerJoin", name:"2", role:"B"});
            }else{
                sendTo(ws, {type:"msg", text:"名字只能输入 1 或者 2！"});
            }
        }

        // 玩家点击准备
        if(data.type === "ready"){
            if(data.role === "A") room.playerA.ready = true;
            if(data.role === "B") room.playerB.ready = true;
            //两人全部准备完毕，倒计时发牌
            if(room.playerA.ready && room.playerB.ready){
                broadcast({type:"countdownStart"});
                setTimeout(()=>{
                    const cardResult = createCards();
                    room.cards.A = cardResult.A;
                    room.cards.B = cardResult.B;
                    sendTo(room.playerA.ws, {type:"newCard", myCards:room.cards.A, enemyCards:room.cards.B});
                    sendTo(room.playerB.ws, {type:"newCard", myCards:room.cards.B, enemyCards:room.cards.A});
                },3000);
            }
        }

        //下注逻辑
        if(data.type === "bet"){
            const betNum = data.num;
            if(data.role === "A"){
                if(betNum > room.playerA.chip){
                    sendTo(ws, {type:"msg", text:"余额不足，下注失败"});
                    return;
                }
                room.playerA.chip -= betNum;
                room.pool += betNum;
            }else{
                if(betNum > room.playerB.chip){
                    sendTo(ws, {type:"msg", text:"余额不足，下注失败"});
                    return;
                }
                room.playerB.chip -= betNum;
                room.pool += betNum;
            }
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
        //重置整局游戏
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

    //玩家断开连接，释放席位
    ws.on('close', ()=>{
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
server.listen(PORT, ()=>console.log("服务启动成功"));
