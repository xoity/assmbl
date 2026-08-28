import "dotenv/config";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pg from "pg";
import sharp from "sharp";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === "production";
const endpoint = "https://opencode.ai/zen/go/v1/chat/completions";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || (isProduction ? "https://assmbl.abukhader.cloud" : "http://localhost:5173,http://127.0.0.1:5173"))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const turnstileHostnames = (process.env.TURNSTILE_HOSTNAMES || (isProduction ? "assmbl.abukhader.cloud" : "localhost,127.0.0.1"))
  .split(",")
  .map((hostname) => hostname.trim())
  .filter(Boolean);

if (isProduction && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in production.");
if (process.env.TRUST_PROXY !== "false") app.set("trust proxy", 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/assmbl",
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  await pool.query(`
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
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outfits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating TEXT NOT NULL,
      occasion TEXT NOT NULL,
      note TEXT NOT NULL,
      item_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wardrobe_items (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT NOT NULL,
      brand TEXT,
      style_json TEXT NOT NULL,
      season_json TEXT NOT NULL,
      formality INTEGER NOT NULL,
      image TEXT NOT NULL,
      favorite BOOLEAN NOT NULL DEFAULT false,
      worn TEXT,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_wardrobe_items_user_id ON wardrobe_items(user_id, archived, created_at);
    CREATE INDEX IF NOT EXISTS idx_outfits_user_id ON outfits(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_outfit_feedback_user_id ON outfit_feedback(user_id, created_at);
  `);
  await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [new Date().toISOString()]);
}

async function one(text, params = []) {
  return (await pool.query(text, params)).rows[0] || null;
}

async function many(text, params = []) {
  return (await pool.query(text, params)).rows;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'"], frameSrc: ["'self'", "https://challenges.cloudflare.com"], imgSrc: ["'self'", "data:", "https://images.unsplash.com"], styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"], fontSrc: ["'self'", "https://fonts.gstatic.com"], scriptSrc: ["'self'", "https://challenges.cloudflare.com"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: isProduction ? [] : null } } }));
app.use(compression());
app.use(cors({ origin: (origin, callback) => callback(isAllowedOrigin(origin) ? null : new Error("Origin is not allowed."), origin || false), credentials: true }));
app.use((request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || isAllowedOrigin(request.headers.origin)) return next();
  return response.status(403).json({ error: "Origin is not allowed." });
});
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 450, standardHeaders: "draft-8", legacyHeaders: false }));
app.use("/api/auth/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many sign-in attempts. Please wait a few minutes." } }));
const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many AI requests. Please wait a few minutes." } });
app.use(express.json({ limit: "30mb" }));

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function safeUser(user) {
  const saved = JSON.parse(user.personalization_json || "{}");
  return { id: user.id, name: user.name, email: user.email, createdAt: user.created_at, personalization: { skinTone: "", eyeColor: "", hairColor: "", preferredStyles: "", colorsToAvoid: "", fitPreference: "", styleBiography: "", completed: false, ...saved } };
}

async function sessionUser(request) {
  const token = parseCookies(request).assmbl_session;
  if (!token) return null;
  return one("SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = $1 AND sessions.expires_at > $2", [token, new Date().toISOString()]);
}

async function requireUser(request, response, next) {
  const user = await sessionUser(request);
  if (!user) return response.status(401).json({ error: "Sign in to continue." });
  request.user = user;
  return next();
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, encoded) {
  const [salt, expected] = String(encoded).split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

async function beginSession(response, userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  await pool.query("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)", [token, userId, expiresAt, new Date().toISOString()]);
  response.cookie("assmbl_session", token, { httpOnly: true, sameSite: "lax", maxAge: sessionTtlMs, secure: isProduction, path: "/" });
}

async function clearSession(request, response) {
  const token = parseCookies(request).assmbl_session;
  if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  response.clearCookie("assmbl_session", { path: "/" });
}

async function verifyTurnstile(request, response, expectedAction) {
  const token = request.body?.["cf-turnstile-response"];
  if (typeof token !== "string" || token.length === 0 || token.length > 2048 || !process.env.TURNSTILE_SECRET || turnstileHostnames.length === 0) {
    response.status(403).json({ error: "Complete the security check and try again." });
    return false;
  }
  try {
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token, remoteip: request.ip })
    });
    if (!verification.ok) throw new Error(`siteverify ${verification.status}`);
    const result = await verification.json();
    if (result.success === true && result.action === expectedAction && turnstileHostnames.includes(result.hostname)) return true;
  } catch (error) {
    console.error(error);
  }
  response.status(403).json({ error: "Complete the security check and try again." });
  return false;
}

