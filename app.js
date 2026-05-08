const APP_ID = "1f1dcb2717bc41a2d196167508f83458";
const APP_KEY = "2efd06f7769a606544357909a7503793";
const BASE_URL = "https://api.codenow.cn/1/classes";
const headers = {
  "X-Bmob-Application-Id": APP_ID,
  "X-Bmob-REST-API-Key": APP_KEY,
  "Content-Type": "application/json"
};

const studyModes = { EN_TO_CN: "en", CN_TO_EN: "cn" };
const GROUP_SIZE = 10;

let currentWord = null;
let expanded = false;
let currentMode = studyModes.EN_TO_CN;
let currentIndex = 0;
let inWrongReview = false;

const state = {
  groupWords: [],
  wrongWords: [],
  todayDone: 0,
  todayNew: 0,
  phaseDone: 0,
  streak: 1
};

let userId = localStorage.getItem("userId");
if (!userId) {
  userId = prompt("请输入用户名");
  localStorage.setItem("userId", userId);
}

async function getRandomWord() {
  const skip = Math.floor(Math.random() * 120);
  const res = await fetch(`${BASE_URL}/Words?limit=1&skip=${skip}`, { headers });
  const data = await res.json();
  return data.results?.[0] || null;
}

async function getWordGroup(size = GROUP_SIZE) {
  const map = new Map();
  let tries = 0;

  while (map.size < size && tries < size * 12) {
    const w = await getRandomWord();
    tries += 1;
    if (w?.objectId && !map.has(w.objectId)) {
      map.set(w.objectId, {
        ...w,
        known_en: false,
        known_cn: false,
        wrongCount: w.wrongCount || 0
      });
    }
  }

  return Array.from(map.values());
}

