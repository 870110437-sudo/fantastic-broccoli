const APP_ID = "1f1dcb2717bc41a2d196167508f83458";
const APP_KEY = "2efd06f7769a606544357909a7503793";
const BASE_URL = "https://api.codenow.cn/1/classes";
const GEN_BASE_URL = "https://shiyunapi.com/v1";
const GEN_API_KEY = "sk-Cc6RjpYaHQmyJctCxaJEVjOcroZCvQZTwe7PQRiXDBpGZcsd";
const CHEAP_MODEL = "deepseek-chat";

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
let pendingNextSession = false;

const state = { groupWords: [], wrongWords: [], todayDone: 0, todayNew: 0, phaseDone: 0, streak: 1 };

let userId = localStorage.getItem("userId");
if (!userId) {
  userId = prompt("请输入用户名")?.trim() || `guest_${Date.now()}`;
  localStorage.setItem("userId", userId);
}

const savedGenKey = localStorage.getItem("genApiKey");
if (!savedGenKey) {
  showToast("未配置生成 API Key，请先点“API设置”");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function escapeHtml(text = "") {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
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
    if (w?.objectId && !map.has(w.objectId)) map.set(w.objectId, { ...w, known_en: false, known_cn: false, wrongCount: w.wrongCount || 0 });
  }
  return Array.from(map.values());
}

