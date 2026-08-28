import "dotenv/config";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import cors from "cors";
import express from "express";
import sharp from "sharp";

const app = express();
const port = Number(process.env.PORT || 8787);
const endpoint = "https://opencode.ai/zen/go/v1/chat/completions";
const db = new Database("closetly.db");
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    personalization_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outfits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    item_ids_json TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    occasion TEXT NOT NULL,
    saved_at TEXT,
    worn_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outfit_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    rating TEXT NOT NULL,
    occasion TEXT NOT NULL,
    note TEXT NOT NULL,
    item_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wardrobe_items (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    type TEXT NOT NULL,
    color TEXT NOT NULL,
    brand TEXT,
    style_json TEXT NOT NULL,
    season_json TEXT NOT NULL,
    formality INTEGER NOT NULL,
    image TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    worn TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("personalization_json")) db.exec("ALTER TABLE users ADD COLUMN personalization_json TEXT NOT NULL DEFAULT '{}'");
const columns = db.prepare("PRAGMA table_info(wardrobe_items)").all().map((column) => column.name);
if (!columns.includes("archived")) db.exec("ALTER TABLE wardrobe_items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
if (!columns.includes("user_id")) db.exec("ALTER TABLE wardrobe_items ADD COLUMN user_id TEXT");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "30mb" }));

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function safeUser(user) {
  const saved = JSON.parse(user.personalization_json || "{}");
  return { id: user.id, name: user.name, email: user.email, createdAt: user.created_at, personalization: { skinTone: "", eyeColor: "", hairColor: "", preferredStyles: "", colorsToAvoid: "", fitPreference: "", styleBiography: "", completed: false, ...saved } };
}

function sessionUser(request) {
  const token = parseCookies(request).assmbl_session;
  if (!token) return null;
  return db.prepare("SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > ?").get(token, new Date().toISOString()) || null;
}

function requireUser(request, response, next) {
  const user = sessionUser(request);
  if (!user) return response.status(401).json({ error: "Sign in to continue." });
  request.user = user;
  next();
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, encoded) {
  const [salt, expected] = String(encoded).split(":");
  const actual = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function beginSession(response, userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(token, userId, expiresAt, new Date().toISOString());
  response.cookie("assmbl_session", token, { httpOnly: true, sameSite: "lax", maxAge: sessionTtlMs, secure: process.env.NODE_ENV === "production", path: "/" });
}

function clearSession(request, response) {
  const token = parseCookies(request).assmbl_session;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  response.clearCookie("assmbl_session", { path: "/" });
}

app.post("/api/auth/signup", (request, response) => {
  const name = String(request.body?.name || "").trim();
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");
  if (name.length < 2) return response.status(400).json({ error: "Please enter your name." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return response.status(400).json({ error: "Use at least 8 characters for your password." });
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return response.status(409).json({ error: "An account with that email already exists." });
  const user = { id: randomUUID(), name, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (@id, @name, @email, @passwordHash, @createdAt)").run(user);
    const unowned = db.prepare("SELECT COUNT(*) AS count FROM wardrobe_items WHERE user_id IS NULL").get().count;
    if (unowned && db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 1) db.prepare("UPDATE wardrobe_items SET user_id = ? WHERE user_id IS NULL").run(user.id);
  })();
  beginSession(response, user.id);
  response.status(201).json({ user: safeUser({ ...user, created_at: user.createdAt }) });
});

app.post("/api/auth/login", (request, response) => {
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !passwordMatches(password, user.password_hash)) return response.status(401).json({ error: "Email or password is incorrect." });
  beginSession(response, user.id);
  response.json({ user: safeUser(user) });
});

app.post("/api/auth/logout", (request, response) => {
  clearSession(request, response);
  response.status(204).end();
});

app.get("/api/auth/me", (request, response) => {
  const user = sessionUser(request);
  response.json({ user: user ? safeUser(user) : null });
});

app.patch("/api/profile", requireUser, (request, response) => {
  const name = String(request.body?.name || "").trim();
  if (name.length < 2) return response.status(400).json({ error: "Please enter your name." });
  const profile = request.body?.personalization || {};
  const personalization = { skinTone: String(profile.skinTone || "").slice(0, 80), eyeColor: String(profile.eyeColor || "").slice(0, 80), hairColor: String(profile.hairColor || "").slice(0, 80), preferredStyles: String(profile.preferredStyles || "").slice(0, 160), colorsToAvoid: String(profile.colorsToAvoid || "").slice(0, 160), fitPreference: String(profile.fitPreference || "").slice(0, 40), styleBiography: String(profile.styleBiography || "").slice(0, 500), completed: Boolean(profile.completed) };
  db.prepare("UPDATE users SET name = ?, personalization_json = ? WHERE id = ?").run(name, JSON.stringify(personalization), request.user.id);
  response.json({ user: safeUser(db.prepare("SELECT * FROM users WHERE id = ?").get(request.user.id)) });
});

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(candidate);
}

