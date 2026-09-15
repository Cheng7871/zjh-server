const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =========配置区========
const ADMIN_PASSWORD = "777777";
const PORT = process.env.PORT || 3000;

//座位
let seat = {
    A: { ws: null, occupied: false, isHost:true },
    B: { ws: null, occupied: false, isHost:false }
};

//游戏状态
let game = {
    chipA:100000,
    chipB:100000,
    pot:0,
    myCardsA:null,
    myCardsB:null,
    showAll:false,
    setting:{
        rateA:50,
        rateB:50,
        rateLeopard:2,
        rateStraightFlush:1,
        rateFlush:8,
        ratePair:15
    }
};

const suits = ["♠","♥","♣","♦"];
const ranks = [2,3,4,5,6,7,8,9,10,11,12,13,14];

/**
 * compareHandCards 真实比牌
 * type:6豹子 >5顺金 >4金花 >3顺子 >2对子 >1散牌
 * return 1:A胜 -1:B胜 0:平局
 * 支持 A‑2‑3最小同花顺
 */
function compareHandCards(cardA,cardB){
    function getHandType(cards){
        let rs = cards.map(i=>i.rank).sort((a,b)=>a-b);
        let ss = cards.map(i=>i.suit);
        let sameSuit = ss.every(x=>x===ss[0]);
        let normalSeq = (rs[2]-rs[1]===1 && rs[1]-rs[0]===1);
        let specialSeq = (rs[0]===2 && rs[1]===3 && rs[2]===14);

        if(rs[0]===rs[1]&&rs[1]===rs[2]) return {type:6,rs};
        if(sameSuit && (normalSeq||specialSeq)){
            return {type:5, rs: specialSeq ? [14,2,3] : rs };
        }
        if(sameSuit) return {type:4,rs};
        if(normalSeq||specialSeq){
            return {type:3, rs: specialSeq ? [14,2,3] : rs };
        }
        if(rs[0]===rs[1]||rs[1]===rs[2]||rs[0]===rs[2]){
            let pair;
            if(rs[0]===rs[1]) pair=rs[0];
            else if(rs[1]===rs[2]) pair=rs[1];
            else pair=rs[0];
            return {type:2,rs:[pair]};
        }
        return {type:1,rs};
    }
    let ta = getHandType(cardA);
    let tb = getHandType(cardB);
    if(ta.type>tb.type) return 1;
    if(ta.type<tb.type) return -1;
    for(let i=ta.rs.length-1;i>=0;i--){
        if(ta.rs[i]>tb.rs[i]) return 1;
        if(ta.rs[i]<tb.rs[i]) return -1;
    }
    return 0;
}

/**
 * getHandByRate：完整概率档位：豹子、顺金、金花、对子，剩余散牌
 */
function getHandByRate(set){
    let total = set.rateLeopard + set.rateStraightFlush + set.rateFlush + set.ratePair;
    if(total>100) total=100;
    let rand = Math.random()*100;

    //豹子
    if(rand < set.rateLeopard){
        let r = ranks[Math.floor(Math.random()*ranks.length)];
        return [ {suit:suits[0],rank:r},{suit:suits[1],rank:r},{suit:suits[2],rank:r} ];
    }
    rand -= set.rateLeopard;
    //顺金
    if(rand < set.rateStraightFlush){
        if(Math.random()<0.3){
            return [{suit:suits[0],rank:14},{suit:suits[0],rank:2},{suit:suits[0],rank:3}];
        }
        let start = Math.floor(Math.random()*11)+2;
        return [
            {suit:suits[0],rank:start},
            {suit:suits[0],rank:start+1},
            {suit:suits[0],rank:start+2}
        ]
    }
    rand -= set.rateStraightFlush;
    //金花
    if(rand < set.rateFlush){
        let s = suits[Math.floor(Math.random()*suits.length)];
        let arr=[];
        while(arr.length<3){
            let r = ranks[Math.floor(Math.random()*ranks.length)];
            if(!arr.find(x=>x.rank===r)) arr.push({suit:s,rank:r});
        }
        return arr;
    }
    rand -= set.rateFlush;
    //对子
    if(rand < set.ratePair){
        let pairRk = ranks[Math.floor(Math.random()*ranks.length)];
        let otherRk;
        do{ otherRk = ranks[Math.floor(Math.random()*ranks.length)]; }while(otherRk===pairRk);
        return [
            {suit:suits[0],rank:pairRk},
            {suit:suits[1],rank:pairRk},
            {suit:suits[2],rank:otherRk}
        ]
    }
    //散牌
    let pool=[];
    suits.forEach(su=>ranks.forEach(rk=>pool.push({suit:su,rank:rk})));
    let out=[];
    while(out.length<3){
        let idx = Math.floor(Math.random()*pool.length);
        out.push(pool.splice(idx,1)[0]);
    }
    return out;
}

