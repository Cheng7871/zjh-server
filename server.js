const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, './')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];
// 双方 1000w，底池 200w
let gameState1 = { myChip: 1000, enemyChip: 1000, pool: 200 };
let gameState2 = { myChip: 1000, enemyChip: 1000, pool: 200 };
let gameReady = { p1: false, p2: false };

function createCards() {
    const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    const suits = ["♠","♥","♦","♣"];
    let all = [];
    for (const r of ranks) for (const s of suits) all.push(r + s);
    const pCards = [];
    const eCards = [];
    for (let i = 0; i < 3; i++) pCards.push(all[Math.floor(Math.random() * all.length)]);
    for (let i = 0; i < 3; i++) eCards.push(all[Math.floor(Math.random() * all.length)]);
    return { pCards, eCards };
}

wss.on('connection', (ws) => {
    players.push(ws);
    if (players.length > 2) players.shift();

    ws.on('message', (raw) => {
        const data = JSON.parse(raw.toString());

        if (data.type === "ready") {
            if (ws === players[0]) gameReady.p1 = true;
            if (ws === players[1]) gameReady.p2 = true;
            if (gameReady.p1 && gameReady.p2) {
                players.forEach(p => p.send(JSON.stringify({ type: "countdownStart" })));
                setTimeout(() => {
                    const cardData = createCards();
                    players.forEach(p => p.send(JSON.stringify({ type: "newCard", data: cardData })));
                }, 3000);
            }
        }

        if (data.type === "bet") {
            const betNum = data.num;
            if (ws === players[0]) {
                if (betNum > gameState1.myChip) {
                    ws.send(JSON.stringify({ type: "msg", text: "余额不足，下注失败" }));
                    return;
                }
                gameState1.myChip -= betNum;
                gameState1.pool += betNum;
            } else {
                if (betNum > gameState2.myChip) {
                    ws.send(JSON.stringify({ type: "msg", text: "余额不足，下注失败" }));
                    return;
                }
                gameState2.myChip -= betNum;
                gameState2.pool += betNum;
            }
            players.forEach(p => p.send(raw.toString()));
        }

        if (data.type === "fold") {
            players.forEach(p => p.send(raw.toString()));
        }

        if (data.type === "openCard") {
            players.forEach(p => p.send(JSON.stringify({ type: "showAllCard" })));
        }

        if (data.type === "reset") {
            gameReady = { p1: false, p2: false };
            gameState1 = { myChip: 1000, enemyChip: 1000, pool: 200 };
            gameState2 = { myChip: 1000, enemyChip: 1000, pool: 200 };
            const resetData = { type: "reset", myChip: 1000, enemyChip: 1000, pool: 200 };
            players.forEach(p => p.send(JSON.stringify(resetData)));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("服务启动，端口", PORT));
