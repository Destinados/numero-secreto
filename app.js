import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, query, orderBy, limit,
         onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 1) Cole aqui o firebaseConfig (Configurações do projeto > Seus apps > App da Web)
const firebaseConfig = {
  apiKey: "AIzaSyDMw3UIJ6AZzYE_hOhXRUnQLrk1oAXGgJM",
  authDomain: "desafio-numero-secreto.firebaseapp.com",
  projectId: "desafio-numero-secreto",
  storageBucket: "desafio-numero-secreto.firebasestorage.app",
  messagingSenderId: "140012274475",
  appId: "1:140012274475:web:86eace7689e851e3b7fb6e"
};

const MAX = 100;     // número secreto de 1 a MAX
const TRIES = 10;    // tentativas por partida (as regras do Firestore também usam 10)

const $ = id => document.getElementById(id);
let db, uid, secret, lo, hi, used, over = true;
let authMsg = "";

function showError(text) { const e = $("error"); e.textContent = text; e.hidden = !text; }

if (firebaseConfig.apiKey.startsWith("COLE")) {
  showError("Cole o firebaseConfig do seu projeto no início do app.js.");
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, async user => {
    try {
      if (!user) return await signInAnonymously(auth);
      uid = user.uid;
      const snap = await getDoc(doc(db, "players", uid));
      if (snap.exists()) start(snap.data().nickname);
      } catch (e) { authMsg = "Não foi possível conectar: " + e.message; showError(authMsg); }
  });
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!uid) return showError(authMsg || "Conexão ainda não está pronta. Tente de novo em instantes.");
  const nickname = $("nick").value.trim();
  try {
    await setDoc(doc(db, "players", uid), { nickname, wins: 0, gamesPlayed: 0, createdAt: serverTimestamp() });
    start(nickname);
  } catch (e) { showError("Não foi possível salvar o apelido: " + e.message); }
});

function start(nickname) {
  $("login").hidden = true; $("app").hidden = false;
  $("who").hidden = false; $("who").textContent = "Jogando como " + nickname;
  listen(); newGame();
}

/* ---------- jogo ---------- */
function newGame() {
  secret = Math.floor(Math.random() * MAX) + 1;
  lo = 1; hi = MAX; used = 0; over = false;
  $("again").hidden = true; $("guessBtn").disabled = false;
  $("guess").value = ""; $("guess").focus();
  setFeedback(`Adivinhe o número entre 1 e ${MAX}. Você tem ${TRIES} tentativas.`);
  render();
}

function setFeedback(text, cls = "") { const f = $("feedback"); f.textContent = text; f.className = "feedback " + cls; }

function render() {
  $("lo").textContent = lo; $("hi").textContent = hi;
  const fill = $("fill").style;
  fill.left = ((lo - 1) / (MAX - 1)) * 100 + "%";
  fill.width = Math.max(((hi - lo) / (MAX - 1)) * 100, 1.5) + "%";
  const pins = $("pins"); pins.replaceChildren();
  for (let i = 0; i < TRIES; i++) {
    const s = document.createElement("span"); if (i < used) s.className = "on"; pins.append(s);
  }
}

$("guessForm").addEventListener("submit", e => {
  e.preventDefault();
  if (over) return;
  const n = Number($("guess").value);
  if (!Number.isInteger(n) || n < 1 || n > MAX) return setFeedback(`Digite um número inteiro de 1 a ${MAX}.`);
  used++; $("guess").value = "";
  if (n === secret) return finish(true);
  if (n < secret) lo = Math.max(lo, n + 1); else hi = Math.min(hi, n - 1);
  render();
  if (used >= TRIES) return finish(false);
  setFeedback(`${n} é ${n < secret ? "baixo" : "alto"} demais. Restam ${TRIES - used}.`);
});

async function finish(won) {
  over = true; render();
  $("guessBtn").disabled = true; $("again").hidden = false;
  setFeedback(won ? `Abriu! Você acertou em ${used} ${used === 1 ? "tentativa" : "tentativas"}.`
                  : `Acabaram as tentativas. O número era ${secret}.`, won ? "win" : "lose");
  const ref = doc(db, "players", uid);
  try {
    await runTransaction(db, async tx => {
      const p = (await tx.get(ref)).data();
      const upd = { gamesPlayed: p.gamesPlayed + 1, wins: p.wins + (won ? 1 : 0) };
      if (won && (!p.bestAttempts || used < p.bestAttempts)) { upd.bestAttempts = used; upd.bestAt = serverTimestamp(); }
      tx.update(ref, upd);
    });
    await addDoc(collection(db, "players", uid, "games"), { won, attempts: used, createdAt: serverTimestamp() });
  } catch (e) { showError("A partida não foi salva: " + e.message); }
}
$("again").addEventListener("click", newGame);

/* ---------- tempo real: ranking, recordes e histórico ---------- */
const row = (left, right, cls = "") => {
  const li = document.createElement("li"); li.className = cls;
  const a = document.createElement("span"), b = document.createElement("b");
  a.textContent = left; b.textContent = right; li.append(a, b); return li;
};
const empty = text => { const li = document.createElement("li"); li.className = "empty"; li.textContent = text; return li; };

function listen() {
  // Ranking: só entra quem tem bestAttempts; menor número de tentativas primeiro
  onSnapshot(query(collection(db, "players"), orderBy("bestAttempts"), limit(10)), snap => {
    const items = snap.docs.map(d => row(d.data().nickname, d.data().bestAttempts + (d.data().bestAttempts === 1 ? " tentativa" : " tentativas"), d.id === uid ? "me" : ""));
    $("ranking").replaceChildren(...(items.length ? items : [empty("Ninguém no ranking ainda. Ganhe uma partida para abrir a lista.")]));
  }, e => showError("Ranking indisponível: " + e.message));

  // Recorde individual e totais
  onSnapshot(doc(db, "players", uid), snap => {
    const p = snap.data(); if (!p) return;
    $("sBest").textContent = p.bestAttempts ?? "–";
    $("sWins").textContent = p.wins; $("sGames").textContent = p.gamesPlayed;
  });

  // Histórico das últimas partidas do jogador
  onSnapshot(query(collection(db, "players", uid, "games"), orderBy("createdAt", "desc"), limit(8)), snap => {
    const items = snap.docs.map(d => {
      const g = d.data({ serverTimestamps: "estimate" });
      const date = g.createdAt ? g.createdAt.toDate().toLocaleDateString("pt-BR") : "";
      return row(`${g.won ? "Vitória" : "Derrota"} em ${g.attempts}`, date);
    });
    $("history").replaceChildren(...(items.length ? items : [empty("Suas partidas aparecem aqui.")]));
  });
}
