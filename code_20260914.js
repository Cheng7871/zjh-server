const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "zjh.html"));
});

let roleOccupied = {
    A: false,
    B: false
};
let connections = {};

let A_RATE = 100;
let B_RATE = 100;
let rateBao = 10;
let rateShun = 12;
let rateJin = 15;
let rateTian = 2;

let gameState = {
    chipA: 1000,
    chipB: 1000,
    pool: 200,
    cardsA: [],
    cardsB: [],
    showEnemyCard: false,
    nextConfirmA: false,
    nextConfirmB: false,
    roundEnd: false
};
let readyStatus = { A: false, B: false };

const suits = ["♥", "♦", "♣", "♠"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function broadcast(obj) {
    const data = JSON.stringify(obj);
    Object.values(connections).forEach(conn => {
        if (conn.readyState === 1) conn.send(data);
    });
}

function buildShuffledDeck() {
    let deck = [];
    for(let s of suits){
        for(let r of ranks){
            deck.push({suit:s, rank:r});
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function removeCardsFromDeck(deck, handCards) {
    handCards.forEach(card => {
        const idx = deck.findIndex(x => x.suit === card.suit && x.rank === card.rank);
        if(idx > -1) deck.splice(idx, 1);
    })
}

function getHandByRate(deck) {
    let r = Math.random() * 100;
    if (r < rateBao) {
        const availableRanks = [...new Set(deck.map(c=>c.rank))];
        const validRanks = availableRanks.filter(rk => deck.filter(c=>c.rank===rk).length >= 3);
        if(validRanks.length === 0) return deck.splice(0,3);
        const pickRank = validRanks[Math.floor(Math.random() * validRanks.length)];
        let hand = deck.filter(c => c.rank === pickRank).slice(0,3);
        removeCardsFromDeck(deck, hand);
        return hand;
    } else if (r < rateBao + rateShun) {
        for(let s of suits){
            const sameSuit = deck.filter(c=>c.suit === s);
            if(sameSuit.length >=3){
                sameSuit.sort((a,b)=>ranks.indexOf(a.rank)-ranks.indexOf(b.rank));
                for(let i=0;i <= sameSuit.length-3;i++){
                    const c1 = sameSuit[i], c2=sameSuit[i+1], c3=sameSuit[i+2];
                    const i1 = ranks.indexOf(c1.rank);
                    const i2 = ranks.indexOf(c2.rank);
                    const i3 = ranks.indexOf(c3.rank);
                    if(i2 === i1+1 && i3 === i2+1){
                        const hand = [c1,c2,c3];
                        removeCardsFromDeck(deck, hand);
                        return hand;
                    }
                }
            }
        }
        return deck.splice(0,3);
    } else if (r < rateBao + rateShun + rateJin) {
        for(let s of suits){
            const sameSuit = deck.filter(c=>c.suit === s);
            if(sameSuit.length >=3){
                const hand = sameSuit.slice(0,3);
                removeCardsFromDeck(deck, hand);
                return hand;
            }
        }
        return deck.splice(0,3);
    } else if (r < rateBao + rateShun + rateJin + rateTian) {
        const cardA = deck.find(c=>c.rank === "A");
        const cardK = deck.find(c=>c.rank === "K");
        const cardQ = deck.find(c=>c.rank === "Q");
        if(cardA && cardK && cardQ){
            const hand = [cardA, cardK, cardQ];
            removeCardsFromDeck(deck, hand);
            return hand;
        }
        return deck.splice(0,3);
    }
    return deck.splice(0,3);
}

function startNewRound(){
    gameState.showEnemyCard = false;
    gameState.nextConfirmA = false;
    gameState.nextConfirmB = false;
    gameState.roundEnd = false;
    readyStatus.A = false;
    readyStatus.B = false;

    const deck = buildShuffledDeck();
    gameState.cardsA = getHandByRate(deck);
    gameState.cardsB = getHandByRate(deck);

    broadcast({
        type: "newRoundCards",
        cardsA: gameState.cardsA,
        cardsB: gameState.cardsB
    });
    broadcast({ type: "gameState", state: gameState });
}

function compareHand(cardsA, cardsB) {
    return Math.random() < 0.5 ? "玩家A" : "玩家B";
}

wss.on('connection', (ws) => {
    let myRole = null;

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            switch (data.type) {
                case "login": {
                    const name = data.name.trim();
                    let targetRole = null;
                    if (name === "1") targetRole = "A";
                    if (name === "2") targetRole = "B";
                    if (!targetRole) {
                        ws.send(JSON.stringify({ type: "loginFail", msg: "只能输入1或者2" }));
                        return;
                    }
                    if (roleOccupied[targetRole]) {
                        ws.send(JSON.stringify({ type: "loginFail", msg: `玩家${targetRole}已被登录！请选择另一个角色` }));
                        return;
                    }
                    myRole = targetRole;
                    roleOccupied[myRole] = true;
                    connections[myRole] = ws;
                    ws.send(JSON.stringify({ type: "loginSuccess", role: myRole }));
                    ws.send(JSON.stringify({ type: "gameState", state: gameState }));
                    break;
                }
                case "ready": {
                    if (!myRole) return;
                    if (myRole === "A") readyStatus.A = true;
                    if (myRole === "B") readyStatus.B = true;
                    if (readyStatus.A && readyStatus.B) {
                        broadcast({ type: "bothReady" });
                    }
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
                case "newRound": {
                    startNewRound();
                    break;
                }
                case "bet": {
                    if (!myRole) return;
                    const num = Number(data.num);
                    // 加固双重校验，防止负数、非数字、超余额
                    if(isNaN(num) || num <=0) return;
                    if(myRole === "A"){
                        if(gameState.chipA < num) return;
                        gameState.chipA -= num;
                    }else{
                        if(gameState.chipB < num) return;
                        gameState.chipB -= num;
                    }
                    gameState.pool += num;
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
                case "fold": {
                    if (!myRole || gameState.roundEnd) return;
                    gameState.roundEnd = true;
                    const winner = myRole === "A" ? "玩家B" : "玩家A";
                    if(winner === "玩家A") gameState.chipA += gameState.pool;
                    else gameState.chipB += gameState.pool;
                    gameState.pool = 0;
                    broadcast({ type: "gameState", state: gameState });
                    broadcast({ type: "roundEndSequence", winner });
                    break;
                }
                case "openCard": {
                    if (!myRole || gameState.roundEnd) return;
                    gameState.roundEnd = true;
                    const winner = compareHand(gameState.cardsA, gameState.cardsB);
                    if(winner === "玩家A") gameState.chipA += gameState.pool;
                    else gameState.chipB += gameState.pool;
                    gameState.pool = 0;
                    broadcast({ type: "gameState", state: gameState });
                    broadcast({ type: "roundEndSequence", winner });
                    break;
                }
                case "requestNextRound": {
                    if (myRole === "A") gameState.nextConfirmA = true;
                    if (myRole === "B") gameState.nextConfirmB = true;
                    broadcast({ type: "gameState", state: gameState });
                    if (gameState.nextConfirmA && gameState.nextConfirmB) {
                        broadcast({ type: "bothConfirmNext" });
                        startNewRound();
                    }
                    break;
                }
                case "resetGame":
                case "fullResetGame": {
                    gameState = {
                        chipA: 1000,
                        chipB: 1000,
                        pool: 200,
                        cardsA: [],
                        cardsB: [],
                        showEnemyCard: false,
                        nextConfirmA: false,
                        nextConfirmB: false,
                        roundEnd: false
                    };
                    readyStatus = { A: false, B: false };
                    // =========重点修复：重置游戏时，清空角色占用锁！=====
                    roleOccupied.A = false;
                    roleOccupied.B = false;
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
                case "updateAllSetting": {
                    A_RATE = data.A_RATE;
                    B_RATE = data.B_RATE;
                    rateBao = data.rateBao;
                    rateShun = data.rateShun;
                    rateJin = data.rateJin;
                    rateTian = data.rateTian;
                    gameState.chipA = data.chipA;
                    gameState.chipB = data.chipB;
                    gameState.pool = data.pool;
                    broadcast({
                        type: "syncAllSetting",
                        A_RATE, B_RATE, rateBao, rateShun, rateJin, rateTian,
                        chipA: gameState.chipA,
                        chipB: gameState.chipB,
                        pool: gameState.pool
                    });
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
            }
        } catch (e) {
            console.log("消息处理异常：", e);
        }
    })

    ws.on('close', () => {
        if (myRole) {
            roleOccupied[myRole] = false;
            delete connections[myRole];
            console.log(`玩家${myRole}下线，角色释放`);
        }
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("服务器启动，端口：" + PORT);
});
