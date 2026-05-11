const APP_ID = "1f1dcb2717bc41a2d196167508f83458";
const APP_KEY = "2efd06f7769a606544357909a7503793";
const BASE_URL = "https://api.codenow.cn/1/classes";
const GEN_BASE_URL = "https://shiyunapi.com/v1";
const CHEAP_MODEL = "deepseek-chat";
const GEN_API_KEY = "sk-Cc6RjpYaHQmyJctCxaJEVjOcroZCvQZTwe7PQRiXDBpGZcsd";
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

// 修复：删除重复的userId赋值，只保留一次
let userId = localStorage.getItem("userId");
if (!userId) {
  userId = (prompt("请输入用户名") || "").trim().slice(0, 32) || `guest_${Date.now()}`;
  localStorage.setItem("userId", userId);
}


function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return; // 安全检查
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}
//缓存占位符
function showLoading(text = "AI生成中...") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  const label = overlay.querySelector(".loading-text");
  if (label) label.textContent = text;

  overlay.classList.remove("hidden");
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  overlay.classList.add("hidden");
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
// 关闭新增单词弹窗
function closeModal() {
  const modal = document.getElementById("addWordModal");
  if (modal) {
    modal.classList.add("hidden");
  }
}
//保存单词
async function saveWord(status) {
  if (!currentWord) return;
  const where = encodeURIComponent(JSON.stringify({ userId, wordId: { "__type": "Pointer", className: "Words", objectId: currentWord.objectId } }));

const findRes = await fetch(
  `${BASE_URL}/userwords?where=${where}`,
  { headers });
console.log("userwords status:", findRes.status);
const findData = await findRes.json();
console.log("userwords response:", findData);

  
  if (findData.results?.length) {
    const record = findData.results[0];
    await fetch(`${BASE_URL}/userwords/${record.objectId}`, { method: "PUT", headers, body: JSON.stringify({ status, reviewCount: (record.reviewCount || 0) + 1 }) });
  } else {
    await fetch(`${BASE_URL}/userwords`, { method: "POST", headers, body: JSON.stringify({ userId, wordId: { "__type": "Pointer", className: "Words", objectId: currentWord.objectId }, status, reviewCount: 1 }) });
  }
}



