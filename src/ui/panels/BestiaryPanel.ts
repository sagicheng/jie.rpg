import type { GameScene } from '../../scenes/GameScene';

import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, ZANPAKUTO_GROWTH } from '../../config/config';

import { GameState } from '../../managers/GameState';

import { GuildClient } from '../../api/GuildClient';

import { FriendClient } from '../../api/FriendClient';

import { GUILD_SKILLS, guildSkillCost } from '../../api/GuildSkills';

import { SaveManager } from '../../core/SaveManager';

import { NAMED_ENEMIES, BESTIARY_TIERS, getBestiaryTierReached, getBestiaryTierProgress, BESTIARY_TITLES } from '../../managers/BestiaryData';

import { expForLevel } from '../../managers/BattleData';

import { Inventory, EquipSlot, Item } from '../../managers/Inventory';

import { listSetProgress, setShortName } from '../../managers/SetSystem';

import { PET_SPECIES_CLIENT, petIcon, petColor, computePetAura, petElementInfo, petQualityInfo, petSkillNames } from '../../managers/PetSystem';

import { applyConsumable, getConsumableEffect } from '../../managers/ConsumableSystem';

import { createPlayerStatus } from '../../managers/StatusSystem';

import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS, getQuestDef, rollDailyPool, rollWeeklyPool, DAILY_CAP, WEEKLY_CAP } from '../../managers/QuestData';

import { SHIKAI_SKILLS, ZANPAKUTO_ELEMENT } from '../../managers/Skills';

import { Kido, KIDO_NODES, KidoSchool, TIER_LOCK } from '../../managers/Kido';

import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset, getRefineDisplay,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getEnhanceGlow,
} from '../../managers/EnhanceSystem';

import {
  requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestAllocateStat, requestMallBuy, requestRespec,
  requestUnlock, requestSetZanpakuto, requestKidoSetSchool, requestKidoAllocate, requestClaimBestiaryTier, requestSetTitle, isOnline,
  requestArenaQueue, requestArenaCancel, requestArenaStatus, arena, tierNameById, ARENA_WEEKLY_CAP_CLIENT,
  requestGuildShopBuy,
  requestAuctionList, requestAuctionMine, requestAuctionFavList, requestAuctionHistory,
  requestAuctionFav, requestAuctionCreate, requestAuctionBuy, requestAuctionCancel,
  requestPetSetActive, requestPetRelease, requestPetRecall, requestPetSetAttr, requestUsePetEgg,
} from '../../api/WorldClient';

import { GUILD_SHOP_ITEMS } from '../../api/GuildShop';



export function toggleBestiaryPanel(scene: GameScene): void { if (scene.bestiaryPanel) { closeBestiaryPanel(scene); return; } scene.pauseForMenu(); renderBestiaryPanel(scene); }

export function closeBestiaryPanel(scene: GameScene): void { if (scene.titlePanel) { scene.titlePanel.destroy(true); scene.titlePanel = null; } if (scene.bestiaryPanel) { scene.bestiaryPanel.destroy(true); scene.bestiaryPanel = null; scene.resumeFromMenu(); } }

export function closeTitlePanel(scene: GameScene): void {
  if (scene.titlePanel) { scene.titlePanel.destroy(true); scene.titlePanel = null; }
  if ((scene as any).titleWheelHandler) { scene.input.off('wheel', (scene as any).titleWheelHandler); (scene as any).titleWheelHandler = null; }
  if ((scene as any).titleMoveHandler) { scene.input.off('pointermove', (scene as any).titleMoveHandler); (scene as any).titleMoveHandler = null; }
  if ((scene as any).titleUpHandler) { scene.input.off('pointerup', (scene as any).titleUpHandler); (scene as any).titleUpHandler = null; }
}

export function toggleTitlePanel(scene: GameScene): void { if (scene.titlePanel) { closeTitlePanel(scene); } else { renderTitlePanel(scene); } }

