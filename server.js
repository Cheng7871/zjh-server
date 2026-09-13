const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, './')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let room = {
    playerA: { ws: null, name: "1", chip: 1000, ready: false },
    playerB: { ws: null, name: "2", chip: 1000, ready: false },
    pool: 200,
    cards: {A:[], B:[]},
    gameOver: false
};

// 牌权重映射
const rankWeight = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};

// 解析手牌，返回牌型权重，越大越强
function parseCards(cardList){
    const ranks = [];
    const suits = [];
    cardList.forEach(c=>{
        let r = c.replace(/[♠♥♦♣]/g,"");
        let s = c.replace(/[0-9JQKA]/g,"");
        ranks.push(rankWeight[r]);
        suits.push(s);
    })
    ranks.sort((a,b)=>b-a);
    const isSameSuit = suits[0]===suits[1] && suits[1]===suits[2];
    const sorted = [...ranks].sort((a,b)=>a-b);
    const isStraight = (sorted[0]+1 === sorted[1] && sorted[1]+1 === sorted[2]);
    const set = new Set(ranks);

    if(set.size ===1) return {type:6, val:ranks[0], name:"豹子"};
    if(isSameSuit && isStraight) return {type:5, val:ranks[0], name:"顺金"};
    if(isSameSuit) return {type:4, val:ranks[0], name:"金花"};
    if(isStraight) return {type:3, val:ranks[0], name:"顺子"};
    if(set.size ===2) return {type:2, val:ranks[0], name:"对子"};
    return {type:1, val:ranks[0], name:"单张"};
}

// 对比 A、B牌，返回赢家 A / B
function compareCard(cardA, cardB){
    const a = parseCards(cardA);
    const b = parseCards(cardB);
    if(a.type > b.type) return "A";
    if(a.type < b.type) return "B";
    return a.val >= b.val ? "A":"B";
}

function sendTo(ws, data){
    ws.send(JSON.stringify(data));
}
function broadcast(data){
    if(room.playerA.ws) room.playerA.ws.send(JSON.stringify(data));
    if(room.playerB.ws) room.playerB.ws.send(JSON.stringify(data));
}

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

wss.on('connection', (ws) => {
    ws.on('message', (rawMsg) => {
        const data = JSON.parse(rawMsg.toString());

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

        if(data.type === "ready"){
            if(data.role === "A") room.playerA.ready = true;
            if(data.role === "B") room.playerB.ready = true;
            if(room.playerA.ready && room.playerB.ready){
                broadcast({type:"countdownStart"});
                setTimeout(()=>{
                    const cardResult = createCards();
                    room.cards.A = cardResult.A;
                    room.cards.B = cardResult.B;
                    room.gameOver = false;
                    sendTo(room.playerA.ws, {type:"newCard", myCards:room.cards.A, enemyCards:room.cards.B});
                    sendTo(room.playerB.ws, {type:"newCard", myCards:room.cards.B, enemyCards:room.cards.A});
                },3000);
            }
        }

        if(data.type === "bet"){
            if(room.gameOver) return;
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

        if(data.type === "fold"){
            if(room.gameOver) return;
            room.gameOver = true;
            let winner = data.role === "A" ? "B":"A";
            if(winner === "A"){
                room.playerA.chip += room.pool;
            }else{
                room.playerB.chip += room.pool;
            }
            broadcast({
                type:"result",
                winner:winner,
                pool:room.pool,
                msg:`玩家${data.role}弃牌！玩家${winner}赢走底池${room.pool}`
            });
            room.pool = 200;
            broadcast({
                type:"syncState",
                chipA: room.playerA.chip,
                chipB: room.playerB.chip,
                pool: room.pool
            })
        }

        if(data.type === "openCard"){
            if(room.gameOver) return;
            room.gameOver = true;
            const winner = compareCard(room.cards.A, room.cards.B);
            if(winner === "A"){
                room.playerA.chip += room.pool;
            }else{
                room.playerB.chip += room.pool;
            }
            broadcast({
                type:"showAllCard"
            });
            setTimeout(()=>{
                broadcast({
                    type:"result",
                    winner:winner,
                    pool:room.pool,
                    msg:`开牌结算！玩家${winner}赢走底池${room.pool}`
                });
                room.pool = 200;
                broadcast({
                    type:"syncState",
                    chipA: room.playerA.chip,
                    chipB: room.playerB.chip,
                    pool: room.pool
                })
            },1200)
        }

        if(data.type === "reset"){
            room.playerA.ready = false;
            room.playerB.ready = false;
            room.playerA.chip = 1000;
            room.playerB.chip = 1000;
            room.pool = 200;
            room.cards = {A:[], B:[]};
            room.gameOver = false;
            broadcast({
                type:"reset",
                chipA: room.playerA.chip,
                chipB: room.playerB.chip,
                pool: room.pool
            });
        }
    })

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
