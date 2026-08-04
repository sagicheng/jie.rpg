/**
 * WorldService 灵宠子系统
 */
import { PET_SPECIES, PET_QUALITIES, PET_ELEMENTS, PET_SLOT_CAP, petExpForLevel, computePetStats, rollPetQuality, genPetId } from '../world';
import type { PlayerWorld, OpResult, Pet, PetElement, PetQuality } from '../world';

export function createPet(scene: any, pw: PlayerWorld, speciesId: string, name?: string, zoneOverride?: number): OpResult {
  const sp = PET_SPECIES[speciesId];
  if (!sp) return { ok: false, msg: '\u672a\u77e5\u7075\u5ba0\u7269\u79cd' };
  if (!Array.isArray(pw.pets)) pw.pets = [];
  if (pw.pets.length >= PET_SLOT_CAP) return { ok: false, msg: `\u7075\u5ba0\u680f\u5df2\u6ee1\uff08\u4e0a\u9650 ${PET_SLOT_CAP}\uff09` };
  const quality = rollPetQuality(zoneOverride ?? sp.obtainZone);
  const attrs = { str: 0, vit: 0, agi: 0, int: 0 };
  const stats = computePetStats(sp, 1, quality, attrs);
  const pet: Pet = {
    id: genPetId(), speciesId, name: name || sp.name, level: 1, exp: 0,
    element: sp.element, quality,
    hp: stats.hp, maxHp: stats.hp, atk: stats.atk, def: stats.def, matk: stats.matk, mdef: stats.mdef, spd: stats.spd,
    attrStr: 0, attrVit: 0, attrAgi: 0, attrInt: 0, attrPoints: 0,
    skills: [...sp.skillIds], loyalty: 50, active: pw.pets.length === 0,
  };
  pw.pets.push(pet);
  return { ok: true, msg: `\u83b7\u5f97\u7075\u5ba0 ${pet.name}`, data: { pet } };
}

export function setActivePet(scene: any, pw: PlayerWorld, petId: string): OpResult {
  if (!Array.isArray(pw.pets)) pw.pets = [];
  const pet = pw.pets.find((p: any) => p.id === petId);
  if (!pet) return { ok: false, msg: '\u7075\u5ba0\u4e0d\u5b58\u5728' };
  pw.pets.forEach((p: any) => { p.active = p.id === petId; });
  return { ok: true, msg: `${pet.name} \u5df2\u51fa\u6218` };
}

export function addPetExp(scene: any, pw: PlayerWorld, petId: string, amount: number): OpResult {
  if (!Array.isArray(pw.pets)) pw.pets = [];
  const pet = pw.pets.find((p: any) => p.id === petId);
  if (!pet) return { ok: false, msg: '\u7075\u5ba0\u4e0d\u5b58\u5728' };
  const sp = PET_SPECIES[pet.speciesId];
  if (!sp) return { ok: false, msg: '\u7075\u5ba0\u7269\u79cd\u7f3a\u5931' };
  pet.exp += Math.max(0, amount);
  let leveled = false, gainedPoints = 0;
  while (pet.level < 70 && pet.exp >= petExpForLevel(pet.level)) {
    pet.exp -= petExpForLevel(pet.level);
    pet.level++;
    leveled = true;
    gainedPoints += (PET_QUALITIES[pet.quality] || PET_QUALITIES.normal).attrPerLevel;
  }
  if (leveled) {
    pet.attrPoints += gainedPoints;
    const attrs = { str: pet.attrStr, vit: pet.attrVit, agi: pet.attrAgi, int: pet.attrInt };
    const s = computePetStats(sp, pet.level, pet.quality, attrs);
    pet.hp = pet.maxHp = s.hp; pet.atk = s.atk; pet.def = s.def; pet.matk = s.matk; pet.mdef = s.mdef; pet.spd = s.spd;
  }
  return { ok: true, msg: leveled ? `${pet.name} \u5347\u81f3 Lv${pet.level}` : '\u7ecf\u9a8c\u5df2\u589e\u52a0', data: { leveled, level: pet.level, gainedPoints } };
}

