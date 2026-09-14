const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

// 角色占用标记
let roleOccupied = {
    A: false,
    B: false
};
let connections = {};

// 游戏全局状态
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

let A_RATE = 100;
let B_RATE = 100;
let rateBao = 10;
let rateShun = 12;
let rateJin = 15;
let rateTian = 2;

// 广播给所有在线玩家
function broadcast(msg) {
    Object.values(connections).forEach(conn => {
        if (conn.readyState === 1) conn.send(JSON.stringify(msg));
    })
}

// 牌型工具
const suits = ["♥", "♦", "♣", "♠"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function randomCard() {
    return {
        suit: suits[Math.floor(Math.random() * suits.length)],
        rank: ranks[Math.floor(Math.random() * ranks.length)]
    }
}

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
                    // 角色占用拦截
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
                    if (myRole === "A") gameState.nextConfirmA = true;
                    if (myRole === "B") gameState.nextConfirmB = true;
                    if (gameState.nextConfirmA && gameState.nextConfirmB) {
                        broadcast({ type: "bothReady" });
                    }
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
                case "newRound": {
                    gameState.showEnemyCard = false;
                    gameState.nextConfirmA = false;
                    gameState.nextConfirmB = false;
                    gameState.roundEnd = false;
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
                    broadcast({ type: "roundEndSequence", winner });
                    break;
                }
                case "openCard": {
                    if (!myRole || gameState.roundEnd) return;
                    gameState.roundEnd = true;
                    const winner = compareHand(gameState.cardsA, gameState.cardsB);
                    broadcast({ type: "roundEndSequence", winner });
                    break;
                }
                case "requestNextRound": {
                    if (myRole === "A") gameState.nextConfirmA = true;
                    if (myRole === "B") gameState.nextConfirmB = true;
                    if (gameState.nextConfirmA && gameState.nextConfirmB) {
                        broadcast({ type: "bothConfirmNext" });
                    }
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
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
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
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
            console.log(e);
        }
    })

    // 断开连接释放角色
    ws.on('close', () => {
        if (myRole) {
            roleOccupied[myRole] = false;
            delete connections[myRole];
        }
    })
})
console.log("WebSocket 服务启动，端口3000");
