// Thin wrapper around Firebase so the UI never talks to the SDK directly.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let app = null, auth = null, db = null;

export function configured(){
  return !!firebaseConfig.projectId && !String(firebaseConfig.projectId).includes("PASTE_ME");
}

export function init(){
  if(!configured()) return false;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  return true;
}

export function onAuth(cb){
  return onAuthStateChanged(auth, u => cb(u ? {uid:u.uid, email:u.email || "", emailVerified:!!u.emailVerified, displayName:u.displayName || ""} : null));
}
export function signIn(){ return signInWithPopup(auth, new GoogleAuthProvider()); }
export function signOut(){ return fbSignOut(auth); }

// Live data. Each callback gets plain objects; onError gets an Error with .code.
export function subscribe({players, pulls, settings, rounds, onError}){
  const u1 = onSnapshot(query(collection(db, "players"), orderBy("created")),
    s => players(s.docs.map(d => ({id:d.id, ...d.data()}))), onError);
  const u2 = onSnapshot(query(collection(db, "pulls"), orderBy("created")),
    s => pulls(s.docs.map(d => ({id:d.id, ...d.data()}))), onError);
  const u3 = onSnapshot(doc(db, "config", "settings"),
    s => settings(s.exists() ? s.data() : null), onError);
  const u4 = onSnapshot(doc(db, "config", "rounds"),
    s => rounds(s.exists() ? s.data() : null), onError);
  return () => { u1(); u2(); u3(); u4(); };
}

export const savePlayer   = (uid, data) => setDoc(doc(db, "players", uid), data, {merge:true});
export const deletePlayer = uid => deleteDoc(doc(db, "players", uid));
export const createPull   = (id, data) => setDoc(doc(db, "pulls", id), data);
export const updatePull   = (id, patch) => updateDoc(doc(db, "pulls", id), patch);
export const saveSettings = patch => setDoc(doc(db, "config", "settings"), patch, {merge:true});
export const saveRounds   = list => setDoc(doc(db, "config", "rounds"), {rounds: list, updated: new Date().toISOString()});
export const pullExists   = async id => (await getDoc(doc(db, "pulls", id))).exists();
