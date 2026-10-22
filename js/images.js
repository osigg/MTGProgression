// Card images from Scryfall (https://scryfall.com/docs/api).
// Looks up exact printings in batches of 75 with POST /cards/collection, at most one request
// every 150 ms (Scryfall asks for no more than 10 per second), and caches the image URLs in
// this browser so each printing is only ever looked up once.

const API = "https://api.scryfall.com/cards/collection";
const LS_KEY = "ppo-img-v1";
const BATCH = 75, GAP_MS = 150;

let cache = {};             // key -> {s: small url, n: normal url} | null (not found)
try { cache = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch(e) { cache = {}; }
const queue = [];           // keys waiting for lookup
const inFlight = new Set();
let timer = null, lastCall = 0, saveTimer = null;

// key format: "set|collector number|card name" (number may be empty)
export const keyFor = (name, set, num) => `${(set||"").toLowerCase()}|${num||""}|${name}`;
const parse = key => { const [set, num, ...rest] = key.split("|"); return {set, num, name: rest.join("|")}; };

export function cached(key){ return cache[key]; }   // undefined = unknown, null = not found

function save(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch(e){} }, 400); }

function apply(key){
  const hit = cache[key];
  document.querySelectorAll("img.cimg[data-ik]").forEach(img => {
    if(img.dataset.ik !== key) return;
    if(hit){ img.src = img.dataset.size === "n" ? hit.n : hit.s; }
    else { img.closest(".cimgbox")?.classList.add("noimg"); }
  });
}

export function request(key){
  if(key in cache){ apply(key); return; }
  if(inFlight.has(key) || queue.includes(key)) return;
  queue.push(key); schedule();
}
function schedule(){
  if(timer) return;
  const wait = Math.max(0, lastCall + GAP_MS - Date.now());
  timer = setTimeout(flush, wait);
}

// One identifier per key; a second pass retries misses by name+set, then by name alone.
function ident(p, pass){
  if(pass === 0 && p.set && p.num) return {set:p.set, collector_number:p.num};
  if(pass <= 1 && p.set) return {name:p.name, set:p.set};
  return {name:p.name};
}
async function lookup(keys, pass){
  const parsed = keys.map(parse);
  const body = {identifiers: parsed.map(p => ident(p, pass))};
  lastCall = Date.now();
  const res = await fetch(API, {method:"POST", headers:{"Content-Type":"application/json", "Accept":"application/json"}, body:JSON.stringify(body)});
  if(res.status === 429){ const e = new Error("rate limited"); e.retry = true; throw e; }
  if(!res.ok) throw new Error("Scryfall " + res.status);
  const json = await res.json();
  const byNum = new Map(), byNameSet = new Map(), byName = new Map();
  for(const c of json.data || []){
    const uris = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris);
    if(!uris) continue;
    const v = {s: uris.small, n: uris.normal};
    byNum.set(`${c.set}|${c.collector_number}`.toLowerCase(), v);
    byNameSet.set(`${c.set}|${c.name}`.toLowerCase(), v);
    if(!byName.has(c.name.toLowerCase())) byName.set(c.name.toLowerCase(), v);
  }
  const missing = [];
  keys.forEach((k, i) => {
    const p = parsed[i];
    const v = (pass === 0 && byNum.get(`${p.set}|${p.num}`.toLowerCase()))
           || (pass <= 1 && byNameSet.get(`${p.set}|${p.name}`.toLowerCase()))
           || (pass === 2 && byName.get(p.name.toLowerCase()));
    if(v){ cache[k] = v; apply(k); } else missing.push(k);
  });
  return missing;
}
async function flush(){
  timer = null;
  const keys = queue.splice(0, BATCH); if(!keys.length) return;
  keys.forEach(k => inFlight.add(k));
  try {
    let left = await lookup(keys, keys.some(k => parse(k).num) ? 0 : 1);
    for(const pass of [1, 2]){
      if(!left.length) break;
      await new Promise(r => setTimeout(r, GAP_MS));
      left = await lookup(left, pass);
    }
    left.forEach(k => { cache[k] = null; apply(k); });
    save();
  } catch(e){
    if(e.retry){ queue.unshift(...keys); lastCall = Date.now() + 1000; }
    else keys.forEach(k => { document.querySelectorAll("img.cimg[data-ik]").forEach(img => { if(img.dataset.ik === k) img.closest(".cimgbox")?.classList.add("noimg"); }); });
  } finally {
    keys.forEach(k => inFlight.delete(k));
    if(queue.length) schedule();
  }
}

// Fill images that scrolled into view. Call after every render.
let observer = null;
export function hydrate(root = document){
  if(!observer && "IntersectionObserver" in window){
    observer = new IntersectionObserver(entries => {
      for(const en of entries){ if(en.isIntersecting){ observer.unobserve(en.target); request(en.target.dataset.ik); } }
    }, {rootMargin: "300px"});
  }
  root.querySelectorAll("img.cimg[data-ik]:not([src])").forEach(img => {
    const hit = cache[img.dataset.ik];
    if(hit){ img.src = img.dataset.size === "n" ? hit.n : hit.s; return; }
    if(hit === null){ img.closest(".cimgbox")?.classList.add("noimg"); return; }
    if(observer) observer.observe(img); else request(img.dataset.ik);
  });
}
export function clearCache(){ cache = {}; try { localStorage.removeItem(LS_KEY); } catch(e){} }