async function saveWord(status) {
  if (!currentWord) return;
  const wordId = currentWord.objectId;

  const where = encodeURIComponent(JSON.stringify({
    userId,
    wordId: { "__type": "Pointer", className: "Words", objectId: wordId }
  }));

  const findRes = await fetch(`${BASE_URL}/userwords?where=${where}`, { headers });
  const findData = await findRes.json();

  if (findData.results?.length) {
    const record = findData.results[0];
    await fetch(`${BASE_URL}/userwords/${record.objectId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status, reviewCount: (record.reviewCount || 0) + 1 })
    });
  } else {
    await fetch(`${BASE_URL}/userwords`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        userId,
        wordId: { "__type": "Pointer", className: "Words", objectId: wordId },
        status,
        reviewCount: 1
      })
    });
  }
}

function switchMode(mode) {
  if (currentMode === mode || inWrongReview) return;
  currentMode = mode;
  document.querySelectorAll(".seg-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
  document.getElementById("segIndicator").style.transform = mode === "en" ? "translateX(0)" : "translateX(100%)";
  flipCard();
  renderWord();
}

function flipCard() {
  const card = document.getElementById("card");
  card.classList.remove("flip");
  void card.offsetWidth;
  card.classList.add("flip");
}

function toggleExpand(event) {
  if (event.target.closest("button")) return;
  expanded = !expanded;
  document.getElementById("card").classList.toggle("expanded", expanded);
}

function renderWord() {
  if (!currentWord) return;
  const primary = document.getElementById("primary");
  const meta = document.getElementById("meta");
  const meaning = document.getElementById("meaning");
  const example = document.getElementById("example");
  const root = document.getElementById("root");

  expanded = false;
  document.getElementById("card").classList.remove("expanded");

  if (currentMode === studyModes.EN_TO_CN) {
    primary.textContent = currentWord.word || "-";
    meta.textContent = `${currentWord.IPA || ""}  ${currentWord.pos || ""}`.trim();
    meaning.textContent = currentWord.meaning || "暂无释义";
    example.textContent = currentWord.example ? `例句：${currentWord.example}` : "例句：暂无";
    root.textContent = currentWord.root ? `词根词缀：${currentWord.root}` : "词根词缀：预留";
  } else {
    primary.textContent = currentWord.meaning || "暂无释义";
    meta.textContent = "先回忆英文，再点击查看";
    meaning.textContent = `${currentWord.word || "-"}  ${currentWord.IPA || ""}`.trim();
    example.textContent = currentWord.pos ? `词性：${currentWord.pos}` : "词性：暂无";
    root.textContent = currentWord.root ? `词根词缀：${currentWord.root}` : "词根词缀：预留";
  }

  updateProgress();
}

function playAudio(event, slow = false) {
  if (event) event.stopPropagation();
  if (!currentWord?.pronunciation) return alert("没有发音");
  const audio = new Audio(currentWord.pronunciation);
  audio.playbackRate = slow ? 0.78 : 1;
  audio.play().catch(() => alert("发音播放失败"));
}

async function handleKnow(known, event) {
  if (event) event.stopPropagation();
  if (!currentWord) return;

  const key = currentMode === studyModes.EN_TO_CN ? "known_en" : "known_cn";
  currentWord[key] = known;
  if (!known) {
    currentWord.wrongCount = (currentWord.wrongCount || 0) + 1;
    if (!state.wrongWords.find(w => w.objectId === currentWord.objectId)) state.wrongWords.push(currentWord);
  }

  state.todayDone += 1;
  state.phaseDone += 1;

  await saveWord(known ? 1 : 0);
  await nextWord();
}

async function nextWord() {
  currentIndex += 1;
  const queue = inWrongReview ? state.wrongWords : state.groupWords;

  if (currentIndex >= queue.length) {
    if (inWrongReview) {
      alert("本组学习完成，包含错词复习 ✅");
      await startSession();
      return;
    }

    if (currentMode === studyModes.EN_TO_CN) {
      currentMode = studyModes.CN_TO_EN;
      currentIndex = 0;
      state.phaseDone = 0;
      switchMode("cn");
      return;
    }

    if (state.wrongWords.length) {
      inWrongReview = true;
      currentIndex = 0;
      alert(`进入错词复习：${state.wrongWords.length} 个`);
      currentWord = state.wrongWords[currentIndex];
      renderWord();
      return;
    }

    alert("本组10词双向学习完成 ✅");
    await startSession();
    return;
  }

  currentWord = queue[currentIndex];
  renderWord();
}

function updateProgress() {
  const queue = inWrongReview ? state.wrongWords : state.groupWords;
  const done = Math.min(state.phaseDone, queue.length);
  const pct = queue.length ? (done / queue.length) * 100 : 0;
  const phase = inWrongReview ? "错词复习" : (currentMode === "en" ? "第一阶段 英→中" : "第二阶段 中→英");

  document.getElementById("progressText").textContent = `${phase} · ${Math.min(currentIndex + 1, queue.length)}/${queue.length}`;
  document.getElementById("progressBar").style.width = `${pct}%`;

  document.getElementById("sNew").textContent = state.todayNew;
  document.getElementById("sDone").textContent = state.todayDone;
  document.getElementById("sLeft").textContent = Math.max(0, (GROUP_SIZE * 2) - state.todayDone);
  document.getElementById("sStreak").textContent = `${state.streak} 天`;
}

async function deleteWord(event) {
  if (event) event.stopPropagation();
  if (!currentWord) return;
  if (!confirm(`确定删除单词：${currentWord.word} 吗？`)) return;

  await fetch(`${BASE_URL}/Words/${currentWord.objectId}`, { method: "DELETE", headers });
  state.groupWords = state.groupWords.filter(w => w.objectId !== currentWord.objectId);
  state.wrongWords = state.wrongWords.filter(w => w.objectId !== currentWord.objectId);

  const queue = inWrongReview ? state.wrongWords : state.groupWords;
  if (!queue.length) {
    await startSession();
    return;
  }

  if (currentIndex >= queue.length) currentIndex = queue.length - 1;
  currentWord = queue[currentIndex];
  renderWord();
}

async function startSession() {
  state.groupWords = await getWordGroup(GROUP_SIZE);
  state.wrongWords = [];
  currentMode = studyModes.EN_TO_CN;
  inWrongReview = false;
  currentIndex = 0;
  state.todayNew += state.groupWords.length;
  state.phaseDone = 0;

  document.getElementById("segIndicator").style.transform = "translateX(0)";
  document.querySelectorAll(".seg-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.mode === "en"));

  currentWord = state.groupWords[0] || null;
  if (!currentWord) {
    document.getElementById("progressText").textContent = "词库不足，请先补充单词";
    return;
  }
  renderWord();
}

startSession();
