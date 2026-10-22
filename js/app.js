import * as backend from "./backend.js";
import { ADMIN_EMAIL } from "./firebase-config.js";
import * as IMG from "./images.js";

/* ---------- card data ---------- */
let CARDS = [], SETS = {}, SET_ORDER = [];
let ODDS = {packsSimulated:0, sets:{}};   // data/odds.json: real-collation odds per set
const TARGETS = {};                        // set code -> Set of card indexes worth chasing
const BY_NAME = new Map();
const NORM = s => s.normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/Æ/g,"Ae").replace(/æ/g,"ae").toLowerCase().replace(/\s+/g," ").trim();
const RANK = {R:0,U:1,C:2,L:3};
const SUPER = new Set(["Legendary","Basic","Snow","World","Ongoing"]);
const MAINT = new Set(["Artifact","Creature","Enchantment","Instant","Sorcery","Land","Tribal","Kindred","Planeswalker","Battle"]);
function typeLine(t){ const w=t.split(" "); const a=[], b=[]; let sub=false;
  for(const x of w){ if(!sub && (SUPER.has(x)||MAINT.has(x))) a.push(x); else { sub=true; b.push(x);} }
  return a.join(" ") + (b.length ? " · " + b.join(" ") : ""); }
const isLegend = c => /\bLegendary\b/.test(c.type) && /\bCreature\b/.test(c.type);
const isBasic = c => /\bBasic\b/.test(c.type) && /\bLand\b/.test(c.type);
function rarityOf(set, idx){ const s=SETS[set]; return (s && s.rar[idx]) || "C"; }
const isTargetIdx = (s, i) => !!(TARGETS[s] && TARGETS[s].has(i));
const RAR_NAME = {R:"rare", U:"uncommon", C:"common", L:"basic land"};
const oneIn = p => p <= 0 ? "never seen in simulation" : p >= 0.5 ? `${Math.round(p*100)}% per pack` : `1 in ${Math.round(1/p)} packs`;

/* ---------- pack stats ---------- */
function packStats(packs){
  const st = {packs:0, cards:0, R:0, U:0, C:0, L:0, targets:[], legends:[], colors:{W:0,U:0,B:0,R:0,G:0,M:0,C:0}};
  for(const pk of packs){
    if(!SETS[pk.s]) continue; st.packs++;
    for(const nm of pk.c){
      const i = BY_NAME.get(NORM(nm)); st.cards++; if(i===undefined) continue;
      st[rarityOf(pk.s,i)]++; const c = CARDS[i];
      if(isTargetIdx(pk.s,i)) st.targets.push({nm, s:pk.s});
      if(isLegend(c)) st.legends.push({nm, s:pk.s});
      if(!/\bLand\b/.test(c.type)) st.colors[c.ci.length>1 ? "M" : (c.ci || "C")]++;
    }
  }
  return st;
}
// Expected rares and target cards for a list of packs, from the simulated real odds.
function expectedFor(packs){
  let R = 0, T = 0;
  for(const pk of packs){ const o = ODDS.sets[pk.s]; if(!o) continue; R += o.avgPerPack.R; T += o.targets.reduce((a,t)=>a+t.p, 0); }
  return {R, T};
}
const fmt1 = x => (Math.round(x*10)/10).toFixed(1);
function colorBar(colors){
  const keys = ["W","U","B","R","G","M","C"]; const total = keys.reduce((a,k)=>a+colors[k],0); if(!total) return "";
  const label = {W:"White",U:"Blue",B:"Black",R:"Red",G:"Green",M:"Multicolor",C:"Colorless"};
  return `<div class="colorbar" role="img" aria-label="Color breakdown">${keys.filter(k=>colors[k]).map(k=>`<span class="cb ${k}" style="flex:${colors[k]}" title="${label[k]}: ${colors[k]}"></span>`).join("")}</div>
    <div class="cblegend">${keys.filter(k=>colors[k]).map(k=>`<span><i class="cb ${k}"></i>${label[k]} ${colors[k]}</span>`).join("")}</div>`;
}
function statsHTML(st, exp){
  const tile = (v, l, sub) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
  return `<div class="summary">
      ${tile(st.cards, "Cards", `${st.packs} pack${st.packs===1?"":"s"}`)}
      ${tile(st.R, "Rares", exp ? `expected ${fmt1(exp.R)}` : "")}
      ${tile(st.targets.length, "Targets hit", exp ? `expected ${fmt1(exp.T)}` : "")}
      ${tile(st.legends.length, "Legendary creatures", "")}
    </div>${colorBar(st.colors)}`;
}

// Round plan. To add a round: add its sets to data/cards.json and an entry here.
const ROUNDS = [
  {n:1, title:"The Beginning", years:"1993 to 1994", lines:[["2ed",10],["leg",10]],
   branch:{label:"Branch: pick one", options:[["arn",5,"Swingy rares: Library of Alexandria, Bazaar of Baghdad"],["atq",5,"Artifacts fit any commander"],["drk",5,"Black and tribal"]]}},
  {n:2, title:"Ice Age", years:"1994 to 1996", lines:[["ice",15]],
   branch:{label:"Branch: pick one (72 cards each)", options:[["all",6,"Pitch spells, best fit with Ice Age"],["hml",9,"Commander branch: Baron Sengir, Autumn Willow"],["fem",9,"Tokens and tribes"],["chr",6,"Catch-up reprints of round 1 sets"]]}},
  {n:3, title:"Mirage", years:"1996 to 1997", lines:[["mir",15]],
   branch:{label:"Branch: pick one", options:[["vis",6,"Creature value, enters-the-battlefield"],["wth",6,"Graveyard"]]}},
  {n:4, title:"Rath Cycle", years:"1997 to 1998", lines:[["tmp",12]],
   split:{a:"sth", b:"exo", total:8}},
  {n:5, title:"Urza's Block", years:"1998 to 1999", lines:[["usg",10],["ulg",5],["uds",5]],
   throwback:{sets:["2ed","leg","arn","atq","drk","ice","all","hml","fem","chr","mir","vis","wth","tmp","sth","exo"], cards:60}}
];
const throwbackPacks = code => Math.round(60 / SETS[code].size);

/* ---------- util ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function manaHTML(m){ if(!m) return ""; return '<span class="mana">' + (m.match(/\{[^}]+\}/g)||[]).map(t => { const v=t.slice(1,-1); const col = /^[WUBRG]$/.test(v) ? v : (/^[WUBRG]\/[WUBRGP]$/.test(v) ? v[0] : ""); return `<span class="ms ${col}" aria-label="${esc(v)}">${esc(col ? v.replace("/P","") : v)}</span>`; }).join("") + "</span>"; }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 2800); }
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const fmtDate = iso => { try { return new Date(iso).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); } catch(e){ return iso; } };
function scryfallURL(name, set){ return "https://scryfall.com/search?q=" + encodeURIComponent('!"' + name + '"' + (set ? " e:" + set : "")); }

/* ---------- booster generation ---------- */
function pickWeighted(list){ let tot=0; for(const x of list) tot+=x[1]; let r=Math.random()*tot; for(const x of list){ r-=x[1]; if(r<0) return x; } return list[list.length-1]; }
function openBooster(code){
  const set = SETS[code];
  const b = pickWeighted(set.boosters.map(x => [x, x.w]))[0];
  const out = [];
  for(const [sheet, count] of Object.entries(b.s)){
    let pool = set.sheets[sheet].slice();
    for(let k=0;k<count && pool.length;k++){ const pick = pickWeighted(pool); out.push(pick[0]); pool = pool.filter(x => x[0] !== pick[0]); }
  }
  out.sort((a,b) => RANK[rarityOf(code,a)] - RANK[rarityOf(code,b)] || CARDS[a].name.localeCompare(CARDS[b].name));
  return out;
}