const typeCategoryRules = [
  ["Accessories", /watch|bracelet|necklace|ring|earring|sunglasses|glasses|hat|cap|beanie|belt|tie|scarf|wallet|bag|backpack|purse|glove/],
  ["Shoes", /sneaker|trainer|shoe|loafer|boot|sandal|slide|mule|heel|flat|derby|slipper/],
  ["Jackets", /jacket|coat|blazer|overshirt|parka|bomber|windbreaker|cardigan|vest|gilet|hoodie|sweater|jumper|knit|fleece/],
  ["Bottoms", /trouser|pants|chino|jeans|denim|shorts|swim|trunks|boardshort|jogger|sweatpant|cargo|legging|skirt/],
  ["Tops", /polo|t-?shirt|tee|shirt|button.?down|oxford shirt|henley|tank|vest top|blouse|crop top|top/]
];

function normalizeCategory(category, type, name) {
  const text = `${category || ""} ${type || ""} ${name || ""}`.toLowerCase();
  return typeCategoryRules.find(([, pattern]) => pattern.test(text))?.[0] || "Accessories";
}

function normalizeMetadata(metadata) {
  const type = String(metadata.type || metadata.name || "Clothing item").trim();
  const name = String(metadata.name || type || "Wardrobe piece").trim();
  return { name, category: normalizeCategory(metadata.category, type, name), type, color: String(metadata.color || "Unknown").trim(), brand: String(metadata.brand || "").trim(), style: Array.isArray(metadata.style) && metadata.style.length ? metadata.style.slice(0, 4).map(String) : ["Casual"], season: Array.isArray(metadata.season) && metadata.season.length ? metadata.season.slice(0, 4).map(String) : ["All year"], formality: Math.max(1, Math.min(5, Number(metadata.formality) || 2)) };
}

async function normalizeImage(image) {
  const match = String(image).match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Unsupported image format.");
  const output = await sharp(Buffer.from(match[2], "base64"), { failOn: "none" }).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

function rowToItem(row) {
  return { ...row, style: JSON.parse(row.style_json), season: JSON.parse(row.season_json), favorite: Boolean(row.favorite), archived: Boolean(row.archived) };
}

function rowToOutfit(row) {
  return { id: row.id, title: row.title, itemIds: JSON.parse(row.item_ids_json), reasoning: row.reasoning, occasion: row.occasion, createdAt: row.created_at, savedAt: row.saved_at, wornAt: row.worn_at };
}

function createItem(userId, image, metadata) {
  const normalized = normalizeMetadata(metadata);
  const item = { id: randomUUID(), userId, ...normalized, image, favorite: false, worn: null, archived: false, created_at: new Date().toISOString() };
  db.prepare("INSERT INTO wardrobe_items (id, user_id, name, category, type, color, brand, style_json, season_json, formality, image, favorite, worn, archived, created_at) VALUES (@id, @userId, @name, @category, @type, @color, @brand, @style_json, @season_json, @formality, @image, @favorite, @worn, @archived, @created_at)").run({ ...item, style_json: JSON.stringify(item.style), season_json: JSON.stringify(item.season), favorite: 0, archived: 0 });
  return item;
}

async function askOpenCode(messages, { maxTokens = 700, timeoutMs = 20000, model } = {}) {
  if (!process.env.OPENCODE_GO_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENCODE_GO_API_KEY}` }, body: JSON.stringify({ model: model || process.env.OPENCODE_MODEL || "deepseek-v4-flash", temperature: 0.45, max_tokens: maxTokens, messages }) });
    if (!response.ok) throw new Error(`OpenCode returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return (await response.json()).choices?.[0]?.message?.content || "";
  } finally { clearTimeout(timer); }
}

async function analyzeWardrobeImage(image) {
  const content = await askOpenCode([{ role: "system", content: "You catalogue one wardrobe item. Return ONLY valid JSON: {\"name\":\"specific descriptive item name\",\"category\":\"Tops|Bottoms|Shoes|Jackets|Accessories\",\"type\":\"controlled item type\",\"color\":\"specific visible colour(s)\",\"brand\":\"visible brand or empty string\",\"style\":[\"up to 3 styles\"],\"season\":[\"Spring\",\"Summer\",\"Autumn\",\"Winter\" or \"All year\"],\"formality\":1}. Watches are Accessories / Watch. Never invent a brand." }, { role: "user", content: [{ type: "text", text: "Identify the single most prominent clothing item in this photo." }, { type: "image_url", image_url: { url: image } }] }], { model: process.env.OPENCODE_VISION_MODEL || "deepseek-v4-flash-vision-exp", maxTokens: 900, timeoutMs: 35000 });
  return content ? normalizeMetadata(extractJson(content)) : null;
}

