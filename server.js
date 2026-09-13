const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, './')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let room = {
    players: [],
    pool: 200,
    cards: {A:[], B:[]},
    gameOver: false,
    timer: null,
    remainTime: 60,
    config: {
        pRate: 100,
        eRate: 100,
        pOdds: 1,
        eOdds: 1,
        forceBig: 0
    }
};

const rankWeight = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};

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
    room.players.forEach(p=>{
        if(p.ws) p.ws.send(JSON.stringify(data));
    })
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

function clearGameTimer(){
    if(room.timer){
        clearInterval(room.timer);
        room.timer = null;
    }
}
function startGameTimer(){
    clearGameTimer();
    room.remainTime = 60;
    room.timer = setInterval(()=>{
        room.remainTime -=1;
        broadcast({type:"timerSync", time:room.remainTime});
        if(room.remainTime <=0){
            clearGameTimer();
            if(room.gameOver) return;
            room.gameOver = true;
            const winner = compareCard(room.cards.A, room.cards.B);
            let winAmount;
            if(winner === "A"){
                winAmount = room.pool * room.config.pOdds;
                room.players.find(x=>x.role==="A").chip += winAmount;
            }else{
                winAmount = room.pool * room.config.eOdds;
                room.players.find(x=>x.role==="B").chip += winAmount;
            }
            broadcast({type:"showAllCard"});
            setTimeout(()=>{
                broadcast({
                    type:"result",
                    msg:`60秒超时自动开牌！玩家${winner}获胜，赢得${winAmount}筹码`
                });
                room.pool = 200;
                broadcastSync();
            },1200)
        }
    },1000)
}
function broadcastSync(){
    const pA = room.players.find(x=>x.role==="A");
    const pB = room.players.find(x=>x.role==="B");
    broadcast({
        type:"syncState",
        chipA: pA?.chip||0,
        chipB: pB?.chip||0,
        pool: room.pool
    })
}

wss.on('connection', (ws) => {
    ws.on('message', (rawMsg) => {
        const data = JSON.parse(rawMsg.toString());

        if(data.type === "login"){
            const userName = data.name.trim();
            if(!userName){
                sendTo(ws, {type:"msg", text:"名字不能为空！"});
                return;
            }
            const existPlayer = room.players.find(p=>p.name === userName);
            if(existPlayer){
                sendTo(ws, {type:"msg", text:"该名字已被占用，请换名字！"});
                return;
            }
            if(room.players.length >=2){
                sendTo(ws, {type:"msg", text:"房间已满！"});
                return;
            }
            let role;
            if(room.players.length === 0) role = "A";
            else role = "B";
            const newPlayer = {
                ws,
                name: userName,
                role,
                chip:1000,
                ready:false
            }
            room.players.push(newPlayer);
            sendTo(ws, {type:"loginSuccess", role, name:userName});
            broadcast({type:"playerJoin", name:userName, role});
        }

        if(data.type === "ready"){
            const player = room.players.find(p=>p.ws === ws);
            if(!player) return;
            player.ready = true;
            const allReady = room.players.every(p=>p.ready === true);
            if(allReady && room.players.length ===2){
                broadcast({type:"countdownStart"});
                setTimeout(()=>{
                    const cardResult = createCards();
                    room.cards.A = cardResult.A;
                    room.cards.B = cardResult.B;
                    room.gameOver = false;
                    const pA = room.players.find(x=>x.role==="A");
                    const pB = room.players.find(x=>x.role==="B");
                    sendTo(pA.ws, {type:"newCard", myCards:room.cards.A, enemyCards:room.cards.B});
                    sendTo(pB.ws, {type:"newCard", myCards:room.cards.B, enemyCards:room.cards.A});
                    startGameTimer();
                },3000);
            }
        }

        if(data.type === "bet"){
            if(room.gameOver) return;
            const player = room.players.find(p=>p.ws === ws);
            if(!player) return;
            const betNum = data.num;
            if(betNum > player.chip){
                sendTo(ws, {type:"msg", text:"余额不足，下注失败"});
                return;
            }
            player.chip -= betNum;
            room.pool += betNum;
            broadcastSync();
        }

        if(data.type === "fold"){
            if(room.gameOver) return;
            clearGameTimer();
            room.gameOver = true;
            const player = room.players.find(p=>p.ws === ws);
            const winner = player.role === "A" ? "B":"A";
            let winAmount;
            if(winner === "A"){
                winAmount = room.pool * room.config.pOdds;
                room.players.find(x=>x.role==="A").chip += winAmount;
            }else{
                winAmount = room.pool * room.config.eOdds;
                room.players.find(x=>x.role==="B").chip += winAmount;
            }
            broadcast({
                type:"result",
                msg:`玩家${player.name}弃牌！玩家${winner}赢走${winAmount}筹码`
            });
            room.pool = 200;
            broadcastSync();
        }

        if(data.type === "openCard"){
            if(room.gameOver) return;
            clearGameTimer();
            room.gameOver = true;
            const winner = compareCard(room.cards.A, room.cards.B);
            let winAmount;
            if(winner === "A"){
                winAmount = room.pool * room.config.pOdds;
                room.players.find(x=>x.role==="A").chip += winAmount;
            }else{
                winAmount = room.pool * room.config.eOdds;
                room.players.find(x=>x.role==="B").chip += winAmount;
            }
            broadcast({type:"showAllCard"});
            setTimeout(()=>{
                broadcast({
                    type:"result",
                    msg:`开牌结算！玩家${winner}获胜，赢得${winAmount}筹码`
                });
                room.pool = 200;
                broadcastSync();
            },1200)
        }

        if(data.type === "saveConfig"){
            room.config.pRate = Number(data.pRate);
            room.config.eRate = Number(data.eRate);
            room.config.pOdds = Number(data.pOdds);
            room.config.eOdds = Number(data.eOdds);
            room.config.forceBig = Number(data.forceBig);
            sendTo(ws, {type:"msg", text:"✅ 配置保存成功，全局生效！"});
        }

        if(data.type === "reset"){
            clearGameTimer();
            room.players.forEach(p=>{
                p.ready = false;
                p.chip = 1000;
            })
            room.pool = 200;
            room.cards = {A:[], B:[]};
            room.gameOver = false;
            broadcast({
                type:"reset",
                chipA: room.players.find(x=>x.role==="A")?.chip,
                chipB: room.players.find(x=>x.role==="B")?.chip,
                pool: room.pool
            });
        }
    })

    ws.on('close', ()=>{
        clearGameTimer();
        const leavePlayerIndex = room.players.findIndex(p=>p.ws === ws);
        if(leavePlayerIndex !== -1){
            room.players.splice(leavePlayerIndex,1);
            broadcast({type:"playerLeave"});
        }
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log("服务启动成功"));