//新增“保存进度”函数
async function saveStudyProgress() {
  const currentUserId = localStorage.getItem("userId");
  if (!currentUserId) return;

 const payload = {
  userId: currentUserId,
  currentIndex,
  currentMode,
  inWrongReview,

  todayDone: state.todayDone,
  todayNew: state.todayNew,
  streak: state.streak,

  groupWordIds: state.groupWords.map(
    w => w.objectId
  ),

  wrongWordIds: state.wrongWords.map(
    w => w.objectId
  )
};

  try {
    const where = encodeURIComponent(
      JSON.stringify({ userId: currentUserId })
    );

    // 先查有没有已有记录
    const res = await fetch(
      `${BASE_URL}/studyProgress?where=${where}`,
      { headers }
    );

    const data = await res.json();

    if (data.results?.length) {
      // 有记录 → 更新
      const objectId = data.results[0].objectId;

      await fetch(
        `${BASE_URL}/studyProgress/${objectId}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(payload)
        }
      );
    } else {
      // 没记录 → 新建
      await fetch(
        `${BASE_URL}/studyProgress`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        }
      );
    }

  } catch (err) {
    console.error("保存学习进度失败", err);
  }
}

//新增“恢复进度”函数
async function loadStudyProgress() {
  const currentUserId = localStorage.getItem("userId");

  if (!currentUserId) {
    return startSession();
  }

  try {
    const where = encodeURIComponent(
      JSON.stringify({ userId: currentUserId })
    );

    const res = await fetch(
      `${BASE_URL}/studyProgress?where=${where}`,
      { headers }
    );

    const data = await res.json();

    if (!data.results?.length) {
      return startSession();
    }

    const progress = data.results[0];

    currentIndex = progress.currentIndex || 0;
    currentMode = progress.currentMode || studyModes.EN_TO_CN;
    inWrongReview = progress.inWrongReview || false;

    state.todayDone = progress.todayDone || 0;
state.todayNew = progress.todayNew || 0;
state.streak = progress.streak || 1;

    const wordIds = progress.groupWordIds || [];
    const words = [];

    for (const id of wordIds) {
      const r = await fetch(
        `${BASE_URL}/Words/${id}`,
        { headers }
      );
      const w = await r.json();
      words.push(w);
    }

  state.groupWords = words;

// 恢复错词
const wrongIds =
  progress.wrongWordIds || [];

state.wrongWords =
  words.filter(w =>
    wrongIds.includes(
      w.objectId
    )
  );

const queue =
  inWrongReview
    ? state.wrongWords
    : state.groupWords;

currentWord =
  queue[currentIndex];

    renderWord();

  } catch (err) {
    console.error("恢复学习进度失败", err);
    startSession();
  }
}
//-----------------------------------
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
  if (!card) return;
  card.classList.remove("flip"); 
  void card.offsetWidth; 
  card.classList.add("flip"); 
}

function toggleExpand(event) {
  // 点击按钮、输入框、文本域时，不触发展开/收起
  if (
    event.target.closest("button") ||
    event.target.closest("input") ||
    event.target.closest("textarea")
  ) {
    return;
  }

  expanded = !expanded;
  document.getElementById("card").classList.toggle("expanded", expanded);
}

  
 // 模式配置映射，把两种模式的渲染规则写死在这里
// 渲染单词卡片
async function renderWord() {
  if (!currentWord) return;

  const primary = document.getElementById("primary");
  const meta = document.getElementById("meta");
  const meaning = document.getElementById("meaning");
  const example = document.getElementById("example");
  const root = document.getElementById("root");
  const memoryMethodInput = document.getElementById("memoryMethodInput");

  if (
    !primary ||
    !meta ||
    !meaning ||
    !example ||
    !root ||
    !memoryMethodInput
  ) return;

  expanded = false;
  document
    .getElementById("card")
    .classList.remove("expanded");

  // ===== 1. 查免费词典 =====
  const dictInfo = await fetchWordInfo(
    currentWord.word
  );

  // 保存发音地址
  window.currentAudioUrl =
    dictInfo.audio || "";

  // ===== 2. 自动生成词根联想（只生成一次）=====
  let memory =
    currentWord.memorymethod ||
    currentWord.root ||
    "";

  if (!memory) {
    root.textContent =
      "词根词缀: 生成中...";

  showLoading("正在生成词根记忆...");
const generated =
  await generateMemoryMethod(
    currentWord.word,
    currentWord.meaning
  );
hideLoading();

    if (generated) {
      memory = generated;

      // 更新当前对象
      currentWord.memorymethod =
        generated;

      // 写回数据库
      try {
        await fetch(
          `${BASE_URL}/Words/${currentWord.objectId}`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              memorymethod:
                generated
            })
          }
        );
      } catch (err) {
        console.error(
          "写回词根失败",
          err
        );
      }
    }
  }

  root.textContent = memory
    ? `词根词缀: ${memory}`
    : "词根词缀: 暂无";

  memoryMethodInput.value =
    memory;

  // ===== 3. 模式渲染 =====
  const modeRenderConfig = {
    [studyModes.EN_TO_CN]: {
      primary: () =>
        currentWord.word || "-",

      meta: () =>
        `${dictInfo.phonetic} ${dictInfo.pos}`.trim(),

      meaning: () =>
        currentWord.meaning ||
        "暂无释义",

      example: () =>
        dictInfo.example
          ? `例句: ${dictInfo.example}`
          : "例句: 暂无"
    },

    [studyModes.CN_TO_EN]: {
      primary: () =>
        currentWord.meaning ||
        "暂无释义",

      meta: () =>
        "先回忆英文，再点击查看",

      meaning: () =>
        `${currentWord.word || "-"} ${dictInfo.phonetic}`.trim(),

      example: () =>
        dictInfo.pos
          ? `词性: ${dictInfo.pos}`
          : "词性: 暂无"
    }
  };

  const renderRule =
    modeRenderConfig[currentMode];

  if (renderRule) {
    primary.textContent =
      renderRule.primary();

    meta.textContent =
      renderRule.meta();

    meaning.textContent =
      renderRule.meaning();

    example.textContent =
      renderRule.example();
  }

  updateProgress();
}


// 免费词典 API
async function fetchWordInfo(word) {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`
    );

    const data = await res.json();
    const entry = data[0];

    return {
      phonetic:
        entry.phonetic ||
        entry.phonetics?.find(
          x => x.text
        )?.text ||
        "",

      audio:
        entry.phonetics?.find(
          x => x.audio
        )?.audio ||
        "",

      pos:
        entry.meanings?.[0]
          ?.partOfSpeech || "",

      example:
        entry.meanings?.[0]
          ?.definitions?.find(
            x => x.example
          )?.example || ""
    };

  } catch (err) {
    console.error(
      "词典查询失败",
      err
    );

    return {
      phonetic: "",
      audio: "",
      pos: "",
      example: ""
    };
  }
}


// DeepSeek 自动生成词根联想
async function generateMemoryMethod(
  word,
  meaning
) {
const genKey = GEN_API_KEY;

  if (!genKey) {
    console.warn(
      "未设置生成 API Key"
    );
    return "";
  }

  try {
    const res = await fetch(
      "https://shiyunapi.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${genKey}`
        },
        body: JSON.stringify({
          model:
            "deepseek-chat",
          messages: [
            {
              role: "user",
              content:
                `请为英语单词 ${word}（意思：${meaning}）生成简短词根词缀联想记忆法，控制在30字以内，只返回结果，不要解释。`
            }
          ]
        })
      }
    );

    const data =
      await res.json();

    return (
      data.choices?.[0]
        ?.message?.content?.trim() ||
      ""
    );

  } catch (err) {
    console.error(
      "生成词根联想失败",
      err
    );

    return "";
  }
}


