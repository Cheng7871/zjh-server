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

// 爆率配置
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

const suits = ["♥", "♦", "♣", "♠"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

// 广播消息给所有连接
function broadcast(obj) {
    const data = JSON.stringify(obj);
    Object.values(connections).forEach(conn => {
        if (conn.readyState === 1) conn.send(data);
    });
}

function randomCard() {
    return {
        suit: suits[Math.floor(Math.random() * suits.length)],
        rank: ranks[Math.floor(Math.random() * ranks.length)]
    }
}

// 按爆率生成牌型
function createCardsByRate(playerRate) {
    let r = Math.random() * 100;
    if (r < rateBao) {
        return [{ rank: "A", suit: "♥" }, { rank: "A", suit: "♦" }, { rank: "A", suit: "♣" }];
    } else if (r < rateBao + rateShun) {
        return [{ rank: "10", suit: "♥" }, { rank: "J", suit: "♥" }, { rank: "Q", suit: "♥" }];
    } else if (r < rateBao + rateShun + rateJin) {
        return [{ rank: "2", suit: "♥" }, { rank: "5", suit: "♥" }, { rank: "9", suit: "♥" }];
    } else if (r < rateBao + rateShun + rateJin + rateTian) {
        return [{ rank: "A", suit: "♥" }, { rank: "K", suit: "♦" }, { rank: "Q", suit: "♣" }];
    }
    let arr = [];
    while(arr.length < 3) arr.push(randomCard());
    return arr;
}

// 比牌判定胜负
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
                    // 重置本局全部状态，解决下一局卡死
                    gameState.showEnemyCard = false;
                    gameState.nextConfirmA = false;
                    gameState.nextConfirmB = false;
                    gameState.roundEnd = false;
                    readyStatus.A = false;
                    readyStatus.B = false;
                    // 生成双方新牌
                    gameState.cardsA = createCardsByRate(A_RATE);
                    gameState.cardsB = createCardsByRate(B_RATE);
                    broadcast({
                        type: "newRoundCards",
                        cardsA: gameState.cardsA,
                        cardsB: gameState.cardsB
                    });
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
                case "bet": {
                    if (!myRole) return;
                    const num = data.num;
                    gameState.pool += num;
                    if (myRole === "A") gameState.chipA -= num;
                    if (myRole === "B") gameState.chipB -= num;
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

    // 玩家断开连接，自动释放角色
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
