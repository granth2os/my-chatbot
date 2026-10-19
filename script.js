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
const statusEl    = document.getElementById("statusLine");

const KEY_NAME   = "gemini_api_key";
const CACHE_NAME = "auxbot_knowledge_cache_v1";
const API_BASE   = "https://generativelanguage.googleapis.com/v1beta/models/";

// The conversation so far (your plain questions and the bot's replies).
// The notes are NOT stored here. They are only added to the latest question.
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
  if (key) {
    saveKey(key, rememberBox.checked);
    // A new key was saved, so (re)start the notes setup
    kbReady = loadKnowledge();
  }
});

// =====================================================================
//  KNOWLEDGE (your notes file)
// =====================================================================

// Everything about the loaded notes lives here
let kb = { notes: [], vectors: null, mode: "keywords" };
let kbLoadId = 0;               // used to ignore out-of-date loads
let kbReady = Promise.resolve(); // lets a question wait until notes are ready

function setStatus(text) {
  statusEl.textContent = text;
}

function noteCountText(count) {
  return count + (count === 1 ? " note" : " notes");
}

function knowledgeIsOn() {
  return BOT_CONFIG.useKnowledge && kb.notes.length > 0;
}

// ---------- Reading the notes file ----------
// Each note starts with a line like "## Note title".
// Anything above the first "##" line is ignored.
// Notes longer than about 1,500 characters are split at blank lines.
function splitLong(body, maxLength) {
  if (body.length <= maxLength) return [body];

  const paragraphs = body.split(/\n\s*\n/);
  const chunks = [];
  let current = "";

  for (const p of paragraphs) {
    if (current && current.length + 2 + p.length > maxLength) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseNotes(raw) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const found = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      current = { title: match[1], lines: [] };
      found.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const notes = [];
  for (const item of found) {
    const body = item.lines.join("\n").trim();
    if (!body) continue; // skip notes with no text
    const parts = splitLong(body, 1500);
    parts.forEach((part, i) => {
      const title = parts.length > 1
        ? item.title + " (part " + (i + 1) + " of " + parts.length + ")"
        : item.title;
      notes.push({ title: title, text: part });
    });
  }
  return notes;
}

// ---------- A small "fingerprint" of the notes file ----------
// If the file changes, the fingerprint changes, and the notes are re-measured.
function makeFingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + "-" + text.length;
}

// ---------- Embeddings (turning text into numbers that capture meaning) ----------
function roundVector(values) {
  return values.map((v) => Math.round(v * 1e6) / 1e6);
}

async function embedTexts(texts, key) {
  const model = BOT_CONFIG.embeddingModel;
  const url = API_BASE + encodeURIComponent(model) + ":batchEmbedContents";
  const all = [];

  // At most 50 texts per request
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        requests: batch.map((t) => ({
          model: "models/" + model,
          content: { parts: [{ text: t }] }
        }))
      })
    });

    if (!response.ok) {
      const err = new Error("HTTP error");
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const list = data.embeddings || [];
    if (list.length !== batch.length) {
      throw new Error("Unexpected embedding response");
    }
    for (const item of list) all.push(roundVector(item.values));
  }
  return all;
}

// Get the notes' vectors from saved storage, or make them fresh
async function getVectors(fileText, notes, key) {
  const fingerprint = makeFingerprint(BOT_CONFIG.embeddingModel + "|" + fileText);

  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_NAME) || "null");
    if (
      saved &&
      saved.fingerprint === fingerprint &&
      Array.isArray(saved.vectors) &&
      saved.vectors.length === notes.length
    ) {
      return saved.vectors;
    }
  } catch (e) {}

  const texts = notes.map((n) => "title: " + n.title + " | text: " + n.text);
  const vectors = await embedTexts(texts, key);

  try {
    localStorage.setItem(CACHE_NAME, JSON.stringify({ fingerprint: fingerprint, vectors: vectors }));
  } catch (e) {}

  return vectors;
}

// ---------- Loading everything when the page opens ----------
async function loadKnowledge() {
  if (!BOT_CONFIG.useKnowledge) {
    setStatus("");
    return;
  }

  const myId = ++kbLoadId;
  kb = { notes: [], vectors: null, mode: "keywords" };
  setStatus("📚 Loading notes…");

  let fileText;
  try {
    const response = await fetch(BOT_CONFIG.knowledgeFile, { cache: "no-cache" });
    if (!response.ok) throw new Error("File not found");
    fileText = await response.text();
  } catch (e) {
    if (myId !== kbLoadId) return;
    setStatus(
      "⚠️ Couldn’t load " + BOT_CONFIG.knowledgeFile +
      ". Check the file name and that it’s in your repository next to index.html. " +
      "(Opening index.html by double-clicking also blocks this. Use your GitHub Pages link.) " +
      "Chatting without notes."
    );
    return;
  }
  if (myId !== kbLoadId) return;

  const notes = parseNotes(fileText);
  if (notes.length === 0) {
    setStatus(
      "⚠️ " + BOT_CONFIG.knowledgeFile +
      " was found, but it has no notes. Start each note with a line like “## Note title”. Chatting without notes."
    );
    return;
  }
  kb.notes = notes;
  const count = noteCountText(notes.length);

  if (BOT_CONFIG.searchMethod !== "meaning") {
    kb.mode = "keywords";
    setStatus("📚 " + count + " loaded · keyword search");
    return;
  }

  const key = getKey();
  if (!key) {
    setStatus("📚 " + count + " loaded · keyword search for now (add your API key for meaning search)");
    return;
  }

  setStatus("📚 " + count + " loaded · preparing meaning search…");
  try {
    const vectors = await getVectors(fileText, notes, key);
    if (myId !== kbLoadId) return;
    kb.vectors = vectors;
    kb.mode = "meaning";
    setStatus("📚 " + count + " loaded · meaning search");
  } catch (e) {
    if (myId !== kbLoadId) return;
    kb.vectors = null;
    kb.mode = "keywords";
    setStatus("📚 " + count + " loaded · keyword search (meaning search didn’t work)");
  }
}

