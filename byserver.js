// 新增：全局崩溃捕获，防止进程直接退出
process.on('uncaughtException', (err) => {
    console.error("【全局崩溃异常】", err);
});
process.on('unhandledRejection', (reason) => {
    console.error("【Promise异常】", reason);
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 密码写在这里，前端看不到
const ADMIN_PASSWORD = "123456";

let roleOccupied = {
    A: false,
    B: false
};
let connections = {};

//全局概率配置
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
let isRoundProcessing = false; // 新增：发牌防重入锁

const suits = ["♥", "♦", "♣", "♠"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankOrder = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};

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
            deck.push({suit:s, rank:r, val: rankOrder[r]});
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
    });
}

// 修复：真实牌型判定，替换原来的随机比牌
function getCardType(cards){
    let vals = cards.map(c=>c.val).sort((a,b)=>a-b);
    let suitsArr = cards.map(c=>c.suit);
    let isSameSuit = suitsArr.every(s=>s===suitsArr[0]);
    let normalSeq = vals[2]-vals[1]===1 && vals[1]-vals[0]===1;
    let specialSeq = vals[0]===2 && vals[1]===3 && vals[2]===14;

    // 豹子
    if(vals[0]===vals[1] && vals[1]===vals[2]) return {type:6,vals};
    // 顺金
    if(isSameSuit && (normalSeq||specialSeq)){
        return {type:5, vals: specialSeq ? [14,2,3] : vals };
    }
    // 金花
    if(isSameSuit) return {type:4, vals};
    // 顺子
    if(normalSeq||specialSeq){
        return {type:3, vals: specialSeq ? [14,2,3] : vals};
    }
    // 对子（修复：带单张，用于比对）
    if(vals[0]===vals[1]||vals[1]===vals[2]||vals[0]===vals[2]){
        let pairVal, singleVal;
        if(vals[0]===vals[1]) { pairVal=vals[0]; singleVal=vals[2]; }
        else if(vals[1]===vals[2]) { pairVal=vals[1]; singleVal=vals[0]; }
        else { pairVal=vals[0]; singleVal=vals[1]; }
        return {type:2, vals:[singleVal, pairVal]};
    }
    // 散牌
    return {type:1, vals};
}

// 修复：真实比牌逻辑，替换原来的随机
function compareHand(cardsA,cardsB){
    let tA = getCardType(cardsA);
    let tB = getCardType(cardsB);
    if(tA.type > tB.type) return "玩家A";
    if(tA.type < tB.type) return "玩家B";
    // 同牌型逐张比
    for(let i=tA.vals.length-1;i>=0;i--){
        if(tA.vals[i]>tB.vals[i]) return "玩家A";
        if(tA.vals[i]<tB.vals[i]) return "玩家B";
    }
    return "平局";
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
                sameSuit.sort((a,b)=>a.val-b.val);
                for(let i=0;i <= sameSuit.length-3;i++){
                    const c1 = sameSuit[i], c2=sameSuit[i+1], c3=sameSuit[i+2];
                    const v1=c1.val,v2=c2.val,v3=c3.val;
                    const ok = (v2===v1+1&&v3===v2+1) || (v1===2&&v2===3&&v3===14);
                    if(ok){
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
    if(isRoundProcessing) return; // 防重复发牌
    isRoundProcessing = true;
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
    setTimeout(()=>{ isRoundProcessing = false; }, 200);
}

// 新增：统一检测游戏结束
function checkGameOver(){
    if(gameState.chipA <= 0){
        broadcast({type:"gameOver",winner:"玩家B"});
    }
    if(gameState.chipB <= 0){
        broadcast({type:"gameOver",winner:"玩家A"});
    }
}

// 修复：指向 zjh.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "zjh.html"));
});

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
                case "adminCheckPwd":{
                    if(data.pwd === ADMIN_PASSWORD){
                        ws.send(JSON.stringify({
                            type:"adminPwdOk",
                            pRate:A_RATE,
                            eRate:B_RATE,
                            rateBao:rateBao,
                            rateShun:rateShun,
                            rateJin:rateJin,
                            rateTian:rateTian
                        }));
                    }else{
                        ws.send(JSON.stringify({type:"adminPwdFail"}));
                    }
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
                    if(isNaN(num) || num <=0) {
                        ws.send(JSON.stringify({type:"betFail", msg:"请输入有效金额"}));
                        return;
                    }
                    if(myRole === "A"){
                        if(gameState.chipA < num) {
                            ws.send(JSON.stringify({type:"betFail", msg:"筹码不足"}));
                            return;
                        }
                        gameState.chipA -= num;
                    }else{
                        if(gameState.chipB < num) {
                            ws.send(JSON.stringify({type:"betFail", msg:"筹码不足"}));
                            return;
                        }
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
                    checkGameOver(); // 修复：弃牌后也检测游戏结束
                    break;
                }
                case "openCard": {
                    if (!myRole || gameState.roundEnd) return;
                    gameState.roundEnd = true;
                    const winRes = compareHand(gameState.cardsA, gameState.cardsB);
                    let winner;
                    if(winRes === "平局"){
                        // 修复：平局底池取整，避免小数
                        const half = Math.floor(gameState.pool / 2);
                        gameState.chipA += half;
                        gameState.chipB += half;
                        winner = "平局";
                    }else{
                        winner = winRes;
                        if(winner === "玩家A") gameState.chipA += gameState.pool;
                        else gameState.chipB += gameState.pool;
                    }
                    gameState.pool = 0;
                    broadcast({ type: "gameState", state: gameState });
                    broadcast({ type: "roundEndSequence", winner });
                    checkGameOver();
                    break;
                }
                case "requestNextRound": {
                    if (myRole === "A") gameState.nextConfirmA = true;
                    if (myRole === "B") gameState.nextConfirmB = true;
                    broadcast({ type: "gameState", state: gameState });
                    if (gameState.nextConfirmA && gameState.nextConfirmB) {
                        broadcast({ type: "bothConfirmNext" });
                        // 修复：移除服务端重复发牌，由前端倒计时结束触发
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
                    // 修复：重置游戏不清空角色占用，避免幽灵玩家
                    broadcast({ type: "gameState", state: gameState });
                    break;
                }
                case "updateAllSetting": {
                    // 修复：参数边界校验，强制0-100
                    A_RATE = Math.max(0, Math.min(100, Number(data.A_RATE||0)));
                    B_RATE = Math.max(0, Math.min(100, Number(data.B_RATE||0)));
                    rateBao = Math.max(0, Math.min(100, Number(data.rateBao||0)));
                    rateShun = Math.max(0, Math.min(100, Number(data.rateShun||0)));
                    rateJin = Math.max(0, Math.min(100, Number(data.rateJin||0)));
                    rateTian = Math.max(0, Math.min(100, Number(data.rateTian||0)));
                    gameState.chipA = Number(data.chipA);
                    gameState.chipB = Number(data.chipB);
                    gameState.pool = Number(data.pool);
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
    });
    ws.on('close', () => {
        if (myRole) {
            roleOccupied[myRole] = false;
            delete connections[myRole];
            console.log(`玩家${myRole}下线，角色释放`);
        }
    });
});

// 修复：监听 0.0.0.0，适配Render云部署
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("服务器启动，端口：" + PORT);
});
