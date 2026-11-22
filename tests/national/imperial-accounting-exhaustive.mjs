// Dependency-free, Node 22.13+; run from repository root:
// node --experimental-strip-types tests/national/imperial-accounting-exhaustive.mjs
import { strict as a } from 'node:assert';
import { splitWorkerIncome, distributeImperialGold, transferActiveTroops } from '../../packages/engine/src/national/politics/ImperialAccounting.ts';
import { hybridPoolCapacity, splitHybridGrowth, distributeImperialTroops } from '../../packages/engine/src/national/politics/ImperialArmyAccounting.ts';
let checks=0;
for (const gross of [0n,1n,2n,9n,10001n,2n**100n]) for (let rate=0;rate<=10000;rate++) {
 const {personal,imperial}=splitWorkerIncome(gross,rate);
 a.equal(personal+imperial,gross); a(imperial>=0n && personal>=0n); a.equal(imperial,gross*BigInt(rate)/10000n); checks++;
}
for (let count=0;count<=30;count++) for(let gold=0n;gold<=100n;gold++) {
 const ids=Array.from({length:count},(_,i)=>'member-'+i);
 for (const leader of ['absent',...ids.slice(0,1)]) {
  const x=distributeImperialGold(gold,leader,ids), y=distributeImperialGold(gold,leader,[...ids].reverse());
  a.deepEqual([...x.credits],[...y.credits]); a.equal([...x.credits.values()].reduce((s,v)=>s+v,x.unclaimed),gold);
  if(ids.includes(leader) && gold>0n) a.equal(x.credits.get(leader),gold);
  if(!ids.length) a.equal(x.unclaimed,gold);
  if(ids.length && !ids.includes(leader)) { const values=ids.map(id=>x.credits.get(id)??0n); a(values.every(v=>values.every(w=>v-w<=1n))); }
  checks++;
 }
}
for(let s=0n;s<15n;s++) for(let d=0n;d<15n;d++) for(let cap=0n;cap<15n;cap++) for(let v=1n;v<15n;v++) {
 if(s>=v && d+v<=cap) { const [ns,nd]=transferActiveTroops(s,d,cap,v); a.equal(ns+nd,s+d); a(nd<=cap); } else a.throws(()=>transferActiveTroops(s,d,cap,v)); checks++;
}
for (const rate of [-1,10001,0.5,NaN,Infinity]) a.throws(()=>splitWorkerIncome(10n,rate));
a.throws(()=>distributeImperialGold(1n,'a',['a','a']));
a.throws(()=>distributeImperialGold(-1n,'a',['a']));
console.log('PASS: '+checks+' exhaustive/boundary treasury and transfer cases + 7 malformed assertions');
checks=0;
const sum=m=>[...m.values()].reduce((s,v)=>s+v,0n);
for(let c=0n;c<=12n;c++)for(let active=0n;active<=14n;active++)for(let gross=0n;gross<=7n;gross++)for(let bps of [0,1,3333,6000,9999,10000])for(let pool=0n;pool<=5n;pool++)for(let cap=0n;cap<=5n;cap++){
 const x=splitHybridGrowth(gross,active,c,bps,pool,cap);
 a.equal(x.imperial+x.personal,gross);a.ok(x.imperial>=0n&&x.personal>=0n);a.ok(x.imperial<=(pool<cap?cap-pool:0n));
 const target=c*BigInt(bps)/10000n; a.ok(x.imperial<=(gross>(target>active?target-active:0n)?gross-(target>active?target-active:0n):0n)); checks++;
}
for(let c1=0n;c1<=7n;c1++)for(let c2=0n;c2<=7n;c2++)for(let a1=0n;a1<=8n;a1++)for(let a2=0n;a2<=8n;a2++)for(let pool=0n;pool<=18n;pool++){
 const slots=[{id:'a',capacity:c1,active:a1},{id:'b',capacity:c2,active:a2}];
 const x=distributeImperialTroops(pool,slots), y=distributeImperialTroops(pool,[...slots].reverse());
 a.deepEqual(x,y);a.equal(sum(x.active)+sum(x.deferred)+x.unclaimed,pool);a.equal(x.unclaimed,0n);
 const room=slots.reduce((s,v)=>s+(v.capacity>v.active?v.capacity-v.active:0n),0n);
 a.equal(sum(x.active),pool<room?pool:room);
 for(const s of slots) a.ok((x.active.get(s.id)??0n)<=(s.capacity>s.active?s.capacity-s.active:0n)); checks++;
}
const q=distributeImperialTroops(7n,[{id:'b',capacity:10n,active:0n},{id:'a',capacity:10n,active:0n}]);a.equal(q.active.get('a'),4n);a.equal(q.active.get('b'),3n);
a.equal(distributeImperialTroops(7n,[]).unclaimed,7n);
a.equal(hybridPoolCapacity([{id:'x',capacity:1000n,active:800n},{id:'y',capacity:3000n,active:20n}],6000),1600n);
console.log('PASS: '+checks+' hybrid growth and capacity redistribution cases; 3 explicit boundary cases');
