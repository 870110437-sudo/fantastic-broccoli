// ========== 常量配置 ==========
const BASE_URL = "https://api.codenow.cn/1/classes";
const GEN_BASE_URL = "https://shiyunapi.com/v1";
const CHEAP_MODEL = "deepseek-chat";
const GROUP_SIZE = 10;

const studyModes = { EN_TO_CN: "en", CN_TO_EN: "cn" };

// 模式渲染配置 抽离到全局
const modeRenderConfig = {
  [studyModes.EN_TO_CN]: {
    primary: () => currentWord.word || "-",
    meta: () => `${currentWord.IPA ?? ""} ${currentWord.pos ?? ""}`.trim(),
    meaning: () => currentWord.meaning || "暂无释义",
    example: () => currentWord.example?.trim() ? `例句: ${currentWord.example}` : "例句: 暂无"
  },
  [studyModes.CN_TO_EN]: {
    primary: () => currentWord.meaning || "暂无释义",
    meta: () => "先回忆英文，再点击查看",
    meaning: () => `${currentWord.word || "-"} ${currentWord.IPA ?? ""}`.trim(),
    example: () => currentWord.pos ? `词性: ${currentWord.pos}` : "词性: 暂无"
  }
};

// ========== 全局状态变量 ==========
let currentWord = null;
let expanded = false;
let currentMode = studyModes.EN_TO_CN;
let currentIndex = 0;
let inWrongReview = false;
let pendingNextSession = false;

const state = { 
  groupWords: [], 
  wrongWords: [], 
  todayDone: 0, 
  todayNew: 0, 
  phaseDone: 0, 
  streak: 1 
};

// ========== 核心关键：动态获取请求头（解决连不上数据库核心BUG） ==========
function getHeaders() {
  const appId = localStorage.getItem("appId") || "";
  const appKey = localStorage.getItem("appKey") || "";
  return {
    "X-Bmob-Application-Id": appId,
    "X-Bmob-REST-API-Key": appKey,
    "Content-Type": "application/json"
  };
}

// 校验Bmob密钥是否配置
function checkBmobAuth() {
  const appId = localStorage.getItem("appId");
  const appKey = localStorage.getItem("appKey");
  if (!appId || !appKey) {
    showToast("未配置Bmob密钥，无法连接数据库，请先去设置填写");
    return false;
  }
  return true;
}

// ========== 用户ID初始化 ==========
let userId = localStorage.getItem("userId");
if (!userId) {
  userId = (prompt("请输入用户名") || "").trim().slice(0, 32) || `guest_${Date.now()}`;
  localStorage.setItem("userId", userId);
}

// ========== 生成API密钥检查 ==========
const savedGenKey = localStorage.getItem("genApiKey");
if (!savedGenKey) {
  showToast("未配置生成 API Key，请先点「API设置」");
}

// ========== 工具方法 ==========
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ========== 单词数据库请求（全部加异常捕获 + 密钥校验） ==========
async function getRandomWord() {
  if (!checkBmobAuth()) return null;
  try {
    const skip = Math.floor(Math.random() * 120);
    const res = await fetch(`${BASE_URL}/Words?limit=1&skip=${skip}`, { headers: getHeaders() });
    if (!res.ok) throw new Error("接口响应异常");
    const data = await res.json();
    return data.results?.[0] || null;
  } catch (e) {
    showToast("连接数据库失败，请检查密钥或网络");
    return null;
  }
}

async function getWordGroup(size = GROUP_SIZE) {
  if (!checkBmobAuth()) return [];
  const map = new Map();
  let tries = 0;
  while (map.size < size && tries < size * 12) {
    const w = await getRandomWord();
    tries += 1;
    if (w?.objectId && !map.has(w.objectId)) {
      map.set(w.objectId, { ...w, known_en: false, known_cn: false, wrongCount: w.wrongCount || 0 });
    }
  }
  return Array.from(map.values());
}

async function saveWord(status) {
  if (!checkBmobAuth() || !currentWord) return;
  try {
    const where = encodeURIComponent(JSON.stringify({ 
      userId, 
      wordId: { "__type": "Pointer", className: "Words", objectId: currentWord.objectId } 
    }));
    const findRes = await fetch(`${BASE_URL}/userwords?where=${where}`, { headers: getHeaders() });
    const findData = await findRes.json();

    if (findData.results?.length) {
      const record = findData.results[0];
      await fetch(`${BASE_URL}/userwords/${record.objectId}`, { 
        method: "PUT", 
        headers: getHeaders(), 
        body: JSON.stringify({ status, reviewCount: (record.reviewCount || 0) + 1 }) 
      });
    } else {
      await fetch(`${BASE_URL}/userwords`, { 
        method: "POST", 
        headers: getHeaders(), 
        body: JSON.stringify({ 
          userId, 
          wordId: { "__type": "Pointer", className: "Words", objectId: currentWord.objectId }, 
          status, 
          reviewCount: 1 
        }) 
      });
    }
  } catch (e) {
    showToast("保存学习记录失败");
  }
}

