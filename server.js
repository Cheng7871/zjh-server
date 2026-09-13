const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname,"zjh.html"));
})

//全局配置
let globalConfig = {
    A_RATE:100,
    B_RATE:100,
    rateBao:10,
    rateShun:12,
    rateJin:15,
    rateTian:2
}
let gameState = {
    chipA:1000,
    chipB:1000,
    pool:200,
    cardsA:[],
    cardsB:[],
    showEnemyCard:false,
    nextConfirmA: false,
    nextConfirmB: false,
    roundEnd: false
}

let readyStatus = {
    A:false,
    B:false
}
let players = {};

// 牌库 炸金花 牌
const suits = ["♠","♥","♣","♦"];
const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

//生成随机普通牌组
function createNormalCards(){
    let deck = [];
    for(let s of suits){
        for(let r of ranks){
            deck.push({suit:s, rank:r})
        }
    }
    //洗牌
    for(let i=deck.length-1;i>0;i--){
        let j = Math.floor(Math.random()*(i+1));
        [deck[i],deck[j]] = [deck[j],deck[i]]
    }
    return deck.slice(0,3);
}

//按概率生成豹子/金花/顺子
function createCardByRate(type){
    if(type === "bao"){
        let r = ranks[Math.floor(Math.random()*ranks.length)]
        return [{suit:"♠",rank:r},{suit:"♥",rank:r},{suit:"♣",rank:r}]
    }else if(type === "jin"){
        let s = suits[Math.floor(Math.random()*suits.length)]
        let idx = [];
        while(idx.length<3){
            let x = Math.floor(Math.random()*13);
            if(!idx.includes(x)) idx.push(x);
        }
        return idx.map(i=>({suit:s, rank:ranks[i]}))
    }else if(type === "shun"){
        let start = Math.floor(Math.random()*11);
        return [{suit:suits[0],rank:ranks[start]},{suit:suits[1],rank:ranks[start+1]},{suit:suits[2],rank:ranks[start+2]}]
    }else{
        return createNormalCards();
    }
}

//开局发牌
function dealCards(){
    //玩家A
    let randA = Math.random()*100;
    if(randA < globalConfig.rateBao) gameState.cardsA = createCardByRate("bao")
    else if(randA < globalConfig.rateBao + globalConfig.rateShun) gameState.cardsA = createCardByRate("shun")
    else if(randA < globalConfig.rateBao + globalConfig.rateShun + globalConfig.rateJin) gameState.cardsA = createCardByRate("jin")
    else gameState.cardsA = createNormalCards();

    //玩家B
    let randB = Math.random()*100;
    if(randB < globalConfig.rateBao) gameState.cardsB = createCardByRate("bao")
    else if(randB < globalConfig.rateBao + globalConfig.rateShun) gameState.cardsB = createCardByRate("shun")
    else if(randB < globalConfig.rateBao + globalConfig.rateShun + globalConfig.rateJin) gameState.cardsB = createCardByRate("jin")
    else gameState.cardsB = createNormalCards();
}

function broadcast(data){
    const str = JSON.stringify(data);
    wss.clients.forEach(client=>{
        if(client.readyState === WebSocket.OPEN){
            client.send(str);
        }
    })
}

wss.on('connection', (ws)=>{
    console.log("新玩家连接");
    ws.on('message', (raw)=>{
        const msg = JSON.parse(raw);
        switch(msg.type){
            case "login":{
                const role = msg.name === "1" ? "A" : "B";
                players[role] = ws;
                ws.send(JSON.stringify({type:"loginSuccess", role}));
                broadcast({type:"gameState", state:gameState})
                break;
            }
            case "ready":{
                readyStatus[msg.role] = true;
                console.log("准备状态：",readyStatus)
                if(readyStatus.A && readyStatus.B){
                    readyStatus.A = false;
                    readyStatus.B = false;
                    broadcast({type:"bothReady"})
                }
                break;
            }
            case "bet":{
                const num = msg.num;
                const role = msg.role;
                if(role === "A"){
                    if(gameState.chipA >= num){
                        gameState.chipA -= num;
                        gameState.pool += num;
                    }
                }else{
                    if(gameState.chipB >= num){
                        gameState.chipB -= num;
                        gameState.pool += num;
                    }
                }
                broadcast({type:"gameState", state:gameState})
                break;
            }
            case "updateAllSetting":{
                globalConfig.A_RATE = msg.A_RATE;
                globalConfig.B_RATE = msg.B_RATE;
                globalConfig.rateBao = msg.rateBao;
                globalConfig.rateShun = msg.rateShun;
                globalConfig.rateJin = msg.rateJin;
                globalConfig.rateTian = msg.rateTian;
                gameState.chipA = msg.chipA;
                gameState.chipB = msg.chipB;
                gameState.pool = msg.pool;
                broadcast({
                    type:"syncAllSetting",
                    ...globalConfig,
                    chipA:gameState.chipA,
                    chipB:gameState.chipB,
                    pool:gameState.pool
                })
                break;
            }
            case "requestNextRound":{
                if(msg.role === "A") gameState.nextConfirmA = true;
                if(msg.role === "B") gameState.nextConfirmB = true;
                console.log("确认状态：",gameState.nextConfirmA,gameState.nextConfirmB)
                if(gameState.nextConfirmA && gameState.nextConfirmB){
                    //双方确认，重置标记，触发倒计时
                    gameState.nextConfirmA = false;
                    gameState.nextConfirmB = false;
                    broadcast({type:"bothConfirmNext"})
                }
                broadcast({type:"gameState", state:gameState})
                break;
            }
            case "newRound":{
                gameState.nextConfirmA = false;
                gameState.nextConfirmB = false;
                gameState.roundEnd = false;
                gameState.showEnemyCard = false;
                // ✅ 在这里执行发牌！
                dealCards();
                broadcast({type:"gameState", state:gameState})
                break;
            }
            case "fold":{
                broadcast({type:"roundEndDelay"})
                break;
            }
            case "openCard":{
                broadcast({type:"roundEndDelay"})
                break;
            }
            case "resetGame":{
                gameState = {
                    chipA:1000,
                    chipB:1000,
                    pool:200,
                    cardsA:[],
                    cardsB:[],
                    showEnemyCard:false,
                    nextConfirmA: false,
                    nextConfirmB: false,
                    roundEnd: false
                }
                readyStatus = {A:false,B:false};
                broadcast({type:"gameState", state:gameState})
                break;
            }
        }
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>{
    console.log("服务器启动，端口："+PORT)
})
