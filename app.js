// 🔑 换成你的
const APP_ID = "1f1dcb2717bc41a2d196167508f83458";
const APP_KEY = "2efd06f7769a606544357909a7503793";

const BASE_URL = "https://api.codenow.cn/1/classes";

const headers = {
  "X-Bmob-Application-Id": APP_ID,
  "X-Bmob-REST-API-Key": APP_KEY,
  "Content-Type": "application/json"
};

let currentWord = null;

// 👤 登录
let userId = localStorage.getItem("userId");
if (!userId) {
  userId = prompt("请输入用户名");
  localStorage.setItem("userId", userId);
}

// 📥 获取随机单词
async function getRandomWord() {
  const skip = Math.floor(Math.random() * 50);

  const res = await fetch(
    `${BASE_URL}/Words?limit=1&skip=${skip}`,
    { headers }
  );

  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    alert("没有单词了");
    return null;
  }

  return data.results[0];
}

// 📥 查询是否学过
async function checkWord(wordId) {
  const where = encodeURIComponent(JSON.stringify({
    userId: userId,
    wordId: {
      "__type": "Pointer",
      "className": "Words",
      "objectId": wordId
    }
  }));

  const res = await fetch(
    `${BASE_URL}/userwords?where=${where}`,
    { headers }
  );

  const data = await res.json();
  return data.results;
}

// 💾 保存记录
async function saveWord(status) {
  if (!currentWord) return;

  const wordId = currentWord.objectId;

  const existing = await checkWord(wordId);

  if (existing.length > 0) {
    const record = existing[0];

    await fetch(
      `${BASE_URL}/userwords/${record.objectId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          status: status,
          reviewCount: (record.reviewCount || 0) + 1
        })
      }
    );

  } else {
    await fetch(`${BASE_URL}/userwords`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        userId: userId,
        wordId: {
          "__type": "Pointer",
          "className": "Words",
          "objectId": wordId
        },
        status: status,
        reviewCount: 1
      })
    });
  }
}

// 🗑 删除单词
async function deleteWord() {
  if (!currentWord) return;

  const confirmDelete = confirm(`确定删除单词：${currentWord.word} 吗？`);
  if (!confirmDelete) return;

  try {
    await fetch(
      `${BASE_URL}/Words/${currentWord.objectId}`,
      {
        method: "DELETE",
        headers
      }
    );

    alert("删除成功");
    loadWord();

  } catch (err) {
    console.error(err);
    alert("删除失败");
  }
}

// 🎯 加载单词
async function loadWord() {
  const word = await getRandomWord();
  if (!word) return;

  currentWord = word;

  document.getElementById("word").innerText = word.word;
  document.getElementById("ipa").innerText = word.IPA || "";
  document.getElementById("pos").innerText = word.pos || "";
  document.getElementById("meaning").innerText = word.meaning || "";

  document.getElementById("meaning").classList.add("hidden");
}

// 👆 点击卡片显示释义
function toggleMeaning() {
  document.getElementById("meaning").classList.toggle("hidden");
}

// 🔊 发音（重点：使用 pronunciation 字段）
function playAudio(event) {
  event.stopPropagation(); // 防止触发翻卡

  if (!currentWord || !currentWord.pronunciation) {
    alert("没有发音");
    return;
  }

  try {
    const audio = new Audio(currentWord.pronunciation);
    audio.play();
  } catch (err) {
    console.error(err);
    alert("发音播放失败");
  }
}

// ✅ / ❌ 点击
async function handle(status, event) {
  if (event) event.stopPropagation();

  await saveWord(status);
  loadWord();
}

// 🚀 初始化
loadWord();