async function saveWord(status) {
  if (!currentWord) return;
  const where = encodeURIComponent(JSON.stringify({ userId, wordId: { "__type": "Pointer", className: "Words", objectId: currentWord.objectId } }));
  const findRes = await fetch(`${BASE_URL}/userwords?where=${where}`, { headers });
  const findData = await findRes.json();
  if (findData.results?.length) {
    const record = findData.results[0];
    await fetch(`${BASE_URL}/userwords/${record.objectId}`, { method: "PUT", headers, body: JSON.stringify({ status, reviewCount: (record.reviewCount || 0) + 1 }) });
  } else {
    await fetch(`${BASE_URL}/userwords`, { method: "POST", headers, body: JSON.stringify({ userId, wordId: { "__type": "Pointer", className: "Words", objectId: currentWord.objectId }, status, reviewCount: 1 }) });
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
function flipCard() { const card = document.getElementById("card"); card.classList.remove("flip"); void card.offsetWidth; card.classList.add("flip"); }
function toggleExpand(event) { if (event.target.closest("button")) return; expanded = !expanded; document.getElementById("card").classList.toggle("expanded", expanded); }

function renderWord() {
  if (!currentWord) return;
  const primary = document.getElementById("primary");
  const meta = document.getElementById("meta");
  const meaning = document.getElementById("meaning");
  const example = document.getElementById("example");
  const root = document.getElementById("root");
  const memoryMethodInput = document.getElementById("memoryMethodInput");
  expanded = false;
  document.getElementById("card").classList.remove("expanded");
  if (currentMode === studyModes.EN_TO_CN) {
    primary.textContent = currentWord.word || "-";
    meta.textContent = `${currentWord.IPA || ""}  ${currentWord.pos || ""}`.trim();
    meaning.textContent = currentWord.meaning || "暂无释义";
    example.textContent = currentWord.example ? `例句：${currentWord.example}` : "例句：暂无";
    const memory = currentWord.memorymethod || currentWord.root || "";
    root.textContent = memory ? `词根词缀：${memory}` : "词根词缀：预留";
    memoryMethodInput.value = currentWord.memorymethod || "";
  } else {
    primary.textContent = currentWord.meaning || "暂无释义";
    meta.textContent = "先回忆英文，再点击查看";
    meaning.textContent = `${currentWord.word || "-"}  ${currentWord.IPA || ""}`.trim();
    example.textContent = currentWord.pos ? `词性：${currentWord.pos}` : "词性：暂无";
    const memory = currentWord.memorymethod || currentWord.root || "";
    root.textContent = memory ? `词根词缀：${memory}` : "词根词缀：预留";
    memoryMethodInput.value = currentWord.memorymethod || "";
  }
  updateProgress();
}

function playAudio(event, slow = false) { if (event) event.stopPropagation(); if (!currentWord?.pronunciation) return alert("没有发音"); const a = new Audio(currentWord.pronunciation); a.playbackRate = slow ? 0.78 : 1; a.play().catch(() => alert("发音播放失败")); }


async function saveMemoryMethod(event) {
  if (event) event.stopPropagation();
  if (!currentWord?.objectId) return;
  const input = document.getElementById("memoryMethodInput");
  const memorymethod = input.value.trim();
  try {
    await fetch(`${BASE_URL}/Words/${currentWord.objectId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ memorymethod })
    });
    currentWord.memorymethod = memorymethod;
    document.getElementById("root").textContent = memorymethod ? `词根词缀：${memorymethod}` : "词根词缀：预留";
    showToast("记忆法已保存");
  } catch (e) {
    showToast("保存失败，请稍后重试");
  }
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
    if (inWrongReview) return openPassageTest(state.groupWords);
    if (currentMode === studyModes.EN_TO_CN) { currentMode = studyModes.CN_TO_EN; currentIndex = 0; state.phaseDone = 0; switchMode("cn"); return; }
    if (state.wrongWords.length) { inWrongReview = true; currentIndex = 0; showToast(`进入错词复习：${state.wrongWords.length} 个`); currentWord = state.wrongWords[currentIndex]; renderWord(); return; }
    return openPassageTest(state.groupWords);
  }
  currentWord = queue[currentIndex];
  renderWord();
}
    if (inWrongReview) {
      alert("本组学习完成，包含错词复习 ✅");
      await openPassageTest(state.groupWords);
      return;
    }

async function generatePassage(words) {
  const genKey = localStorage.getItem("genApiKey");
  if (!genKey) throw new Error("缺少API key");
  const wordPairs = words.map(w => `${w.word}: ${w.meaning}`).join("\n");
  const prompt = `请用以下10个英语单词写一个120词以内自然短文，要求：\n1) 必须包含所有单词\n2) 返回 JSON: {\"passage\":\"...\"}\n单词列表:\n${wordPairs}`;
  const res = await fetch(`${GEN_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${genKey}` },
    body: JSON.stringify({ model: CHEAP_MODEL, temperature: 0.4, messages: [{ role: "system", content: "You are a concise English writing assistant." }, { role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error("短文生成失败");
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "{}";
  const parsed = JSON.parse(raw);
  if (!parsed.passage) throw new Error("模型返回格式错误");
  return parsed.passage;
}

function renderPassageWithHighlights(passage, words) {
  const dict = new Map(words.map(w => [String(w.word || "").toLowerCase(), w.meaning || "暂无释义"]));
  const frag = document.createDocumentFragment();
  const parts = String(passage || "").split(/(\b)/);
  for (const p of parts) {
    const key = p.toLowerCase().replace(/[^a-z'-]/gi, "");
    if (dict.has(key)) {
      const span = document.createElement("span");
      span.className = "hl-word";
      span.textContent = p;
      span.dataset.meaning = dict.get(key);
      span.onclick = () => showToast(`${span.textContent}：${span.dataset.meaning}`);
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(p));

function renderPassageWithHighlights(passage, words) {
  const dict = new Map(words.map(w => [String(w.word || "").toLowerCase(), w.meaning || "暂无释义"]));
  const frag = document.createDocumentFragment();
  const parts = String(passage || "").split(/(\b)/);
  for (const p of parts) {
    const key = p.toLowerCase().replace(/[^a-z'-]/gi, "");
    if (dict.has(key)) {
      const span = document.createElement("span");
      span.className = "hl-word";
      span.textContent = p;
      span.dataset.meaning = dict.get(key);
      span.onclick = () => showToast(`${span.textContent}：${span.dataset.meaning}`);
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(p));
    }
  }
  const box = document.getElementById("passageContent");
  box.textContent = "";
  box.appendChild(frag);
}

async function savePassage(minitext) {
  await fetch(`${BASE_URL}/shortpassage`, { method: "POST", headers, body: JSON.stringify({ minitext, userId, score: Date.now() }) });
}

async function openPassageTest(words) {
  document.getElementById("passageModal").classList.remove("hidden");
  document.getElementById("passageContent").textContent = "短文生成中...";
  pendingNextSession = true;
  try {
    const passage = await generatePassage(words);
    await savePassage(passage);
    renderPassageWithHighlights(passage, words);
  } catch (e) {
    document.getElementById("passageContent").textContent = "短文生成失败，请检查API设置后再试。";
    await openPassageTest(state.groupWords);
    return;
  }
}

function closePassageModal(startNext = false) {
  document.getElementById("passageModal").classList.add("hidden");
  if (pendingNextSession && startNext) {
    pendingNextSession = false;
    startSession();
  }
}

async function openHistoryModal(event) {
  if (event) event.stopPropagation();
  const list = document.getElementById("historyList");
  list.textContent = "加载中...";
  document.getElementById("historyModal").classList.remove("hidden");
  try {
    const where = encodeURIComponent(JSON.stringify({ userId }));
    const res = await fetch(`${BASE_URL}/shortpassage?where=${where}&order=-createdAt&limit=30`, { headers });
    const data = await res.json();
    const rows = data.results || [];
    list.textContent = "";
    if (!rows.length) { list.textContent = "暂无历史短文"; return; }
    rows.forEach(r => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `<div class="time">${escapeHtml(r.createdAt || "")}</div><div>${escapeHtml(r.minitext || "")}</div>`;
      list.appendChild(item);
    });
  } catch (e) {
    list.textContent = "加载失败";
  }
}
function closeHistoryModal() { document.getElementById("historyModal").classList.add("hidden"); }

function openSettingsModal() {
  document.getElementById("apiKeyInput").value = localStorage.getItem("genApiKey") || "";
  document.getElementById("settingsModal").classList.remove("hidden");
}
function closeSettingsModal() { document.getElementById("settingsModal").classList.add("hidden"); }
function saveApiKey() {
  const key = document.getElementById("apiKeyInput").value.trim();
  localStorage.setItem("genApiKey", key);
  closeSettingsModal();
  showToast("API Key 已保存");
}

async function generatePassage(words) {
  const wordPairs = words.map(w => `${w.word}: ${w.meaning}`).join("\n");
  const prompt = `请用以下10个英语单词写一个120词以内自然短文，要求：\n1) 必须包含所有单词且每个只出现一次\n2) 仅返回 JSON 格式 {\"passage\":\"...\"}\n3) 不要包含 markdown\n\n单词列表:\n${wordPairs}`;

  const res = await fetch(`${GEN_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GEN_API_KEY}`
    },
    body: JSON.stringify({
      model: CHEAP_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: "You are a concise English writing assistant." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!res.ok) throw new Error("短文生成失败");
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  const parsed = JSON.parse(raw);
  return parsed.passage;
}

function highlightPassage(passage, words) {
  const dict = new Map(words.map(w => [w.word.toLowerCase(), w.meaning || "暂无释义"]));
  const tokenized = passage.split(/(\b)/);
  return tokenized.map(part => {
    const key = part.toLowerCase().replace(/[^a-z'-]/gi, "");
    if (dict.has(key)) {
      const meaning = dict.get(key);
      return `<span class="hl-word" data-meaning="${meaning}">${part}</span>`;
    }
    return part;
  }).join("");
}

async function savePassage(minitext) {
  await fetch(`${BASE_URL}/shortpassage`, {
    method: "POST",
    headers,
    body: JSON.stringify({ minitext, userId, score: Date.now() })
  });
}

async function openPassageTest(words) {
  try {
    const passage = await generatePassage(words);
    await savePassage(passage);
    const html = highlightPassage(passage, words);
    const box = document.getElementById("passageContent");
    box.innerHTML = html;
    box.querySelectorAll(".hl-word").forEach(el => {
      el.addEventListener("click", () => alert(`${el.textContent}：${el.dataset.meaning}`));
    });
  } catch (e) {
    document.getElementById("passageContent").textContent = "短文生成失败，请稍后再试。";
  }

  pendingNextSession = true;
  document.getElementById("passageModal").classList.remove("hidden");
}

function closePassageModal(startNext = false) {
  document.getElementById("passageModal").classList.add("hidden");
  if (pendingNextSession && startNext) {
    pendingNextSession = false;
    startSession();
  }
}

async function openHistoryModal(event) {
  if (event) event.stopPropagation();
  const list = document.getElementById("historyList");
  list.innerHTML = "加载中...";
  document.getElementById("historyModal").classList.remove("hidden");

  try {
    const where = encodeURIComponent(JSON.stringify({ userId }));
    const res = await fetch(`${BASE_URL}/shortpassage?where=${where}&order=-createdAt&limit=30`, { headers });
    const data = await res.json();
    const rows = data.results || [];

    if (!rows.length) {
      list.textContent = "暂无历史短文";
      return;
    }
  }
  const box = document.getElementById("passageContent");
  box.textContent = "";
  box.appendChild(frag);
}

async function savePassage(minitext) {
  await fetch(`${BASE_URL}/shortpassage`, { method: "POST", headers, body: JSON.stringify({ minitext, userId, score: Date.now() }) });
}

async function openPassageTest(words) {
  document.getElementById("passageModal").classList.remove("hidden");
  document.getElementById("passageContent").textContent = "短文生成中...";
  pendingNextSession = true;
  try {
    const passage = await generatePassage(words);
    await savePassage(passage);
    renderPassageWithHighlights(passage, words);
  } catch (e) {
    document.getElementById("passageContent").textContent = "短文生成失败，请检查API设置后再试。";
  }
}

function closePassageModal(startNext = false) {
  document.getElementById("passageModal").classList.add("hidden");
  if (pendingNextSession && startNext) {
    pendingNextSession = false;
    startSession();
  }
}

async function openHistoryModal(event) {
  if (event) event.stopPropagation();
  const list = document.getElementById("historyList");
  list.textContent = "加载中...";
  document.getElementById("historyModal").classList.remove("hidden");
  try {
    const where = encodeURIComponent(JSON.stringify({ userId }));
    const res = await fetch(`${BASE_URL}/shortpassage?where=${where}&order=-createdAt&limit=30`, { headers });
    const data = await res.json();
    const rows = data.results || [];
    list.textContent = "";
    if (!rows.length) { list.textContent = "暂无历史短文"; return; }
    rows.forEach(r => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `<div class="time">${escapeHtml(r.createdAt || "")}</div><div>${escapeHtml(r.minitext || "")}</div>`;
      list.appendChild(item);
    });
  } catch (e) {
    list.textContent = "加载失败";
  }
}
function closeHistoryModal() { document.getElementById("historyModal").classList.add("hidden"); }

function openSettingsModal() {
  document.getElementById("apiKeyInput").value = localStorage.getItem("genApiKey") || "";
  document.getElementById("settingsModal").classList.remove("hidden");
}
function closeSettingsModal() { document.getElementById("settingsModal").classList.add("hidden"); }
function saveApiKey() {
  const key = document.getElementById("apiKeyInput").value.trim();
  localStorage.setItem("genApiKey", key);
  closeSettingsModal();
  showToast("API Key 已保存");
    list.innerHTML = rows.map(r => `<div class="history-item"><div class="time">${r.createdAt || ""}</div><div>${r.minitext || ""}</div></div>`).join("");
  } catch (e) {
    list.textContent = "加载失败";
  }
}

function closeHistoryModal() {
  document.getElementById("historyModal").classList.add("hidden");
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
  if (!queue.length) return startSession();
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
  if (!currentWord) { document.getElementById("progressText").textContent = "词库不足，请先补充单词"; return; }
  renderWord();
}

startSession();
