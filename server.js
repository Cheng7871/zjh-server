const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 托管前端页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "zjh.html"));
});

// 角色占用标记
let roleOccupied = {
    A: false,
    B: false
};
let connections = {};

// 全局游戏配置
let A_RATE = 100;
let B_RATE = 100;
let rateBao = 10;
let rateShun = 12;
let rateJin = 15;
let rateTian = 2;

// 游戏状态
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

const suits = ["\u2660", "\u2665", "\u2663", "\u2666"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function broadcast(obj) {
    const data = JSON.stringify(obj);
    Object.values(connections).forEach(conn => {
        if (conn.readyState === 1) conn.send(data);
    });
}

function createNormalCards() {
    let deck = [];
    for (let s of suits) {
        for (let r of ranks) deck.push({ suit: s, rank: r });
    }
    for (let i = deck.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.slice(0, 3);
}

function createCardByRate(type) {
    if (type === "bao") {
        let r = ranks[Math.floor(Math.random() * ranks.length)];
        return [
            { suit: suits[0], rank: r },
            { suit: suits[1], rank: r },
            { suit: suits[2], rank: r }
        ];
    } else if (type === "jin") {
        let s = suits[Math.floor(Math.random() * suits.length)];
        let idx = [];
        while (idx.length < 3) {
            let x = Math.floor(Math.random() * 13);
            if (!idx.includes(x)) idx.push(x);
        }
        return idx.map(i => ({ suit: s, rank: ranks[i] }));
    } else if (type === "shun") {
        let start = Math.floor(Math.random() * 11);
        return [
            { suit: suits[0], rank: ranks[start] },
            { suit: suits[1], rank: ranks[start + 1] },
            { suit: suits[2], rank: ranks[start + 2] }
        ];
    } else {
        return createNormalCards();
    }
}

function dealCards() {
    let randA = Math.random() * 100;
    if (randA < rateBao) gameState.cardsA = createCardByRate("bao");
    else if (randA < rateBao + rateShun) gameState.cardsA = createCardByRate("shun");
    else if (randA < rateBao + rateShun + rateJin) gameState.cardsA = createCardByRate("jin");
    else gameState.cardsA = createNormalCards();

    let randB = Math.random() * 100;
    if (randB < rateBao) gameState.cardsB = createCardByRate("bao");
    else if (randB < rateBao + rateShun) gameState.cardsB = createCardByRate("shun");
    else if (randB < rateBao + rateShun + rateJin) gameState.cardsB = createCardByRate("jin");
    else gameState.cardsB = createNormalCards();
}

function checkGameOver() {
    if (gameState.chipA <= 0) {
        broadcast({ type: "gameOver", winner: "玩家B" });
        return true;
    }
    if (gameState.chipB <= 0) {
        broadcast({ type: "gameOver", winner: "玩家A" });
        return true;
    }
    return false;
}

wss.on('connection', (ws) => {
    let myRole = null;

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);

        switch (msg.type) {
            case "login": {
                const name = (msg.name || "").trim();
                let targetRole = null;
                if (name === "1") targetRole = "A";
                if (name === "2") targetRole = "B";

                if (!targetRole) {
                    ws.send(JSON.stringify({ type: "loginFail", msg: "只能输入1或者2" }));
                    return;
                }
                // ✅ 角色占用拦截
                if (roleOccupied[targetRole]) {
                    ws.send(JSON.stringify({ type: "loginFail", msg: "玩家" + targetRole + "已被登录！请选另一个角色" }));
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
                readyStatus[msg.role] = true;
                if (readyStatus.A && readyStatus.B) {
                    broadcast({ type: "bothReady" });
                }
                break;
            }

            case "newRound": {
                gameState.showEnemyCard = false;
                gameState.nextConfirmA = false;
                gameState.nextConfirmB = false;
                gameState.roundEnd = false;
                readyStatus.A = false;
                readyStatus.B = false;
                dealCards();
                broadcast({ type: "gameState", state: gameState });
                broadcast({
                    type: "newRoundCards",
                    cardsA: gameState.cardsA,
                    cardsB: gameState.cardsB
                });
                break;
            }

            case "requestNextRound": {
                if (msg.role === "A") gameState.nextConfirmA = true;
                if (msg.role === "B") gameState.nextConfirmB = true;
                broadcast({ type: "gameState", state: gameState });
                if (gameState.nextConfirmA && gameState.nextConfirmB) {
                    broadcast({ type: "bothConfirmNext" });
                }
                break;
            }

            case "bet": {
                const num = msg.num;
                const role = msg.role;
                if (role === "A") {
                    if (gameState.chipA >= num) {
                        gameState.chipA -= num;
                        gameState.pool += num;
                    }
                } else {
                    if (gameState.chipB >= num) {
                        gameState.chipB -= num;
                        gameState.pool += num;
                    }
                }
                broadcast({ type: "gameState", state: gameState });
                break;
            }

            case "openCard": {
                gameState.roundEnd = true;
                let winner = "玩家A";
                if (winner === "玩家A") gameState.chipA += gameState.pool;
                else gameState.chipB += gameState.pool;
                gameState.pool = 0;
                gameState.showEnemyCard = true;
                broadcast({ type: "gameState", state: gameState });
                if (!checkGameOver()) {
                    broadcast({ type: "roundEndSequence", winner: winner });
                }
                break;
            }

            case "fold": {
                gameState.roundEnd = true;
                let winner = msg.role === "A" ? "玩家B" : "玩家A";
                if (winner === "玩家A") gameState.chipA += gameState.pool;
                else gameState.chipB += gameState.pool;
                gameState.pool = 0;
                gameState.showEnemyCard = true;
                broadcast({ type: "gameState", state: gameState });
                if (!checkGameOver()) {
                    broadcast({ type: "roundEndSequence", winner: winner });
                }
                break;
            }

            case "fullResetGame":
            case "resetGame": {
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
                broadcast({ type: "gameState", state: gameState });
                break;
            }

            case "updateAllSetting": {
                A_RATE = msg.A_RATE;
                B_RATE = msg.B_RATE;
                rateBao = msg.rateBao;
                rateShun = msg.rateShun;
                rateJin = msg.rateJin;
                rateTian = msg.rateTian;
                gameState.chipA = msg.chipA;
                gameState.chipB = msg.chipB;
                gameState.pool = msg.pool;
                broadcast({
                    type: "syncAllSetting",
                    A_RATE: A_RATE,
                    B_RATE: B_RATE,
                    rateBao: rateBao,
                    rateShun: rateShun,
                    rateJin: rateJin,
                    rateTian: rateTian,
                    chipA: gameState.chipA,
                    chipB: gameState.chipB,
                    pool: gameState.pool
                });
                break;
            }
        }
    });

    // ✅ 断开连接自动释放角色
    ws.on('close', () => {
        if (myRole) {
            roleOccupied[myRole] = false;
            delete connections[myRole];
            console.log("玩家" + myRole + "下线，角色已释放");
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("服务器启动，端口：" + PORT);
});