app.get("/api/status", (_request, response) => response.json({ connected: Boolean(process.env.OPENCODE_GO_API_KEY), model: process.env.OPENCODE_MODEL || "deepseek-v4-flash" }));
app.get("/api/wardrobe", requireUser, (request, response) => response.json({ items: db.prepare("SELECT * FROM wardrobe_items WHERE user_id = ? ORDER BY created_at DESC").all(request.user.id).map(rowToItem) }));

app.post("/api/wardrobe", requireUser, async (request, response) => {
  if (!request.body?.image) return response.status(400).json({ error: "An image is required." });
  try {
    const image = await normalizeImage(request.body.image);
    const metadata = await analyzeWardrobeImage(image);
    if (!metadata) return response.status(502).json({ error: "AI analysis did not return item details. Please try that photo again." });
    response.status(201).json({ item: createItem(request.user.id, image, metadata) });
  } catch { response.status(502).json({ error: "AI could not analyze that photo. Please try again with the item more clearly in frame." }); }
});

app.post("/api/wardrobe/:id/reanalyze", requireUser, async (request, response) => {
  const row = db.prepare("SELECT * FROM wardrobe_items WHERE id = ? AND user_id = ?").get(request.params.id, request.user.id);
  if (!row) return response.status(404).json({ error: "Item not found." });
  try {
    const metadata = await analyzeWardrobeImage(row.image);
    if (!metadata) return response.status(502).json({ error: "The vision model did not return item metadata." });
    db.prepare("UPDATE wardrobe_items SET name=@name, category=@category, type=@type, color=@color, brand=@brand, style_json=@style_json, season_json=@season_json, formality=@formality WHERE id=@id AND user_id=@userId").run({ ...metadata, id: row.id, userId: request.user.id, style_json: JSON.stringify(metadata.style), season_json: JSON.stringify(metadata.season) });
    response.json({ item: rowToItem(db.prepare("SELECT * FROM wardrobe_items WHERE id = ? AND user_id = ?").get(row.id, request.user.id)) });
  } catch { response.status(502).json({ error: "Could not reanalyze item." }); }
});

app.patch("/api/wardrobe/:id", requireUser, (request, response) => {
  const item = db.prepare("SELECT * FROM wardrobe_items WHERE id = ? AND user_id = ?").get(request.params.id, request.user.id);
  if (!item) return response.status(404).json({ error: "Item not found." });
  const body = request.body || {};
  const style = Array.isArray(body.style) ? body.style.map(String).slice(0, 8) : JSON.parse(item.style_json);
  const season = Array.isArray(body.season) ? body.season.map(String).slice(0, 8) : JSON.parse(item.season_json);
  const next = { name: body.name !== undefined ? String(body.name).trim() : item.name, category: body.category !== undefined ? normalizeCategory(body.category, body.type ?? item.type, body.name ?? item.name) : item.category, type: body.type !== undefined ? String(body.type).trim() : item.type, color: body.color !== undefined ? String(body.color).trim() : item.color, brand: body.brand !== undefined ? String(body.brand).trim() : item.brand, style, season, formality: body.formality !== undefined ? Math.max(1, Math.min(5, Number(body.formality) || 2)) : item.formality, favorite: typeof body.favorite === "boolean" ? Number(body.favorite) : item.favorite, archived: typeof body.archived === "boolean" ? Number(body.archived) : Number(item.archived) };
  db.prepare("UPDATE wardrobe_items SET name=@name, category=@category, type=@type, color=@color, brand=@brand, style_json=@style_json, season_json=@season_json, formality=@formality, favorite=@favorite, archived=@archived WHERE id=@id AND user_id=@userId").run({ ...next, id: item.id, userId: request.user.id, style_json: JSON.stringify(style), season_json: JSON.stringify(season) });
  response.json({ item: rowToItem(db.prepare("SELECT * FROM wardrobe_items WHERE id = ? AND user_id = ?").get(item.id, request.user.id)) });
});

app.delete("/api/wardrobe/:id", requireUser, (request, response) => { db.prepare("DELETE FROM wardrobe_items WHERE id = ? AND user_id = ?").run(request.params.id, request.user.id); response.status(204).end(); });

app.get("/api/outfits", requireUser, (request, response) => {
  const rows = db.prepare("SELECT * FROM outfits WHERE user_id = ? ORDER BY COALESCE(worn_at, saved_at, created_at) DESC").all(request.user.id).map(rowToOutfit);
  response.json({ saved: rows.filter((outfit) => outfit.savedAt), history: rows.filter((outfit) => outfit.wornAt) });
});