// ---------- Finding the best notes for a question ----------
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOP_WORDS = new Set([
  "the", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was",
  "were", "be", "what", "which", "who", "how", "why", "when", "where", "do",
  "does", "did", "can", "you", "it", "this", "that", "with", "as", "at", "by",
  "from", "about", "me", "my", "your", "some", "any"
]);

function tokenize(text) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function keywordSearch(question, k) {
  const terms = Array.from(new Set(tokenize(question)));
  if (terms.length === 0) return [];

  const scored = kb.notes.map((note) => {
    const title = note.title.toLowerCase();
    const body = note.text.toLowerCase();
    let raw = 0;
    for (const term of terms) {
      if (title.includes(term)) raw += 3;
      const hits = body.split(term).length - 1;
      raw += Math.min(hits, 5);
    }
    return { title: note.title, text: note.text, score: Math.min(raw / (terms.length * 8), 1) };
  }).filter((n) => n.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

async function findNotes(question, key) {
  const k = Math.max(1, Number(BOT_CONFIG.topK) || 3);

  if (kb.mode === "meaning" && kb.vectors) {
    try {
      const result = await embedTexts(["task: search result | query: " + question], key);
      const queryVector = result[0];
      const scored = kb.notes.map((note, i) => ({
        title: note.title,
        text: note.text,
        score: cosine(queryVector, kb.vectors[i])
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    } catch (e) {
      // Meaning search failed, so switch to keyword search automatically
      kb.mode = "keywords";
      kb.vectors = null;
      setStatus("📚 " + noteCountText(kb.notes.length) + " loaded · keyword search (meaning search didn’t work)");
    }
  }

  return keywordSearch(question, k);
}

// ---------- Putting the notes together with the question ----------
function buildPrompt(question, notes) {
  let text = "NOTES:\n";
  if (notes.length === 0) {
    text += "(No matching notes were found.)\n";
  } else {
    notes.forEach((n, i) => {
      text += "[" + (i + 1) + "] " + n.title + "\n" + n.text + "\n\n";
    });
  }
  text += "\nQUESTION: " + question;
  return text;
}

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

// A small "Sources" section (click to open) under a reply
function addSources(bubble, notes) {
  if (!notes || notes.length === 0) return;

  const details = document.createElement("details");
  details.className = "sources";

  const summary = document.createElement("summary");
  summary.textContent = "Sources (" + notes.length + ")";
  details.appendChild(summary);

  notes.forEach((note, i) => {
    const item = document.createElement("div");
    item.className = "source";

    const title = document.createElement("div");
    title.className = "source-title";
    title.textContent = "[" + (i + 1) + "] " + note.title + " · score " + note.score.toFixed(2);

    const snippet = document.createElement("div");
    snippet.className = "source-text";
    snippet.textContent = note.text.length > 200
      ? note.text.slice(0, 200).trim() + "…"
      : note.text;

    item.appendChild(title);
    item.appendChild(snippet);
    details.appendChild(item);
  });

  bubble.appendChild(details);
  scrollToBottom();
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
async function askGemini(key, notes) {
  const url = API_BASE + encodeURIComponent(BOT_CONFIG.model) + ":generateContent";

  const useNotes = knowledgeIsOn();

  // Bot rules (plus the notes rules when notes are in use)
  const systemText = useNotes
    ? BOT_CONFIG.systemInstructions + "\n\n" + BOT_CONFIG.knowledgeRules
    : BOT_CONFIG.systemInstructions;

  // History holds only plain questions. The notes are added to the latest one.
  const contents = history.slice(0, -1);
  const lastQuestion = history[history.length - 1];
  if (useNotes) {
    contents.push({
      role: "user",
      parts: [{ text: buildPrompt(lastQuestion.parts[0].text, notes) }]
    });
  } else {
    contents.push(lastQuestion);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: contents
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
    // Find the best notes for this question (if notes are turned on)
    let usedNotes = [];
    if (BOT_CONFIG.useKnowledge) {
      await kbReady;
      if (knowledgeIsOn()) usedNotes = await findNotes(text, key);
    }

    const reply = await askGemini(key, usedNotes);
    thinkingBubble.remove();
    const bubble = addBubble("bot", reply);
    addSources(bubble, usedNotes);
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
kbReady = loadKnowledge();
