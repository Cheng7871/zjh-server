const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

let players = [];
// 独立存储两个玩家状态：双方1000w，底池200w
let gameState1 = {myChip:1000, enemyChip:1000, pool:200};
let gameState2 = {myChip:1000, enemyChip:1000, pool:200};
let gameReady = {p1:false,p2:false};

//牌库生成函数，后端统一生成
function createCards(pRate,eRate,forceBig){
    const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    const suits = ["♠","♥","♦","♣"];
    let all = [];
    for(let r of ranks) for(let s of suits) all.push(r+s);
    let pCards = [];
    let eCards = [];
    for(let i=0;i<3;i++) pCards.push(all[Math.floor(Math.random()*all.length)]);
    for(let i=0;i<3;i++) eCards.push(all[Math.floor(Math.random()*all.length)]);
    return {pCards,eCards};
}

wss.on('connection', (ws) => {
    players.push(ws);
    if(players.length>2) players.shift(); //最多两个人对局

    ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        //玩家准备
        if(data.type === "ready"){
            if(ws === players[0]) gameReady.p1=true;
            if(ws === players[1]) gameReady.p2=true;
            //两个人全部准备完成，触发倒计时
            if(gameReady.p1 && gameReady.p2){
                players.forEach(p=>p.send(JSON.stringify({type:"countdownStart"})));
                //倒计时结束后端生成牌，广播给双方
                setTimeout(()=>{
                    const cardData = createCards();
                    players.forEach(p=>p.send(JSON.stringify({type:"newCard",data:cardData})));
                },3000);
            }
        }
        //下注 后端校验余额，杜绝负数！
        if(data.type === "bet"){
            const betNum = data.num;
            if(ws === players[0]){
                if(betNum > gameState1.myChip){
                    ws.send(JSON.stringify({type:"msg",text:"余额不足，下注失败"}));
                    return;
                }
                gameState1.myChip -= betNum;
                gameState1.pool += betNum;
            }else{
                if(betNum > gameState2.myChip){
                    ws.send(JSON.stringify({type:"msg",text:"余额不足，下注失败"}));
                    return;
                }
                gameState2.myChip -= betNum;
                gameState2.pool += betNum;
            }
            players.forEach(p=>p.send(raw));
        }
        //弃牌
        if(data.type === "fold"){
            players.forEach(p=>p.send(raw));
        }
        //开牌
        if(data.type === "openCard"){
            players.forEach(p=>p.send(JSON.stringify({type:"showAllCard"})));
        }
        //重置游戏 恢复初始：双方1000w，底池200w
        if(data.type === "reset"){
            gameReady = {p1:false,p2:false};
            gameState1 = {myChip:1000, enemyChip:1000, pool:200};
            gameState2 = {myChip:1000, enemyChip:1000, pool:200};
            const resetData = {
                type:"reset",
                myChip:1000,
                enemyChip:1000,
                pool:200
            }
            players.forEach(p=>p.send(JSON.stringify(resetData)));
        }
    })
})
console.log("WebSocket服务启动");