app.post("/api/auth/signup", async (request, response, next) => {
  if (!await verifyTurnstile(request, response, "signup")) return;
  const name = String(request.body?.name || "").trim();
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");
  if (name.length < 2) return response.status(400).json({ error: "Please enter your name." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return response.status(400).json({ error: "Use at least 8 characters for your password." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if ((await client.query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount) {
      await client.query("ROLLBACK");
      return response.status(409).json({ error: "An account with that email already exists." });
    }
    const user = { id: randomUUID(), name, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    await client.query("INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [user.id, user.name, user.email, user.passwordHash, user.createdAt]);
    const unowned = Number((await client.query("SELECT COUNT(*) AS count FROM wardrobe_items WHERE user_id IS NULL")).rows[0].count);
    const userCount = Number((await client.query("SELECT COUNT(*) AS count FROM users")).rows[0].count);
    if (unowned && userCount === 1) await client.query("UPDATE wardrobe_items SET user_id = $1 WHERE user_id IS NULL", [user.id]);
    await client.query("COMMIT");
    await beginSession(response, user.id);
    return response.status(201).json({ user: safeUser({ ...user, created_at: user.createdAt, personalization_json: "{}" }) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (request, response) => {
  if (!await verifyTurnstile(request, response, "login")) return;
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");
  const user = await one("SELECT * FROM users WHERE email = $1", [email]);
  if (!user || !passwordMatches(password, user.password_hash)) return response.status(401).json({ error: "Email or password is incorrect." });
  await beginSession(response, user.id);
  return response.json({ user: safeUser(user) });
});

app.post("/api/auth/logout", async (request, response) => {
  await clearSession(request, response);
  response.status(204).end();
});

app.get("/api/auth/me", async (request, response) => {
  const user = await sessionUser(request);
  response.json({ user: user ? safeUser(user) : null });
});

app.patch("/api/profile", requireUser, async (request, response) => {
  const name = String(request.body?.name || "").trim();
  if (name.length < 2) return response.status(400).json({ error: "Please enter your name." });
  const profile = request.body?.personalization || {};
  const personalization = { skinTone: String(profile.skinTone || "").slice(0, 80), eyeColor: String(profile.eyeColor || "").slice(0, 80), hairColor: String(profile.hairColor || "").slice(0, 80), preferredStyles: String(profile.preferredStyles || "").slice(0, 160), colorsToAvoid: String(profile.colorsToAvoid || "").slice(0, 160), fitPreference: String(profile.fitPreference || "").slice(0, 40), styleBiography: String(profile.styleBiography || "").slice(0, 500), completed: Boolean(profile.completed) };
  const user = await one("UPDATE users SET name = $1, personalization_json = $2 WHERE id = $3 RETURNING *", [name, JSON.stringify(personalization), request.user.id]);
  response.json({ user: safeUser(user) });
});

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(candidate);
}

const typeCategoryRules = [
  ["Bottoms", /trouser|pants|chino|jeans|denim|shorts|swim|trunks|boardshort|jogger|sweatpant|cargo|legging|skirt/],
  ["Tops", /polo|t-?shirt|tee|shirt|button.?down|oxford shirt|henley|tank|vest top|blouse|crop top|top/],
  ["Shoes", /sneaker|trainer|shoe|loafer|boot|sandal|slide|mule|heel|flat|derby|slipper/],
  ["Jackets", /jacket|coat|blazer|overshirt|parka|bomber|windbreaker|cardigan|vest|gilet|hoodie|sweater|jumper|knit|fleece/],
  ["Accessories", /watch|bracelet|necklace|ring|earring|sunglasses|glasses|hat|cap|beanie|belt|tie|scarf|wallet|bag|backpack|purse|glove/]
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
  return { ...row, category: normalizeCategory(row.category, row.type, row.name), style: JSON.parse(row.style_json), season: JSON.parse(row.season_json), favorite: Boolean(row.favorite), archived: Boolean(row.archived) };
}

function rowToOutfit(row) {
  return { id: row.id, title: row.title, itemIds: JSON.parse(row.item_ids_json), reasoning: row.reasoning, occasion: row.occasion, createdAt: row.created_at, savedAt: row.saved_at, wornAt: row.worn_at };
}

async function createItem(userId, image, metadata) {
  const normalized = normalizeMetadata(metadata);
  const item = { id: randomUUID(), userId, ...normalized, image, favorite: false, worn: null, archived: false, created_at: new Date().toISOString() };
  const row = await one("INSERT INTO wardrobe_items (id, user_id, name, category, type, color, brand, style_json, season_json, formality, image, favorite, worn, archived, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *", [item.id, item.userId, item.name, item.category, item.type, item.color, item.brand, JSON.stringify(item.style), JSON.stringify(item.season), item.formality, item.image, item.favorite, item.worn, item.archived, item.created_at]);
  return rowToItem(row);
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

app.get("/healthz", async (_request, response) => {
  await pool.query("SELECT 1");
  response.json({ ok: true });
});
app.get("/api/status", (_request, response) => response.json({ connected: Boolean(process.env.OPENCODE_GO_API_KEY), model: process.env.OPENCODE_MODEL || "deepseek-v4-flash" }));
app.get("/api/wardrobe", requireUser, async (request, response) => response.json({ items: (await many("SELECT * FROM wardrobe_items WHERE user_id = $1 ORDER BY created_at DESC", [request.user.id])).map(rowToItem) }));

app.post("/api/wardrobe", aiLimiter, requireUser, async (request, response) => {
  if (!request.body?.image) return response.status(400).json({ error: "An image is required." });
  try {
    const image = await normalizeImage(request.body.image);
    const metadata = await analyzeWardrobeImage(image);
    if (!metadata) return response.status(502).json({ error: "AI analysis did not return item details. Please try that photo again." });
    response.status(201).json({ item: await createItem(request.user.id, image, metadata) });
  } catch { response.status(502).json({ error: "AI could not analyze that photo. Please try again with the item more clearly in frame." }); }
});

app.post("/api/wardrobe/:id/reanalyze", aiLimiter, requireUser, async (request, response) => {
  const row = await one("SELECT * FROM wardrobe_items WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
  if (!row) return response.status(404).json({ error: "Item not found." });
  try {
    const metadata = await analyzeWardrobeImage(row.image);
    if (!metadata) return response.status(502).json({ error: "The vision model did not return item metadata." });
    const item = await one("UPDATE wardrobe_items SET name=$1, category=$2, type=$3, color=$4, brand=$5, style_json=$6, season_json=$7, formality=$8 WHERE id=$9 AND user_id=$10 RETURNING *", [metadata.name, metadata.category, metadata.type, metadata.color, metadata.brand, JSON.stringify(metadata.style), JSON.stringify(metadata.season), metadata.formality, row.id, request.user.id]);
    response.json({ item: rowToItem(item) });
  } catch { response.status(502).json({ error: "Could not reanalyze item." }); }
});

app.patch("/api/wardrobe/:id", requireUser, async (request, response) => {
  const item = await one("SELECT * FROM wardrobe_items WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
  if (!item) return response.status(404).json({ error: "Item not found." });
  const body = request.body || {};
  const style = Array.isArray(body.style) ? body.style.map(String).slice(0, 8) : JSON.parse(item.style_json);
  const season = Array.isArray(body.season) ? body.season.map(String).slice(0, 8) : JSON.parse(item.season_json);
  const next = { name: body.name !== undefined ? String(body.name).trim() : item.name, category: body.category !== undefined ? normalizeCategory(body.category, body.type ?? item.type, body.name ?? item.name) : item.category, type: body.type !== undefined ? String(body.type).trim() : item.type, color: body.color !== undefined ? String(body.color).trim() : item.color, brand: body.brand !== undefined ? String(body.brand).trim() : item.brand, style, season, formality: body.formality !== undefined ? Math.max(1, Math.min(5, Number(body.formality) || 2)) : item.formality, favorite: typeof body.favorite === "boolean" ? body.favorite : Boolean(item.favorite), archived: typeof body.archived === "boolean" ? body.archived : Boolean(item.archived) };
  const row = await one("UPDATE wardrobe_items SET name=$1, category=$2, type=$3, color=$4, brand=$5, style_json=$6, season_json=$7, formality=$8, favorite=$9, archived=$10 WHERE id=$11 AND user_id=$12 RETURNING *", [next.name, next.category, next.type, next.color, next.brand, JSON.stringify(style), JSON.stringify(season), next.formality, next.favorite, next.archived, item.id, request.user.id]);
  response.json({ item: rowToItem(row) });
});

app.delete("/api/wardrobe/:id", requireUser, async (request, response) => {
  await pool.query("DELETE FROM wardrobe_items WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
  response.status(204).end();
});

app.get("/api/outfits", requireUser, async (request, response) => {
  const rows = (await many("SELECT * FROM outfits WHERE user_id = $1 ORDER BY COALESCE(worn_at, saved_at, created_at) DESC", [request.user.id])).map(rowToOutfit);
  response.json({ saved: rows.filter((outfit) => outfit.savedAt), history: rows.filter((outfit) => outfit.wornAt) });
});

app.get("/api/outfit-feedback", requireUser, async (request, response) => {
  const feedback = (await many("SELECT rating, occasion, note, item_ids_json FROM outfit_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30", [request.user.id]))
    .map((entry) => ({ rating: entry.rating, occasion: entry.occasion, note: entry.note, itemIds: JSON.parse(entry.item_ids_json) }));
  response.json({ feedback });
});

app.post("/api/outfit-feedback", requireUser, async (request, response) => {
  const rating = request.body?.rating === "like" ? "like" : request.body?.rating === "dislike" ? "dislike" : null;
  const itemIds = Array.isArray(request.body?.itemIds) ? request.body.itemIds.map(String).slice(0, 4) : [];
  if (!rating || !itemIds.length) return response.status(400).json({ error: "Feedback needs a rating and outfit pieces." });
  await pool.query("INSERT INTO outfit_feedback (id, user_id, rating, occasion, note, item_ids_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [randomUUID(), request.user.id, rating, String(request.body?.occasion || "Casual").slice(0, 60), String(request.body?.note || "").slice(0, 240), JSON.stringify(itemIds), new Date().toISOString()]);
  response.status(201).json({ ok: true });
});

app.post("/api/outfits", requireUser, async (request, response) => {
  const action = request.body?.action === "wear" ? "wear" : "save";
  const timestampColumn = action === "wear" ? "worn_at" : "saved_at";
  const outfit = request.body?.outfit || {};
  const itemIds = Array.isArray(outfit.itemIds) ? outfit.itemIds.map(String).slice(0, 4) : [];
  if (!itemIds.length || !String(outfit.title || "").trim()) return response.status(400).json({ error: "A complete outfit is required." });
  const validItemCount = Number((await one("SELECT COUNT(*) AS count FROM wardrobe_items WHERE user_id = $1 AND archived = false AND id = ANY($2::text[])", [request.user.id, itemIds])).count);
  if (validItemCount !== itemIds.length) return response.status(400).json({ error: "An outfit can only contain items from your active wardrobe." });
  const existing = outfit.id ? await one("SELECT * FROM outfits WHERE id = $1 AND user_id = $2", [outfit.id, request.user.id]) : null;
  const now = new Date().toISOString();
  let row;
  if (existing) {
    row = await one(`UPDATE outfits SET title = $1, item_ids_json = $2, reasoning = $3, occasion = $4, ${timestampColumn} = $5 WHERE id = $6 AND user_id = $7 RETURNING *`, [String(outfit.title).trim(), JSON.stringify(itemIds), String(outfit.reasoning || ""), String(outfit.occasion || "Casual"), now, outfit.id, request.user.id]);
  } else {
    const outfitId = String(outfit.id || randomUUID());
    row = await one(`INSERT INTO outfits (id, user_id, title, item_ids_json, reasoning, occasion, ${timestampColumn}, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [outfitId, request.user.id, String(outfit.title).trim(), JSON.stringify(itemIds), String(outfit.reasoning || ""), String(outfit.occasion || "Casual"), now, now]);
  }
  response.status(201).json({ outfit: rowToOutfit(row) });
});

app.post("/api/outfit", aiLimiter, requireUser, async (request, response) => {
  const { occasion, note, weather, personalization, wardrobe, feedback, excludedItemIds, previousItemSets } = request.body;
  try {
    const content = await askOpenCode([{ role: "system", content: "You are an inventive personal stylist. Build a complete, original fit using only wardrobe ids supplied by the user. The note is a creative brief, not a label: infer the venue, companions, mood, ambience, desired impression, climate, movement, and level of polish. Use the detailed style biography, personal preferences, and likes/dislikes as meaningful input. Do not reduce a person's style to appearance traits. Prioritize intentional colour harmony, silhouette, texture, and the full context over rigid occasion templates. Never pair navy or very dark blue with black/charcoal trousers unless a distinct lighter contrast layer makes the combination clearly intentional. Return ONLY JSON: {itemIds:string[], title:string, reasoning:string}. Pick 2-4 pieces. Make the title specific to the plan. In reasoning, explicitly explain the venue/context and the colour/silhouette decisions, without generic filler. Previous looks should be avoided when the wardrobe permits; never use excludedItemIds." }, { role: "user", content: JSON.stringify({ occasion, note, weather, personalization, wardrobe, feedback, excludedItemIds, previousItemSets }) }], { maxTokens: 700, timeoutMs: 20000 });
    response.json(content ? { demo: false, outfit: extractJson(content) } : { demo: true });
  } catch { response.status(502).json({ error: "Could not create an outfit." }); }
});

const distPath = path.join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath, { index: false, maxAge: isProduction ? "1y" : 0, etag: true, immutable: isProduction }));
  app.get("/{*splat}", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Something went wrong." });
});

await initDatabase();
const server = app.listen(port, () => console.log(`assmbl listening on ${port}`));
server.on("error", (error) => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use.` : `App failed to start: ${error.message}`); process.exit(1); });