// 发音
function playPronunciation() {
  if (
    !window.currentAudioUrl
  ) {
    showToast(
      "没有发音"
    );
    return;
  }

  new Audio(
    window.currentAudioUrl
  ).play();
}
// 修复：删除重复变量声明，保留一个清晰的赋值流程
async function saveMemoryMethod(event) {
  if (event) event.stopPropagation();
  if (!currentWord?.objectId) return;
  const input = document.getElementById("memoryMethodInput");
  if (!input) return;
  const memorymethod = input.value.trim().slice(0, 300);
  try {
    await fetch(`${BASE_URL}/Words/${currentWord.objectId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ memorymethod })
    });
    currentWord.memorymethod = memorymethod;
   document.getElementById("root").textContent =memorymethod ? `词根词缀: ${memorymethod}` : "词根词缀: 预留";
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
await saveStudyProgress();
await nextWord();
}



async function nextWord() {
  currentIndex += 1;

  const queue =
    inWrongReview
      ? state.wrongWords
      : state.groupWords;

  if (currentIndex >= queue.length) {

    // 错词复习结束
    if (inWrongReview) {
      return openPassageTest(
        state.groupWords
      );
    }

    // 第一轮结束：切换到中→英
    if (
      currentMode ===
      studyModes.EN_TO_CN
    ) {
      currentMode =
        studyModes.CN_TO_EN;

      currentIndex = 0;
      state.phaseDone = 0;

      await saveStudyProgress();

      switchMode("cn");
      return;
    }

    // 第二轮结束：进入错词复习
    if (state.wrongWords.length) {
      inWrongReview = true;
      currentIndex = 0;

      await saveStudyProgress();

      showToast(
        "进入错词复习"
      );

      currentWord =
        state.wrongWords[
          currentIndex
        ];

      renderWord();
      return;
    }

    // 全部完成
    return openPassageTest(
      state.groupWords
    );
  }

  // 正常进入下一词
  currentWord =
    queue[currentIndex];

  renderWord();
}





// 修复：仅保留一个generatePassage函数，使用localStorage中的API Key
async function generatePassage(words) {
 const genKey = GEN_API_KEY;

  // 调试：看看有没有读到 key
  console.log("读取到 genKey:", genKey);

  if (!genKey) {
    throw new Error("缺少API key");
  }

  const wordPairs = words
    .map(w => `${w.word}: ${w.meaning}`)
    .join("\n");

  const prompt = `
请用以下10个英语单词写一个120词以内自然短文，要求：
1. 必须包含所有单词
2. 每个单词只出现一次
3. 只返回 JSON 格式：
{"passage":"短文内容"}

单词列表：
${wordPairs}
`;

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
        {
          role: "system",
          content: "You are a concise English writing assistant."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error("短文生成失败");
  }

  const data = await res.json();

  let raw =
    data.choices?.[0]?.message?.content?.trim() || "{}";

  // 修复：去掉 ```json ``` 包裹
  raw = raw
    .replace(/^```json/, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const parsed = JSON.parse(raw);

  if (!parsed.passage) {
    throw new Error("模型返回格式错误");
  }

  return parsed.passage;
}
// 修复：仅保留一个renderPassageWithHighlights函数，使用textContent避免XSS
function renderPassageWithHighlights(passage, words) {
  const dict = new Map(words.map(w => [String(w.word || "").toLowerCase(), w.meaning || "暂无释义"]));
  const frag = document.createDocumentFragment();
  const parts = String(passage || "").split(/(\b)/);
  
  for (const p of parts) {
    const key = p.toLowerCase().replace(/[^a-z'-]/gi, "");
    if (dict.has(key)) {
      const span = document.createElement("span");
      span.className = "hl-word";
      span.textContent = p; // 使用textContent而非innerHTML避免XSS
      const meaning = dict.get(key);
      span.title = meaning; // 使用title属性作为提示
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
  await fetch(`${BASE_URL}/shortpassage`, { method: "POST", headers, body: JSON.stringify({ minitext, userId, score: Date.now() }) });
}

// 修复：修复错误处理，避免无限递归
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
    hideLoading();
    passageContent.textContent = `短文生成失败：${e.message}。请检查 后再试。`;
    // 移除递归调用以避免无限循环
  }
}

function closePassageModal(startNext = false) {
  const passageModal =
    document.getElementById(
      "passageModal"
    );

  if (passageModal) {
    passageModal.classList.add(
      "hidden"
    );
  }

  if (
    pendingNextSession &&
    startNext
  ) {
    pendingNextSession = false;

    // 修复：不要恢复旧记录
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
  
  try {
    const where = encodeURIComponent(JSON.stringify({ userId }));
    const res = await fetch(`${BASE_URL}/shortpassage?where=${where}&order=-createdAt&limit=30`, { headers });
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
      time.textContent = escapeHtml(r.createdAt || ""); // 使用textContent避免XSS
      const text = document.createElement("div");
      text.textContent = escapeHtml(r.minitext || ""); // 使用textContent避免XSS
      item.appendChild(time);
      item.appendChild(text);
      list.appendChild(item);
    });
  } catch (e) {
    hideLoading();
    list.textContent = "加载失败";
  }
}

function closeHistoryModal() { 
  const historyModal = document.getElementById("historyModal");
  if (historyModal) {
    historyModal.classList.add("hidden");
  }
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
//添加单词
  function openAddWordModal(event) {
  if (event) event.stopPropagation();

  document
    .getElementById("addWordModal")
    .classList.remove("hidden");

  document
    .getElementById("newWordInput")
    .value = "";

  document
    .getElementById("newMeaningInput")
    .value = "";
}

function closeAddWordModal() {
  document
    .getElementById("addWordModal")
    .classList.add("hidden");
}


async function saveNewWord() {
  const word = document
    .getElementById("newWordInput")
    .value
    .trim()
    .toLowerCase();

  const meaning = document
    .getElementById("newMeaningInput")
    .value
    .trim();

  if (!word || !meaning) {
    showToast("请填写完整");
    return;
  }

  try {
    // 先查重
    const where =
      encodeURIComponent(
        JSON.stringify({
          word
        })
      );

    const checkRes =
      await fetch(
        `${BASE_URL}/Words?where=${where}`,
        { headers }
      );

    const checkData =
      await checkRes.json();

    if (
      checkData.results?.length
    ) {
      showToast(
        "单词已存在"
      );
      return;
    }

    // 保存
    await fetch(
      `${BASE_URL}/Words`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          word,
          meaning
        })
      }
    );

    showToast(
      "已加入单词库"
    );

    closeAddWordModal();

  } catch (err) {
    console.error(err);
    showToast(
      "添加失败"
    );
  }
}
async function startSession() {
  state.groupWords = await getWordGroup(GROUP_SIZE);
  state.wrongWords = [];
  currentMode = studyModes.EN_TO_CN;
  inWrongReview = false;
  currentIndex = 0;

  // 修复：不要累计
  state.todayNew = GROUP_SIZE;

  state.phaseDone = 0;

  const segIndicator = document.getElementById("segIndicator");
  if (segIndicator) {
    segIndicator.style.transform = "translateX(0)";
  }

  document.querySelectorAll(".seg-btn")
    .forEach(btn =>
      btn.classList.toggle(
        "active",
        btn.dataset.mode === "en"
      )
    );

  currentWord = state.groupWords[0] || null;

  if (!currentWord) {
    document.getElementById(
      "progressText"
    ).textContent = "词库不足，请先补充单词";
    return;
  }

  await saveStudyProgress();   // 新增
  renderWord();
}

loadStudyProgress();
