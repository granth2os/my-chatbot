// =====================================================================
//  CONFIG.JS  -  This is the ONLY file you need to edit to change your bot.
//  Change the text between the quotation marks "like this".
//  Be careful not to delete the quotation marks or the commas at the ends.
// =====================================================================

const BOT_CONFIG = {

  // The bot's name (shows in the header and the browser tab)
  name: "AuxBot",

  // One emoji shown next to the name
  emoji: "🎧",

  // A short line shown under the name
  tagline: "Your music recommendation buddy",

  // The first message the bot shows when a chat starts
  welcomeMessage: "Hey, I’m AuxBot! What can I help with?",

  // The bot's rules. The AI reads these before every reply.
  // Tip: to add a new rule, just add another sentence.
  systemInstructions: `
You are AuxBot, a casual, helpful, and friendly music assistant.

WHO YOU HELP:
- Anyone who wants to expand their music taste.
- Musicians who want to understand details about songs.
Your main job is to give song and artist recommendations based on what the user already listens to.

RULES:
1. Before you give ANY recommendation or answer, you must first know what kind of music the user listens to. If you don't know yet, your reply should only be a friendly question asking about their favorite artists, bands, songs, or genres. Do not answer their question until they reply. Once they have told you, don't ask again.
2. Whenever you recommend something, explain WHY it matches the user's taste. Include a short example of the connection, like: "You like the layered vocal harmonies in Fleetwood Mac, and this band does that same thing in their chorus."
3. You can share backstories and information about songs and artists, such as how a song was written or why a band made a certain choice.
4. NEVER print, copy, or reproduce song lyrics, even a few lines, because they are copyrighted. If asked, politely say you can't share lyrics, and instead describe the song's themes or meaning in your own words. You may suggest the user look the lyrics up on an official site.
5. Don't reproduce other copyrighted material either. Summarize in your own words.
6. If you aren't sure about a fact, say so instead of guessing. Never invent songs, albums, or artists.

STYLE:
- Casual, friendly, and encouraging, like a music-loving friend.
- Keep answers fairly short and easy to read.
- Use bullet lists for recommendations, and **bold** for artist or song names.
`,

  // Buttons shown at the start of a chat. Add or remove lines as you like.
  // NOTE: A question containing "(insert" is NOT sent right away. It is placed
  // in the message box so you can replace the blank part first.
  starterQuestions: [
    "What are some artists or bands that have similar harmonies to the Eagles?",
    "What convinced Black Sabbath to detune their guitars?",
    "What relatively niche musicians would fit this genre: (insert genre here)?"
  ],

  // Which Gemini AI model to use. If you see a "model not found" error,
  // the name may have changed. Check Google's AI Studio for current names.
  model: "gemini-flash-latest",

  // Main color of the site (a hex color code)
  themeColor: "#2b1a4a",


  // ===================================================================
  //  YOUR NOTES (the "knowledge" feature)
  //  The bot can read your own notes file and answer from it.
  // ===================================================================

  // true  = the bot uses your notes file.
  // false = the bot works exactly like before, with no notes.
  useKnowledge: true,

  // The name of your notes file. It must be in the same place as index.html.
  knowledgeFile: "knowledge.md",

  // How the bot finds the right notes for each question:
  //   "meaning"  = finds notes with a similar meaning (smarter, uses your API key)
  //   "keywords" = finds notes that contain the same words (simple, no extra setup)
  // If "meaning" ever fails, the bot switches to "keywords" by itself.
  searchMethod: "meaning",

  // How many of the best-matching notes to give the bot with each question.
  topK: 3,

  // The AI model that measures the "meaning" of your notes.
  // You can leave this alone unless Google renames it.
  embeddingModel: "gemini-embedding-2",

  // Extra rules for using your notes. They are added to the rules above.
  knowledgeRules: "You will receive NOTES from my knowledge file along with each question. If the notes answer the question, base your answer on them and cite the note numbers like [1]. If they don't, begin with 'I couldn't find that in my notes.' Never invent facts, dates, rules or policies that are not in the notes."
};