function broadcast(obj){
    let str = JSON.stringify(obj);
    wss.clients.forEach(cl=>{
        if(cl.readyState===WebSocket.OPEN) cl.send(str);
    })
}

//路由返回正确文件名 index.html
app.get('/',(req,res)=>{
    res.sendFile(__dirname+"/index.html");
})

wss.on('connection',(ws)=>{
    let myRole = null;
    ws.on('message',(raw)=>{
        try{
            let pkg = JSON.parse(raw);
            switch(pkg.cmd){
                case "login":{
                    let r = pkg.role;
                    if(seat[r].occupied){
                        ws.send(JSON.stringify({cmd:"loginFail",msg:"该座位已被占用"}));
                        return;
                    }
                    seat[r].occupied=true;
                    seat[r].ws = ws;
                    myRole=r;
                    ws.send(JSON.stringify({cmd:"loginOk",isHost:seat[r].isHost}));
                    broadcast({cmd:"gameState",data:getState()});
                    break;
                }
                case "adminAuth":{
                    if(pkg.password === ADMIN_PASSWORD){
                        ws.send(JSON.stringify({cmd:"adminAuthOk"}));
                    }else{
                        ws.send(JSON.stringify({cmd:"adminAuthFail"}));
                    }
                    break;
                }
                case "saveRate":{
                    //权限校验：只有房主A可以修改配置
                    if(!(myRole==='A')){
                        ws.send(JSON.stringify({cmd:"hostOnly",msg:"仅房主可修改"}));
                        return;
                    }
                    game.setting.rateA = Number(pkg.rateA);
                    game.setting.rateB = Number(pkg.rateB);
                    game.setting.rateLeopard = Number(pkg.rateLeopard);
                    game.setting.rateStraightFlush = Number(pkg.rateStraightFlush);
                    game.setting.rateFlush = Number(pkg.rateFlush);
                    game.setting.ratePair = Number(pkg.ratePair);
                    broadcast({cmd:"notify",msg:"爆率配置已更新"});
                    break;
                }
                case "bet":{
                    let v = Number(pkg.value);
                    if(myRole==='A'){
                        if(game.chipA < v) return;
                        game.chipA -=v;
                    }else{
                        if(game.chipB < v) return;
                        game.chipB -=v;
                    }
                    game.pot +=v;
                    broadcast({cmd:"gameState",data:getState()});
                    break;
                }
                case "fold":{
                    let win = myRole==='A'?'B':'A';
                    broadcast({cmd:"notify",msg:myRole+"弃牌，对局结束，"+win+"获胜"});
                    settle(win);
                    checkChipZero();
                    broadcast({cmd:"gameState",data:getState()});
                    break;
                }
                case "open":{
                    game.myCardsA = getHandByRate(game.setting);
                    game.myCardsB = getHandByRate(game.setting);
                    game.showAll=true;
                    let res = compareHandCards(game.myCardsA,game.myCardsB);
                    let winner;
                    if(res===1) winner="A";
                    else if(res===-1) winner="B";
                    else winner="draw";
                    settle(winner);
                    checkChipZero();
                    if(winner==="draw"){
                        broadcast({cmd:"notify",msg:"平局！筹码退回双方"});
                    }else{
                        broadcast({cmd:"notify",msg:"对局结束，"+winner+"获胜"});
                    }
                    broadcast({cmd:"gameState",data:getState()});
                    break;
                }
                case "resetGame":{
                    resetGame();
                    broadcast({cmd:"notify",msg:"游戏已重置"});
                    broadcast({cmd:"gameState",data:getState()});
                    break;
                }
            }
        }catch(e){
            console.log("[消息解析异常]",e);
        }
    })

    //断线释放座位锁
    ws.on('close',()=>{
        if(myRole){
            seat[myRole].occupied = false;
            seat[myRole].ws = null;
        }
    })
})

function getState(){
    return {
        chipA:game.chipA,
        chipB:game.chipB,
        pot:game.pot,
        myCardsA:game.myCardsA,
        myCardsB:game.myCardsB,
        showAll:game.showAll
    }
}

//结算，支持平局
function settle(winner){
    if(winner==="A"){
        game.chipA += game.pot;
    }else if(winner==="B"){
        game.chipB += game.pot;
    }else{
        game.chipA += game.pot/2;
        game.chipB += game.pot/2;
    }
    game.pot=0;
}

//筹码归零判定，游戏结束
function checkChipZero(){
    if(game.chipA <= 0){
        broadcast({cmd:"gameOver",winner:"玩家B"});
    }else if(game.chipB <=0){
        broadcast({cmd:"gameOver",winner:"玩家A"});
    }
}

function resetGame(){
    game.myCardsA=null;
    game.myCardsB=null;
    game.showAll=false;
}

server.listen(PORT,()=>{
    console.log(`服务启动 PORT:${PORT}`);
    console.log(`后台密码：${ADMIN_PASSWORD}`);
})
