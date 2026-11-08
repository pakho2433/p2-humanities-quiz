import Fire3D from './js/fire3d.js?v=20261108v7';

const $ = id => document.getElementById(id);
let all = [], qs = [], i = 0, sc = 0, mode = 0, takeN = 16, done = false, st = {};
let playKind = "quiz"; // "quiz" | "fire"
let fireLevel = 5;
const FIRE_MAX = 5; // = zone count
const FIRE_QUESTIONS = 20;
let fireBusy = false;

const LESSON = {
  1: "善用金錢",
  2: "善用閒暇",
  3: "善用資訊科技",
  4: "交朋結友"
};

const sh = a => {
  a = a.slice();
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
};

function mapPool(pool, n) {
  return sh(pool).slice(0, Math.min(n, pool.length)).map(q => {
    const raw = q.options.map((t, k) => ({
      t,
      alt: (q.optionAlts && q.optionAlts[k]) || t,
      c: k === q.correct
    }));
    const o = sh(raw);
    return { ...q, o, ans: o.findIndex(x => x.c) };
  });
}

fetch("questions.json?v=20261108v7")
  .then(r => r.json())
  .then(d => { all = d; })
  .catch(e => { console.error(e); alert("題目載入失敗"); });

function show(s) {
  ["home", "quiz", "fire", "result"].forEach(x => {
    const el = $(x);
    if (el) el.classList.toggle("hide", x !== s);
  });
  if (s === "result" || s === "home") {
    if (window.AudioCtl) AudioCtl.onQuizEnd();
    if (s === "home") {
      try { Fire3D.dispose(); } catch (_) {}
      const banner = $("fireWonBanner");
      if (banner) banner.classList.add("hide");
    }
  }
}

async function start(l, n) {
  playKind = "quiz";
  mode = l;
  takeN = n || (l ? 16 : 28);
  const pool = l ? all.filter(q => q.lesson === l) : all.slice();
  qs = mapPool(pool, takeN);
  i = 0; sc = 0; st = {}; done = false;
  show("quiz");
  if (window.AudioCtl) await AudioCtl.onQuizStart();
  render();
}

async function startFire() {
  playKind = "fire";
  mode = "fire";
  takeN = FIRE_QUESTIONS;
  qs = mapPool(all.slice(), FIRE_QUESTIONS);
  i = 0; sc = 0; st = {}; done = false;
  fireBusy = false;
  fireLevel = FIRE_MAX;
  show("fire");
  $("corridor").classList.remove("flare", "won");
  const banner = $("fireWonBanner");
  if (banner) banner.classList.add("hide");
  $("fireOpts").classList.remove("dim");
  try {
    Fire3D.init($("fire3d"));
    Fire3D.resetWin();
  } catch (e) {
    console.error("Fire3D init failed", e);
  }
  syncFireMeter();
  if (window.AudioCtl) await AudioCtl.onQuizStart();
  renderFire();
}

function syncFireMeter() {
  try { fireLevel = Fire3D.getRemaining(); } catch (_) {}
  const m = $("fireMeter");
  m.innerHTML = "";
  for (let n = 0; n < FIRE_MAX; n++) {
    const s = document.createElement("span");
    // show remaining fires from the left
    s.className = "fl" + (n < fireLevel ? " on" : "");
    s.textContent = "🔥";
    m.appendChild(s);
  }
}

function setBubblesVisible(v) {
  const box = $("fireOpts");
  if (!box) return;
  box.classList.toggle("dim", !v);
  box.style.pointerEvents = v ? "" : "none";
}

function render() {
  const q = qs[i];
  done = false;
  $("prog").textContent = `第 ${i + 1} / ${qs.length} 題`;
  $("score").textContent = `⭐ ${sc} 分`;
  $("fill").style.width = (i / qs.length) * 100 + "%";
  $("tag").textContent = `第${q.lesson}課 ${LESSON[q.lesson] || ""} · ${q.difficulty || ""}`;
  $("src").textContent = `📖 ${q.source || ""}`;
  $("q").textContent = q.question;
  $("opts").innerHTML = "";
  const isImg = q.optionType === "image";
  q.o.forEach((x, k) => {
    const b = document.createElement("button");
    b.className = "opt" + (isImg ? " img-opt" : "");
    b.type = "button";
    if (isImg) {
      b.innerHTML = `<div class="row"><b>${k + 1}</b><span class="alt-label">${x.alt}</span></div>`;
      const img = document.createElement("img");
      img.src = x.t;
      img.alt = x.alt;
      img.loading = "eager";
      b.appendChild(img);
    } else {
      b.innerHTML = `<b>${k + 1}</b>`;
      b.append(document.createTextNode(x.t));
    }
    b.onclick = () => pick(k);
    $("opts").appendChild(b);
  });
  $("fb").classList.add("hide");
  $("next").classList.add("hide");
}

