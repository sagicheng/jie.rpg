const fs = require('fs');
const path = require('path');

const zoneDir = 'src/config/zones';
const zoneFiles = fs.readdirSync(zoneDir).filter(f => f.startsWith('zone_') && f.endsWith('.ts'));
const npcMap = new Map();

for (const zf of zoneFiles) {
  const content = fs.readFileSync(path.join(zoneDir, zf), 'utf8');
  const re = /id:\s*'([^']+)',\s*name:\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const [, id, name] = match;
    if (!npcMap.has(id)) npcMap.set(id, { name, count: 1 });
  }
}

const nameList = [
  'XC匠','一番锻','七弦','书记官','云行商',
  '云隐','修竹','冬凌','千代','启明',
  '咎人锻','囚灵','夏萤','天衡阁','太岁',
  '奇迹使','孤影集','守关翁','守门者','安和集',
  '完现锻','寂灭阁','密牙','岩户集','川流坊',
  '巧手商','弓月','影铁匠','恐惧','戌吊工',
  '战迹翁','技开工','无间炼','星十锤','星塔',
  '春涧','暗影阁','朱华','校舍工','桃影',
  '残影·冥','残影·墨','残影·护','残影·牙','残影·祈',
  '残影·虚王','残影·铁','残影·雪','水镜','沧溟轩',
  '流浪锻','流翁','浦原锻','浮云','润林锤',
  '游鱼','灵院炼','灼燃','炎叟','炼狱商',
  '爆音','狂笑','狱王','珍味坊','电光',
  '白斋主','砂原锻','碎岳','磨刀匠','花童',
  '花铃','花静','苍山','菊舞','虚夜锤',
  '虚探','观云','近卫','远行商','铁云堂',
  '铁心','铁臂','铁裁','银架工','银镜坊',
  '雀羽','雨雀','雨龙','雪绪','霜行',
  '露华集','静言','风鹤轩','魂影','鸦鸣',
  '黑腔匠'
];
const nameToNum = {};
nameList.forEach((n, i) => { nameToNum[n] = i + 1; });

const ids = [...npcMap.keys()].sort();
let count = 0;
for (const id of ids) {
  const num = nameToNum[npcMap.get(id).name];
  if (num) {
    console.log(`  { key: '${id}', path: 'assets/characters/${id}.png' },`);
    count++;
  }
}
console.log(`\n// Total: ${count} NPC texture entries`);