// ========== 界面交互 ==========
function switchMode(mode) {
  if (currentMode === mode || inWrongReview) return;
  currentMode = mode;
  document.querySelectorAll(".seg-btn").forEach(btn => 
    btn.classList.toggle("active", btn.dataset.mode === mode)
  );
  document.getElementById("segIndicator").style.transform = mode === "en" ? "translateX(0)" : "translateX(100%)";
  flipCard();
  renderWord();
}

function flipCard() { 
  const card = document.getElementById("card"); 
  if (!card) return;
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
  const memoryMethodInput = document.getElementById("memoryMethodInput");
  
  if (!primary || !meta || !meaning || !example || !root || !memoryMethodInput) return;
  
  expanded = false;
  document.getElementById("card").classList.remove("expanded");

  // 公共记忆法逻辑
  const memory = currentWord.memorymethod || currentWord.root || "";
  root.textContent = memory ? `词根词缀: ${memory}` : "词根词缀: 预留";
  memoryMethodInput.value = currentWord.memorymethod || "";

  // 渲染赋值
  const renderRule = modeRenderConfig[currentMode];
  if (renderRule) {
    primary.textContent = renderRule.primary();
    meta.textContent = renderRule.meta();
    meaning.textContent = renderRule.meaning();
    example.textContent = renderRule.example();
  }

  updateProgress();
}

function playAudio(event, slow = false) { 
  if (event) event.stopPropagation(); 
  if (!currentWord?.pronunciation) return alert("没有发音"); 
  const a = new Audio(currentWord.pronunciation); 
  a.playbackRate = slow ? 0.75 : 1;
  a.play();
}

async function saveMemoryMethod(event) {
  if (event) event.stopPropagation();
  if (!checkBmobAuth() || !currentWord?.objectId) return;
  const input = document.getElementById("memoryMethodInput");
  if (!input) return;
  const memorymethod = input.value.trim().slice(0, 300);
  try {
    await fetch(`${BASE_URL}/Words/${currentWord.objectId}`, {
      method: "PUT",
      headers: getHeaders(),
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
    if (!state.wrongWords.find(w => w.objectId === currentWord.objectId)) {
      state.wrongWords.push(currentWord);
    }
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
      showToast(`进入错词复习：${state.wrongWords.length} 个`); 
      currentWord = state.wrongWords[currentIndex]; 
      renderWord();
      return;
    }
    return openPassageTest(state.groupWords);
  }
  currentWord = queue[currentIndex];
  renderWord();
}

async function generatePassage(words) {
  const genKey = localStorage.getItem("genApiKey");
  if (!genKey) throw new Error("缺少API key");
  const wordPairs = words.map(w => `${w.word}: ${w.meaning}`).join("\n");
  const prompt = `请用以下10个英语单词写一个120词以内自然短文，要求：
1) 必须包含所有单词且每个只出现一次
2) 仅返回 JSON 格式 {"passage":"..."}
单词列表:
${wordPairs}`;
  
  const res = await fetch(`${GEN_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${genKey}` 
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
  const raw = data.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error("模型返回格式错误");
  }
  if (!parsed.passage || typeof parsed.passage !== "string") {
    throw new Error("模型返回格式错误");
  }
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
      const meaning = dict.get(key);
      span.title = meaning;
      span.style.cursor = "pointer";
      span.onclick = () => showToast(`${span.textContent}：${meaning}`);
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(p));
    }
  }
  
  const box = document.getElementById("passageContent");
  if (box) {
    box.textContent = "";
    box.appendChild(frag);
  }
}

async function savePassage(minitext) {
  if (!checkBmobAuth()) return;
  try {
    await fetch(`${BASE_URL}/shortpassage`, { 
      method: "POST", 
      headers: getHeaders(), 
      body: JSON.stringify({ minitext, userId, score: Date.now() }) 
    });
  } catch (e) {
    showToast("短文记录保存失败");
  }
}

async function openPassageTest(words) {
  const passageModal = document.getElementById("passageModal");
  const passageContent = document.getElementById("passageContent");
  
  if (!passageModal || !passageContent) return;
  
  passageModal.classList.remove("hidden");
  passageContent.textContent = "短文生成中...";
  pendingNextSession = true;
  
  try {
    const passage = await generatePassage(words);
    await savePassage(passage);
    renderPassageWithHighlights(passage, words);
  } catch (e) {
    passageContent.textContent = `短文生成失败：${e.message}。请检查API设置后再试。`;
  }
}

function closePassageModal(startNext = false) {
  const passageModal = document.getElementById("passageModal");
  if (passageModal) {
    passageModal.classList.add("hidden");
  }
  if (pendingNextSession && startNext) {
    pendingNextSession = false;
    startSession();
  }
}