function renderFire() {
  const q = qs[i];
  done = false;
  fireBusy = false;
  $("fireProg").textContent = `${i + 1}/${qs.length}`;
  $("fireScore").textContent = String(sc);
  $("fireSrc").textContent = `📖 ${q.source || ""}`;
  $("fireQ").textContent = q.question;
  $("fireFb").classList.add("hide");
  $("fireNext").classList.add("hide");
  $("corridor").classList.remove("flare");
  setBubblesVisible(true);
  const box = $("fireOpts");
  box.innerHTML = "";
  const isImg = q.optionType === "image";
  q.o.forEach((x, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt" + (isImg ? " img-opt" : "");
    if (isImg) {
      b.innerHTML = `<div class="row"><b>${k + 1}</b><span class="alt-label">${x.alt}</span></div>`;
      const img = document.createElement("img");
      img.src = x.t;
      img.alt = x.alt;
      img.loading = "eager";
      b.appendChild(img);
    } else {
      b.innerHTML = `<b>${k + 1}</b>`;
      b.append(document.createTextNode(x.t));
    }
    b.onclick = () => pickFire(k);
    box.appendChild(b);
  });
  syncFireMeter();
}

function pick(k) {
  if (done) return;
  done = true;
  const q = qs[i];
  const ok = k === q.ans;
  const bs = $("opts").children;
  bs[q.ans].classList.add("ok");
  if (!ok) bs[k].classList.add("bad");
  const s = st[q.lesson] || (st[q.lesson] = [0, 0]);
  s[1]++;
  if (ok) { sc++; s[0]++; }
  $("score").textContent = `⭐ ${sc} 分`;
  const ansText = q.o[q.ans].alt || q.o[q.ans].t;
  $("fb").innerHTML =
    (ok ? "✅ 答對了！" : "❌ 答錯了！正確答案：" + ansText) +
    "<br>💡 " + q.explanation +
    `<span class="book">📚 翻書：${q.source || "（見課本／作業）"}</span>`;
  $("fb").classList.remove("hide");
  $("next").textContent = i + 1 < qs.length ? "下一題 ➜" : "看結果 🏆";
  $("next").classList.remove("hide");
  $("fill").style.width = ((i + 1) / qs.length) * 100 + "%";
}

async function pickFire(k) {
  if (done || fireBusy) return;
  done = true;
  fireBusy = true;
  const q = qs[i];
  const ok = k === q.ans;
  const bs = $("fireOpts").children;
  [...bs].forEach(b => { b.disabled = true; });
  bs[q.ans].classList.add("ok");
  if (!ok) bs[k].classList.add("bad");
  const s = st[q.lesson] || (st[q.lesson] = [0, 0]);
  s[1]++;

  const ansText = q.o[q.ans].alt || q.o[q.ans].t;

  if (ok) {
    sc++;
    s[0]++;
    $("fireScore").textContent = String(sc);
    setBubblesVisible(false);
    if (window.AudioCtl) {
      AudioCtl.playSplash();
      setTimeout(() => AudioCtl.playCheer(), 200);
    }
    $("fireFb").innerHTML =
      `✅ 答對了！射水救火中…` +
      "<br>💡 " + q.explanation +
      `<span class="book">📚 翻書：${q.source || "（見課本／作業）"}</span>`;
    $("fireFb").classList.remove("hide");

    let outcome = { remaining: fireLevel - 1, walked: false, won: false };
    try {
      outcome = await Fire3D.playCorrect();
    } catch (e) {
      console.error(e);
    }
    fireLevel = outcome.remaining;
    syncFireMeter();

    if (outcome.won) {
      $("corridor").classList.add("won");
      try { Fire3D.win(); } catch (_) {}
      const banner = $("fireWonBanner");
      if (banner) banner.classList.remove("hide");
      $("fireFb").innerHTML =
        `✅ 太棒了！五區大火全部救熄！` +
        "<br>💡 " + q.explanation +
        `<span class="book">📚 翻書：${q.source || "（見課本／作業）"}</span>`;
      $("fireNext").textContent = "看結果 🏆";
      $("fireNext").classList.remove("hide");
      fireBusy = false;
      return;
    }

    $("fireFb").innerHTML =
      `✅ 答對了！已熄滅這一區的火${outcome.walked ? "，前進到下一火區！" : "！"}火勢 ${fireLevel}/${FIRE_MAX}` +
      "<br>💡 " + q.explanation +
      `<span class="book">📚 翻書：${q.source || "（見課本／作業）"}</span>`;
    $("fireNext").textContent = i + 1 < qs.length ? "下一題 ➜" : "看結果 🏆";
    $("fireNext").classList.remove("hide");
    fireBusy = false;
  } else {
    $("corridor").classList.add("flare");
    try { Fire3D.playWrong(); } catch (_) {}
    if (window.AudioCtl) AudioCtl.playFireFlare();
    setTimeout(() => $("corridor").classList.remove("flare"), 450);
    $("fireFb").innerHTML =
      `❌ 答錯了！火勢更猛！正確：${ansText}` +
      "<br>💡 " + q.explanation +
      `<span class="book">📚 翻書：${q.source || "（見課本／作業）"}</span>`;
    $("fireFb").classList.remove("hide");
    $("fireNext").textContent = i + 1 < qs.length ? "下一題 ➜" : "看結果 🏆";
    $("fireNext").classList.remove("hide");
    fireBusy = false;
  }
}