/* ---------- state ---------- */
const state = { me:null, players:[], pulls:[], settings:null, loaded:false };
const isAdmin = () => !!(state.me && state.me.emailVerified && state.me.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
const unlocked = () => (state.settings && state.settings.unlockedRound) || 1;
const bans = () => (state.settings && state.settings.bans) || [];
const myProfile = () => state.me && state.players.find(p => p.id === state.me.uid);

function friendly(e){
  const c = (e && e.code) || "";
  if(c.includes("permission-denied")) return "The database refused that. If you think you should be allowed, ask the admin.";
  if(c.includes("popup-closed") || c.includes("cancelled-popup")) return "Sign-in window closed before finishing.";
  if(c.includes("unauthorized-domain")) return "This site isn't on Firebase's allowed list yet. The admin needs to add it (README step 5).";
  if(c.includes("unavailable")) return "Can't reach the database right now. Check your connection.";
  return "Something went wrong: " + (e && e.message ? e.message : "unknown error");
}
async function guarded(fn, okMsg){ try { await fn(); if(okMsg) toast(okMsg); return true; } catch(e){ console.error(e); toast(friendly(e)); return false; } }

/* ---------- derived ---------- */
function playerName(id){ const p = state.players.find(x=>x.id===id); return p ? p.name : "Unknown player"; }
function livePulls(pid){ return state.pulls.filter(p => p.player===pid && !p.voided); }
function collectionOf(pid){
  const m = new Map();
  for(const pull of livePulls(pid)){
    for(const pk of pull.packs || []){
      pk.c.forEach((nm, j) => {
        const k = NORM(nm); let e = m.get(k);
        if(!e){ e = {name:nm, idx: BY_NAME.has(k) ? BY_NAME.get(k) : -1, total:0, sets:{}, nums:{}, best:"C"}; m.set(k,e); }
        e.total++; const code = pk.s || "pool"; e.sets[code] = (e.sets[code]||0)+1;
        const num = (pk.n && pk.n[j]) || (e.idx>=0 && SETS[code] ? SETS[code].num[e.idx] : "");
        if(num && !e.nums[code]) e.nums[code] = num;
        if(e.idx>=0 && pk.s && SETS[pk.s]){ const r = rarityOf(pk.s, e.idx); if(RANK[r] < RANK[e.best]) e.best = r; }
      });
    }
  }
  return m;
}
const banSet = () => new Set(bans().map(NORM));
function roundPullId(uid, n){ return `${uid}_r${n}`; }
function roundDone(uid, n){ return state.pulls.some(p => p.player===uid && p.kind==="packs" && p.round===n && !p.voided); }

/* ---------- UI state ---------- */
const ui = { tab:"open", player:null, round:1, branch:{}, split:4, throwback:"leg", extraSet:"2ed", extraCount:1, poolText:"", poolRound:1,
  lastOpen:null, colPlayer:null, f:{q:"", colors:new Set(), type:"", rarity:"", set:"", cmd:"", hideBasics:true}, sort:"name",
  deckPlayer:null, deckText:"", deckCmd:"", deckResult:null, histOpen:new Set(), voidConfirm:null, removeConfirm:null, banDraft:null,
  busy:false, checks:null, revealIdx:0, revealDone:false, statsRound:null,
  revealMode: (() => { try { return localStorage.getItem("ppo-reveal") || "one"; } catch(e){ return "one"; } })(),
  images: (() => { try { return localStorage.getItem("ppo-images") !== "off"; } catch(e){ return true; } })(),
  sb:{set:null, sort:"rarity", q:"", rarity:"", color:"", targets:false, own:"", hideBasics:true} };

function ensureSelections(){
  const ids = state.players.map(p=>p.id); const mine = state.me && ids.includes(state.me.uid) ? state.me.uid : ids[0] || null;
  if(!isAdmin()) ui.player = state.me ? state.me.uid : null;
  else if(!ids.includes(ui.player)) ui.player = mine;
  if(!ids.includes(ui.colPlayer)) ui.colPlayer = mine;
  if(!ids.includes(ui.deckPlayer)) ui.deckPlayer = mine;
  if(typeof ui.round === "number" && !isAdmin() && ui.round > unlocked()) ui.round = unlocked();
}
function playerChips(sel, attr){
  if(!state.players.length) return `<p class="muted small">No players yet.</p>`;
  return `<div class="chips">${state.players.map(p => `<button class="chip" data-${attr}="${esc(p.id)}" aria-pressed="${p.id===sel}">${esc(p.name)}${state.me && p.id===state.me.uid ? " (you)" : ""}</button>`).join("")}</div>`;
}

/* ---------- Open tab ---------- */
function visibleRounds(){ return ROUNDS.filter(R => isAdmin() || R.n <= unlocked()); }
function planFor(){
  const r = ui.round;
  if(typeof r === "number"){
    const R = ROUNDS[r-1]; const slots = R.lines.map(([s,n]) => ({kind:"Line", set:s, packs:n}));
    if(R.branch){ const ch = ui.branch[r] || R.branch.options[0][0]; const o = R.branch.options.find(x=>x[0]===ch); slots.push({kind:"Branch", set:o[0], packs:o[1]}); }
    if(R.split){ const a = Math.max(0, Math.min(R.split.total, ui.split)); if(a) slots.push({kind:"Mix", set:R.split.a, packs:a}); if(R.split.total-a) slots.push({kind:"Mix", set:R.split.b, packs:R.split.total-a}); }
    if(R.throwback) slots.push({kind:"Throwback", set:ui.throwback, packs:throwbackPacks(ui.throwback)});
    return slots;
  }
  if(r === "extra") return [{kind:"Extra", set:ui.extraSet, packs:Math.max(1, Math.min(60, ui.extraCount|0))}];
  return [];
}
function slotHTML(kind, s, n){ return `<div class="slot"><div><div class="k">${kind}</div><div class="n">${esc(SETS[s].name)}</div></div><div class="c">${n} × ${SETS[s].size} = ${n*SETS[s].size}</div></div>`; }
function renderOpen(){
  const v = $("#view-open");
  const rounds = visibleRounds().map(R => `<button data-round="${R.n}" aria-pressed="${ui.round===R.n}">Round ${R.n}${R.n>unlocked()?" 🔒":""}</button>`).join("") +
    (isAdmin() ? `<button data-round="extra" aria-pressed="${ui.round==="extra"}">Extra packs</button>` : "") +
    `<button data-round="pool" aria-pressed="${ui.round==="pool"}">Shared pool</button>`;
  const who = ui.player ? playerName(ui.player) : "you";
  let planHTML = "";
  if(typeof ui.round === "number"){
    const R = ROUNDS[ui.round-1];
    const lines = R.lines.map(([s,n]) => slotHTML("Line", s, n)).join("");
    let extra = "";
    if(R.branch){
      const ch = ui.branch[R.n] || R.branch.options[0][0]; const o = R.branch.options.find(x=>x[0]===ch);
      extra = `<div class="slot"><div><div class="k">${esc(R.branch.label)}</div><div class="n">${esc(SETS[o[0]].name)}</div></div><div class="c">${o[1]} × ${SETS[o[0]].size} = ${o[1]*SETS[o[0]].size}</div>
        <div class="opts">${R.branch.options.map(([s,n,why]) => `<label class="opt"><input type="radio" name="branch" value="${s}" ${s===ch?"checked":""}> <span>${esc(SETS[s].name)} <span class="muted">(${n} packs)</span><br><span class="why">${esc(why)}</span></span></label>`).join("")}</div></div>`;
    }
    if(R.split){
      const a = Math.max(0, Math.min(R.split.total, ui.split)), b = R.split.total - a;
      extra = `<div class="slot"><div><div class="k">Mix and match: ${R.split.total} packs</div><div class="n">${a} Stronghold · ${b} Exodus</div></div><div class="c">${R.split.total} × 15 = ${R.split.total*15}</div>
        <div class="opts"><label for="splitRange" class="small">Stronghold packs: <b>${a}</b></label><input id="splitRange" type="range" min="0" max="${R.split.total}" step="1" value="${a}"><span class="why">Stronghold: Slivers, Spikes, Sliver Queen. Exodus: Coat of Arms, Soul Warden, Mirri.</span></div></div>`;
    }
    if(R.throwback){
      const tp = throwbackPacks(ui.throwback);
      extra = `<div class="slot"><div><div class="k">Throwback: about 60 cards from one earlier set</div><div class="n">${esc(SETS[ui.throwback].name)}</div></div><div class="c">${tp} × ${SETS[ui.throwback].size} = ${tp*SETS[ui.throwback].size}</div>
        <div class="opts"><select id="throwSel" aria-label="Throwback set">${R.throwback.sets.map(s => `<option value="${s}" ${s===ui.throwback?"selected":""}>${esc(SETS[s].name)} (${throwbackPacks(s)} packs)</option>`).join("")}</select></div></div>`;
    }
    const slots = planFor(); const total = slots.reduce((a,s)=>a+s.packs*SETS[s.set].size,0); const packs = slots.reduce((a,s)=>a+s.packs,0);
    const done = ui.player && roundDone(ui.player, ui.round);
    const locked = ui.round > unlocked();
    let action;
    if(done && !isAdmin()) action = `<div class="note"><b>You've opened Round ${ui.round}.</b> Your cards are in Collections. If something went wrong, ask the admin to void it and re-open for you.</div>`;
    else if(locked && !isAdmin()) action = `<div class="note"><b>Round ${ui.round} is locked.</b></div>`;
    else action = `${done ? `<div class="note warn"><b>${esc(who)} already opened Round ${ui.round}.</b> Opening again adds a second set of packs. Void the old one in History first if this is a redo.</div>` : ""}
      ${locked ? `<div class="note warn"><b>Round ${ui.round} is still locked for players.</b> As admin you can open it anyway.</div>` : ""}
      <button class="btn primary" id="openBtn" ${!ui.player||ui.busy?"disabled":""}>Open ${packs} packs for ${esc(who)}</button>`;
    planHTML = `<div class="plan">${lines}${extra}<div class="total"><span>${packs} packs</span><span>${total} cards</span></div></div>${action}`;
  } else if(ui.round === "extra"){
    planHTML = `<p class="small muted">Admin only. For corrections, prizes, or anything outside the round plan. Saved and logged like any round.</p>
      <div class="row"><select id="extraSet" aria-label="Set">${SET_ORDER.map(s => `<option value="${s}" ${s===ui.extraSet?"selected":""}>${esc(SETS[s].name)} (${SETS[s].size}-card packs)</option>`).join("")}</select>
      <input id="extraCount" type="number" min="1" max="60" value="${ui.extraCount}" style="width:80px" aria-label="Packs"></div>
      <div class="total"><span>${ui.extraCount} packs</span><span>${ui.extraCount*SETS[ui.extraSet].size} cards</span></div>
      <button class="btn primary" id="openBtn" ${!ui.player||ui.busy?"disabled":""}>Open ${ui.extraCount} packs for ${esc(who)}</button>`;
  } else {
    planHTML = `<p class="small muted">Shared pool picks (2 per player per round, worst record first). One card per line with its edition, like <span style="font-family:var(--f-mono)">Sol Ring (2ed) 270</span>, so the export to Archidekt keeps the right printing. For sets on the round sheet the number is optional.</p>
      <div class="row"><label for="poolRound">For round</label><select id="poolRound">${visibleRounds().map(R=>`<option value="${R.n}" ${R.n===ui.poolRound?"selected":""}>Round ${R.n}</option>`).join("")}</select></div>
      <textarea id="poolText" placeholder="Sol Ring (2ed) 270&#10;Force of Will (all) 28" style="min-height:90px">${esc(ui.poolText)}</textarea>
      <button class="btn primary" id="poolSave" ${!ui.player||ui.busy?"disabled":""}>Add to ${esc(who)}'s collection</button>`;
  }
  const R = typeof ui.round==="number" ? ROUNDS[ui.round-1] : null;
  v.innerHTML = `<div class="grid2">
    <div class="panel">
      ${isAdmin() ? `<div class="stack"><h3>Opening for</h3>${playerChips(ui.player,"player")}</div>` : ""}
      <div class="stack"><h3>What to open</h3><div class="seg">${rounds}</div>
        ${R ? `<p class="small"><b>Round ${R.n}: ${esc(R.title)}</b> <span class="muted">(${R.years})</span></p>` : ""}
      </div>
      ${planHTML}
      ${typeof ui.round==="number" || ui.round==="extra" ? `<div class="stack"><h3>Reveal</h3><div class="seg"><button data-reveal="one" aria-pressed="${ui.revealMode==="one"}">One pack at a time</button><button data-reveal="all" aria-pressed="${ui.revealMode==="all"}">All at once</button></div></div>` : ""}
      ${typeof ui.round==="number" || ui.round==="extra" ? expectHTML(planFor()) : ""}
      <p class="small muted">Opening saves every pack straight to the collection and the History tab, even when you reveal them one at a time. Each player gets one opening per round.</p>
    </div>
    <div class="stack">${resultHTML()}</div>
  </div>`;
}
function resultHTML(){
  const L = ui.lastOpen;
  if(!L){
    const recent = [...state.pulls].reverse().find(p => !p.voided && p.kind==="packs");
    if(recent) return `<div class="empty"><b>Ready to open.</b><br>Last opening: ${esc(playerName(recent.player))}, ${esc(recent.label)} on ${esc(fmtDate(recent.created))}. Every pack is in History.</div>`;
    return `<div class="empty"><b>No packs opened yet.</b><br>Choose your branch and open. ${ui.revealMode==="one" ? "Packs are revealed one at a time." : "All packs appear at once, rares first."}</div>`;
  }
  const N = L.packs.length;
  const oneByOne = ui.revealMode === "one" && !ui.revealDone;
  const upto = oneByOne ? Math.min(ui.revealIdx, N-1) : N-1;
  const shown = L.packs.slice(0, upto+1);
  const st = packStats(shown); const exp = expectedFor(shown);
  const head = `<div><h2>${esc(playerName(L.player))} · ${esc(L.label)}</h2><p class="small muted">${N} packs · saved ${esc(fmtDate(L.created))}${oneByOne ? ` · stats so far cover ${upto+1} of ${N}` : ""}</p></div>`;
  const hits = st.targets.length ? `<div class="note target-note"><b>Targets pulled:</b> ${st.targets.map(x => `<button class="link" data-card="${esc(x.nm)}" data-set="${esc(x.s)}">${esc(x.nm)}</button>`).join(", ")}</div>` : "";
  const legends = st.legends.length ? `<div class="note"><b>Commander options:</b> ${st.legends.map(x => `<button class="link" data-card="${esc(x.nm)}" data-set="${esc(x.s)}">${esc(x.nm)}</button>`).join(", ")}</div>` : "";
  if(oneByOne){
    const pk = L.packs[upto];
    return `${head}
      <div class="reveal">
        <div class="row" style="justify-content:space-between">
          <b class="revcount">Pack ${upto+1} of ${N}</b>
          <div class="row"><button class="btn" id="revPrev" ${upto===0?"disabled":""}>Previous</button>
          ${upto < N-1 ? `<button class="btn primary" id="revNext">Open next pack</button>` : `<button class="btn primary" id="revDone">See all ${N} packs</button>`}
          <button class="btn" id="revAll">Skip to all</button></div>
        </div>
        <div class="progress" aria-hidden="true"><span style="width:${((upto+1)/N*100).toFixed(1)}%"></span></div>
        ${packHTML(pk, upto, true)}
      </div>
      ${statsHTML(st, exp)}${hits}${legends}`;
  }
  return `${head}${statsHTML(st, exp)}${hits}${legends}
    <div class="packs">${L.packs.map((pk,i) => packHTML(pk,i)).join("")}</div>`;
}
/* ---------- card images ---------- */
function numFor(nm, s){ const i = BY_NAME.get(NORM(nm)); return i!==undefined && SETS[s] ? (SETS[s].num[i] || "") : ""; }
function cardImgHTML(nm, s, o = {}){
  const i = BY_NAME.get(NORM(nm)); const c = i!==undefined ? CARDS[i] : null;
  const r = c && SETS[s] ? rarityOf(s, i) : (o.rarity || "C");
  const tgt = c && isTargetIdx(s, i);
  const key = IMG.keyFor(nm, s, o.num || numFor(nm, s));
  return `<button class="cimgbox ${r} ${tgt?"T":""} ${o.dim?"dim":""}" data-card="${esc(nm)}" data-set="${esc(s||"")}" title="${esc(nm)}">
    <img class="cimg" data-ik="${esc(key)}" data-size="${o.big?"n":"s"}" alt="${esc(nm)}" width="244" height="340" decoding="async">
    <span class="cimgname">${esc(nm)}</span>
    ${o.qty ? `<span class="qty">×${o.qty}</span>` : ""}${tgt ? '<span class="target-tag">Target</span>' : ""}${o.note ? `<span class="cnote">${esc(o.note)}</span>` : ""}
  </button>`;
}
function packCardsHTML(pk, big){
  if(!ui.images) return `<ol>${pk.c.map(nm => cardRow(nm, pk.s)).join("")}</ol>`;
  return `<div class="cgrid ${big?"big":""}">${pk.c.map((nm, j) => cardImgHTML(nm, pk.s, {big, num: pk.n && pk.n[j]})).join("")}</div>`;
}
function packHTML(pk, i, big){
  const set = SETS[pk.s];
  const st = set ? packStats([pk]) : null;
  const line = st ? [st.R ? `${st.R} rare${st.R>1?"s":""}` : "no rare", `${st.U} unc`, st.targets.length ? `<b class="tgt">${st.targets.length} target${st.targets.length>1?"s":""}</b>` : ""].filter(Boolean).join(" · ") : `${pk.c.length} card${pk.c.length>1?"s":""}`;
  return `<article class="pack ${big?"big":""} ${st && st.targets.length ? "has-target" : ""}" style="animation-delay:${big?0:Math.min(i,20)*40}ms"><header><b>${esc(set ? set.name : pk.s ? pk.s.toUpperCase() : "Pool pick")}</b><span class="muted">${set ? `#${i+1} · ` : ""}${line}</span></header>${packCardsHTML(pk, big)}</article>`;
}
function cardRow(nm, s){
  const i = BY_NAME.get(NORM(nm)); const c = i!==undefined ? CARDS[i] : null; const r = c && s && SETS[s] ? rarityOf(s,i) : "C";
  const tgt = c && isTargetIdx(s, i);
  return `<li class="cardrow ${r} ${tgt?"T":""}"><span class="rar ${r}" title="${r==="R"?"Rare":r==="U"?"Uncommon":r==="L"?"Basic land":"Common"}"></span><span class="nm"><button class="link" style="color:inherit" data-card="${esc(nm)}" data-set="${esc(s||"")}">${esc(nm)}</button>${tgt ? '<span class="target-tag">Target</span>' : ""}${c && isLegend(c) ? '<span class="legend-tag">Legend</span>' : ""}</span>${c ? manaHTML(c.mana) : ""}</li>`;
}
// "What's in these packs": real odds plus the target list for each set in a plan.
function expectHTML(slots){
  const own = ui.player ? collectionOf(ui.player) : new Map();
  const seen = new Set();
  return `<div class="stack"><h3>What to expect</h3>${slots.filter(s => !seen.has(s.set) && seen.add(s.set)).map(sl => {
    const o = ODDS.sets[sl.set]; if(!o) return "";
    const set = SETS[sl.set]; const b = set.boosters[0].s;
    const slotsTxt = Object.entries(b).filter(([k])=>!k.startsWith("foil")).map(([k,n])=>`${n} ${k}`).join(", ");
    const rareTxt = Object.entries(o.raresPerPack).sort().map(([k,p])=>`${k}: ${Math.round(p*100)}%`).join(" · ");
    const sumT = o.targets.reduce((a,t)=>a+t.p,0);
    return `<details class="expect"><summary><b>${esc(set.name)}</b> <span class="muted small">${Math.round(o.pAnyTarget*100)}% of packs hold a target · ${fmt1(sumT*sl.packs)} expected in ${sl.packs} packs</span></summary>
      <div class="small muted">Pack: ${esc(slotsTxt)}. Rares per pack: ${esc(rareTxt)}.</div>
      <ul class="tlist">${[...o.targets].sort((a,b)=>b.p-a.p).map(t => { const has = own.get(NORM(t.name)); return `<li><button class="link" data-card="${esc(t.name)}" data-set="${esc(sl.set)}">${esc(t.name)}</button>${has ? ' <span class="badge cmd">Owned</span>' : ""}<span class="muted">${RAR_NAME[t.rarity]||""} · ${oneIn(t.p)}</span></li>`; }).join("")}</ul>
    </details>`; }).join("")}
    <p class="small muted">Odds come from ${ODDS.packsSimulated.toLocaleString()} simulated packs per set using the real print sheets. Targets are cards that see heavy Commander play today.</p></div>`;
}
async function doOpen(){
  const slots = planFor(); if(!slots.length || !ui.player || ui.busy) return;
  const R = typeof ui.round==="number" ? ROUNDS[ui.round-1] : null;
  let id;
  if(R){
    id = roundPullId(ui.player, R.n);
    if(isAdmin() && state.pulls.some(p => p.id === id)) id = `${id}_${rid()}`; // admin redo after a void
  } else id = `${ui.player}_extra_${rid()}`;
  const packs = [];
  for(const sl of slots) for(let k=0;k<sl.packs;k++) packs.push({s:sl.set, c:openBooster(sl.set).map(i => CARDS[i].name)});
  const label = R ? `Round ${R.n}` : `Extra: ${ui.extraCount} ${SETS[ui.extraSet].name}`;
  const plan = slots.map(s => `${s.packs} ${SETS[s.set].name}`).join(", ");
  const pull = {player:ui.player, round: R ? R.n : "extra", kind: R ? "packs" : "extra", label, plan, created:new Date().toISOString(), packs, voided:false};
  ui.busy = true; renderOpen();
  const ok = await guarded(() => backend.createPull(id, pull), `Saved ${packs.length} packs to ${playerName(ui.player)}`);
  ui.busy = false;
  if(ok){ ui.lastOpen = {id, ...pull}; ui.revealIdx = 0; ui.revealDone = false; }
  renderOpen();
}
async function doPool(){
  const lines = ui.poolText.split("\n").map(s=>s.trim()).filter(Boolean); if(!lines.length || !ui.player || ui.busy) return;
  const packs = []; const names = [];
  for(const raw of lines){
    let l = raw.replace(/^\d+\s*x?\s+/i,""); let s = "", n = "";
    const m = l.match(/^(.*?)\s*\(([A-Za-z0-9]{2,6})\)\s*([\w-]+)?\s*$/);
    if(m){ l = m[1]; s = m[2].toLowerCase(); n = m[3] || ""; }
    const i = BY_NAME.get(NORM(l)); const name = i!==undefined ? CARDS[i].name : l.trim();
    if(s && !n && i!==undefined && SETS[s]) n = SETS[s].num[i] || "";
    names.push(name); packs.push({s, c:[name], n:[n]});
  }
  const id = `${ui.player}_pool_${rid()}`;
  const pull = {player:ui.player, round:ui.poolRound, kind:"pool", label:`Shared pool, Round ${ui.poolRound}`, plan:`${names.length} picked card${names.length>1?"s":""}`, created:new Date().toISOString(), packs, voided:false};
  ui.busy = true;
  const ok = await guarded(() => backend.createPull(id, pull), `Added ${names.length} card${names.length>1?"s":""} to ${playerName(ui.player)}`);
  ui.busy = false;
  if(ok) ui.poolText = "";
  renderOpen();
}

/* ---------- Collection tab ---------- */
function filteredCollection(){
  if(!ui.colPlayer) return [];
  const m = collectionOf(ui.colPlayer); const bs = banSet(); const f = ui.f;
  let cmdCI = null; if(f.cmd){ const i = BY_NAME.get(NORM(f.cmd)); if(i!==undefined) cmdCI = CARDS[i].ci; }
  const rows = [];
  for(const e of m.values()){
    const c = e.idx>=0 ? CARDS[e.idx] : null;
    if(f.hideBasics && c && isBasic(c)) continue;
    if(f.q && !NORM(e.name).includes(NORM(f.q)) && !(c && NORM(c.type).includes(NORM(f.q)))) continue;
    if(f.type){ if(!c) continue; if(f.type==="Commander"){ if(!isLegend(c)) continue; } else if(!new RegExp("\\b"+f.type+"\\b").test(c.type)) continue; }
    if(f.rarity && e.best!==f.rarity) continue;
    if(f.set && !e.sets[f.set]) continue;
    const ci = c ? c.ci : "";
    if(cmdCI !== null && ![...ci].every(x => cmdCI.includes(x))) continue;
    if(f.colors.size){ const want=[...f.colors]; const ok = want.includes("C") ? (ci==="" || [...ci].some(x=>want.includes(x))) : [...ci].some(x=>want.includes(x)); if(!ok) continue; }
    rows.push({...e, c, ci, banned: bs.has(NORM(e.name))});
  }
  const ciOrder = s => s==="" ? 9 : s.length>1 ? 8 : "WUBRG".indexOf(s);
  const sorters = { name:(a,b)=>a.name.localeCompare(b.name), qty:(a,b)=>b.total-a.total||a.name.localeCompare(b.name), color:(a,b)=>ciOrder(a.ci)-ciOrder(b.ci)||a.name.localeCompare(b.name), type:(a,b)=>(a.c?.type||"").localeCompare(b.c?.type||"")||a.name.localeCompare(b.name), rarity:(a,b)=>RANK[a.best]-RANK[b.best]||a.name.localeCompare(b.name) };
  rows.sort(sorters[ui.sort] || sorters.name);
  return rows;
}
function exportLines(rows){
  const out = []; const noEd = [];
  for(const r of rows){
    for(const [s,n] of Object.entries(r.sets)){
      const num = r.nums[s];
      if(s !== "pool" && num) out.push(`${n}x ${r.name} (${s.toLowerCase()}) ${num}`);
      else if(s !== "pool") out.push(`${n}x ${r.name} (${s.toLowerCase()})`);
      else { out.push(`${n}x ${r.name}`); noEd.push(r.name); }
    }
  }
  return {text: out.join("\n"), noEd};
}
function renderCollection(){
  const v = $("#view-collection");
  if(!ui.colPlayer){ v.innerHTML = `<div class="empty"><b>No collections yet.</b></div>`; return; }
  const m = collectionOf(ui.colPlayer); const all = [...m.values()];
  const totalCards = all.reduce((a,e)=>a+e.total,0);
  const legends = all.filter(e => e.idx>=0 && isLegend(CARDS[e.idx])).sort((a,b)=>a.name.localeCompare(b.name));
  const rows = filteredCollection(); const f = ui.f;
  const bs = banSet(); const bannedOwned = all.filter(e => bs.has(NORM(e.name)));
  const exp = exportLines(rows);
  v.innerHTML = `<div class="stack" style="gap:16px">
    <div class="stack" style="gap:6px"><h3>Player</h3>${playerChips(ui.colPlayer,"colplayer")}</div>
    <div class="summary">
      <div class="stat"><div class="v">${totalCards}</div><div class="l">Cards owned</div></div>
      <div class="stat"><div class="v">${all.length}</div><div class="l">Unique</div></div>
      <div class="stat"><div class="v">${legends.length}</div><div class="l">Possible commanders</div></div>
      <div class="stat"><div class="v">${livePulls(ui.colPlayer).length}</div><div class="l">Openings</div></div>
    </div>
    ${bannedOwned.length ? `<div class="note bad"><b>Owns ${bannedOwned.length} banned card${bannedOwned.length>1?"s":""}:</b> ${bannedOwned.map(e=>esc(e.name)).join(", ")}</div>` : ""}
    <div class="panel">
      <div class="filters">
        <div class="f"><label for="fq">Search name or type</label><input id="fq" type="text" value="${esc(f.q)}" placeholder="Wurm, Sliver, Sol Ring…"></div>
        <div class="f"><label>Colors</label><div class="row">${["W","U","B","R","G","C"].map(x=>`<button class="cchip ${x}" data-color="${x}" aria-pressed="${f.colors.has(x)}" aria-label="${x}">${x}</button>`).join("")}</div></div>
        <div class="f"><label for="ftype">Type</label><select id="ftype"><option value="">Any</option>${["Commander","Creature","Instant","Sorcery","Artifact","Enchantment","Land"].map(t=>`<option value="${t}" ${f.type===t?"selected":""}>${t==="Commander"?"Legendary creature":t}</option>`).join("")}</select></div>
        <div class="f"><label for="frar">Rarity</label><select id="frar"><option value="">Any</option>${[["R","Rare"],["U","Uncommon"],["C","Common"]].map(([k,t])=>`<option value="${k}" ${f.rarity===k?"selected":""}>${t}</option>`).join("")}</select></div>
        <div class="f"><label for="fset">Set</label><select id="fset"><option value="">Any</option>${SET_ORDER.map(s=>`<option value="${s}" ${f.set===s?"selected":""}>${esc(SETS[s].name)}</option>`).join("")}</select></div>
        <div class="f"><label for="fcmd">Fits commander</label><select id="fcmd"><option value="">Any colors</option>${legends.map(e=>`<option ${f.cmd===e.name?"selected":""}>${esc(e.name)}</option>`).join("")}</select></div>
        <div class="f"><label class="opt" style="font-weight:600"><input type="checkbox" id="fbasic" ${f.hideBasics?"checked":""}> Hide basic lands</label></div>
      </div>
      <p class="small muted">${rows.length} of ${all.length} unique cards shown${f.cmd ? `, all inside ${esc(f.cmd)}'s color identity` : ""}. Click a header to sort.</p>
      ${ui.images ? `<div class="cgrid">${rows.map(r => { const s0 = Object.keys(r.sets)[0] || ""; return cardImgHTML(r.name, s0==="pool" ? "" : s0, {qty: r.total, num: r.nums[s0], note: r.banned ? "Banned" : ""}); }).join("") || '<p class="muted">No cards match these filters.</p>'}</div>` : `
      <div class="tablewrap" style="max-height:560px;overflow:auto"><table><thead><tr>
        <th data-sort="qty">Qty</th><th data-sort="name">Card</th><th data-sort="color">Cost</th><th data-sort="type">Type</th><th data-sort="rarity">Rarity</th><th>Printings</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.banned?"banned":""}"><td class="num">${r.total}</td><td><button class="link" style="color:inherit;font-weight:${r.best==="R"?700:400}" data-card="${esc(r.name)}" data-set="${esc(Object.keys(r.sets)[0]||"")}">${esc(r.name)}</button> ${r.banned?'<span class="badge bad">Banned</span>':""}${r.c&&isLegend(r.c)?' <span class="badge cmd">Commander</span>':""}</td><td>${r.c?manaHTML(r.c.mana):""}</td><td>${r.c?esc(typeLine(r.c.type)):'<span class="muted">Pool pick</span>'}</td><td><span class="rar ${r.best}" style="display:inline-block"></span> ${r.best==="R"?"Rare":r.best==="U"?"Uncommon":r.best==="L"?"Basic":"Common"}</td><td class="small muted">${Object.entries(r.sets).map(([s,n])=>`${s==="pool"?"Pool":s.toUpperCase()}×${n}`).join(", ")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No cards match these filters.</td></tr>`}</tbody></table></div>`}
    </div>
    <div class="panel">
      <h3>Export for Archidekt, Moxfield or Tabletop Simulator</h3>
      <p class="small muted">Every line names the exact printing, as <span style="font-family:var(--f-mono)">1x Card Name (set) number</span>, so Archidekt doesn't swap in a newer or foreign edition. Exports the ${rows.length} cards shown above; clear the filters to export everything.</p>
      ${exp.noEd.length ? `<div class="note warn"><b>${exp.noEd.length} shared pool pick${exp.noEd.length>1?"s have":" has"} no edition:</b> ${exp.noEd.map(esc).join(", ")}. Ask the admin to void that entry and re-add it with a set code, like <span style="font-family:var(--f-mono)">Sol Ring (2ed) 270</span>.</div>` : ""}
      <textarea id="expText" readonly>${esc(exp.text)}</textarea>
      <div class="row"><button class="btn primary" id="copyExp">Copy list</button><button class="btn" id="dlExp">Download .txt</button></div>
      <p class="small muted">Paste into Archidekt's collection import (or a new deck). To play, export the finished deck from Archidekt or Moxfield and load it into Tabletop Simulator with a deck importer such as tts-deckconverter.</p>
    </div>
  </div>`;
}

/* ---------- Deck check ---------- */
function parseDeck(text){
  const out = []; let nextIsCmd = false; let cmd = "";
  for(let raw of text.split("\n")){
    let line = raw.replace(/\[[^\]]*\]/g,"").replace(/\^[^^]*\^/g,"").trim();
    if(!line || line.startsWith("//") || line.startsWith("#")) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if(!m){ nextIsCmd = /commander/i.test(line); continue; }
    const name = m[2].replace(/\*[^*]*\*/g,"").replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w-]+)?\s*$/,"").trim();
    const isCmd = nextIsCmd || /\*CMDR\*/i.test(m[2]);
    out.push({qty:+m[1], name});
    if(isCmd && !cmd) cmd = name;
  }
  return {lines:out, cmd};
}
function checkDeck(){
  const {lines, cmd} = parseDeck(ui.deckText);
  if(!ui.deckCmd && cmd) ui.deckCmd = cmd;
  const own = collectionOf(ui.deckPlayer); const bs = banSet();
  const merged = new Map();
  for(const l of lines){ const k = NORM(l.name); const e = merged.get(k) || {name:l.name, qty:0}; e.qty += l.qty; merged.set(k,e); }
  const total = [...merged.values()].reduce((a,e)=>a+e.qty,0);
  const missing=[], banned=[], dupes=[], offColor=[], unknown=[];
  const cmdIdx = ui.deckCmd ? BY_NAME.get(NORM(ui.deckCmd)) : undefined; const cmdCI = cmdIdx!==undefined ? CARDS[cmdIdx].ci : null;
  for(const [k,e] of merged){
    const i = BY_NAME.get(k); const c = i!==undefined ? CARDS[i] : null;
    const basic = c ? isBasic(c) : /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i.test(e.name);
    if(basic){ if(c && cmdCI!==null && ![...c.ci].every(x=>cmdCI.includes(x))) offColor.push(e.name); continue; }
    const have = own.get(k)?.total || 0;
    if(have < e.qty) missing.push(`${e.name} (needs ${e.qty}, owns ${have})`);
    if(bs.has(k)) banned.push(e.name);
    if(e.qty > 1) dupes.push(`${e.name} ×${e.qty}`);
    if(!c && !own.has(k)) unknown.push(e.name);
    if(c && cmdCI!==null && ![...c.ci].every(x=>cmdCI.includes(x))) offColor.push(e.name);
  }
  const cmdOwned = ui.deckCmd ? (own.get(NORM(ui.deckCmd))?.total||0) > 0 : false;
  const cmdLegal = cmdIdx!==undefined && isLegend(CARDS[cmdIdx]);
  ui.deckResult = {total, missing, banned, dupes, offColor, unknown, cmdOwned, cmdLegal};
}
function renderDeck(){
  const v = $("#view-deck");
  if(!ui.deckPlayer){ v.innerHTML = `<div class="empty"><b>No players yet.</b></div>`; return; }
  const legends = [...collectionOf(ui.deckPlayer).values()].filter(e=>e.idx>=0&&isLegend(CARDS[e.idx])).map(e=>e.name).sort();
  const R = ui.deckResult;
  const item = (ok, title, list) => `<div class="note ${ok?"":"bad"}"><b>${ok?"✓":"✗"} ${esc(title)}</b>${list && list.length ? `<ul class="list-tight">${list.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
  const bad = R && (R.missing.length||R.banned.length||R.dupes.length||R.offColor.length||R.total!==100||!R.cmdOwned||!R.cmdLegal);
  v.innerHTML = `<div class="grid2">
    <div class="panel">
      <div class="stack"><h3>Whose deck</h3>${playerChips(ui.deckPlayer,"deckplayer")}</div>
      <div class="stack"><label for="deckText">Paste the decklist</label>
        <textarea id="deckText" placeholder="1 Adun Oakenshield&#10;1 Sol Ring&#10;30 Swamp&#10;…">${esc(ui.deckText)}</textarea>
        <span class="small muted">Plain lists and Archidekt or Moxfield exports both work. Include the commander.</span></div>
      <div class="stack"><label for="deckCmd">Commander</label><select id="deckCmd"><option value="">Choose a legendary creature this player owns</option>${legends.map(n=>`<option ${n===ui.deckCmd?"selected":""}>${esc(n)}</option>`).join("")}${ui.deckCmd && !legends.includes(ui.deckCmd) ? `<option selected>${esc(ui.deckCmd)}</option>` : ""}</select></div>
      <button class="btn primary" id="deckRun">Check deck</button>
    </div>
    <div class="stack">
      ${R ? `<h2>${bad ? "Not legal yet" : "Legal for this series"}</h2>
        ${item(R.total===100, `${R.total} cards (needs exactly 100 including the commander)`)}
        ${item(R.cmdOwned && R.cmdLegal, ui.deckCmd ? `Commander: ${ui.deckCmd}${!R.cmdLegal?" is not a legendary creature":!R.cmdOwned?" is not in this collection":""}` : "No commander chosen")}
        ${item(!R.missing.length, R.missing.length ? `${R.missing.length} cards not in the collection` : "Every card is in the collection", R.missing)}
        ${item(!R.banned.length, R.banned.length ? `${R.banned.length} banned cards` : "No banned cards", R.banned)}
        ${item(!R.dupes.length, R.dupes.length ? "Singleton broken" : "Singleton (basics excepted)", R.dupes)}
        ${item(!R.offColor.length, R.offColor.length ? "Outside the commander's color identity" : "Inside the commander's color identity", R.offColor)}
        ${R.unknown.length ? `<div class="note warn"><b>Names not recognized</b> (check spelling): <ul class="list-tight">${R.unknown.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}`
      : `<div class="empty"><b>Check a deck against what a player actually opened.</b><br>Counts copies, bans, singleton, the 100-card size and color identity. Basic lands are free.</div>`}
    </div></div>`;
}

/* ---------- Card lists (what's in each set's packs) ---------- */
const PACK_ODDS = {};
// Chance a given card shows up in one pack, from the set's booster layouts and sheet weights.
// Targets use the simulated value from data/odds.json; everything else uses this close approximation.
function perPackOdds(code){
  if(PACK_ODDS[code]) return PACK_ODDS[code];
  const s = SETS[code]; const Wv = s.boosters.reduce((a,b)=>a+b.w, 0); const out = new Map();
  for(const b of s.boosters){
    const notIn = new Map();
    for(const [sh, k] of Object.entries(b.s)){
      const list = s.sheets[sh]; const W = list.reduce((a,x)=>a+x[1], 0);
      for(const [i, w] of list) notIn.set(i, (notIn.has(i) ? notIn.get(i) : 1) * Math.pow(1 - w/W, k));
    }
    for(const [i, q] of notIn) out.set(i, (out.get(i) || 0) + (b.w/Wv) * (1 - q));
  }
  const o = ODDS.sets[code];
  if(o) for(const t of o.targets){ const i = BY_NAME.get(NORM(t.name)); if(i !== undefined && t.p > 0) out.set(i, t.p); }
  PACK_ODDS[code] = out; return out;
}
function browsableSets(){
  const groups = [];
  for(const R of visibleRounds()) groups.push({label:`Round ${R.n}: ${R.title}`, sets: roundSets(R)});
  return groups;
}
function renderSets(){
  const v = $("#view-sets"); const groups = browsableSets(); const all = groups.flatMap(g => g.sets);
  if(!all.length){ v.innerHTML = `<div class="empty"><b>No sets unlocked yet.</b></div>`; return; }
  if(!all.includes(ui.sb.set)) ui.sb.set = all[0];
  const code = ui.sb.set, set = SETS[code], sb = ui.sb, odds = perPackOdds(code);
  const mine = state.me ? collectionOf(state.me.uid) : new Map();
  const ciOrder = s => s==="" ? 9 : s.length>1 ? 8 : "WUBRG".indexOf(s);
  let rows = Object.keys(set.rar).map(Number).map(i => ({i, c:CARDS[i], r:set.rar[i], p:odds.get(i) || 0, num:set.num[i] || "", own:(mine.get(NORM(CARDS[i].name))||{}).total || 0, tgt:isTargetIdx(code, i)}));
  const total = rows.length, targets = rows.filter(x=>x.tgt).length;
  rows = rows.filter(x => {
    if(sb.hideBasics && isBasic(x.c)) return false;
    if(sb.q && !NORM(x.c.name).includes(NORM(sb.q)) && !NORM(x.c.type).includes(NORM(sb.q)) && !NORM(x.c.text).includes(NORM(sb.q))) return false;
    if(sb.rarity && x.r !== sb.rarity) return false;
    if(sb.targets && !x.tgt) return false;
    if(sb.own === "have" && !x.own) return false;
    if(sb.own === "need" && x.own) return false;
    if(sb.color){ const ci = x.c.ci; if(sb.color==="C" ? ci!=="" : sb.color==="M" ? ci.length<2 : !ci.includes(sb.color)) return false; }
    return true;
  });
  const numKey = n => { const m = String(n).match(/^(\d+)(.*)$/); return m ? [+m[1], m[2]] : [1e9, n]; };
  const sorters = {
    rarity:(a,b)=>RANK[a.r]-RANK[b.r] || a.c.name.localeCompare(b.c.name),
    odds:(a,b)=>a.p-b.p || a.c.name.localeCompare(b.c.name),
    name:(a,b)=>a.c.name.localeCompare(b.c.name),
    color:(a,b)=>ciOrder(a.c.ci)-ciOrder(b.c.ci) || a.c.name.localeCompare(b.c.name),
    number:(a,b)=>{ const x=numKey(a.num), y=numKey(b.num); return x[0]-y[0] || String(x[1]).localeCompare(String(y[1])); },
    type:(a,b)=>a.c.type.localeCompare(b.c.type) || a.c.name.localeCompare(b.c.name)
  };
  rows.sort(sorters[sb.sort] || sorters.rarity);
  const layout = Object.entries(set.boosters[0].s).filter(([k])=>!k.startsWith("foil")).map(([k,n])=>`${n} ${k}`).join(", ");
  const o = ODDS.sets[code];
  v.innerHTML = `<div class="stack" style="gap:16px">
    <div class="panel">
      <div class="filters">
        <div class="f"><label for="sbSet">Set</label><select id="sbSet">${groups.map(g => `<optgroup label="${esc(g.label)}">${g.sets.map(c => `<option value="${c}" ${c===code?"selected":""}>${esc(SETS[c].name)}</option>`).join("")}</optgroup>`).join("")}</select></div>
        <div class="f"><label for="sbQ">Search name, type or text</label><input id="sbQ" type="text" value="${esc(sb.q)}" placeholder="Dragon, draw a card…"></div>
        <div class="f"><label for="sbSort">Sort by</label><select id="sbSort">${[["rarity","Rarity"],["odds","Rarest first (odds)"],["name","Name"],["color","Color"],["type","Type"],["number","Collector number"]].map(([k,t])=>`<option value="${k}" ${sb.sort===k?"selected":""}>${t}</option>`).join("")}</select></div>
        <div class="f"><label for="sbRar">Rarity</label><select id="sbRar"><option value="">Any</option>${[["R","Rare"],["U","Uncommon"],["C","Common"]].map(([k,t])=>`<option value="${k}" ${sb.rarity===k?"selected":""}>${t}</option>`).join("")}</select></div>
        <div class="f"><label>Color</label><div class="row">${["W","U","B","R","G","M","C"].map(x=>`<button class="cchip ${x}" data-sbcolor="${x}" aria-pressed="${sb.color===x}" aria-label="${x==="M"?"Multicolor":x}">${x}</button>`).join("")}</div></div>
        <div class="f"><label for="sbOwn">My collection</label><select id="sbOwn"><option value="">All cards</option><option value="have" ${sb.own==="have"?"selected":""}>Cards I own</option><option value="need" ${sb.own==="need"?"selected":""}>Cards I'm missing</option></select></div>
        <div class="f"><label class="opt" style="font-weight:600"><input type="checkbox" id="sbTargets" ${sb.targets?"checked":""}> Targets only</label><label class="opt" style="font-weight:600"><input type="checkbox" id="sbBasics" ${sb.hideBasics?"checked":""}> Hide basic lands</label></div>
      </div>
      <p class="small muted"><b>${esc(set.name)}</b> (${set.year}) · ${set.size}-card packs: ${esc(layout)} · ${total} different cards · ${targets} targets${o ? ` · ${Math.round(o.pAnyTarget*100)}% of packs hold a target` : ""}. Showing ${rows.length}.</p>
    </div>
    ${ui.images
      ? `<div class="cgrid">${rows.map(x => cardImgHTML(x.c.name, code, {num:x.num, qty:x.own, note:oneIn(x.p), dim: sb.own==="" && !x.own && !!state.me})).join("") || '<p class="muted">No cards match.</p>'}</div>`
      : `<div class="tablewrap" style="max-height:640px;overflow:auto"><table><thead><tr><th>#</th><th>Card</th><th>Cost</th><th>Type</th><th>Rarity</th><th>Odds per pack</th><th>I own</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td class="num small muted">${esc(x.num)}</td><td><button class="link" style="color:inherit;font-weight:${x.r==="R"?700:400}" data-card="${esc(x.c.name)}" data-set="${code}">${esc(x.c.name)}</button>${x.tgt?'<span class="target-tag">Target</span>':""}</td><td>${manaHTML(x.c.mana)}</td><td>${esc(typeLine(x.c.type))}</td><td><span class="rar ${x.r}" style="display:inline-block"></span> ${RAR_NAME[x.r]||""}</td><td class="small">${oneIn(x.p)}</td><td class="num">${x.own||""}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">No cards match.</td></tr>'}
        </tbody></table></div>`}
    <p class="small muted">Odds per pack come from each set's real print sheets. Dimmed cards are ones you don't own yet. Images from Scryfall.</p>
  </div>`;
}

/* ---------- Stats ---------- */
function roundSets(R){
  const s = R.lines.map(([c])=>c);
  if(R.branch) s.push(...R.branch.options.map(o=>o[0]));
  if(R.split) s.push(R.split.a, R.split.b);
  return [...new Set(s)];
}
function renderStats(){
  const v = $("#view-stats");
  if(ui.statsRound === null) ui.statsRound = unlocked();
  const sel = ui.statsRound;
  const rounds = visibleRounds();
  const pulls = state.pulls.filter(p => !p.voided && p.kind !== "pool" && (sel === "all" || p.round === sel));
  const rows = state.players.map(pl => {
    const packs = pulls.filter(p => p.player === pl.id).flatMap(p => p.packs || []);
    const st = packStats(packs); const exp = expectedFor(packs);
    return {pl, st, exp, luck: exp.T > 0 ? st.targets.length / exp.T : null};
  }).filter(r => r.st.packs > 0).sort((a,b) => b.st.targets.length - a.st.targets.length || b.st.R - a.st.R);
  const allHits = rows.flatMap(r => r.st.targets.map(t => ({...t, who:r.pl.name}))).map(t => {
    const o = ODDS.sets[t.s]; const tt = o && o.targets.find(x => x.name === t.nm); return {...t, p: tt ? tt.p : 0};
  }).sort((a,b) => a.p - b.p);
  const luckTxt = l => l === null ? "–" : `${l >= 1 ? "+" : ""}${Math.round((l-1)*100)}%`;
  const roundChecklist = typeof sel === "number" ? (() => {
    const R = ROUNDS[sel-1];
    return `<div class="panel"><h2>Round ${R.n} targets</h2><p class="small muted">Every target in the sets this round can open, with real odds and who owns one.</p>
      ${roundSets(R).map(code => { const o = ODDS.sets[code]; if(!o) return ""; return `<details class="expect"><summary><b>${esc(SETS[code].name)}</b> <span class="muted small">${o.targets.length} targets · ${Math.round(o.pAnyTarget*100)}% of packs hold one</span></summary>
        <ul class="tlist">${[...o.targets].sort((a,b)=>b.p-a.p).map(t => { const owners = state.players.filter(pl => (collectionOf(pl.id).get(NORM(t.name))||{}).total).map(pl => pl.name); return `<li><button class="link" data-card="${esc(t.name)}" data-set="${esc(code)}">${esc(t.name)}</button>${owners.length ? ` <span class="badge cmd">${esc(owners.join(", "))}</span>` : ""}<span class="muted">${RAR_NAME[t.rarity]||""} · ${oneIn(t.p)}</span></li>`; }).join("")}</ul></details>`; }).join("")}
    </div>`; })() : "";
  v.innerHTML = `<div class="stack" style="gap:16px">
    <div class="seg">${rounds.map(R => `<button data-statsround="${R.n}" aria-pressed="${sel===R.n}">Round ${R.n}</button>`).join("")}<button data-statsround="all" aria-pressed="${sel==="all"}">All rounds</button></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Player</th><th>Packs</th><th>Rares</th><th>Targets</th><th title="Targets hit compared with the real-odds expectation">Luck</th><th>Legends</th><th>Best pull</th></tr></thead><tbody>
      ${rows.map(r => { const best = r.st.targets.map(t => { const o = ODDS.sets[t.s]; const tt = o && o.targets.find(x=>x.name===t.nm); return {...t, p: tt?tt.p:1}; }).sort((a,b)=>a.p-b.p)[0];
        return `<tr><td><b>${esc(r.pl.name)}</b></td><td class="num">${r.st.packs}</td><td class="num">${r.st.R} <span class="muted">/ ${fmt1(r.exp.R)}</span></td><td class="num">${r.st.targets.length} <span class="muted">/ ${fmt1(r.exp.T)}</span></td><td class="num ${r.luck!==null && r.luck>=1 ? "ok" : "no"}">${luckTxt(r.luck)}</td><td class="num">${r.st.legends.length}</td><td>${best ? `<button class="link" data-card="${esc(best.nm)}" data-set="${esc(best.s)}">${esc(best.nm)}</button> <span class="muted small">${oneIn(best.p)}</span>` : '<span class="muted">none</span>'}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="small muted">Rares and targets show actual / expected. Expected numbers come from each set's real print sheets for exactly the packs that player opened.</p>`
      : `<div class="empty"><b>No openings ${sel==="all" ? "yet" : `in Round ${sel} yet`}.</b></div>`}
    ${allHits.length ? `<div class="panel"><h2>Every target pulled</h2><ul class="tlist">${allHits.map(t => `<li><span><b>${esc(t.who)}</b> · <button class="link" data-card="${esc(t.nm)}" data-set="${esc(t.s)}">${esc(t.nm)}</button></span><span class="muted">${esc(SETS[t.s].name)} · ${oneIn(t.p)}</span></li>`).join("")}</ul></div>` : ""}
    ${roundChecklist}
  </div>`;
}

/* ---------- History ---------- */
function renderHistory(){
  const v = $("#view-history");
  const items = [...state.pulls].sort((a,b)=>(b.created||"").localeCompare(a.created||""));
  if(!items.length){ v.innerHTML = `<div class="empty"><b>Nothing opened yet.</b><br>Every opening and pool pick lands here with a timestamp. Mistakes can be voided by the admin, never silently deleted.</div>`; return; }
  v.innerHTML = `<div class="stack"><p class="small muted">${items.length} entries. Voided entries stay listed but no longer count toward a collection.</p><div class="hist">${items.map(p => {
    const n = (p.packs||[]).reduce((a,k)=>a+k.c.length,0); const open = ui.histOpen.has(p.id);
    return `<div class="hitem ${p.voided?"void":""}"><div class="hhead"><div><b>${esc(playerName(p.player))}</b> · ${esc(p.label)} ${p.voided?'<span class="badge void">Voided</span>':""}<div class="small muted">${esc(p.plan||"")} · ${n} cards</div></div><span class="when">${esc(fmtDate(p.created))}</span></div>
      <div class="row"><button class="btn" data-hist="${esc(p.id)}">${open?"Hide cards":"Show cards"}</button>
      ${!isAdmin() ? "" : ui.voidConfirm===p.id ? `<span class="confirm">${p.voided?"Count this entry again?":"Void this entry? Its cards leave the collection."} <button class="btn danger" data-voidyes="${esc(p.id)}">${p.voided?"Restore":"Void"}</button><button class="btn" data-voidno="1">Cancel</button></span>` : `<button class="btn ${p.voided?"":"danger"}" data-void="${esc(p.id)}">${p.voided?"Restore":"Void"}</button>`}</div>
      ${open ? `<div class="packs">${(p.packs||[]).map((pk,i)=>packHTML(pk,i)).join("")}</div>` : ""}</div>`; }).join("")}</div></div>`;
}

/* ---------- Players & bans ---------- */
function renderTable(){
  const v = $("#view-table"); const admin = isAdmin();
  const bansText = ui.banDraft !== null ? ui.banDraft : bans().join("\n");
  const nextRound = ROUNDS.find(R => R.n === unlocked()+1);
  v.innerHTML = `<div class="cols">
    ${admin ? `<div class="panel"><h2>Admin</h2>
      <div class="kv"><b>Unlocked</b><span>Rounds 1 to ${unlocked()}</span></div>
      <div class="row">${nextRound ? `<button class="btn primary" id="unlockNext">Unlock Round ${nextRound.n}</button>` : `<span class="small muted">Every round in the plan is unlocked.</span>`}
        ${unlocked()>1 ? `<button class="btn" id="lockLast">Re-lock Round ${unlocked()}</button>` : ""}</div>
      <p class="small muted">Players only see and open rounds up to the unlocked one.</p>
      <button class="btn" id="runChecks">Run setup check</button>
      ${ui.checks ? `<ul class="list-tight checks">${ui.checks.map(c=>`<li class="${c.ok?"ok":"no"}">${c.ok?"✓":"✗"} ${esc(c.msg)}</li>`).join("")}</ul>` : ""}
    </div>` : ""}
    <div class="panel"><h2>Players</h2>
      ${state.players.length ? `<div class="stack">${state.players.map(p => { const cnt = state.pulls.filter(x=>x.player===p.id).length; const canEdit = admin || (state.me && p.id===state.me.uid); return `<div class="row" style="justify-content:space-between"><input type="text" id="pname-${esc(p.id)}" value="${esc(p.name)}" data-rename="${esc(p.id)}" ${canEdit?"":"disabled"} aria-label="Player name" maxlength="40" style="flex:1;min-width:0"><span class="small muted">${cnt} entr${cnt===1?"y":"ies"}</span>
        ${!admin||cnt ? "" : ui.removeConfirm===p.id ? `<span class="confirm">Remove? <button class="btn danger" data-removeyes="${esc(p.id)}">Remove</button><button class="btn" data-removeno="1">Cancel</button></span>` : `<button class="btn danger" data-remove="${esc(p.id)}">Remove</button>`}</div>`; }).join("")}</div>` : `<p class="muted small">No players yet.</p>`}
      <p class="small muted">Everyone becomes a player the first time they sign in. You can rename yourself here.</p>
    </div>
    <div class="panel"><h2>Ban list</h2>
      <p class="small muted">Nothing is banned at opening. Bans are added between rounds and every collection and deck check flags them.</p>
      <textarea id="banText" ${admin?"":"readonly"} placeholder="Black Lotus&#10;Library of Alexandria">${esc(bansText)}</textarea>
      ${admin ? `<div class="row"><button class="btn primary" id="banSave">Save ban list</button><span class="small muted">${bans().length} banned</span></div>` : `<span class="small muted">${bans().length} banned</span>`}
    </div>
    <div class="panel"><h2>Round plan</h2>
      <div class="kv">${visibleRounds().map(R => `<b>R${R.n}</b><span>${R.lines.map(([s,n])=>`${n} ${esc(SETS[s].name)}`).join(", ")}${R.branch?`, then 1 of ${R.branch.options.map(o=>esc(SETS[o[0]].name)).join(" / ")}`:""}${R.split?", then 8 Stronghold/Exodus in any split":""}${R.throwback?", then about 60 cards from one earlier set":""}</span>`).join("")}</div>
      <p class="small muted">Booster contents follow each set's real print sheets and slot counts.</p>
    </div></div>`;
}
async function runChecks(){
  const out = [];
  out.push({ok:true, msg:"Firebase config loaded"});
  out.push({ok:!!state.me, msg: state.me ? `Signed in as ${state.me.email}` : "Not signed in"});
  out.push({ok:isAdmin(), msg: isAdmin() ? "Recognized as admin" : "Not recognized as admin (check the email in firebase-config.js and firestore.rules)"});
  out.push({ok:!!state.settings, msg: state.settings ? "Settings document exists" : "Settings document missing (unlock a round to create it)"});
  out.push({ok:!!myProfile(), msg: myProfile() ? "Your player profile exists" : "Your player profile is missing"});
  try { await backend.saveSettings({lastCheck:new Date().toISOString()}); out.push({ok:true, msg:"Admin can write settings (rules published)"}); }
  catch(e){ out.push({ok:false, msg:"Admin write to settings refused. Publish firestore.rules in the Firebase console."}); }
  ui.checks = out; renderTable();
}

/* ---------- drawer ---------- */
function showCard(name, set){
  const i = BY_NAME.get(NORM(name)); const d = $("#drawer");
  if(i===undefined){ d.innerHTML = `<div class="ttl"><b>${esc(name)}</b><button class="btn" data-close="1">Close</button></div><p class="small muted">Not in this site's card data (likely a shared pool pick).</p><a href="${scryfallURL(name)}" target="_blank" rel="noopener">View on Scryfall</a>`; d.hidden=false; return; }
  const c = CARDS[i]; const r = set && SETS[set] ? rarityOf(set,i) : "";
  d.innerHTML = `${ui.images ? `<div class="cimgbox big drawerimg"><img class="cimg" data-ik="${esc(IMG.keyFor(c.name, set, numFor(c.name, set)))}" data-size="n" alt="${esc(c.name)}" width="244" height="340"></div>` : ""}<div class="ttl"><div><b>${esc(c.name)}</b> ${manaHTML(c.mana)}</div><button class="btn" data-close="1">Close</button></div>
    <div class="tl">${esc(typeLine(c.type))}${c.pt?` · ${esc(c.pt)}`:""}${set&&SETS[set]?` · ${esc(SETS[set].name)} ${r==="R"?"rare":r==="U"?"uncommon":r==="L"?"basic land":"common"}`:""}</div>
    <div class="ox">${esc(c.text) || '<span class="muted">No rules text.</span>'}</div>
    <div class="row small"><span class="muted">Color identity: ${c.ci ? c.ci.split("").join(" ") : "colorless"}</span><a href="${scryfallURL(c.name, set)}" target="_blank" rel="noopener">View on Scryfall</a></div>`;
  d.hidden = false;
}

/* ---------- gate (sign-in, setup, first-time profile) ---------- */
function renderWho(){
  const w = $("#who");
  if(!state.me){ w.innerHTML = ""; return; }
  w.innerHTML = `<button class="btn" id="imgToggle" aria-pressed="${ui.images}">Images: ${ui.images ? "on" : "off"}</button>${isAdmin() ? '<span class="admin-tag">Admin</span>' : ""}<span>${esc(myProfile() ? myProfile().name : state.me.email)}</span><button class="btn" id="signOut">Sign out</button>`;
}
function showGate(html){
  $("#view-gate").innerHTML = html; $("#view-gate").hidden = false; $("#tabs").hidden = true;
  ["open","collection","sets","deck","stats","history","table"].forEach(k => $("#view-"+k).hidden = true);
}
function renderGate(){
  if(!backend.configured()){
    showGate(`<div class="signin"><h2>Almost set up</h2><p>Paste your Firebase config into <code>js/firebase-config.js</code> and push. The README walks through every step.</p></div>`);
    return true;
  }
  if(!state.me){
    showGate(`<div class="signin"><h2>Sign in to open packs</h2><p class="muted">Use your Google account. The first time, you'll pick the name everyone sees.</p><button class="btn primary" id="signIn">Sign in with Google</button></div>`);
    return true;
  }
  if(!state.loaded){ showGate(`<div class="empty"><b>Loading collections…</b></div>`); return true; }
  if(!myProfile()){
    showGate(`<div class="signin"><h2>Pick your player name</h2><p class="muted">This is what shows on your collection and in the history.</p>
      <form id="profileForm" class="row" style="justify-content:center"><input type="text" id="profileName" maxlength="40" value="${esc((state.me.displayName||"").split(" ")[0])}" aria-label="Player name"><button class="btn primary" type="submit">Join the series</button></form></div>`);
    return true;
  }
  $("#view-gate").hidden = true; $("#tabs").hidden = false;
  return false;
}

/* ---------- render + events ---------- */
function renderAll(){
  renderWho();
  if(renderGate()) return;
  ensureSelections();
  ["open","collection","sets","deck","stats","history","table"].forEach(k => $("#view-"+k).hidden = k!==ui.tab);
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab===ui.tab)));
  if(ui.tab==="open") renderOpen();
  if(ui.tab==="collection") renderCollection();
  if(ui.tab==="deck") renderDeck();
  if(ui.tab==="sets") renderSets();
  if(ui.tab==="stats") renderStats();
  if(ui.tab==="history") renderHistory();
  if(ui.tab==="table") renderTable();
}
function keepFocus(fn){ const a=document.activeElement; const id=a&&a.id; const pos=a&&a.selectionStart; fn(); if(id){ const el=document.getElementById(id); if(el){ el.focus(); try{ if(pos!=null) el.setSelectionRange(pos,pos);}catch(e){} } } }
function setTab(t){ ui.tab = t; try { history.replaceState(null, "", "#"+t); } catch(e){} renderAll(); }

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button, [data-card]"); if(!t) return;
  const d = t.dataset;
  if(t.id==="signIn"){ try { await backend.signIn(); } catch(e){ toast(friendly(e)); } return; }
  if(t.id==="signOut"){ await backend.signOut(); return; }
  if(d.tab) return setTab(d.tab);
  if(d.card) return showCard(d.card, d.set);
  if(d.close){ $("#drawer").hidden = true; return; }
  if(d.player){ ui.player = d.player; ui.lastOpen = null; return renderOpen(); }
  if(d.colplayer){ ui.colPlayer = d.colplayer; ui.f.cmd=""; return renderCollection(); }
  if(d.deckplayer){ ui.deckPlayer = d.deckplayer; ui.deckResult=null; ui.deckCmd=""; return renderDeck(); }
  if(d.round){ ui.round = /^\d+$/.test(d.round) ? +d.round : d.round; ui.roundChosen = true; return renderOpen(); }
  if(t.id==="openBtn") return doOpen();
  if(t.id==="imgToggle"){ ui.images = !ui.images; try { localStorage.setItem("ppo-images", ui.images ? "on" : "off"); } catch(e){} if(!$("#drawer").hidden) $("#drawer").hidden = true; return renderAll(); }
  if(d.sbcolor !== undefined){ ui.sb.color = ui.sb.color === d.sbcolor ? "" : d.sbcolor; return renderSets(); }
  if(d.reveal){ ui.revealMode = d.reveal; ui.revealDone = false; try { localStorage.setItem("ppo-reveal", d.reveal); } catch(e){} return renderOpen(); }
  if(t.id==="revNext"){ ui.revealIdx++; return renderOpen(); }
  if(t.id==="revPrev"){ ui.revealIdx = Math.max(0, ui.revealIdx-1); return renderOpen(); }
  if(t.id==="revDone" || t.id==="revAll"){ ui.revealDone = true; return renderOpen(); }
  if(d.statsround){ ui.statsRound = d.statsround === "all" ? "all" : +d.statsround; return renderStats(); }
  if(t.id==="poolSave") return doPool();
  if(d.color){ const s=ui.f.colors; s.has(d.color)?s.delete(d.color):s.add(d.color); return renderCollection(); }
  if(d.sort){ ui.sort = d.sort; return renderCollection(); }
  if(t.id==="copyExp"){ const txt=$("#expText"); try { await navigator.clipboard.writeText(txt.value); toast("Copied"); } catch(e){ txt.focus(); txt.select(); toast("Selected. Press Ctrl+C or Cmd+C to copy"); } return; }
  if(t.id==="dlExp"){
    const blob = new Blob([$("#expText").value], {type:"text/plain"}); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${playerName(ui.colPlayer).replace(/[^\w-]+/g,"-")}-collection.txt`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000); return;
  }
  if(t.id==="deckRun"){ ui.deckText = $("#deckText").value; ui.deckCmd = $("#deckCmd").value || ui.deckCmd; checkDeck(); return renderDeck(); }
  if(d.hist){ ui.histOpen.has(d.hist)?ui.histOpen.delete(d.hist):ui.histOpen.add(d.hist); return renderHistory(); }
  if(d.void){ ui.voidConfirm = d.void; return renderHistory(); }
  if(d.voidno){ ui.voidConfirm = null; return renderHistory(); }
  if(d.voidyes){ const p = state.pulls.find(x=>x.id===d.voidyes); ui.voidConfirm=null; if(p){ await guarded(() => backend.updatePull(p.id, {voided:!p.voided}), p.voided?"Restored":"Voided"); if(ui.lastOpen && ui.lastOpen.id===p.id) ui.lastOpen=null; } return renderHistory(); }
  if(d.remove){ ui.removeConfirm = d.remove; return renderTable(); }
  if(d.removeno){ ui.removeConfirm = null; return renderTable(); }
  if(d.removeyes){ ui.removeConfirm = null; await guarded(() => backend.deletePlayer(d.removeyes), "Player removed"); return; }
  if(t.id==="banSave"){ const list = $("#banText").value.split("\n").map(s=>s.trim()).filter(Boolean); if(await guarded(() => backend.saveSettings({bans:list}), `Ban list saved (${list.length})`)) ui.banDraft=null; return; }
  if(t.id==="unlockNext"){ const n = unlocked()+1; await guarded(() => backend.saveSettings({unlockedRound:n}), `Round ${n} unlocked`); return; }
  if(t.id==="lockLast"){ const n = unlocked()-1; await guarded(() => backend.saveSettings({unlockedRound:n}), `Back to Round ${n}`); return; }
  if(t.id==="runChecks") return runChecks();
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.name==="branch"){ ui.branch[ui.round] = t.value; return renderOpen(); }
  if(t.id==="throwSel"){ ui.throwback = t.value; return renderOpen(); }
  if(t.id==="extraSet"){ ui.extraSet = t.value; return renderOpen(); }
  if(t.id==="extraCount"){ ui.extraCount = Math.max(1, Math.min(60, +t.value||1)); return renderOpen(); }
  if(t.id==="poolRound"){ ui.poolRound = +t.value; return; }
  if(t.id==="ftype"){ ui.f.type=t.value; return renderCollection(); }
  if(t.id==="frar"){ ui.f.rarity=t.value; return renderCollection(); }
  if(t.id==="fset"){ ui.f.set=t.value; return renderCollection(); }
  if(t.id==="fcmd"){ ui.f.cmd=t.value; return renderCollection(); }
  if(t.id==="fbasic"){ ui.f.hideBasics=t.checked; return renderCollection(); }
  if(t.id==="sbSet"){ ui.sb.set=t.value; return renderSets(); }
  if(t.id==="sbSort"){ ui.sb.sort=t.value; return renderSets(); }
  if(t.id==="sbRar"){ ui.sb.rarity=t.value; return renderSets(); }
  if(t.id==="sbOwn"){ ui.sb.own=t.value; return renderSets(); }
  if(t.id==="sbTargets"){ ui.sb.targets=t.checked; return renderSets(); }
  if(t.id==="sbBasics"){ ui.sb.hideBasics=t.checked; return renderSets(); }
  if(t.id==="deckCmd"){ ui.deckCmd=t.value; return; }
  if(t.dataset.rename){ const n=t.value.trim(); if(n) guarded(() => backend.savePlayer(t.dataset.rename, {name:n}), "Renamed"); return; }
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if(t.id==="splitRange"){ ui.split = +t.value; return keepFocus(renderOpen); }
  if(t.id==="sbQ"){ ui.sb.q = t.value; clearTimeout(ui._sq); ui._sq = setTimeout(()=>keepFocus(renderSets), 180); return; }
  if(t.id==="fq"){ ui.f.q = t.value; clearTimeout(ui._qt); ui._qt = setTimeout(()=>keepFocus(renderCollection), 180); return; }
  if(t.id==="poolText"){ ui.poolText = t.value; return; }
  if(t.id==="deckText"){ ui.deckText = t.value; return; }
  if(t.id==="banText"){ ui.banDraft = t.value; return; }
});
document.addEventListener("submit", async ev => {
  if(ev.target.id==="profileForm"){
    ev.preventDefault(); const n = $("#profileName").value.trim(); if(!n) return;
    await guarded(() => backend.savePlayer(state.me.uid, {name:n, created:new Date().toISOString()}), `Welcome, ${n}`);
  }
});
document.addEventListener("keydown", ev => { if(ev.key==="Escape") $("#drawer").hidden = true; });

/* ---------- images: fill any new <img class="cimg"> after each render ---------- */
let hydrateQueued = false;
new MutationObserver(() => { if(hydrateQueued || !ui.images) return; hydrateQueued = true; requestAnimationFrame(() => { hydrateQueued = false; IMG.hydrate(); }); })
  .observe(document.body, {childList:true, subtree:true});

/* ---------- boot ---------- */
async function boot(){
  const [DATA, odds] = await Promise.all([fetch("data/cards.json").then(r => r.json()), fetch("data/odds.json").then(r => r.json()).catch(() => null)]);
  if(odds) ODDS = odds;
  CARDS = DATA.cards.map(c => ({name:c[0], mana:c[1], type:c[2], pt:c[3], text:c[4], ci:c[5]}));
  DATA.sets.forEach(s => SETS[s.code] = s); SET_ORDER = DATA.sets.map(s => s.code);
  CARDS.forEach((c,i) => BY_NAME.set(NORM(c.name), i));
  for(const [code, o] of Object.entries(ODDS.sets)) TARGETS[code] = new Set(o.targets.map(t => BY_NAME.get(NORM(t.name))).filter(i => i !== undefined));
  const startTab = (location.hash||"").slice(1);
  if(["open","collection","sets","deck","stats","history","table"].includes(startTab)) ui.tab = startTab;
  if(!backend.init()){ renderAll(); return; }
  let unsub = null;
  backend.onAuth(async user => {
    if(unsub){ unsub(); unsub = null; }
    state.me = user; state.loaded = false; state.players = []; state.pulls = []; state.settings = null; ui.lastOpen = null; ui.checks = null;
    renderAll();
    if(!user) return;
    let got = 0; const mark = () => { if(++got >= 3 && !state.loaded){ state.loaded = true; } };
    let seen = {players:false, pulls:false, settings:false};
    const ready = k => { if(!seen[k]){ seen[k]=true; mark(); } };
    unsub = backend.subscribe({
      players: list => { state.players = list; ready("players"); renderAll(); },
      pulls: list => { state.pulls = list; ready("pulls"); renderAll(); },
      settings: async s => {
        state.settings = s; ready("settings");
        if(!s && isAdmin()){ try { await backend.saveSettings({unlockedRound:1, bans:[]}); } catch(e){ console.error(e); } }
        if(s && !ui.roundChosen){ ui.round = s.unlockedRound || 1; ui.poolRound = ui.round; }
        if(s && typeof ui.round === "number" && ui.round > s.unlockedRound && !isAdmin()) ui.round = s.unlockedRound;
        renderAll();
      },
      onError: e => { console.error(e); toast(friendly(e)); }
    });
  });
}
boot();
