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

// Round plan. The admin edits rounds in the Rounds tab (saved to config/rounds in Firestore).
// Each round is a list of slots, and each slot is opened and saved on its own:
//   {type:"fixed",  key, set, packs}                          every player opens these packs
//   {type:"choice", key, label, options:[{set, packs, note}]} player picks one option (a branch)
//   {type:"mix",    key, label, sets:[a, b], total}           player splits `total` packs between two sets
// Slot keys never change once a slot has been opened, because saved openings point at them.
let ROUNDS = [];
function defaultRounds(){
  const tb = code => Math.round(60 / SETS[code].size);
  const fixed = (set, packs) => ({type:"fixed", key:`line-${set}`, set, packs});
  const opt = (set, packs, note="") => ({set, packs, note});
  return [
    {n:1, title:"The Beginning", years:"1993 to 1994", slots:[fixed("2ed",10), fixed("leg",10),
      {type:"choice", key:"branch", label:"Branch", options:[opt("arn",5,"Swingy rares: Library of Alexandria, Bazaar of Baghdad"), opt("atq",5,"Artifacts fit any commander"), opt("drk",5,"Black and tribal")]}]},
    {n:2, title:"Ice Age", years:"1994 to 1996", slots:[fixed("ice",15),
      {type:"choice", key:"branch", label:"Branch (72 cards each)", options:[opt("all",6,"Pitch spells, best fit with Ice Age"), opt("hml",9,"Commander branch: Baron Sengir, Autumn Willow"), opt("fem",9,"Tokens and tribes"), opt("chr",6,"Catch-up reprints of round 1 sets")]}]},
    {n:3, title:"Mirage", years:"1996 to 1997", slots:[fixed("mir",15),
      {type:"choice", key:"branch", label:"Branch", options:[opt("vis",6,"Creature value, enters-the-battlefield"), opt("wth",6,"Graveyard")]}]},
    {n:4, title:"Rath Cycle", years:"1997 to 1998", slots:[fixed("tmp",12),
      {type:"mix", key:"split", label:"Mix and match", sets:["sth","exo"], total:8}]},
    {n:5, title:"Urza's Block", years:"1998 to 1999", slots:[fixed("usg",10), fixed("ulg",5), fixed("uds",5),
      {type:"choice", key:"throwback", label:"Throwback (about 60 cards from one earlier set)", options:["2ed","leg","arn","atq","drk","ice","all","hml","fem","chr","mir","vis","wth","tmp","sth","exo"].map(c => opt(c, tb(c)))}]}
  ];
}
// Keep only slots whose sets exist in the card data, and number rounds by position.
function normalizeRounds(list){
  return (list || []).map((R, i) => ({...R, n:i+1, slots:(R.slots || []).map(sl => {
    if(sl.type === "fixed") return SETS[sl.set] && sl.packs > 0 ? sl : null;
    if(sl.type === "choice"){ const options = (sl.options || []).filter(o => SETS[o.set] && o.packs > 0); return options.length ? {...sl, options} : null; }
    if(sl.type === "mix") return (sl.sets || []).every(c => SETS[c]) && sl.sets.length === 2 && sl.total > 0 ? sl : null;
    return null;
  }).filter(Boolean)}));
}

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
  const pulls = livePulls(pid).slice().sort((a,b) => (a.created||"").localeCompare(b.created||""));
  for(const pull of pulls){
    for(const pk of pull.packs || []){
      pk.c.forEach((nm, j) => {
        const k = NORM(nm); let e = m.get(k);
        if(pull.kind === "remove"){   // take one copy out, from the named printing if it has one
          if(!e) return;
          const code = pk.s && e.sets[pk.s] ? pk.s : Object.keys(e.sets).sort((a,b)=>e.sets[b]-e.sets[a])[0];
          e.sets[code]--; if(!e.sets[code]) delete e.sets[code];
          if(--e.total <= 0) m.delete(k);
          return;
        }
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
// A round is opened slot by slot (each line set, the branch, the split, the throwback).
// Saved openings carry slot = that key; older whole-round openings have no slot and cover every slot.
function slotPull(uid, n, key){ return state.pulls.find(p => p.player===uid && p.kind==="packs" && p.round===n && !p.voided && (!p.slot || p.slot===key)); }
function roundSlots(R){
  return R.slots.map(sl => {
    const ck = `${R.n}:${sl.key}`;
    if(sl.type === "fixed") return {key:sl.key, def:sl, kind:"Packs", label:SETS[sl.set].name, parts:[{set:sl.set, packs:sl.packs}]};
    if(sl.type === "choice"){
      const done = ui.player && slotPull(ui.player, R.n, sl.key);
      const chosen = done && done.packs && done.packs[0] ? done.packs[0].s : (ui.choice[ck] || sl.options[0].set);
      const o = sl.options.find(x => x.set === chosen) || sl.options[0];
      return {key:sl.key, def:sl, kind:sl.label || "Branch", label:SETS[o.set].name, parts:[{set:o.set, packs:o.packs}]};
    }
    const [a, b] = sl.sets; const na = Math.max(0, Math.min(sl.total, ui.mix[ck] ?? Math.ceil(sl.total/2))); const parts = [];
    if(na) parts.push({set:a, packs:na}); if(sl.total-na) parts.push({set:b, packs:sl.total-na});
    return {key:sl.key, def:sl, kind:sl.label || "Mix and match", label:`${na} ${SETS[a].name} · ${sl.total-na} ${SETS[b].name}`, parts};
  });
}
// Which slots are ticked for opening (defaults to every slot not opened yet).
function selectedSlots(R){
  const all = roundSlots(R).filter(sl => !(ui.player && slotPull(ui.player, R.n, sl.key)));
  if(!ui.sel[R.n]) ui.sel[R.n] = new Set(all.map(sl => sl.key));
  return all.filter(sl => ui.sel[R.n].has(sl.key));
}

/* ---------- UI state ---------- */
const ui = { tab:"open", player:null, round:1, choice:{}, mix:{}, rdraft:null, rdirty:false, extraSet:"2ed", extraCount:1, poolText:"", poolRound:1,
  lastOpen:null, colPlayer:null, f:{q:"", colors:new Set(), type:"", rarity:"", set:"", cmd:"", hideBasics:true}, sort:"name",
  deckPlayer:null, deckText:"", deckCmd:"", deckResult:null, histOpen:new Set(), voidConfirm:null, removeConfirm:null, banDraft:null,
  busy:false, checks:null, revealIdx:0, revealDone:false, statsRound:null,
  revealMode: (() => { try { return localStorage.getItem("ppo-reveal") || "one"; } catch(e){ return "one"; } })(),
  images: (() => { try { return localStorage.getItem("ppo-images") !== "off"; } catch(e){ return true; } })(),
  pending:null, sel:{}, simSet:null, simCount:3, adjMode:"add", adjReason:"Shared pool pick",
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
    const R = ROUNDS[r-1];
    return selectedSlots(R).flatMap(sl => sl.parts.map(pt => ({kind:sl.kind, slot:sl.key, type:sl.def.type, set:pt.set, packs:pt.packs})));
  }
  if(r === "extra") return [{kind:"Extra", set:ui.extraSet, packs:Math.max(1, Math.min(60, ui.extraCount|0))}];
  if(r === "sim"){ const sets = simSets(); if(!sets.includes(ui.simSet)) ui.simSet = sets[0]; return [{kind:"Practice", set:ui.simSet, packs:Math.max(1, Math.min(20, ui.simCount|0))}]; }
  return [];
}
function slotHTML(kind, s, n){ return `<div class="slot"><div><div class="k">${kind}</div><div class="n">${esc(SETS[s].name)}</div></div><div class="c">${n} × ${SETS[s].size} = ${n*SETS[s].size}</div></div>`; }
function renderOpen(){
  const v = $("#view-open");
  const rounds = visibleRounds().map(R => `<button data-round="${R.n}" aria-pressed="${ui.round===R.n}">Round ${R.n}${R.n>unlocked()?" 🔒":""}</button>`).join("") +
    (isAdmin() ? `<button data-round="extra" aria-pressed="${ui.round==="extra"}">Extra packs</button>` : "") +
    `<button data-round="sim" aria-pressed="${ui.round==="sim"}">Practice packs</button>` +
    `<button data-round="pool" aria-pressed="${ui.round==="pool"}">Add / remove cards</button>`;
  const who = ui.player ? playerName(ui.player) : "you";
  let planHTML = "";
  if(typeof ui.round === "number"){
    const R = ROUNDS[ui.round-1];
    const locked = ui.round > unlocked();
    const sel = selectedSlots(R); const selKeys = new Set(sel.map(x=>x.key));
    const rows = roundSlots(R).map(sl => {
      const done = ui.player && slotPull(ui.player, R.n, sl.key);
      const packs = sl.parts.reduce((a,p)=>a+p.packs,0), cards = sl.parts.reduce((a,p)=>a+p.packs*SETS[p.set].size,0);
      let opts = "";
      if(!done && sl.def.type === "choice"){
        const ch = sl.parts[0].set;
        opts = `<div class="opts">${sl.def.options.map(o => `<label class="opt"><input type="radio" name="choice-${sl.key}" data-choice="${sl.key}" value="${o.set}" ${o.set===ch?"checked":""} ${ui.pending?"disabled":""}> <span>${esc(SETS[o.set].name)} <span class="muted">(${o.packs} pack${o.packs>1?"s":""})</span>${o.note ? `<br><span class="why">${esc(o.note)}</span>` : ""}</span></label>`).join("")}</div>`;
      }
      if(!done && sl.def.type === "mix"){
        const [a, b] = sl.def.sets; const na = sl.parts.find(p=>p.set===a)?.packs || 0;
        opts = `<div class="opts"><label for="mix-${sl.key}" class="small">${esc(SETS[a].name)} <b>${na}</b> · ${esc(SETS[b].name)} <b>${sl.def.total-na}</b></label><input id="mix-${sl.key}" data-mix="${sl.key}" type="range" min="0" max="${sl.def.total}" step="1" value="${na}" ${ui.pending?"disabled":""}></div>`;
      }
      const label = !done && sl.def.type === "choice" ? `${esc(sl.kind)}: pick one` : esc(sl.kind);
      return `<div class="slot ${done?"done":""}">
        <label class="slotpick">${done ? `<span class="tick" aria-hidden="true">✓</span>` : `<input type="checkbox" data-slot="${sl.key}" ${selKeys.has(sl.key)?"checked":""} ${ui.pending?"disabled":""} aria-label="Open ${esc(sl.label)}">`}
          <div><div class="k">${label}</div><div class="n">${esc(sl.label)}</div>${done ? `<div class="small muted">Opened ${esc(fmtDate(done.created))}</div>` : ""}</div></label>
        <div class="c">${packs} pack${packs>1?"s":""} · ${cards}</div>${opts}</div>`;
    }).join("");
    const remaining = roundSlots(R).filter(sl => !(ui.player && slotPull(ui.player, R.n, sl.key)));
    const packs = sel.reduce((a,sl)=>a+sl.parts.reduce((b,p)=>b+p.packs,0),0);
    const total = sel.reduce((a,sl)=>a+sl.parts.reduce((b,p)=>b+p.packs*SETS[p.set].size,0),0);
    let action;
    if(locked && !isAdmin()) action = `<div class="note"><b>Round ${ui.round} is locked.</b></div>`;
    else if(!remaining.length) action = `<div class="note"><b>${ui.player===state.me?.uid ? "You've" : esc(who)+" has"} opened all of Round ${ui.round}.</b> ${isAdmin() ? "To redo part of it, void that entry in History." : "If something went wrong, ask the admin to void it."}</div>`;
    else if(ui.pending) action = `<div class="note"><b>Packs waiting.</b> Add them to the collection or reroll on the right.</div>`;
    else action = `${locked ? `<div class="note warn"><b>Round ${ui.round} is still locked for players.</b> As admin you can open it anyway.</div>` : ""}
      <button class="btn primary" id="openBtn" ${!ui.player||ui.busy||!packs?"disabled":""}>${packs ? `Open ${packs} packs for ${esc(who)}` : "Tick at least one set to open"}</button>`;
    const pickAll = remaining.length > 1 ? `<div class="row small"><button class="link" id="selAll">Select all</button><span class="muted">·</span><button class="link" id="selNone">Select none</button></div>` : "";
    planHTML = `<div class="plan">${pickAll}${rows}<div class="total"><span>${packs} packs selected</span><span>${total} cards</span></div></div>${action}`;
  } else if(ui.round === "extra"){
    planHTML = `<p class="small muted">Admin only. For corrections, prizes, or anything outside the round plan. Saved and logged like any round.</p>
      <div class="row"><select id="extraSet" aria-label="Set">${SET_ORDER.map(s => `<option value="${s}" ${s===ui.extraSet?"selected":""}>${esc(SETS[s].name)} (${SETS[s].size}-card packs)</option>`).join("")}</select>
      <input id="extraCount" type="number" min="1" max="60" value="${ui.extraCount}" style="width:80px" aria-label="Packs"></div>
      <div class="total"><span>${ui.extraCount} packs</span><span>${ui.extraCount*SETS[ui.extraSet].size} cards</span></div>
      ${ui.pending ? `<div class="note"><b>Packs waiting.</b> Add them or reroll on the right.</div>` : `<button class="btn primary" id="openBtn" ${!ui.player||ui.busy?"disabled":""}>Open ${ui.extraCount} packs for ${esc(who)}</button>`}`;
  } else if(ui.round === "sim"){
    const sets = simSets(); if(!sets.includes(ui.simSet)) ui.simSet = sets[0];
    planHTML = `<div class="note"><b>Practice only.</b> Packs opened here are not saved and don't touch anyone's collection.</div>
      <div class="row"><select id="simSet" aria-label="Set">${sets.map(s => `<option value="${s}" ${s===ui.simSet?"selected":""}>${esc(SETS[s].name)} (${SETS[s].size}-card packs)</option>`).join("")}</select>
      <label for="simCount" class="small">Packs</label><input id="simCount" type="number" min="1" max="20" value="${ui.simCount}" style="width:72px"></div>
      <div class="total"><span>${ui.simCount} pack${ui.simCount>1?"s":""}</span><span>${ui.simCount*SETS[ui.simSet].size} cards</span></div>
      <button class="btn primary" id="simBtn">Sim ${ui.simCount} pack${ui.simCount>1?"s":""}</button>`;
  } else {
    const add = ui.adjMode === "add";
    const reasons = add ? ["Shared pool pick", "Round prize", "Other"] : ["Correction", "Round penalty", "Other"];
    if(!reasons.includes(ui.adjReason)) ui.adjReason = reasons[0];
    planHTML = `<div class="seg"><button data-adj="add" aria-pressed="${add}">Add cards</button><button data-adj="remove" aria-pressed="${!add}">Remove cards</button></div>
      <div class="row"><label for="adjReason">Reason</label><select id="adjReason">${reasons.map(r => `<option ${r===ui.adjReason?"selected":""}>${r}</option>`).join("")}</select>
        <label for="poolRound">Round</label><select id="poolRound">${visibleRounds().map(R=>`<option value="${R.n}" ${R.n===ui.poolRound?"selected":""}>Round ${R.n}</option>`).join("")}</select></div>
      <p class="small muted">${add
        ? `One line per card, with a count and edition so the Archidekt export keeps the right printing: <span style="font-family:var(--f-mono)">2 Sol Ring (2ed) 270</span>. For sets on the round sheet the number is optional.`
        : `One line per card: <span style="font-family:var(--f-mono)">1 Sol Ring</span>, or <span style="font-family:var(--f-mono)">1 Sol Ring (2ed)</span> to remove a specific printing. You can only remove cards ${esc(who)} owns.`}</p>
      <textarea id="poolText" placeholder="${add ? "1 Sol Ring (2ed) 270&#10;1 Force of Will (all) 28" : "1 Sol Ring&#10;2 Plains"}" style="min-height:90px">${esc(ui.poolText)}</textarea>
      <button class="btn ${add?"primary":"danger"}" id="poolSave" ${!ui.player||ui.busy?"disabled":""}>${add ? `Add to ${esc(who)}'s collection` : `Remove from ${esc(who)}'s collection`}</button>`;
  }
  const R = typeof ui.round==="number" ? ROUNDS[ui.round-1] : null;
  v.innerHTML = `<div class="grid2">
    <div class="panel">
      ${isAdmin() ? `<div class="stack"><h3>Opening for</h3>${playerChips(ui.player,"player")}</div>` : ""}
      <div class="stack"><h3>What to open</h3><div class="seg">${rounds}</div>
        ${R ? `<p class="small"><b>Round ${R.n}: ${esc(R.title)}</b> <span class="muted">(${R.years})</span></p>` : ""}
      </div>
      ${planHTML}
      ${typeof ui.round==="number" || ui.round==="extra" || ui.round==="sim" ? `<div class="stack"><h3>Reveal</h3><div class="seg"><button data-reveal="one" aria-pressed="${ui.revealMode==="one"}">One pack at a time</button><button data-reveal="all" aria-pressed="${ui.revealMode==="all"}">All at once</button></div></div>` : ""}
      ${typeof ui.round==="number" || ui.round==="extra" || ui.round==="sim" ? expectHTML(planFor()) : ""}
      ${ui.round==="sim" ? "" : ui.round==="pool" ? `<p class="small muted">Every add and remove is logged in History with its reason. The admin can void a mistake.</p>` : `<p class="small muted">Opening rolls the packs first. Look through them, then choose <b>Add to collection</b> or <b>Reroll</b>. Nothing is saved until you add, and each player adds one opening per round.</p>`}
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
  const pendingBar = L.pending ? `<div class="pendingbar"><div><b>Not in your collection yet.</b> <span class="small muted">${ui.pending && ui.pending.rerolls ? `Rerolled ${ui.pending.rerolls} time${ui.pending.rerolls>1?"s":""}. ` : ""}Rerolling replaces all ${N} packs.</span></div>
      <div class="row"><button class="btn" id="rerollOpen" ${ui.busy?"disabled":""}>Reroll</button><button class="btn primary" id="saveOpen" ${ui.busy?"disabled":""}>Add to collection</button></div></div>` : "";
  const head = `${pendingBar}<div><h2>${L.practice ? esc(L.label) : `${esc(playerName(L.player))} · ${esc(L.label)}`}</h2><p class="small muted">${N} packs · ${L.practice ? "practice, not saved" : L.pending ? "not saved yet" : `saved ${esc(fmtDate(L.created))}`}${oneByOne ? ` · stats so far cover ${upto+1} of ${N}` : ""}</p></div>`;
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
// Opening is two steps: roll the packs (not saved), then Add to collection or Reroll.
function rollPacks(slots){
  const packs = [];
  for(const sl of slots) for(let k=0;k<sl.packs;k++) packs.push({s:sl.set, c:openBooster(sl.set).map(i => CARDS[i].name), _slot:sl.slot || ""});
  return packs;
}
function doOpen(){
  const slots = planFor(); if(!slots.length || !ui.player || ui.busy) return;
  const R = typeof ui.round==="number" ? ROUNDS[ui.round-1] : null;
  const label = R ? `Round ${R.n}` : `Extra: ${ui.extraCount} ${SETS[ui.extraSet].name}`;
  const plan = slots.map(s => `${s.packs} ${SETS[s.set].name}`).join(", ");
  ui.pending = {slots, player:ui.player, round: R ? R.n : "extra", kind: R ? "packs" : "extra", label, plan, rerolls:0, saved:new Set()};
  ui.lastOpen = {id:null, pending:true, player:ui.player, label, plan, created:new Date().toISOString(), packs: rollPacks(slots)};
  ui.revealIdx = 0; ui.revealDone = false;
  renderOpen();
}
function doReroll(){
  const P = ui.pending; if(!P || ui.busy) return;
  P.rerolls++;
  if(P.saved.size){ toast("Part of this opening is already saved. Click Add to collection to finish saving it."); return; }
  ui.lastOpen = {...ui.lastOpen, created:new Date().toISOString(), packs: rollPacks(P.slots)};
  ui.revealIdx = 0; ui.revealDone = false;
  toast(`Rerolled (${P.rerolls})`);
  renderOpen();
}
async function doSaveOpen(){
  const P = ui.pending; if(!P || ui.busy) return;
  const strip = pk => ({s:pk.s, c:pk.c});
  // Rounds save one entry per slot (each line set, branch, split, throwback); extra packs save one entry.
  const groups = P.kind === "packs"
    ? [...new Set(ui.lastOpen.packs.map(pk => pk._slot))].map(key => ({key, packs: ui.lastOpen.packs.filter(pk => pk._slot === key)}))
    : [{key:"", packs: ui.lastOpen.packs}];
  ui.busy = true; renderOpen();
  let added = 0, failed = false;
  for(const g of groups){
    if(P.saved.has(g.key)) continue;
    let id, label = P.label;
    if(P.kind === "packs"){
      id = `${roundPullId(P.player, P.round)}_${g.key}`;
      if(isAdmin() && state.pulls.some(p => p.id === id)) id = `${id}_${rid()}`; // admin redo after a void
      const sl = P.slots.find(x => x.slot === g.key);
      label = `Round ${P.round} · ${sl.type === "fixed" ? SETS[sl.set].name : sl.type === "choice" ? `${sl.kind}: ${SETS[sl.set].name}` : sl.kind}`;
    } else id = `${P.player}_extra_${rid()}`;
    const plan = Object.entries(g.packs.reduce((a,pk)=>(a[pk.s]=(a[pk.s]||0)+1,a),{})).map(([s,n]) => `${n} ${SETS[s].name}`).join(", ");
    const pull = {player:P.player, round:P.round, kind:P.kind, label, plan, rerolls:P.rerolls, created:new Date().toISOString(), packs:g.packs.map(strip), voided:false};
    if(P.kind === "packs") pull.slot = g.key;
    const ok = await guarded(() => backend.createPull(id, pull));
    if(!ok){ failed = true; break; }
    P.saved.add(g.key); added += g.packs.length;
  }
  ui.busy = false;
  if(!failed){
    toast(`Added ${added} packs to ${playerName(P.player)}'s collection`);
    ui.pending = null; ui.lastOpen = {...ui.lastOpen, pending:false, created:new Date().toISOString()};
    if(typeof P.round === "number") delete ui.sel[P.round];
  }
  renderOpen();
}
// Sets you can practice with: anything in an unlocked round (admin: every set).
function simSets(){ return isAdmin() ? SET_ORDER.filter(c => c !== "3ed") : [...new Set(visibleRounds().filter(R => R.n <= unlocked()).flatMap(R => roundSets(R)))]; }
function doSim(){
  if(ui.pending){ toast("Add or reroll your waiting packs first"); return; }
  const slots = planFor(); if(!slots.length) return;
  const packs = [];
  for(const sl of slots) for(let k=0;k<sl.packs;k++) packs.push({s:sl.set, c:openBooster(sl.set).map(i => CARDS[i].name)});
  ui.lastOpen = {id:null, practice:true, player: state.me ? state.me.uid : null, label:`Practice: ${packs.length} ${SETS[slots[0].set].name}`, created:new Date().toISOString(), packs};
  ui.revealIdx = 0; ui.revealDone = false;
  renderOpen();
}
// Parse "2 Sol Ring (2ed) 270" style lines into {qty, name, set, num}.
function parseCardLines(text){
  const out = [];
  for(const raw of text.split("\n").map(x=>x.trim()).filter(Boolean)){
    let l = raw, qty = 1;
    const q = l.match(/^(\d+)\s*x?\s+(.*)$/i); if(q){ qty = Math.max(1, Math.min(99, +q[1])); l = q[2]; }
    let set = "", num = "";
    const m = l.match(/^(.*?)\s*\(([A-Za-z0-9]{2,6})\)\s*([\w-]+)?\s*$/);
    if(m){ l = m[1]; set = m[2].toLowerCase(); num = m[3] || ""; }
    const i = BY_NAME.get(NORM(l)); const name = i!==undefined ? CARDS[i].name : l.trim();
    if(set && !num && i!==undefined && SETS[set]) num = SETS[set].num[i] || "";
    if(name) out.push({qty, name, set, num});
  }
  return out;
}
async function doAdjust(){
  if(!ui.player || ui.busy) return;
  const lines = parseCardLines(ui.poolText); if(!lines.length){ toast("Add at least one card, one per line."); return; }
  const add = ui.adjMode === "add";
  if(!add){
    const own = collectionOf(ui.player); const problems = [];
    for(const l of lines){
      const e = own.get(NORM(l.name));
      const have = !e ? 0 : l.set ? (e.sets[l.set] || 0) : e.total;
      if(have < l.qty) problems.push(`${l.name}${l.set?` (${l.set})`:""}: owns ${have}`);
    }
    if(problems.length){ toast(`Can't remove more than owned. ${problems.join("; ")}`); return; }
  }
  const packs = lines.map(l => ({s:l.set, c:Array(l.qty).fill(l.name), n:Array(l.qty).fill(l.num)}));
  const count = lines.reduce((a,l)=>a+l.qty, 0);
  const kind = add ? (ui.adjReason === "Shared pool pick" ? "pool" : "add") : "remove";
  const id = `${ui.player}_adj_${rid()}`;
  const label = add ? `${ui.adjReason}, Round ${ui.poolRound}` : `Removed: ${ui.adjReason}, Round ${ui.poolRound}`;
  const plan = `${add ? "Added" : "Removed"} ${count} card${count>1?"s":""}: ${lines.map(l => `${l.qty>1?l.qty+" ":""}${l.name}`).join(", ")}`;
  const pull = {player:ui.player, round:ui.poolRound, kind, label, plan, created:new Date().toISOString(), packs, voided:false};
  ui.busy = true;
  const ok = await guarded(() => backend.createPull(id, pull), `${add ? "Added" : "Removed"} ${count} card${count>1?"s":""} ${add ? "to" : "from"} ${playerName(ui.player)}`);
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

function slotPacks(sl){ return sl.type === "fixed" ? sl.packs : sl.type === "choice" ? sl.options[0].packs : sl.total; }
function roundSummary(R){
  return R.slots.map(sl => sl.type === "fixed" ? `${sl.packs} ${SETS[sl.set].name}`
    : sl.type === "choice" ? `${sl.label || "Branch"}: one of ${sl.options.map(o => `${o.packs} ${SETS[o.set].name}`).join(" / ")}`
    : `${sl.total} split between ${SETS[sl.sets[0]].name} and ${SETS[sl.sets[1]].name}`).join("; ");
}

/* ---------- Rounds editor (admin) ---------- */
const clone = x => JSON.parse(JSON.stringify(x));
function draft(){ if(!ui.rdraft){ ui.rdraft = clone(ROUNDS); ui.rdirty = false; } return ui.rdraft; }
function openedKeys(n){ return new Set(state.pulls.filter(p => p.kind === "packs" && p.round === n && !p.voided).map(p => p.slot || "*")); }
function setOptions(sel){ return SET_ORDER.filter(c => c !== "3ed").map(c => `<option value="${c}" ${c===sel?"selected":""}>${esc(SETS[c].name)} (${SETS[c].size}-card packs)</option>`).join(""); }
// Give new slots a stable key the rules accept: line-<set>[n], branch / choiceN, split / mixN.
function assignKeys(R){
  // Existing keys stay as they are (saved openings point at them); only new or duplicate slots get one.
  const used = new Set(), keep = new Set();
  for(const sl of R.slots) if(sl.key && !used.has(sl.key)){ used.add(sl.key); keep.add(sl); }
  for(const sl of R.slots){
    if(keep.has(sl)) continue;
    let base = sl.type === "fixed" ? `line-${sl.set}` : sl.type === "choice" ? "branch" : "split";
    let key = base, k = 2;
    while(used.has(key)) key = sl.type === "fixed" ? `${base}${k++}` : `${sl.type === "choice" ? "choice" : "mix"}${k++}`;
    sl.key = key; used.add(key);
  }
}
function validateRounds(list){
  const errs = [];
  list.forEach((R, i) => {
    const n = i + 1;
    if(!R.slots.length) errs.push(`Round ${n} has no packs.`);
    R.slots.forEach((sl, j) => {
      const where = `Round ${n}, item ${j+1}`;
      const okNum = x => Number.isInteger(x) && x >= 1 && x <= 60;
      if(sl.type === "fixed" && !okNum(sl.packs)) errs.push(`${where}: packs must be 1 to 60.`);
      if(sl.type === "choice"){ if(!sl.options.length) errs.push(`${where}: add at least one option.`); sl.options.forEach(o => { if(!okNum(o.packs)) errs.push(`${where}: each option needs 1 to 60 packs.`); }); }
      if(sl.type === "mix"){ if(sl.sets[0] === sl.sets[1]) errs.push(`${where}: pick two different sets.`); if(!okNum(sl.total)) errs.push(`${where}: total must be 1 to 60.`); }
    });
  });
  return errs;
}
function renderRounds(){
  const v = $("#view-rounds");
  if(!isAdmin()){ v.innerHTML = `<div class="empty"><b>Only the admin can edit rounds.</b></div>`; return; }
  const D = draft();
  const cardsOf = sl => sl.type === "fixed" ? sl.packs*SETS[sl.set].size : sl.type === "choice" ? sl.options.map(o=>o.packs*SETS[o.set].size) : sl.total*SETS[sl.sets[0]].size;
  const num = (attrs, val, w=64) => `<input type="number" min="1" max="60" value="${val}" ${attrs} style="width:${w}px">`;
  v.innerHTML = `<div class="stack" style="gap:16px">
    <div class="panel roundbar">
      <div><h2>Rounds</h2><p class="small muted">Build each round from packs. <b>Packs</b>: everyone opens them. <b>Branch</b>: each player picks one option. <b>Mix</b>: each player splits a number of packs between two sets. Players see a round when you unlock it in Players &amp; bans.</p></div>
      <div class="row">${ui.rdirty ? `<span class="badge cmd">Unsaved changes</span>` : `<span class="small muted">All changes saved</span>`}
        <button class="btn" id="rDiscard" ${ui.rdirty?"":"disabled"}>Discard changes</button>
        <button class="btn primary" id="rSave" ${ui.rdirty&&!ui.busy?"":"disabled"}>Save rounds</button></div>
    </div>
    ${D.map((R, ri) => {
      const n = ri + 1; const opened = openedKeys(n); const isUnlocked = n <= unlocked();
      const packs = R.slots.reduce((a,sl)=>a+slotPacks(sl),0);
      return `<div class="panel">
        <div class="row" style="justify-content:space-between">
          <div class="row"><h2>Round ${n}</h2><span class="badge ${isUnlocked?"cmd":"void"}">${isUnlocked?"Unlocked":"Locked"}</span>${opened.size ? `<span class="small muted">${state.pulls.filter(p=>p.kind==="packs"&&p.round===n&&!p.voided).length} openings saved</span>` : ""}</div>
          ${ri === D.length-1 && !opened.size && D.length > 1 ? (ui.removeRound ? `<span class="confirm">Delete Round ${n}? <button class="btn danger" id="rDelYes">Delete</button><button class="btn" id="rDelNo">Cancel</button></span>` : `<button class="btn danger" id="rDel">Delete round</button>`) : ""}
        </div>
        <div class="row"><label>Title <input type="text" data-ri="${ri}" data-f="title" value="${esc(R.title||"")}" maxlength="60"></label>
          <label>Years <input type="text" data-ri="${ri}" data-f="years" value="${esc(R.years||"")}" maxlength="30" style="width:140px"></label>
          <span class="small muted">About ${packs} packs per player</span></div>
        <div class="stack">${R.slots.map((sl, si) => {
          const locked = sl.key && opened.has(sl.key) || opened.has("*");
          const at = `data-ri="${ri}" data-si="${si}"`;
          const head = `<div class="row" style="justify-content:space-between"><b class="k">${sl.type==="fixed"?"Packs":sl.type==="choice"?"Branch: pick one":"Mix two sets"}</b>
            ${locked ? `<span class="small muted">Already opened by a player, so its sets and counts are locked</span>` : `<button class="link" ${at} data-act="delSlot">Remove</button>`}</div>`;
          if(sl.type === "fixed") return `<div class="slot edit">${head}<div class="row"><select ${at} data-f="set" ${locked?"disabled":""}>${setOptions(sl.set)}</select> × ${num(`${at} data-f="packs" ${locked?"disabled":""}`, sl.packs)} packs <span class="small muted">${cardsOf(sl)} cards</span></div></div>`;
          if(sl.type === "mix") return `<div class="slot edit">${head}<div class="row"><label>Label <input type="text" ${at} data-f="label" value="${esc(sl.label||"")}" maxlength="60"></label></div>
            <div class="row">${num(`${at} data-f="total" ${locked?"disabled":""}`, sl.total)} packs split between <select ${at} data-f="setA" ${locked?"disabled":""}>${setOptions(sl.sets[0])}</select> and <select ${at} data-f="setB" ${locked?"disabled":""}>${setOptions(sl.sets[1])}</select></div></div>`;
          return `<div class="slot edit">${head}<div class="row"><label>Label <input type="text" ${at} data-f="label" value="${esc(sl.label||"")}" maxlength="60" placeholder="Branch"></label></div>
            <div class="stack">${sl.options.map((o, oi) => `<div class="row optrow"><select ${at} data-oi="${oi}" data-f="oset" ${locked?"disabled":""}>${setOptions(o.set)}</select> × ${num(`${at} data-oi="${oi}" data-f="opacks" ${locked?"disabled":""}`, o.packs)} packs
              <input type="text" ${at} data-oi="${oi}" data-f="onote" value="${esc(o.note||"")}" placeholder="Note for players (optional)" maxlength="80" style="flex:1;min-width:140px">
              ${locked || sl.options.length < 2 ? "" : `<button class="link" ${at} data-oi="${oi}" data-act="delOpt">Remove</button>`}</div>`).join("")}</div>
            ${locked ? "" : `<button class="link" ${at} data-act="addOpt">+ Add option</button>`}</div>`;
        }).join("") || `<p class="muted small">No packs yet.</p>`}</div>
        <div class="row"><button class="btn" data-ri="${ri}" data-act="addFixed">+ Packs</button><button class="btn" data-ri="${ri}" data-act="addChoice">+ Branch</button><button class="btn" data-ri="${ri}" data-act="addMix">+ Mix two sets</button></div>
      </div>`;
    }).join("")}
    <div class="row"><button class="btn" id="rAdd">+ Add round</button>${isAdmin() ? `<button class="btn" id="rDefault">Reset to the original 5 rounds</button>` : ""}</div>
    <p class="small muted">Only sets with card data can be used (the 20 sets from 1993 to 1999). Ask Claude to add newer sets.</p>
  </div>`;
}
function editRounds(t){
  const D = draft(); const ri = +t.dataset.ri, si = +t.dataset.si, oi = +t.dataset.oi; const R = D[ri]; const sl = R && R.slots[si];
  const f = t.dataset.f; const v = t.value; const n = Math.max(1, Math.min(60, parseInt(v,10) || 1));
  if(f === "title") R.title = v; else if(f === "years") R.years = v;
  else if(f === "set") sl.set = v; else if(f === "packs") sl.packs = n;
  else if(f === "label") sl.label = v; else if(f === "total") sl.total = n;
  else if(f === "setA") sl.sets[0] = v; else if(f === "setB") sl.sets[1] = v;
  else if(f === "oset") sl.options[oi].set = v; else if(f === "opacks") sl.options[oi].packs = n; else if(f === "onote") sl.options[oi].note = v;
  ui.rdirty = true;
}
async function saveRounds(){
  const D = draft(); const errs = validateRounds(D);
  if(errs.length){ toast(errs.slice(0,3).join(" ")); return; }
  D.forEach((R, i) => { R.n = i + 1; if(!R.title) R.title = `Round ${i+1}`; assignKeys(R); });
  ui.busy = true; renderRounds();
  const ok = await guarded(() => backend.saveRounds(clone(D)), "Rounds saved");
  ui.busy = false;
  if(ok){ ui.rdraft = null; ui.rdirty = false; ui.sel = {}; }
  renderRounds();
}

/* ---------- Stats ---------- */
function roundSets(R){
  return [...new Set(R.slots.flatMap(sl => sl.type === "fixed" ? [sl.set] : sl.type === "choice" ? sl.options.map(o=>o.set) : sl.sets))];
}
function renderStats(){
  const v = $("#view-stats");
  if(ui.statsRound === null) ui.statsRound = unlocked();
  const sel = ui.statsRound;
  const rounds = visibleRounds();
  const pulls = state.pulls.filter(p => !p.voided && (p.kind === "packs" || p.kind === "extra") && (sel === "all" || p.round === sel));
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
    return `<div class="hitem ${p.voided?"void":""} ${p.kind==="remove"?"removal":""}"><div class="hhead"><div><b>${esc(playerName(p.player))}</b> · ${esc(p.label)} ${p.voided?'<span class="badge void">Voided</span>':""}<div class="small muted">${esc(p.plan||"")} · ${n} cards${p.rerolls ? ` · rerolled ${p.rerolls}×` : ""}</div></div><span class="when">${esc(fmtDate(p.created))}</span></div>
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
      <div class="kv">${visibleRounds().map(R => `<b>R${R.n}</b><span>${esc(R.title)}: ${esc(roundSummary(R))}</span>`).join("")}</div>
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
  ["open","collection","sets","deck","stats","history","table","rounds"].forEach(k => $("#view-"+k).hidden = true);
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
  const rt = document.querySelector('[data-tab="rounds"]'); if(rt) rt.hidden = !isAdmin();
  if(ui.tab === "rounds" && !isAdmin()) ui.tab = "open";
  if(typeof ui.round === "number" && ui.round > ROUNDS.length) ui.round = Math.max(1, Math.min(unlocked(), ROUNDS.length));
  ["open","collection","sets","deck","stats","history","table","rounds"].forEach(k => $("#view-"+k).hidden = k!==ui.tab);
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab===ui.tab)));
  if(ui.tab==="open") renderOpen();
  if(ui.tab==="collection") renderCollection();
  if(ui.tab==="deck") renderDeck();
  if(ui.tab==="sets") renderSets();
  if(ui.tab==="rounds") renderRounds();
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
  if(d.player){ if(ui.pending){ toast("Add or reroll the waiting packs first"); return; } ui.player = d.player; ui.lastOpen = null; ui.sel = {}; return renderOpen(); }
  if(d.colplayer){ ui.colPlayer = d.colplayer; ui.f.cmd=""; return renderCollection(); }
  if(d.deckplayer){ ui.deckPlayer = d.deckplayer; ui.deckResult=null; ui.deckCmd=""; return renderDeck(); }
  if(d.round){ ui.round = /^\d+$/.test(d.round) ? +d.round : d.round; ui.roundChosen = true; if(ui.lastOpen && ui.lastOpen.practice && ui.round !== "sim") ui.lastOpen = null;
    if(ui.round === "sim" && ui.lastOpen && !ui.lastOpen.practice && !ui.lastOpen.pending) ui.lastOpen = null;
    return renderOpen(); }
  if(t.id==="openBtn") return doOpen();
  if(t.id==="imgToggle"){ ui.images = !ui.images; try { localStorage.setItem("ppo-images", ui.images ? "on" : "off"); } catch(e){} if(!$("#drawer").hidden) $("#drawer").hidden = true; return renderAll(); }
  if(d.sbcolor !== undefined){ ui.sb.color = ui.sb.color === d.sbcolor ? "" : d.sbcolor; return renderSets(); }
  if(d.reveal){ ui.revealMode = d.reveal; ui.revealDone = false; try { localStorage.setItem("ppo-reveal", d.reveal); } catch(e){} return renderOpen(); }
  if(t.id==="revNext"){ ui.revealIdx++; return renderOpen(); }
  if(t.id==="revPrev"){ ui.revealIdx = Math.max(0, ui.revealIdx-1); return renderOpen(); }
  if(t.id==="revDone" || t.id==="revAll"){ ui.revealDone = true; return renderOpen(); }
  if(d.statsround){ ui.statsRound = d.statsround === "all" ? "all" : +d.statsround; return renderStats(); }
  if(t.id==="poolSave") return doAdjust();
  if(t.id==="simBtn") return doSim();
  if(d.act && ui.tab==="rounds"){
    const D = draft(); const R = D[+d.ri]; const sl = R.slots[+d.si];
    const first = SET_ORDER.find(c => c !== "3ed");
    if(d.act==="addFixed") R.slots.push({type:"fixed", set:first, packs:10});
    if(d.act==="addChoice") R.slots.push({type:"choice", label:"Branch", options:[{set:first, packs:5, note:""}, {set:SET_ORDER[2], packs:5, note:""}]});
    if(d.act==="addMix") R.slots.push({type:"mix", label:"Mix and match", sets:[first, SET_ORDER[2]], total:8});
    if(d.act==="delSlot") R.slots.splice(+d.si, 1);
    if(d.act==="addOpt") sl.options.push({set:first, packs:5, note:""});
    if(d.act==="delOpt") sl.options.splice(+d.oi, 1);
    ui.rdirty = true; return renderRounds();
  }
  if(t.id==="rAdd"){ const D = draft(); D.push({n:D.length+1, title:`Round ${D.length+1}`, years:"", slots:[]}); ui.rdirty = true; return renderRounds(); }
  if(t.id==="rDel"){ ui.removeRound = true; return renderRounds(); }
  if(t.id==="rDelNo"){ ui.removeRound = false; return renderRounds(); }
  if(t.id==="rDelYes"){ ui.removeRound = false; draft().pop(); ui.rdirty = true; return renderRounds(); }
  if(t.id==="rDiscard"){ ui.rdraft = null; ui.rdirty = false; return renderRounds(); }
  if(t.id==="rDefault"){ const keep = draft(); ui.rdraft = normalizeRounds(defaultRounds()); for(let i = ui.rdraft.length; i < keep.length; i++) if(state.pulls.some(p=>p.round===i+1&&p.kind==="packs"&&!p.voided)) ui.rdraft.push(keep[i]); ui.rdirty = true; return renderRounds(); }
  if(t.id==="rSave") return saveRounds();
  if(t.id==="selAll" || t.id==="selNone"){ const R = ROUNDS[ui.round-1]; ui.sel[R.n] = new Set(t.id==="selAll" ? roundSlots(R).filter(sl => !slotPull(ui.player, R.n, sl.key)).map(sl=>sl.key) : []); return renderOpen(); }
  if(t.id==="saveOpen") return doSaveOpen();
  if(t.id==="rerollOpen") return doReroll();
  if(d.adj){ ui.adjMode = d.adj; return renderOpen(); }
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
  if(t.dataset.slot){ const set = ui.sel[ui.round] || new Set(); t.checked ? set.add(t.dataset.slot) : set.delete(t.dataset.slot); ui.sel[ui.round] = set; return renderOpen(); }
  if(t.dataset.ri !== undefined && t.dataset.f && ui.tab==="rounds"){
    editRounds(t);
    // Re-render only for dropdowns: re-rendering on a text/number blur would swallow the click that caused it.
    if(t.tagName === "SELECT") return renderRounds();
    const sv = $("#rSave"), dc = $("#rDiscard"); if(sv) sv.disabled = false; if(dc) dc.disabled = false; return;
  }
  if(t.dataset.choice){ ui.choice[`${ui.round}:${t.dataset.choice}`] = t.value; return renderOpen(); }
  if(t.id==="extraSet"){ ui.extraSet = t.value; return renderOpen(); }
  if(t.id==="extraCount"){ ui.extraCount = Math.max(1, Math.min(60, +t.value||1)); return renderOpen(); }
  if(t.id==="poolRound"){ ui.poolRound = +t.value; return; }
  if(t.id==="adjReason"){ ui.adjReason = t.value; return; }
  if(t.id==="simSet"){ ui.simSet = t.value; return renderOpen(); }
  if(t.id==="simCount"){ ui.simCount = Math.max(1, Math.min(20, +t.value||1)); return renderOpen(); }
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
  if(t.dataset.ri !== undefined && t.dataset.f && ui.tab==="rounds" && (t.type === "text" || t.type === "number")){ editRounds(t); const sv = $("#rSave"), dc = $("#rDiscard"); if(sv) sv.disabled = false; if(dc) dc.disabled = false; return; }
  if(t.dataset.mix){ ui.mix[`${ui.round}:${t.dataset.mix}`] = +t.value; return keepFocus(renderOpen); }
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

window.addEventListener("beforeunload", e => { if(ui.pending){ e.preventDefault(); e.returnValue = ""; } });

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
  ROUNDS = normalizeRounds(defaultRounds());
  CARDS.forEach((c,i) => BY_NAME.set(NORM(c.name), i));
  for(const [code, o] of Object.entries(ODDS.sets)) TARGETS[code] = new Set(o.targets.map(t => BY_NAME.get(NORM(t.name))).filter(i => i !== undefined));
  const startTab = (location.hash||"").slice(1);
  if(["open","collection","sets","deck","stats","history","table","rounds"].includes(startTab)) ui.tab = startTab;
  if(!backend.init()){ renderAll(); return; }
  let unsub = null;
  backend.onAuth(async user => {
    if(unsub){ unsub(); unsub = null; }
    state.me = user; state.loaded = false; state.players = []; state.pulls = []; state.settings = null; ui.lastOpen = null; ui.checks = null;
    renderAll();
    if(!user) return;
    let got = 0; const mark = () => { if(++got >= 4 && !state.loaded){ state.loaded = true; } };
    let seen = {players:false, pulls:false, settings:false, rounds:false};
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
      rounds: r => { ROUNDS = r && Array.isArray(r.rounds) && r.rounds.length ? normalizeRounds(r.rounds) : normalizeRounds(defaultRounds()); ready("rounds"); renderAll(); },
      onError: e => { console.error(e); toast(friendly(e)); }
    });
  });
}
boot();