app.get("/api/outfit-feedback", requireUser, (request, response) => {
  const feedback = db.prepare("SELECT rating, occasion, note, item_ids_json FROM outfit_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").all(request.user.id)
    .map((entry) => ({ rating: entry.rating, occasion: entry.occasion, note: entry.note, itemIds: JSON.parse(entry.item_ids_json) }));
  response.json({ feedback });
});

app.post("/api/outfit-feedback", requireUser, (request, response) => {
  const rating = request.body?.rating === "like" ? "like" : request.body?.rating === "dislike" ? "dislike" : null;
  const itemIds = Array.isArray(request.body?.itemIds) ? request.body.itemIds.map(String).slice(0, 4) : [];
  if (!rating || !itemIds.length) return response.status(400).json({ error: "Feedback needs a rating and outfit pieces." });
  db.prepare("INSERT INTO outfit_feedback (id, user_id, rating, occasion, note, item_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), request.user.id, rating, String(request.body?.occasion || "Casual").slice(0, 60), String(request.body?.note || "").slice(0, 240), JSON.stringify(itemIds), new Date().toISOString());
  response.status(201).json({ ok: true });
});

app.post("/api/outfits", requireUser, (request, response) => {
  const action = request.body?.action === "wear" ? "wear" : "save";
  const timestampColumn = action === "wear" ? "worn_at" : "saved_at";
  const outfit = request.body?.outfit || {};
  const itemIds = Array.isArray(outfit.itemIds) ? outfit.itemIds.map(String).slice(0, 4) : [];
  if (!itemIds.length || !String(outfit.title || "").trim()) return response.status(400).json({ error: "A complete outfit is required." });
  const validItemCount = db.prepare(`SELECT COUNT(*) AS count FROM wardrobe_items WHERE user_id = ? AND archived = 0 AND id IN (${itemIds.map(() => "?").join(",")})`).get(request.user.id, ...itemIds).count;
  if (validItemCount !== itemIds.length) return response.status(400).json({ error: "An outfit can only contain items from your active wardrobe." });
  const existing = db.prepare("SELECT * FROM outfits WHERE id = ? AND user_id = ?").get(outfit.id, request.user.id);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE outfits SET title = ?, item_ids_json = ?, reasoning = ?, occasion = ?, ${timestampColumn} = ? WHERE id = ? AND user_id = ?`).run(String(outfit.title).trim(), JSON.stringify(itemIds), String(outfit.reasoning || ""), String(outfit.occasion || "Casual"), now, outfit.id, request.user.id);
  } else {
    db.prepare(`INSERT INTO outfits (id, user_id, title, item_ids_json, reasoning, occasion, ${timestampColumn}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(outfit.id || randomUUID()), request.user.id, String(outfit.title).trim(), JSON.stringify(itemIds), String(outfit.reasoning || ""), String(outfit.occasion || "Casual"), now, now);
  }
  response.status(201).json({ outfit: rowToOutfit(db.prepare("SELECT * FROM outfits WHERE id = ? AND user_id = ?").get(outfit.id, request.user.id)) });
});

app.post("/api/outfit", requireUser, async (request, response) => {
  const { occasion, note, weather, personalization, wardrobe, feedback, excludedItemIds, previousItemSets } = request.body;
  try {
    const content = await askOpenCode([{ role: "system", content: "You are an inventive personal stylist. Build a complete, original fit using only wardrobe ids supplied by the user. The note is a creative brief, not a label: infer the venue, companions, mood, ambience, desired impression, climate, movement, and level of polish. Use the detailed style biography, personal preferences, and likes/dislikes as meaningful input. Do not reduce a person's style to appearance traits. Prioritize intentional colour harmony, silhouette, texture, and the full context over rigid occasion templates. Never pair navy or very dark blue with black/charcoal trousers unless a distinct lighter contrast layer makes the combination clearly intentional. Return ONLY JSON: {itemIds:string[], title:string, reasoning:string}. Pick 2-4 pieces. Make the title specific to the plan. In reasoning, explicitly explain the venue/context and the colour/silhouette decisions, without generic filler. Previous looks should be avoided when the wardrobe permits; never use excludedItemIds." }, { role: "user", content: JSON.stringify({ occasion, note, weather, personalization, wardrobe, feedback, excludedItemIds, previousItemSets }) }], { maxTokens: 700, timeoutMs: 20000 });
    response.json(content ? { demo: false, outfit: extractJson(content) } : { demo: true });
  } catch { response.status(502).json({ error: "Could not create an outfit." }); }
});

const server = app.listen(port, () => console.log(`assmbl API listening on ${port}`));
server.on("error", (error) => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use.` : `API failed to start: ${error.message}`); process.exit(1); });
