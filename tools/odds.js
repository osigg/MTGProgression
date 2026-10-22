// Simulate packs from the real print sheets and write data/odds.json.
// Usage: node tools/odds.js [packsPerSet]   (default 20000). Edit tools/targets.json to change target lists.
const fs=require('fs');
const D=JSON.parse(fs.readFileSync(__dirname+'/../data/cards.json','utf8'));
const T=JSON.parse(fs.readFileSync(__dirname+'/targets.json','utf8'));
const NORM=s=>s.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
const byName=new Map(D.cards.map((c,i)=>[NORM(c[0]),i]));
const RANK={R:0,U:1,C:2,L:3};
function pickW(list){let t=0;for(const x of list)t+=x[1];let r=Math.random()*t;for(const x of list){r-=x[1];if(r<0)return x;}return list[list.length-1];}
function open(s){const b=pickW(s.boosters.map(x=>[x,x.w]))[0];const out=[];for(const[sh,c]of Object.entries(b.s)){let pool=s.sheets[sh].slice();for(let k=0;k<c&&pool.length;k++){const p=pickW(pool);out.push(p[0]);pool=pool.filter(x=>x[0]!==p[0]);}}return out;}
const N=+process.argv[2]||20000; const out={packsSimulated:N, sets:{}};
for(const s of D.sets){
  const tgt=(T[s.code]||[]).map(n=>byName.get(NORM(n)));
  const tset=new Set(tgt); const hits=new Map(tgt.map(i=>[i,0]));
  let any=0; const rareDist={}; const avg={R:0,U:0,C:0,L:0};
  for(let k=0;k<N;k++){
    const p=open(s); let r=0, hit=false;
    for(const i of new Set(p)){ if(tset.has(i)){ hits.set(i,hits.get(i)+1); hit=true; } }
    for(const i of p){ const ra=s.rar[i]||'C'; avg[ra]++; if(ra==='R') r++; }
    if(hit) any++; rareDist[r]=(rareDist[r]||0)+1;
  }
  for(const k in avg) avg[k]=+(avg[k]/N).toFixed(2);
  for(const k in rareDist) rareDist[k]=+(rareDist[k]/N).toFixed(4);
  const targets=tgt.map(i=>({name:D.cards[i][0], rarity:s.rar[i]||'C', p:+(hits.get(i)/N).toFixed(5)})).sort((a,b)=>a.p-b.p||a.name.localeCompare(b.name));
  out.sets[s.code]={pAnyTarget:+(any/N).toFixed(4), avgPerPack:avg, raresPerPack:rareDist, targets};
  console.log(s.code, 'anyTarget', (any/N).toFixed(3), 'rares', JSON.stringify(rareDist), 'avg', JSON.stringify(avg));
}
fs.writeFileSync(__dirname+'/../data/odds.json', JSON.stringify(out));