export function renderTitlePanel(scene: GameScene): void {
    closeTitlePanel(scene);
    const cam=scene.cameras.main;
    const c=scene.add.container(Math.round(cam.scrollX),Math.round(cam.scrollY)).setDepth(320);scene.titlePanel=c;
    const vw=GAME_WIDTH,vh=GAME_HEIGHT,mw=560,mh=470,mx=(vw-mw)/2,my=(vh-mh)/2;
    const ov=scene.add.graphics();ov.fillStyle(0,0.55);ov.fillRect(0,0,vw,vh);ov.setInteractive(new Phaser.Geom.Rectangle(0,0,vw,vh),Phaser.Geom.Rectangle.Contains);c.add(ov);
    const bg=scene.add.graphics();bg.fillStyle(0x121222,0.985);bg.fillRoundedRect(mx,my,mw,mh,12);bg.lineStyle(2,0x6a5a3a,0.7);bg.strokeRoundedRect(mx,my,mw,mh,12);c.add(bg);
    c.add(scene.add.text(mx+mw/2,my+26,'◆  称  号  ◆',{fontSize:'20px',color:'#e8d5a3',fontStyle:'bold',padding:{y:3}}).setOrigin(0.5));
    const closeT=scene.add.text(mx+mw-30,my+26,'✕',{fontSize:'20px',color:'#cc6666',padding:{x:6,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true});
    closeT.on('pointerover',function(this:any){this.setColor('#ff8888');});closeT.on('pointerout',function(this:any){this.setColor('#cc6666');});
    closeT.on('pointerdown',()=>closeTitlePanel(scene));c.add(closeT);
    c.add(scene.add.text(mx+mw/2,my+50,'装备称号可获得对应加成（同时仅生效一个）',{fontSize:'11px',color:'#6677aa',padding:{y:2}}).setOrigin(0.5));
    // 滚动视口（内容超出时裁剪 + 滚动条）
    const viewTop=my+72, viewBottom=my+mh-56, viewH=viewBottom-viewTop, rowH=72;
    const listX=mx+24;
    const contentH=BESTIARY_TITLES.length*rowH;
    const scrollable=contentH>viewH;
    const scrollContent=scene.add.container(0,0);c.add(scrollContent);
    const rowBtns: Phaser.GameObjects.Text[] = [];
    BESTIARY_TITLES.forEach((def,i)=>{
      const ry=i*rowH;const st=(GameState as any).getTitleStatus(def);const isActive=(GameState as any).activeTitle===def.id;
      const rowBg=scene.add.graphics();rowBg.fillStyle(st.unlocked?(isActive?0x2a2410:0x152028):0x12121e,0.85);rowBg.fillRoundedRect(listX,ry,mw-48,rowH-8,8);rowBg.lineStyle(1,st.unlocked?(isActive?0xc9a96e:0x3a5a6a):0x2a2a3a,0.7);rowBg.strokeRoundedRect(listX,ry,mw-48,rowH-8,8);scrollContent.add(rowBg);
      const nc=st.unlocked?(isActive?'#ffcc44':'#cfe8ff'):'#556688';
      scrollContent.add(scene.add.text(listX+14,ry+10,def.name,{fontSize:'15px',color:nc,fontStyle:'bold',padding:{y:1}}));
      scrollContent.add(scene.add.text(listX+14,ry+32,`条件：${def.conditionDesc}`,{fontSize:'11px',color:'#8899bb',padding:{y:1}}));
      scrollContent.add(scene.add.text(listX+14,ry+50,`效果：${def.effectDesc}`,{fontSize:'11px',color:def.effectDesc==='无特殊效果'?'#667788':'#aadd88',padding:{y:1}}));
      if(st.unlocked){
        const btnLabel=isActive?'卸下':'装备';
        const ab=scene.add.text(listX+mw-48-72,ry+rowH/2-12,`[ ${btnLabel} ]`,{fontSize:'12px',color:isActive?'#ffcc66':'#88ccff',fontStyle:'bold',backgroundColor:isActive?'#3a2e00aa':'#002233aa',padding:{x:10,y:5}}).setOrigin(0,0.5).setInteractive({useHandCursor:true});
        ab.on('pointerover',()=>ab.setColor('#ffffff'));ab.on('pointerout',()=>ab.setColor(isActive?'#ffcc66':'#88ccff'));
        ab.on('pointerdown',()=>{ if(isOnline()) requestSetTitle(def.id); else (GameState as any).setActiveTitle(def.id); scene.broadcastTitle(); closeTitlePanel(scene); renderBestiaryPanel(scene); });
        (ab as any)._localY=ry;
        (ab as any)._enabled=!scrollable;
        if(scrollable) ab.disableInteractive();
        rowBtns.push(ab);
        scrollContent.add(ab);
      }else{
        scrollContent.add(scene.add.text(listX+mw-48-130,ry+rowH/2,st.progress,{fontSize:'11px',color:'#7788aa',padding:{y:1}}).setOrigin(0,0.5));
      }
    });
    if(scrollable){
      const maskG=scene.make.graphics({});maskG.fillStyle(0xffffff);maskG.fillRect(cam.scrollX+mx,cam.scrollY+viewTop,mw-22,viewH);
      scrollContent.setMask(maskG.createGeometryMask());
    }
    // 滚动条（轨道 + 手柄）
    const sbX=mx+mw-13; let scrollY=0; const scrollBar=scene.add.graphics();c.add(scrollBar);
    function updateScroll():void{
      scrollY=Phaser.Math.Clamp(scrollY, viewH-contentH, 0);
      scrollContent.y=viewTop+scrollY;
      scrollBar.clear();
      if(scrollable){
        const thumbH=Math.max(24, viewH*viewH/contentH);
        const progress=(contentH>viewH)?scrollY/(viewH-contentH):0;
        const ty=viewTop+progress*(viewH-thumbH);
        scrollBar.fillStyle(0x000000,0.35);scrollBar.fillRoundedRect(sbX-3,viewTop,6,viewH,3);
        scrollBar.fillStyle(0x99aacc,0.6);scrollBar.fillRoundedRect(sbX-3,ty,6,thumbH,3);
        // 越界（被遮罩裁掉）的装备/卸下按钮自动禁用，避免误触
        for(const b of rowBtns){const rel=((b as any)._localY)+scrollY;const vis=rel>=-rowH&&rel<=viewH;const en=(b as any)._enabled===true;if(vis&&!en){b.setInteractive({useHandCursor:true});(b as any)._enabled=true;}else if(!vis&&en){b.disableInteractive();(b as any)._enabled=false;}}
      }
    }
    updateScroll();
    // 交互：滚轮 + 拖动手柄
    const onWheel=(_p:any,_o:any,_dx:number,dy:number)=>{ if(!scrollable)return; scrollY-=dy*0.5; updateScroll(); };
    scene.input.on('wheel',onWheel);
    let dragging=false;
    const onMove=(p:any)=>{ if(!dragging||!scrollable)return; const rel=p.worldY-cam.scrollY-viewTop; const thumbH=Math.max(24,viewH*viewH/contentH); const newTop=Phaser.Math.Clamp(rel-thumbH/2,0,viewH-thumbH); const progress=newTop/(viewH-thumbH); scrollY=progress*(viewH-contentH); updateScroll(); };
    const onUp=()=>{dragging=false;};
    scrollBar.setInteractive(new Phaser.Geom.Rectangle(sbX-8,viewTop,16,viewH),Phaser.Geom.Rectangle.Contains);
    scrollBar.on('pointerdown',()=>{dragging=true;});
    scene.input.on('pointermove',onMove);
    scene.input.on('pointerup',onUp);
    (scene as any).titleWheelHandler=onWheel;(scene as any).titleMoveHandler=onMove;(scene as any).titleUpHandler=onUp;
    // 底部：卸下当前称号（固定在面板底部，不随滚动）
    const footY=my+mh-36;
    const noneBtn=scene.add.text(mx+mw/2,footY,(GameState as any).activeTitle?'[ 卸下当前称号 ]':'（当前未装备称号）',{fontSize:'12px',color:(GameState as any).activeTitle?'#cc8888':'#556688',padding:{y:2}}).setOrigin(0.5).setInteractive({useHandCursor:(GameState as any).activeTitle?true:false});
    if((GameState as any).activeTitle){
      noneBtn.on('pointerover',()=>noneBtn.setColor('#ffaaaa'));noneBtn.on('pointerout',()=>noneBtn.setColor('#cc8888'));
      noneBtn.on('pointerdown',()=>{ if(isOnline()) requestSetTitle(null); else (GameState as any).setActiveTitle(null); scene.broadcastTitle(); closeTitlePanel(scene); renderBestiaryPanel(scene); });
    }
    c.add(noneBtn);
  }

export function renderBestiaryPanel(scene: GameScene): void {
    if (scene.bestiaryPanel) { scene.bestiaryPanel.destroy(true); scene.bestiaryPanel = null; }
    const cam=scene.cameras.main;const c=scene.add.container(Math.round(cam.scrollX),Math.round(cam.scrollY)).setDepth(300);scene.bestiaryPanel=c;
    const ov=scene.add.graphics();ov.fillStyle(0,0.78);ov.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);ov.setInteractive(new Phaser.Geom.Rectangle(0,0,GAME_WIDTH,GAME_HEIGHT),Phaser.Geom.Rectangle.Contains);c.add(ov);
    const ox=30,oy=20,ow=GAME_WIDTH-60,oh=GAME_HEIGHT-40;
    const bg=scene.add.graphics();bg.fillStyle(0x121222,0.98);bg.fillRoundedRect(ox,oy,ow,oh,12);bg.lineStyle(2,0x4a5a8a,0.6);bg.strokeRoundedRect(ox,oy,ow,oh,12);c.add(bg);
    const th=54;const tb=scene.add.graphics();tb.fillStyle(0x1a1a36,1);tb.fillRoundedRect(ox+4,oy+4,ow-8,th,{tl:10,tr:10,bl:0,br:0});c.add(tb);
    c.add(scene.add.text(GAME_WIDTH/2,oy+th/2,'◆  妖 魔 图 鉴  ◆',{fontSize:'22px',color:'#e8d5a3',fontStyle:'bold',padding:{y:3}}).setOrigin(0.5));
    c.add(scene.add.text(ox+ow-40,oy+th/2,'✕',{fontSize:'22px',color:'#cc6666',padding:{x:8,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true}).on('pointerover',function(this:any){this.setColor('#ff8888');}).on('pointerout',function(this:any){this.setColor('#cc6666');}).on('pointerdown',()=>closeBestiaryPanel(scene)));
    const ty=oy+th+16;const cw=(ow-60)/4;const rd=getBestiaryTierReached(GameState.bestiaryKilled);const tn=Object.keys(NAMED_ENEMIES).length;
    BESTIARY_TIERS.forEach((tr,ti)=>{const cx=ox+14+ti*(cw+12);const ir=rd>=tr.id;const ic=GameState.bestiaryTierClaimed.includes(tr.id);const pg=getBestiaryTierProgress(tr.id,GameState.bestiaryKilled);const pt=pg.total>0?pg.completed/pg.total:0;const cc=ir?parseInt(tr.color.replace('#',''),16):0x222244;const cb=scene.add.graphics();cb.fillStyle(cc,ir?0.18:0.12);cb.fillRoundedRect(cx,ty,cw,100,8);cb.lineStyle(1,cc,ir?0.6:0.25);cb.strokeRoundedRect(cx,ty,cw,100,8);c.add(cb);const ic2=ir?parseInt(tr.color.replace('#',''),16):0x444466;const ico=scene.add.graphics();ico.fillStyle(ic2,ir?1:0.5);ico.fillCircle(cx+20,ty+20,6);ico.lineStyle(2,ic2,0.7);ico.strokeCircle(cx+20,ty+20,9);c.add(ico);c.add(scene.add.text(cx+34,ty+11,tr.name,{fontSize:'14px',color:ir?tr.color:'#666688',fontStyle:'bold',padding:{y:2}}));c.add(scene.add.text(cx+34,ty+32,`每类×${tr.requiredKills}杀`,{fontSize:'10px',color:'#555577',padding:{y:1}}));const by2=ty+52,bw=cw-28;c.add(scene.add.rectangle(cx+14+bw/2,by2,bw,6,0x111122,0.9));if(pt>0){const fw=Math.max(2,bw*pt);c.add(scene.add.rectangle(cx+14+fw/2,by2,fw,5,ir?parseInt(tr.color.replace('#',''),16):0x334466,1));}const bty=ty+68;if(ic){c.add(scene.add.text(cx+cw/2,bty,'✔ 已领取',{fontSize:'12px',color:'#558855',fontStyle:'bold',padding:{y:1}}).setOrigin(0.5));}else if(ir){const bt=scene.add.text(cx+cw/2,bty,'[ 领取奖励 ]',{fontSize:'12px',color:'#ffcc44',fontStyle:'bold',backgroundColor:'#33220088',padding:{x:10,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true});bt.on('pointerover',()=>{bt.setColor('#ffff88');bt.setBackgroundColor('#443300aa');});bt.on('pointerout',()=>{bt.setColor('#ffcc44');bt.setBackgroundColor('#33220088');});bt.on('pointerdown',()=>{if(isOnline()) requestClaimBestiaryTier(tr.id); else GameState.claimBestiaryTierReward(tr.id); closeBestiaryPanel(scene); renderBestiaryPanel(scene);});c.add(bt);}else{c.add(scene.add.text(cx+cw/2,bty,`${Math.round(pt*100)}% · ${pg.completed}/${pg.total}`,{fontSize:'10px',color:'#556688',padding:{y:1}}).setOrigin(0.5));c.add(scene.add.text(cx+cw/2,bty+16,tr.reward.desc,{fontSize:'9px',color:'#444466',padding:{y:1},wordWrap:{width:cw-10}}).setOrigin(0.5));}});
    const sy2=ty+130;const sp=scene.add.graphics();sp.lineStyle(1,0x3a4a6a,0.5);sp.lineBetween(ox+14,sy2,ox+ow-14,sy2);c.add(sp);
    const bodyY=sy2+14,bh=oh-(sy2-oy)-36,lw=380,dw2=ow-lw-40,lx=ox+14,dx2=lx+lw+16;
    const lb=scene.add.graphics();lb.fillStyle(0x0e0e22,0.7);lb.fillRoundedRect(lx,bodyY,lw,bh,6);lb.lineStyle(1,0x334466,0.4);lb.strokeRoundedRect(lx,bodyY,lw,bh,6);c.add(lb);
    const enc=GameState.bestiaryEncountered;c.add(scene.add.text(lx+12,bodyY+10,`已遭遇 ${enc.length} / ${tn}`,{fontSize:'12px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));
    // 当前称号 + 称号按钮
    const activeTD=(GameState as any).getActiveTitleDef ? (GameState as any).getActiveTitleDef() : null;
    c.add(scene.add.text(lx+lw-205,bodyY+10,`称号：${activeTD?activeTD.name:'无'}`,{fontSize:'11px',color:activeTD?'#ffcc66':'#6677aa',fontStyle:'bold',padding:{y:2}}));
    const tBtn=scene.add.text(lx+lw-92,bodyY+6,'[ 称号 ]',{fontSize:'12px',color:'#ffcc44',fontStyle:'bold',backgroundColor:'#33220088',padding:{x:8,y:4}}).setInteractive({useHandCursor:true});
    tBtn.on('pointerover',()=>{tBtn.setColor('#ffff88');tBtn.setBackgroundColor('#443300aa');});
    tBtn.on('pointerout',()=>{tBtn.setColor('#ffcc44');tBtn.setBackgroundColor('#33220088');});
    tBtn.on('pointerdown',()=>{renderTitlePanel(scene);});
    c.add(tBtn);
    const an=Object.entries(NAMED_ENEMIES);const ih=26,mv=Math.floor((bh-40)/ih);const lc=scene.add.container(lx,bodyY+34);c.add(lc);
    an.forEach(([nm,df],i)=>{if(i>=mv)return;const ry=i*ih;const en=GameState.bestiaryEncountered.includes(nm);const kl=GameState.bestiaryKilled[nm]||0;const ib2=df.type==='妖将'||df.type==='妖王';const rw=scene.add.container(0,ry);const rb=scene.add.rectangle(2,0,lw-6,ih-2,en?0x152525:0x121222,0.8);rb.setOrigin(0,0);rw.add(rb);if(ib2)rw.add(scene.add.text(8,3,'👑',{fontSize:'11px',padding:{y:1}}));const nc2=en?(ib2?'#ffcc44':df.type==='恶妖'?'#ff8866':'#bbbbdd'):'#444466';rw.add(scene.add.text(ib2?24:10,4,en?nm:'???',{fontSize:'12px',color:nc2,fontStyle:en&&ib2?'bold':'normal',padding:{y:1}}));if(en&&df.element&&df.element!=='无'){const ec2:Record<string,string>={火:'#ff6644',水:'#4488ff',风:'#44cc88',土:'#cc9944',暗:'#8844cc',光:'#ffdd44'};rw.add(scene.add.text(lw-110,4,df.element,{fontSize:'10px',color:ec2[df.element]||'#888888',padding:{y:1}}));}if(kl>0)rw.add(scene.add.text(lw-55,4,`×${kl}`,{fontSize:'11px',color:'#668866',fontStyle:'bold',padding:{y:1}}));rb.setInteractive({useHandCursor:true});rb.on('pointerover',()=>rb.setFillStyle(0x1a2a3a,1));rb.on('pointerout',()=>rb.setFillStyle(en?0x152525:0x121222,0.8));rb.on('pointerdown',()=>{showBestiaryDetail(scene, dx2,bodyY,dw2,bh,nm,df,en,kl,c);});lc.add(rw);});
    const rb2=scene.add.graphics();rb2.fillStyle(0x0e0e22,0.7);rb2.fillRoundedRect(dx2,bodyY,dw2,bh,6);rb2.lineStyle(1,0x334466,0.4);rb2.strokeRoundedRect(dx2,bodyY,dw2,bh,6);c.add(rb2);
    c.add(scene.add.text(dx2+dw2/2,bodyY+bh/2-20,'← 点击左侧敌人',{fontSize:'16px',color:'#334466',padding:{y:2}}).setOrigin(0.5));
    c.add(scene.add.text(dx2+dw2/2,bodyY+bh/2+10,'查看详细信息',{fontSize:'14px',color:'#223355',padding:{y:2}}).setOrigin(0.5));
    const fy2=bodyY+bh+6;const ft=scene.add.graphics();ft.fillStyle(0x1a1a36,0.8);ft.fillRoundedRect(ox+4,fy2,ow-8,24,{tl:0,tr:0,bl:10,br:10});c.add(ft);
    c.add(scene.add.text(GAME_WIDTH/2,fy2+12,'N键 开关  |  ESC 关闭  |  点击敌人查看详情',{fontSize:'11px',color:'#556688',padding:{y:2}}).setOrigin(0.5));
  }

export function showBestiaryDetail(scene: GameScene, x:number,y:number,w:number,h:number,nm:string,df:any,en:boolean,kl:number,pa:Phaser.GameObjects.Container):void {
    if(scene.bestiaryDetailContainer)scene.bestiaryDetailContainer.destroy(true);scene.bestiaryDetailContainer=scene.add.container(x,y);pa.add(scene.bestiaryDetailContainer);const dc=scene.bestiaryDetailContainer,pad=14;
    if(!en){dc.add(scene.add.text(w/2,h/2-30,'？',{fontSize:'48px',color:'#334466',fontStyle:'bold',padding:{y:4}}).setOrigin(0.5));dc.add(scene.add.text(w/2,h/2+30,'尚未遭遇',{fontSize:'16px',color:'#445566',padding:{y:2}}).setOrigin(0.5));dc.add(scene.add.text(w/2,h/2+56,'击败后解锁详细信息',{fontSize:'12px',color:'#334455',padding:{y:2}}).setOrigin(0.5));return;}
    const ib=df.type==='妖将'||df.type==='妖王';const nc=ib?'#ffcc44':df.type==='恶妖'?'#ff8866':'#ddddff';dc.add(scene.add.text(pad,pad,nm,{fontSize:'22px',color:nc,fontStyle:'bold',padding:{y:3}}));
    const tc:Record<string,string>={杂妖:'#6688aa',恶妖:'#cc6644',妖将:'#cc8844',妖王:'#cc4444'};dc.add(scene.add.text(pad,pad+32,df.type,{fontSize:'11px',color:tc[df.type]||'#666688',fontStyle:'bold',backgroundColor:'#00000066',padding:{x:8,y:3}}));
    dc.add(scene.add.text(w-pad-80,pad+4,`击杀 ×${kl}`,{fontSize:'13px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));
    let cy=pad+68;const lh=22;const ec:Record<string,string>={火:'#ff6644',水:'#4488ff',风:'#44cc88',土:'#cc9944',暗:'#8844cc',光:'#ffdd44',无:'#888899'};
    [{l:'元素',v:df.element,c:ec[df.element]||'#888899'},{l:'弱点',v:df.weakness||'无',c:df.weakness?'#ff8866':'#666688'},{l:'抗性',v:df.resist||'无',c:df.resist?'#6688cc':'#666688'}].forEach(p=>{dc.add(scene.add.text(pad+8,cy,`${p.l}：`,{fontSize:'12px',color:'#7788aa',padding:{y:1}}));dc.add(scene.add.text(pad+60,cy,p.v,{fontSize:'12px',color:p.c,fontStyle:'bold',padding:{y:1}}));cy+=lh;});
    cy+=6;const h1=scene.add.graphics();h1.lineStyle(1,0x2a3a4a,0.4);h1.lineBetween(pad,cy,w-pad,cy);dc.add(h1);cy+=12;
    const sn:Record<string,string>={灼烧:'灼烧',冻结:'冻结',中毒:'中毒',寄生:'寄生',减速:'减速',眩晕:'眩晕',禁锢:'禁锢',嘲讽:'嘲讽',恐惧:'恐惧',攻降:'攻降',防降:'防降',降灵压:'降灵压'};
    const es=Object.entries(df.statusResist||{});if(es.length===0){dc.add(scene.add.text(pad+8,cy,'无特殊抗性',{fontSize:'11px',color:'#556688',padding:{y:2}}));cy+=lh;}
    else{es.forEach(([k,v]:any,i:number)=>{const col=i%2;const sx=pad+8+col*(w/2-8);const pct=Math.round(v*100);const sc=pct>=80?'#ff5555':pct>=40?'#ffaa44':'#66cc66';dc.add(scene.add.text(sx,cy+Math.floor(i/2)*lh,`${sn[k]||k} ${pct}%`,{fontSize:'11px',color:sc,padding:{y:2}}));});cy+=Math.ceil(es.length/2)*lh;}
    cy+=6;const h2=scene.add.graphics();h2.lineStyle(1,0x2a3a4a,0.4);h2.lineBetween(pad,cy,w-pad,cy);dc.add(h2);cy+=12;
    if(df.skills?.length){df.skills.forEach((s:any)=>{const dt=s.damageType==='magical'?'魔':'物';dc.add(scene.add.text(pad+8,cy,`✦ ${s.name} [${dt}×${s.power}]`,{fontSize:'12px',color:'#ddbbee',fontStyle:'bold',padding:{y:1}}));cy+=lh;if(s.desc){dc.add(scene.add.text(pad+16,cy,s.desc,{fontSize:'10px',color:'#7788aa',wordWrap:{width:w-pad*2-16},padding:{y:1}}));cy+=18;}});cy+=4;const h3=scene.add.graphics();h3.lineStyle(1,0x2a3a4a,0.4);h3.lineBetween(pad,cy,w-pad,cy);dc.add(h3);cy+=12;}
    if(df.drops?.length){df.drops.forEach((d:any)=>{dc.add(scene.add.text(pad+8,cy,`◆ ${d.item}`,{fontSize:'12px',color:'#88cc88',padding:{y:1}}));dc.add(scene.add.text(w-pad-50,cy,`${Math.round(d.rate*100)}%`,{fontSize:'11px',color:'#669966',padding:{y:1}}));cy+=lh;});cy+=4;const h4=scene.add.graphics();h4.lineStyle(1,0x2a3a4a,0.4);h4.lineBetween(pad,cy,w-pad,cy);dc.add(h4);cy+=12;}
    if(kl>=3&&df.lore){dc.add(scene.add.text(pad,cy,'背景笔记',{fontSize:'13px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));cy+=lh+4;dc.add(scene.add.text(pad+8,cy,df.lore,{fontSize:'11px',color:'#ccbb88',wordWrap:{width:w-pad*2-8},padding:{y:2}}));}
    else if(kl>0&&kl<3){dc.add(scene.add.text(pad,cy,`再击败 ${3-kl} 次解锁背景笔记`,{fontSize:'11px',color:'#556688',padding:{y:2}}));}
  }

  // ═══════════════════════════════════════════
  //  PVP 竞技场面板
  // ═════════════════════════════════════════

  /** 最近一次服务端竞技场状态（由 GameScene 的 arenaStatus 消息写入）。 */
