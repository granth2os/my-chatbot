// =====================================================================
//  SCRIPT.JS  -  The code that makes the chatbot work.
//  You don't need to edit this file. Change your bot in config.js instead.
// =====================================================================

// ---------- Grab the pieces of the page ----------
const messagesEl  = document.getElementById("messages");
const startersEl  = document.getElementById("starters");
const composerEl  = document.getElementById("composer");
const inputEl     = document.getElementById("input");
const sendBtn     = document.getElementById("sendBtn");
const newChatBtn  = document.getElementById("newChatBtn");
const keyBtn      = document.getElementById("keyBtn");
const keyDialog   = document.getElementById("keyDialog");
const keyForm     = document.getElementById("keyForm");
const keyInput    = document.getElementById("keyInput");
const rememberBox = document.getElementById("rememberBox");
const keyCancel   = document.getElementById("keyCancel");
const keyClear    = document.getElementById("keyClear");

const KEY_NAME = "gemini_api_key";

// The conversation so far, in the format Gemini expects
let history = [];
let isBusy = false;

// ---------- Apply settings from config.js ----------
document.title = BOT_CONFIG.name;
document.getElementById("botName").textContent = BOT_CONFIG.name;
document.getElementById("botEmoji").textContent = BOT_CONFIG.emoji;
document.getElementById("botTagline").textContent = BOT_CONFIG.tagline;
document.documentElement.style.setProperty("--brand", BOT_CONFIG.themeColor);

// ---------- Saving and loading the API key ----------
function getKey() {
  try {
    return sessionStorage.getItem(KEY_NAME) || localStorage.getItem(KEY_NAME) || "";
  } catch (e) {
    return "";
  }
}

function saveKey(key, remember) {
  try { sessionStorage.setItem(KEY_NAME, key); } catch (e) {}
  try {
    if (remember) localStorage.setItem(KEY_NAME, key);
    else localStorage.removeItem(KEY_NAME);
  } catch (e) {}
}

function removeKey() {
  try { sessionStorage.removeItem(KEY_NAME); } catch (e) {}
  try { localStorage.removeItem(KEY_NAME); } catch (e) {}
}

function isRemembered() {
  try { return !!localStorage.getItem(KEY_NAME); } catch (e) { return false; }
}

// ---------- API key pop-up ----------
function openKeyDialog() {
  keyInput.value = getKey();
  rememberBox.checked = isRemembered();
  keyDialog.showModal();
  keyInput.focus();
}

keyBtn.addEventListener("click", openKeyDialog);
keyCancel.addEventListener("click", () => keyDialog.close());

keyClear.addEventListener("click", () => {
  removeKey();
  keyInput.value = "";
  rememberBox.checked = false;
  keyDialog.close();
});

keyForm.addEventListener("submit", () => {
  const key = keyInput.value.trim();
  if (key) saveKey(key, rememberBox.checked);
});

// ---------- Safe text formatting ----------
// Step 1: escape HTML so nothing sneaky can run.
// Step 2: turn **bold** and bullet lines into simple HTML.
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function formatText(raw) {
  const lines = escapeHtml(raw).split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + applyBold(bullet[1]) + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim() !== "") html += "<p>" + applyBold(line) + "</p>";
    }
  }
  if (inList) html += "</ul>";
  return html;
}

// ---------- Showing messages ----------
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(kind, text) {
  const div = document.createElement("div");
  div.className = "bubble " + kind;
  if (kind === "user") {
    div.textContent = text;            // user text is shown as plain text
  } else if (kind === "bot") {
    div.innerHTML = formatText(text);  // escaped first, then formatted
  } else {
    div.textContent = text;            // error messages
  }
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function addThinking() {
  const div = document.createElement("div");
  div.className = "bubble bot";
  div.innerHTML = '<div class="thinking" aria-label="Thinking"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

// ---------- Starter question buttons ----------
function showStarters() {
  startersEl.innerHTML = "";
  for (const question of BOT_CONFIG.starterQuestions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "starter";
    btn.textContent = question;
    btn.addEventListener("click", () => {
      if (question.includes("(insert")) {
        // Has a blank to fill in, so let the user edit it first
        inputEl.value = question;
        autoResize();
        inputEl.focus();
      } else {
        sendMessage(question);
      }
    });
    startersEl.appendChild(btn);
  }
}

function hideStarters() {
  startersEl.innerHTML = "";
}

// ---------- Friendly error messages ----------
function errorForStatus(status) {
  if (status === 400 || status === 403) {
    return "Hmm, Google didn't accept your API key. Click the “API key” button and check that you pasted it correctly.";
  }
  if (status === 404) {
    return "That AI model name wasn't found. Open config.js and check the “model” line.";
  }
  if (status === 429) {
    return "Too many requests right now. Wait a minute and try again.";
  }
  if (status >= 500) {
    return "Google's server is having trouble. Please try again in a bit.";
  }
  return "Something went wrong (error " + status + "). Please try again.";
}

// ---------- Talking to Gemini ----------
async function askGemini(key) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(BOT_CONFIG.model) +
    ":generateContent";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: BOT_CONFIG.systemInstructions }] },
      contents: history
    })
  });

  if (!response.ok) {
    const err = new Error("HTTP error");
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];

  // Join the text parts, skipping any "thought" parts
  const text = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");

  if (!text.trim()) {
    const err = new Error("Empty reply");
    err.empty = true;
    throw err;
  }
  return text;
}

// ---------- Sending a message ----------
async function sendMessage(text) {
  text = (text || "").trim();
  if (!text || isBusy) return;

  const key = getKey();
  if (!key) {
    // Keep what they typed, ask for the key first
    inputEl.value = text;
    autoResize();
    openKeyDialog();
    return;
  }

  isBusy = true;
  sendBtn.disabled = true;
  hideStarters();

  addBubble("user", text);
  history.push({ role: "user", parts: [{ text: text }] });
  inputEl.value = "";
  autoResize();

  const thinkingBubble = addThinking();

  try {
    const reply = await askGemini(key);
    thinkingBubble.remove();
    addBubble("bot", reply);
    history.push({ role: "model", parts: [{ text: reply }] });
  } catch (err) {
    thinkingBubble.remove();
    history.pop(); // remove the failed question so the chat stays in order

    let message;
    if (err.status) {
      message = errorForStatus(err.status);
    } else if (err.empty) {
      message = "I didn't get an answer back. Try rephrasing your message.";
    } else {
      message = "I can't reach the internet right now. Check your connection and try again.";
    }
    addBubble("error", message);
  } finally {
    isBusy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ---------- Typing box behavior ----------
function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}

inputEl.addEventListener("input", autoResize);

// Enter sends, Shift+Enter makes a new line
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});

composerEl.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(inputEl.value);
});

// ---------- New chat ----------
function startNewChat() {
  history = [];
  isBusy = false;
  sendBtn.disabled = false;
  messagesEl.innerHTML = "";
  addBubble("bot", BOT_CONFIG.welcomeMessage);
  showStarters();
  inputEl.value = "";
  autoResize();
}

newChatBtn.addEventListener("click", startNewChat);

// ---------- Start ----------
startNewChat();