async function openHistoryModal(event) {
  if (event) event.stopPropagation();
  const list = document.getElementById("historyList");
  if (!list) return;
  
  list.textContent = "加载中...";
  const historyModal = document.getElementById("historyModal");
  if (historyModal) {
    historyModal.classList.remove("hidden");
  }
  
  if (!checkBmobAuth()) {
    list.textContent = "无密钥，无法加载历史";
    return;
  }

  try {
    const where = encodeURIComponent(JSON.stringify({ userId }));
    const res = await fetch(`${BASE_URL}/shortpassage?where=${where}&order=-createdAt&limit=30`, { headers: getHeaders() });
    const data = await res.json();
    const rows = data.results || [];
    
    list.textContent = "";
    if (!rows.length) { 
      list.textContent = "暂无历史短文"; 
      return; 
    }
    
    rows.forEach(r => {
      const item = document.createElement("div");
      item.className = "history-item";
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = escapeHtml(r.createdAt || "");
      const text = document.createElement("div");
      text.textContent = escapeHtml(r.minitext || "");
      item.appendChild(time);
      item.appendChild(text);
      list.appendChild(item);
    });
  } catch (e) {
    list.textContent = "加载失败";
  }
}

function closeHistoryModal() { 
  const historyModal = document.getElementById("historyModal");
  if (historyModal) {
    historyModal.classList.add("hidden");
  }
}

function openSettingsModal() {
  const apiKeyInput = document.getElementById("apiKeyInput");
  if (apiKeyInput) {
    apiKeyInput.value = localStorage.getItem("genApiKey") || "";
  }
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.classList.remove("hidden");
  }
}

function closeSettingsModal() { 
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.classList.add("hidden");
  }
}

function saveApiKey() {
  const apiKeyInput = document.getElementById("apiKeyInput");
  if (!apiKeyInput) return;
  
  const key = apiKeyInput.value.trim();
  if (!key.startsWith("sk-")) {
    showToast("Key 格式不正确");
    return;
  }
  
  localStorage.setItem("genApiKey", key);
  closeSettingsModal();
  showToast("API Key 已保存");
}

function updateProgress() {
  const queue = inWrongReview ? state.wrongWords : state.groupWords;
  const done = Math.min(state.phaseDone, queue.length);
  const pct = queue.length ? (done / queue.length) * 100 : 0;
  const phase = inWrongReview ? "错词复习" : (currentMode === "en" ? "第一阶段 英→中" : "第二阶段 中→英");
  
  const progressText = document.getElementById("progressText");
  const progressBar = document.getElementById("progressBar");
  const sNew = document.getElementById("sNew");
  const sDone = document.getElementById("sDone");
  const sLeft = document.getElementById("sLeft");
  const sStreak = document.getElementById("sStreak");
  
  if (progressText) progressText.textContent = `${phase} · ${Math.min(currentIndex + 1, queue.length)}/${queue.length}`;
  if (progressBar) progressBar.style.width = `${pct}%`;
  if (sNew) sNew.textContent = state.todayNew;
  if (sDone) sDone.textContent = state.todayDone;
  if (sLeft) sLeft.textContent = Math.max(0, (GROUP_SIZE * 2) - state.todayDone);
  if (sStreak) sStreak.textContent = `${state.streak} 天`;
}

async function deleteWord(event) {
  if (event) event.stopPropagation();
  if (!checkBmobAuth() || !currentWord) return;
  if (!confirm(`确定删除单词：${currentWord.word} 吗？`)) return;
  
  try {
    await fetch(`${BASE_URL}/Words/${currentWord.objectId}`, { 
      method: "DELETE", 
      headers: getHeaders() 
    });
    state.groupWords = state.groupWords.filter(w => w.objectId !== currentWord.objectId);
    state.wrongWords = state.wrongWords.filter(w => w.objectId !== currentWord.objectId);
    
    const queue = inWrongReview ? state.wrongWords : state.groupWords;
    if (!queue.length) return startSession();
    if (currentIndex >= queue.length) currentIndex = queue.length - 1;
    
    currentWord = queue[currentIndex];
    renderWord();
  } catch (e) {
    showToast("删除单词失败");
  }
}

async function startSession() {
  // 启动先校验密钥
  if (!checkBmobAuth()) return;

  state.groupWords = await getWordGroup(GROUP_SIZE);
  state.wrongWords = [];
  currentMode = studyModes.EN_TO_CN;
  inWrongReview = false;
  currentIndex = 0;
  state.todayNew += state.groupWords.length;
  state.phaseDone = 0;
  
  const segIndicator = document.getElementById("segIndicator");
  if (segIndicator) {
    segIndicator.style.transform = "translateX(0)";
  }
  
  document.querySelectorAll(".seg-btn").forEach(btn => 
    btn.classList.toggle("active", btn.dataset.mode === "en")
  );
  
  currentWord = state.groupWords[0] || null;
  
  const progressText = document.getElementById("progressText");
  if (!currentWord) { 
    if (progressText) {
      progressText.textContent = "词库不足，请先补充单词";
    }
    return; 
  }
  
  renderWord();
}

// 启动
startSession();
