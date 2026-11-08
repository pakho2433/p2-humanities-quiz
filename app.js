const $ = id => document.getElementById(id);
let all = [], qs = [], i = 0, sc = 0, mode = 0, takeN = 16, done = false, st = {};

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

fetch("questions.json")
  .then(r => r.json())
  .then(d => { all = d; })
  .catch(e => { console.error(e); alert("題目載入失敗"); });

function show(s) {
  ["home", "quiz", "result"].forEach(x => $(x).classList.toggle("hide", x !== s));
  if (s === "result" || s === "home") {
    if (window.AudioCtl) AudioCtl.onQuizEnd();
  }
}

async function start(l, n) {
  mode = l;
  takeN = n || (l ? 16 : 28);
  let pool = l ? all.filter(q => q.lesson === l) : all.slice();
  qs = sh(pool).slice(0, Math.min(takeN, pool.length)).map(q => {
    const raw = q.options.map((t, k) => ({
      t,
      alt: (q.optionAlts && q.optionAlts[k]) || t,
      c: k === q.correct
    }));
    const o = sh(raw);
    return { ...q, o, ans: o.findIndex(x => x.c) };
  });
  i = 0; sc = 0; st = {}; done = false;
  show("quiz");
  if (window.AudioCtl) await AudioCtl.onQuizStart();
  render();
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

function next() {
  if (!done) return;
  i++;
  if (i < qs.length) render();
  else result();
}

function result() {
  if (window.AudioCtl) AudioCtl.onQuizEnd();
  show("result");
  const r = sc / qs.length;
  const n = r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0;
  $("stars").textContent = "★".repeat(n) + "☆".repeat(3 - n);
  $("final").textContent =
    `答對 ${sc} / ${qs.length} 題（${Math.round(r * 100)}%）` +
    ["　繼續努力！", "　不錯！", "　很好！", "　太棒了！"][n];
  $("per").innerHTML = Object.keys(st)
    .sort()
    .map(l => `<div><span>第${l}課 ${LESSON[l] || ""}</span><span>${st[l][0]} / ${st[l][1]}</span></div>`)
    .join("");
}

document.querySelectorAll(".mode").forEach(b => {
  b.onclick = () => start(+b.dataset.l, +b.dataset.n);
});
$("next").onclick = next;
$("again").onclick = () => start(mode, takeN);
$("home2").onclick = () => show("home");

document.addEventListener("keydown", e => {
  if ($("quiz").classList.contains("hide")) return;
  if (e.key >= "1" && e.key <= "4" && qs[i] && +e.key <= qs[i].o.length) pick(+e.key - 1);
  else if (e.key === "Enter" || e.key === " ") next();
});

/* Audio: unlock on first gesture; welcome SFX; mute toggle */
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
  // Try autoplay; fall back to first tap (browser policy)
  AudioCtl.ensure().then(ok => {
    if (ok && !AudioCtl.muted) AudioCtl.playWelcome();
  }).catch(() => {});
  ["pointerdown", "touchstart", "keydown", "click"].forEach(ev => {
    document.addEventListener(ev, unlock, { once: true, passive: true });
  });
})();