function next() {
  if (!done) return;
  i++;
  if (i < qs.length) render();
  else result();
}

function nextFire() {
  if (!done || fireBusy) return;
  if (fireLevel === 0) {
    result();
    return;
  }
  i++;
  if (i < qs.length) renderFire();
  else result();
}

function result() {
  if (window.AudioCtl) AudioCtl.onQuizEnd();
  show("result");
  if (playKind === "fire") {
    const cleared = FIRE_MAX - fireLevel;
    const win = fireLevel === 0;
    $("resultTitle").textContent = win ? "🚒 大火救熄了！" : "🚒 救火結束";
    const n = win ? 3 : cleared >= 3 ? 2 : cleared >= 1 ? 1 : 0;
    $("stars").textContent = "★".repeat(n) + "☆".repeat(3 - n);
    $("final").textContent = win
      ? `太棒了！答對 ${sc} 題，成功把 ${FIRE_MAX} 個火區全部救熄！`
      : `答對 ${sc} / ${qs.length} 題，救熄了 ${cleared}/${FIRE_MAX} 個火區。再試一次把火救清！`;
  } else {
    $("resultTitle").textContent = "挑戰完成！";
    const r = sc / qs.length;
    const n = r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0;
    $("stars").textContent = "★".repeat(n) + "☆".repeat(3 - n);
    $("final").textContent =
      `答對 ${sc} / ${qs.length} 題（${Math.round(r * 100)}%）` +
      ["　繼續努力！", "　不錯！", "　很好！", "　太棒了！"][n];
  }
  $("per").innerHTML = Object.keys(st)
    .sort()
    .map(l => `<div><span>第${l}課 ${LESSON[l] || ""}</span><span>${st[l][0]} / ${st[l][1]}</span></div>`)
    .join("");
}

document.querySelectorAll(".mode").forEach(b => {
  b.onclick = () => start(+b.dataset.l, +b.dataset.n);
});
$("fireStart").onclick = () => startFire();
$("next").onclick = next;
$("fireNext").onclick = nextFire;
$("fireHome").onclick = () => show("home");
$("again").onclick = () => {
  if (playKind === "fire") startFire();
  else start(mode, takeN);
};
$("home2").onclick = () => show("home");

document.addEventListener("keydown", e => {
  if (!$("quiz").classList.contains("hide")) {
    if (e.key >= "1" && e.key <= "4" && qs[i] && +e.key <= qs[i].o.length) pick(+e.key - 1);
    else if (e.key === "Enter" || e.key === " ") next();
  } else if (!$("fire").classList.contains("hide")) {
    if (fireBusy) return;
    if (e.key >= "1" && e.key <= "4" && qs[i] && +e.key <= qs[i].o.length) pickFire(+e.key - 1);
    else if (e.key === "Enter" || e.key === " ") nextFire();
  }
});

window.__p2quiz = {
  getQs: () => qs,
  getFire: () => fireLevel,
  getZone: () => { try { return Fire3D.getZoneIndex(); } catch (_) { return 0; } },
  pickFire,
  startFire
};

(function initAudio() {
  if (!window.AudioCtl) return;
  AudioCtl.syncMuteBtn();
  const muteBtn = $("muteBtn");
  if (muteBtn) {
    muteBtn.onclick = e => {
      e.stopPropagation();
      AudioCtl.toggleMute();
      AudioCtl.ensure().then(() => {
        if (!AudioCtl.muted && !AudioCtl.welcomePlayed) AudioCtl.playWelcome();
      });
    };
  }
  let unlockedOnce = false;
  const unlock = () => {
    if (unlockedOnce) return;
    unlockedOnce = true;
    AudioCtl.unlockAndWelcome();
  };
  AudioCtl.ensure().then(ok => {
    if (ok && !AudioCtl.muted) AudioCtl.playWelcome();
  }).catch(() => {});
  ["pointerdown", "touchstart", "keydown", "click"].forEach(ev => {
    document.addEventListener(ev, unlock, { once: true, passive: true });
  });
})();