export function setPetAttr(scene: any, pw: PlayerWorld, petId: string, attr: string, delta: number): OpResult {
  if (!Array.isArray(pw.pets)) pw.pets = [];
  const pet = pw.pets.find((p: any) => p.id === petId);
  if (!pet) return { ok: false, msg: '\u7075\u5ba0\u4e0d\u5b58\u5728' };
  const sp = PET_SPECIES[pet.speciesId];
  if (!sp) return { ok: false, msg: '\u7075\u5ba0\u7269\u79cd\u7f3a\u5931' };
  const fields: Record<string, string> = { str: 'attrStr', vit: 'attrVit', agi: 'attrAgi', int: 'attrInt' };
  const field = fields[attr];
  if (!field) return { ok: false, msg: '\u672a\u77e5\u5c5e\u6027' };
  const cur = (pet as any)[field] as number;
  if (delta > 0 && pet.attrPoints <= 0) return { ok: false, msg: '\u65e0\u53ef\u7528\u5c5e\u6027\u70b9' };
  if (delta < 0 && cur <= 0) return { ok: false, msg: '\u8be5\u5c5e\u6027\u70b9\u5df2\u4e3a 0' };
  (pet as any)[field] = cur + delta;
  pet.attrPoints -= delta;
  const attrs = { str: pet.attrStr, vit: pet.attrVit, agi: pet.attrAgi, int: pet.attrInt };
  const s = computePetStats(sp, pet.level, pet.quality, attrs);
  pet.hp = pet.maxHp = s.hp; pet.atk = s.atk; pet.def = s.def; pet.matk = s.matk; pet.mdef = s.mdef; pet.spd = s.spd;
  return { ok: true, msg: `${pet.name} \u5c5e\u6027\u5df2\u66f4\u65b0` };
}

export function releasePet(scene: any, pw: PlayerWorld, petId: string): OpResult {
  if (!Array.isArray(pw.pets)) pw.pets = [];
  const idx = pw.pets.findIndex((p: any) => p.id === petId);
  if (idx < 0) return { ok: false, msg: '\u7075\u5ba0\u4e0d\u5b58\u5728' };
  const wasActive = pw.pets[idx].active;
  const name = pw.pets[idx].name;
  pw.pets.splice(idx, 1);
  if (wasActive && pw.pets.length > 0) pw.pets[0].active = true;
  return { ok: true, msg: `\u5df2\u653e\u751f ${name}` };
}

export function recallPet(scene: any, pw: PlayerWorld, petId: string): OpResult {
  if (!Array.isArray(pw.pets)) pw.pets = [];
  const pet = pw.pets.find((p: any) => p.id === petId);
  if (!pet) return { ok: false, msg: '\u7075\u5ba0\u4e0d\u5b58\u5728' };
  pet.active = false;
  return { ok: true, msg: `${pet.name} \u5df2\u6536\u56de` };
}

export function openPetEgg(scene: any, pw: PlayerWorld, itemId: string): OpResult {
  if (!Array.isArray(pw.pets)) pw.pets = [];
  const egg = pw.inventory.find((i: any) => i.id === itemId && i.type === 'pet_egg');
  if (!egg) return { ok: false, msg: '\u80cc\u5305\u91cc\u6ca1\u6709\u8fd9\u679a\u7075\u5ba0\u86cb' };
  if (pw.pets.length >= PET_SLOT_CAP) return { ok: false, msg: `\u7075\u5ba0\u680f\u5df2\u6ee1\uff08\u4e0a\u9650 ${PET_SLOT_CAP}\uff09\uff0c\u65e0\u6cd5\u5f00\u542f\u7075\u5ba0\u86cb` };
  const keys = Object.keys(PET_SPECIES);
  const speciesId = keys[Math.floor(Math.random() * keys.length)];
  const res = createPet(scene, pw, speciesId, undefined, egg.zone);
  if (!res.ok) return res;
  egg.quantity -= 1;
  if (egg.quantity <= 0) pw.inventory = pw.inventory.filter((i: any) => i !== egg);
  const pet = res.data?.pet as Pet;
  const el = PET_ELEMENTS[pet.element as PetElement]?.label || pet.element;
  const q = PET_QUALITIES[pet.quality as PetQuality]?.label || pet.quality;
  return { ok: true, msg: `\u5b75\u5316\u6210\u529f\uff01\u83b7\u5f97\u7075\u5ba0\u300c${pet.name}\u300d\uff08${el}\u00b7${q}\uff09`, data: { pet } };
}

export function grantPetEgg(scene: any, pw: PlayerWorld, zone: number = 1): OpResult {
  scene.grantItem(pw, { id: 'pet_egg', name: '\u7075\u5ba0\u86cb', type: 'pet_egg', desc: '\u53cc\u51fb\u5f00\u542f\uff0c\u968f\u673a\u5b75\u5316\u4e00\u53ea\u7075\u5ba0', quantity: 1, zone });
  return { ok: true, msg: '\u83b7\u5f97\u7075\u5ba0\u86cb' };
}

export function getActivePet(scene: any, pw: PlayerWorld): Pet | null {
  if (!Array.isArray(pw.pets)) return null;
  return pw.pets.find((p: any) => p.active) || null;
}
