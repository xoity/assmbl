import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowRight, Camera, Check, ChevronRight, CloudSun, Heart, LoaderCircle, LogOut, Pencil, Plus, Settings2, Shirt, Sparkles, ThumbsDown, ThumbsUp, Trash2, Upload, UserRound, X } from "lucide-react";
import "./styles.css";

type Personalization = { skinTone: string; eyeColor: string; hairColor: string; preferredStyles: string; colorsToAvoid: string; fitPreference: string; styleBiography: string; completed: boolean };
type User = { id: string; name: string; email: string; createdAt: string; personalization: Personalization };
type Garment = { id: string; name: string; category: string; type: string; color: string; brand?: string; style: string[]; season: string[]; formality: number; image: string; favorite?: boolean; worn?: string; archived?: boolean };
type Outfit = { id: string; title: string; itemIds: string[]; reasoning: string; createdAt: string; occasion: string; savedAt?: string; wornAt?: string };
type OutfitFeedback = { rating: "like" | "dislike"; occasion: string; note: string; itemIds: string[] };
type View = "landing" | "signin" | "signup" | "app";

const categories = ["All", "Tops", "Bottoms", "Shoes", "Jackets", "Accessories"];
const occasions = ["Casual", "Work", "Dinner", "Date", "Going out", "Formal", "Gym"];
const occasionFormality: Record<string, number> = { Gym: 1, Casual: 2, Date: 3, Dinner: 3, "Going out": 3, Work: 4, Formal: 5 };
const emptyPersonalization: Personalization = { skinTone: "", eyeColor: "", hairColor: "", preferredStyles: "", colorsToAvoid: "", fitPreference: "", styleBiography: "", completed: false };

async function requestJson(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: "include", ...init, signal: controller.signal });
    const body = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(body.error || "Something went wrong.");
    return body;
  } finally { window.clearTimeout(timer); }
}

async function compressImage(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => resolve(""); reader.readAsDataURL(file); });
  if (!raw) return raw;
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("decode")); element.src = raw; });
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    if (scale >= 1 && file.size < 900 * 1024) return raw;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return raw;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch { return raw; }
}

function localOutfit(wardrobe: Garment[], occasion: string, note: string, personalization: Personalization, feedback: OutfitFeedback[] = [], previousItemSets: string[][] = []): Outfit {
  const target = occasionFormality[occasion] ?? 3;
  const isDark = (item: Garment) => /black|charcoal|dark grey|dark gray/.test(item.color.toLowerCase());
  const isNavy = (item: Garment) => /navy|midnight blue|dark blue/.test(item.color.toLowerCase());
  const colorConflict = (candidate: Garment[]) => candidate.some((item) => isNavy(item)) && candidate.some((item) => isDark(item));
  const preferenceScore = (item: Garment) => {
    const details = `${item.name} ${item.type} ${item.color} ${item.style.join(" ")} ${item.season.join(" ")}`.toLowerCase();
    let score = 0;
    if (personalization.colorsToAvoid && personalization.colorsToAvoid.toLowerCase().split(",").some((color) => color.trim() && details.includes(color.trim()))) score -= 8;
    for (const entry of feedback) {
      if (!entry.itemIds.includes(item.id)) continue;
      const sameContext = entry.occasion === occasion || Boolean(note && entry.note && note.toLowerCase().includes(entry.note.toLowerCase()));
      score += (entry.rating === "like" ? 5 : -7) * (sameContext ? 1.5 : 1);
    }
    return score;
  };
  const sorted = [...wardrobe].sort((left, right) => preferenceScore(right) - preferenceScore(left) || Math.abs(left.formality - target) - Math.abs(right.formality - target));
  const choices = (category: string) => sorted.filter((item) => item.category === category);
  const tops = choices("Tops"), bottoms = choices("Bottoms"), shoes = choices("Shoes");
  const finishers = shoes.length ? shoes : choices("Accessories");
  const candidates = tops.flatMap((top) => bottoms.flatMap((bottom) => finishers.length ? finishers.map((finisher) => [top, bottom, finisher]) : [[top, bottom]]));
  const previous = previousItemSets.map((itemIds) => new Set(itemIds));
  const pieces = [...candidates]
    .sort((left, right) => {
      const overlap = (candidate: Garment[]) => previous.reduce((total, prior) => total + candidate.filter((item) => prior.has(item.id)).length, 0);
      const formalityDistance = (candidate: Garment[]) => candidate.reduce((total, item) => total + Math.abs(item.formality - target), 0);
      const preferenceFit = (candidate: Garment[]) => candidate.reduce((total, item) => total + preferenceScore(item), 0);
      return overlap(left) - overlap(right) || Number(colorConflict(left)) - Number(colorConflict(right)) || preferenceFit(right) - preferenceFit(left) || formalityDistance(left) - formalityDistance(right);
    })[0] || [tops[0], bottoms[0], shoes[0]].filter((item): item is Garment => Boolean(item));
  if (pieces.length < 2) pieces.push(...sorted.filter((item) => !pieces.some((piece) => piece.id === item.id)).slice(0, 3 - pieces.length));
  const plan = note.trim() || `${occasion.toLowerCase()} plans`;
  const title = note ? plan.replace(/^(i\s+(want|wanna)\s+to\s+have|going)\s+/i, "").replace(/^a\s+/i, "").slice(0, 64) : `${occasion} look`;
  const profileDetail = personalization.preferredStyles ? ` It also leans into your ${personalization.preferredStyles} preferences.` : "";
  return { id: crypto.randomUUID(), title: title.replace(/^./, (letter) => letter.toUpperCase()), itemIds: pieces.map((item) => item.id), reasoning: `A temporary wardrobe-only suggestion for ${plan}. The live stylist could not respond in time, so this avoids repeated pieces, your saved colour dislikes, and a near-black/navy clash.${profileDetail}`, createdAt: new Date().toISOString(), occasion };
}

function App() {
  const [view, setView] = useState<View>("landing");
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    requestJson("/api/auth/me").then((data) => { setUser(data.user); setView(data.user ? "app" : "landing"); }).catch(() => setView("landing")).finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) return <div className="boot-screen"><span className="brand-mark">assmbl<span>.</span></span></div>;
  if (view === "landing") return <Landing onStart={() => setView("signup")} onSignIn={() => setView("signin")} />;
  if (view === "signin" || view === "signup") return <AuthScreen mode={view} onBack={() => setView("landing")} onAuthed={(nextUser) => { setUser(nextUser); setView("app"); }} onSwitch={() => setView(view === "signin" ? "signup" : "signin")} />;
  return user ? <Workspace user={user} onUserChange={setUser} onSignOut={() => { setUser(null); setView("landing"); }} /> : null;
}

function Landing({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  return <main className="landing-page">
    <nav className="landing-nav"><button className="brand-mark" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>assmbl<span>.</span></button><div><button className="nav-link" onClick={onSignIn}>Sign in</button><button className="primary-button nav-cta" onClick={onStart}>Create your wardrobe <ArrowRight size={16} /></button></div></nav>
    <section className="landing-hero">
      <div className="hero-copy reveal"><span className="eyebrow">A PERSONAL WARDROBE, FINALLY USEFUL</span><h1>Get dressed with<br /><em>more intention.</em></h1><p>assmbl turns the clothes you already own into a calm, personal system for getting ready well.</p><div className="hero-actions"><button className="primary-button" onClick={onStart}>Build my wardrobe <ArrowRight size={17} /></button><a href="#how-it-works" className="text-button">See how it works <ChevronRight size={16} /></a></div></div>
      <div className="hero-composition reveal reveal-delay"><div className="hero-image hero-image-large"><img src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1100&q=85" alt="Curated clothing rail" /></div><div className="hero-image hero-image-small"><img src="https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=700&q=85" alt="Neutral wardrobe detail" /></div><span className="hero-caption">Your wardrobe,<br />assembled.</span></div>
    </section>
    <section className="promise-band"><p>Less decision fatigue. More outfits that feel like <em>you.</em></p><span>PRIVATE BY DEFAULT</span><span>AI-ASSISTED</span><span>BUILT FROM YOUR OWN CLOTHES</span></section>
    <section id="how-it-works" className="landing-section"><span className="eyebrow">THE RHYTHM</span><div className="section-intro"><h2>Three small steps.<br /><em>A clearer closet.</em></h2><p>No shopping lists, no borrowed looks. Just a better relationship with the wardrobe that is already yours.</p></div><div className="steps-grid"><article className="step reveal"><span>01</span><Shirt size={28} /><h3>Add what you own</h3><p>Photograph your pieces from your phone. assmbl recognises the details and keeps the record tidy.</p></article><article className="step reveal reveal-delay"><span>02</span><Sparkles size={28} /><h3>Ask for a look</h3><p>Tell us what the day calls for. Your personal stylist works only with what you have.</p></article><article className="step reveal reveal-delay-2"><span>03</span><Check size={28} /><h3>Wear with confidence</h3><p>Save combinations that land, learn your preferences, and make getting ready feel lighter.</p></article></div></section>
    <section className="landing-feature"><div className="feature-visual"><img src="https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=85" alt="Organised clothing collection" /></div><div className="feature-copy"><span className="eyebrow">A QUIETER WAY TO DECIDE</span><h2>A wardrobe that knows its way around.</h2><p>Every item lives in one considered place, with its colour, category, formality, season, and the outfits it helps unlock.</p><button className="text-button" onClick={onStart}>Start with what you have <ArrowRight size={16} /></button></div></section>
    <section className="landing-closing"><span className="eyebrow">START WHERE YOU ARE</span><h2>Your next great outfit<br /><em>is already at home.</em></h2><button className="primary-button" onClick={onStart}>Create your free account <ArrowRight size={17} /></button></section>
    <footer><span className="brand-mark">assmbl<span>.</span></span><span>Made for the things you actually wear.</span></footer>
  </main>;
}

function AuthScreen({ mode, onBack, onAuthed, onSwitch }: { mode: "signin" | "signup"; onBack: () => void; onAuthed: (user: User) => void; onSwitch: () => void }) {
  const [name, setName] = useState("Mohammad");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const isSignup = mode === "signup";
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const result = await requestJson(`/api/auth/${isSignup ? "signup" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isSignup ? { name, email, password } : { email, password }) });
      onAuthed(result.user);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not continue."); } finally { setPending(false); }
  }
  return <main className="auth-page"><button className="brand-mark auth-brand" onClick={onBack}>assmbl<span>.</span></button><section className="auth-panel reveal"><button className="back-button" onClick={onBack}>← Back</button><span className="eyebrow">{isSignup ? "YOUR WARDROBE STARTS HERE" : "WELCOME BACK"}</span><h1>{isSignup ? <>Make space for<br /><em>your style.</em></> : <>Good to have<br /><em>you back.</em></>}</h1><p>{isSignup ? "Create a private account and start building the wardrobe you will actually use." : "Sign in to pick up where you left off."}</p><form onSubmit={submit}>{isSignup && <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignup ? "new-password" : "current-password"} minLength={8} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : null}{isSignup ? "Create account" : "Sign in"}<ArrowRight size={17} /></button></form><p className="auth-switch">{isSignup ? "Already have an account?" : "New here?"} <button onClick={onSwitch}>{isSignup ? "Sign in" : "Create one"}</button></p></section><aside className="auth-aside"><img src="https://images.unsplash.com/photo-1496217590455-aa63a8350eea?auto=format&fit=crop&w=1100&q=85" alt="Clothing arranged on a rail" /><p>“A little less thinking.<br />A lot more wearing.”</p></aside></main>;
}

function Workspace({ user, onUserChange, onSignOut }: { user: User; onUserChange: (user: User) => void; onSignOut: () => void }) {
  const [wardrobe, setWardrobe] = useState<Garment[]>([]);
  const [archived, setArchived] = useState<Garment[]>([]);
  const [screen, setScreen] = useState<"home" | "wardrobe" | "outfits" | "saved" | "archive" | "profile">("home");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Garment | null>(null);
  const [editing, setEditing] = useState<Garment | null>(null);
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [saved, setSaved] = useState<Outfit[]>([]);
  const [history, setHistory] = useState<Outfit[]>([]);
  const [generatedSets, setGeneratedSets] = useState<string[][]>([]);
  const [occasion, setOccasion] = useState("Dinner");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [feedback, setFeedback] = useState<OutfitFeedback[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(!user.personalization.completed);

  const refreshWardrobe = () => requestJson("/api/wardrobe").then((data) => { const items = data.items as Garment[]; setWardrobe(items.filter((item) => !item.archived)); setArchived(items.filter((item) => item.archived)); });
  useEffect(() => {
    void refreshWardrobe().catch((error) => setToast(error.message));
    requestJson("/api/outfits").then((data) => { setSaved(data.saved || []); setHistory(data.history || []); }).catch((error) => setToast(error.message));
    requestJson("/api/status").then((data) => setAiConnected(data.connected)).catch(() => setAiConnected(false));
    requestJson("/api/outfit-feedback").then((data) => setFeedback(data.feedback || [])).catch(() => undefined);
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const visible = category === "All" ? wardrobe : wardrobe.filter((item) => item.category === category);
  const outfitItems = outfit ? outfit.itemIds.map((id) => wardrobe.find((item) => item.id === id)).filter((item): item is Garment => Boolean(item)) : [];

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files); setLoading(true); setUploadProgress({ done: 0, total: list.length });
    try {
      const added = await Promise.all(list.map(async (file) => { const image = await compressImage(file); const result = await requestJson("/api/wardrobe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) }, 45000); setUploadProgress((current) => current ? { ...current, done: current.done + 1 } : current); return result.item as Garment; }));
      setWardrobe((items) => [...added, ...items]); setToast(`${added.length} item${added.length > 1 ? "s" : ""} added to your wardrobe`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not add photo."); } finally { setLoading(false); setUploadProgress(null); }
  }

  async function generateOutfit() {
    if (!wardrobe.length) { setScreen("wardrobe"); setToast("Add a few pieces first, then assmbl can style them."); return; }
    setLoading(true);
    const previousItemSets = [
      ...generatedSets,
      ...(outfit ? [outfit.itemIds] : []),
      ...history.slice(0, 6).map((entry) => entry.itemIds)
    ];
    let next = localOutfit(wardrobe, occasion, note, user.personalization, feedback, previousItemSets);
    try {
      const result = await requestJson("/api/outfit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occasion, note, weather: "Warm, clear day", personalization: user.personalization, wardrobe: wardrobe.map(({ id, name, category: itemCategory, type, color, style, season, formality }) => ({ id, name, category: itemCategory, type, color, style, season, formality })), feedback, excludedItemIds: outfit?.itemIds || [], previousItemSets }) }, 25000);
      const returnedIds = result.outfit?.itemIds as string[] | undefined;
      const returnedKey = returnedIds ? [...returnedIds].sort().join("|") : "";
      const knownKeys = new Set(previousItemSets.map((itemIds) => [...itemIds].sort().join("|")));
      if (returnedIds?.length && !knownKeys.has(returnedKey)) next = { ...next, ...result.outfit, id: crypto.randomUUID(), createdAt: new Date().toISOString(), occasion };
    } catch { /* The local selector remains responsive when the AI is slow or unavailable. */ }
    setGeneratedSets((sets) => [...sets.slice(-7), next.itemIds]);
    setOutfit(next); setLoading(false);
  }

  async function storeOutfit(action: "save" | "wear") {
    if (!outfit) return;
    try {
      const result = await requestJson("/api/outfits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, outfit }) });
      const stored = result.outfit as Outfit;
      if (action === "save") { setSaved((items) => [stored, ...items.filter((item) => item.id !== stored.id)]); setToast("Look saved to your collection"); }
      else { setHistory((items) => [stored, ...items.filter((item) => item.id !== stored.id)]); setToast("Marked as worn today"); }
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not save this look."); }
  }

  async function rateOutfit(rating: OutfitFeedback["rating"]) {
    if (!outfit) return;
    const entry: OutfitFeedback = { rating, occasion: outfit.occasion, note, itemIds: outfit.itemIds };
    try {
      await requestJson("/api/outfit-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
      setFeedback((entries) => [entry, ...entries].slice(0, 30));
      setToast(rating === "like" ? "Got it - more looks like this." : "Got it - I will take this direction less often.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not save your feedback."); }
  }

  async function patchItem(id: string, body: Record<string, unknown>) {
    const result = await requestJson(`/api/wardrobe/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const next = result.item as Garment;
    setWardrobe((items) => items.map((item) => item.id === id ? next : item).filter((item) => !item.archived));
    setArchived((items) => items.map((item) => item.id === id ? next : item).filter((item) => item.archived));
    return next;
  }

  async function saveEdit(item: Garment) { try { const next = await patchItem(item.id, item); setSelected(next); setEditing(null); setToast("Item updated"); } catch (error) { setToast(error instanceof Error ? error.message : "Could not save item."); } }
  async function toggleFavorite(item: Garment) { try { const next = await patchItem(item.id, { favorite: !item.favorite }); setSelected(next); } catch (error) { setToast(error instanceof Error ? error.message : "Could not update item."); } }
  async function moveArchive(item: Garment, nextArchived: boolean) { try { await patchItem(item.id, { archived: nextArchived }); if (nextArchived) { setWardrobe((items) => items.filter((entry) => entry.id !== item.id)); setArchived((items) => [{ ...item, archived: true }, ...items]); } else { setArchived((items) => items.filter((entry) => entry.id !== item.id)); setWardrobe((items) => [{ ...item, archived: false }, ...items]); } setSelected(null); setToast(nextArchived ? "Moved to archive" : "Restored to wardrobe"); } catch (error) { setToast(error instanceof Error ? error.message : "Could not move item."); } }
  async function deleteItem(id: string) { if (!window.confirm("Permanently delete this item? This cannot be undone.")) return; try { await requestJson(`/api/wardrobe/${id}`, { method: "DELETE" }); setWardrobe((items) => items.filter((item) => item.id !== id)); setArchived((items) => items.filter((item) => item.id !== id)); setSelected(null); setToast("Item deleted"); } catch (error) { setToast(error instanceof Error ? error.message : "Could not delete item."); } }
  async function updateProfile(next: { name: string; personalization: Personalization }) { try { const result = await requestJson("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); onUserChange(result.user); setShowOnboarding(false); setToast("Personalization saved"); } catch (error) { setToast(error instanceof Error ? error.message : "Could not save profile."); } }
  async function signOut() { await requestJson("/api/auth/logout", { method: "POST" }).catch(() => undefined); onSignOut(); }

  return <div className="app-shell"><aside className="sidebar"><button className="brand-mark wordmark" onClick={() => setScreen("home")}>assmbl<span>.</span></button><nav>{[["home", "Home"], ["wardrobe", "Wardrobe"], ["outfits", "Outfits"], ["saved", "Saved"], ["archive", "Archive"]].map(([id, label]) => <button key={id} className={screen === id ? "nav-item active" : "nav-item"} onClick={() => setScreen(id as typeof screen)}>{label}</button>)}</nav><div className="side-bottom"><button className="profile-dot" onClick={() => setScreen("profile")}>{user.name.charAt(0).toUpperCase()}</button><button className="account-name" onClick={() => setScreen("profile")}><strong>{user.name}</strong><small>Personal wardrobe</small></button><button className="icon-button" aria-label="Profile settings" onClick={() => setScreen("profile")}><Settings2 size={17} /></button></div></aside><main><header className="topbar"><div className="mobile-mark brand-mark">assmbl<span>.</span></div><div className="weather"><CloudSun size={19} /><span>Personal edit</span><b>{wardrobe.length} pieces</b></div><div className={aiConnected ? "ai-status connected" : "ai-status"}><i></i>{aiConnected ? "OpenCode AI live" : "Local styling ready"}</div></header>
    {screen === "home" && <section className="page home-page"><div className="eyebrow">YOUR PERSONAL WARDROBE</div><h1>Good to see you,<br /><em>{user.name}.</em></h1><div className="generator"><div className="generator-heading"><div><span className="spark-icon"><Sparkles size={18} /></span><h2>What should I wear?</h2><p>Tell assmbl the plan. Your wardrobe does the rest.</p></div><span className="weather-note">Built only from your clothes</span></div><div className="occasion-row">{occasions.map((item) => <button key={item} className={occasion === item ? "occasion selected" : "occasion"} onClick={() => setOccasion(item)}>{item}</button>)}</div><label className="note-input"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Dinner somewhere nice but not too formal" /><button onClick={generateOutfit} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <>Assemble <ArrowRight size={16} /></>}</button></label></div><section className="wardrobe-preview"><div className="section-header"><div><span className="eyebrow">IN ROTATION</span><h2>{wardrobe.length ? `${wardrobe.length} items, all yours.` : "Your wardrobe starts here."}</h2></div><button className="text-button" onClick={() => setScreen("wardrobe")}>View wardrobe <ChevronRight size={16} /></button></div>{wardrobe.length ? <div className="mini-grid">{wardrobe.slice(0, 4).map((item, index) => <GarmentCard item={item} key={item.id} index={index} onSelect={setSelected} />)}</div> : <div className="empty-state"><Upload size={25} /><h2>Add your first piece</h2><p>Start with one photo. assmbl will handle the detail work.</p><button className="primary-button" onClick={() => setScreen("wardrobe")}>Build my wardrobe <ArrowRight size={16} /></button></div>}</section></section>}
    {screen === "wardrobe" && <section className="page wardrobe-page"><div className="section-header"><div><span className="eyebrow">YOUR WARDROBE</span><h1>Everything you own,<br /><em>in one place.</em></h1></div><div className="upload-actions"><label className="primary-button"><Plus size={18} /> Add clothes<input type="file" accept="image/*" multiple onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} /></label><label className="secondary-button"><Camera size={17} /> Take photo<input type="file" accept="image/*" capture="environment" onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} /></label></div></div><p className="upload-hint">Lay it flat, hang it, or wear it. assmbl will catalogue the visible piece from the photo.</p><div className="filters">{categories.map((item) => <button className={category === item ? "filter active" : "filter"} key={item} onClick={() => setCategory(item)}>{item}</button>)}<span>{visible.length} items</span></div>{visible.length ? <div className="garment-grid">{visible.map((item, index) => <GarmentCard item={item} key={item.id} index={index} onSelect={setSelected} />)}</div> : <div className="empty-state"><Shirt size={25} /><h2>No pieces here yet</h2><p>Add your first photo to get started.</p></div>}</section>}
    {screen === "outfits" && <section className="page outfits-page"><span className="eyebrow">YOUR STYLIST</span><h1>Made from your<br /><em>actual wardrobe.</em></h1><button className="large-cta" onClick={generateOutfit}><Sparkles size={22} /> What should I wear?<ArrowRight size={20} /></button><p className="page-note">assmbl will always choose from the clothes in your current rotation.</p></section>}
    {screen === "saved" && <section className="page saved-page"><span className="eyebrow">SAVED LOOKS</span><h1>A little less thinking.<br /><em>A lot more wearing.</em></h1>{saved.length ? <div className="outfit-list">{saved.map((entry) => <OutfitLine outfit={entry} wardrobe={wardrobe} key={entry.id} onSelect={setOutfit} />)}</div> : <div className="empty-state"><Heart size={25} /><h2>Nothing saved yet</h2><p>When a look lands, save it here for the next time.</p><button className="primary-button" onClick={generateOutfit}>Assemble a look <ArrowRight size={16} /></button></div>}<div className="history-list"><span className="eyebrow">RECENTLY WORN</span>{history.length ? history.map((entry) => <OutfitLine outfit={entry} wardrobe={wardrobe} key={entry.id} onSelect={setOutfit} />) : <p className="page-note">Mark an outfit as worn to build a useful history.</p>}</div></section>}
    {screen === "archive" && <section className="page archive-page"><span className="eyebrow">ARCHIVE</span><h1>Out of rotation,<br /><em>not out of mind.</em></h1><p className="upload-hint">Archived pieces stay private and out of recommendations until you restore them.</p>{archived.length ? <div className="garment-grid">{archived.map((item, index) => <GarmentCard item={item} key={item.id} index={index} onSelect={setSelected} />)}</div> : <div className="empty-state"><Archive size={25} /><h2>Nothing archived</h2><p>Pieces you archive will wait here for you.</p></div>}</section>}
    {screen === "profile" && <ProfilePage user={user} wardrobeCount={wardrobe.length} archivedCount={archived.length} onSave={updateProfile} onSignOut={signOut} />}
  </main>{showOnboarding && <PersonalizationModal user={user} onSave={updateProfile} />}{selected && <ItemModal item={selected} archived={Boolean(selected.archived)} onClose={() => setSelected(null)} onFavorite={() => void toggleFavorite(selected)} onEdit={() => setEditing(selected)} onArchive={() => void moveArchive(selected, true)} onRestore={() => void moveArchive(selected, false)} onDelete={() => void deleteItem(selected.id)} />}{editing && <EditModal item={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}{outfit && <OutfitModal outfit={outfit} items={outfitItems} onClose={() => setOutfit(null)} onAnother={generateOutfit} onLike={() => void rateOutfit("like")} onDislike={() => void rateOutfit("dislike")} onSave={() => void storeOutfit("save")} onWear={() => void storeOutfit("wear")} />}{loading && !outfit && <div className="processing"><LoaderCircle className="spin" /><span>{uploadProgress ? `Analysing photo ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${uploadProgress.total}` : "Assembling your look"}</span></div>}{toast && <div className="toast"><Check size={17} />{toast}</div>}</div>;
}

function GarmentCard({ item, index, onSelect }: { item: Garment; index: number; onSelect: (item: Garment) => void }) { return <button className="garment-card" style={{ "--card-delay": `${Math.min(index, 7) * 55}ms` } as React.CSSProperties} onClick={() => onSelect(item)}><img src={item.image} alt={item.name} /><span className="card-shade"></span><span className="card-info"><b>{item.name}</b><small>{item.color} · {item.type}</small></span>{item.favorite && <Heart className="card-heart" size={16} fill="currentColor" />}</button>; }
function OutfitLine({ outfit, wardrobe, onSelect }: { outfit: Outfit; wardrobe: Garment[]; onSelect: (outfit: Outfit) => void }) { const image = wardrobe.find((item) => outfit.itemIds.includes(item.id))?.image; return <button className="outfit-line" onClick={() => onSelect(outfit)}>{image && <img src={image} alt="" />}<span><b>{outfit.title}</b><small>{new Date(outfit.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {outfit.occasion}</small></span><ChevronRight size={18} /></button>; }
function PersonalizationFields({ value, onChange }: { value: Personalization; onChange: (next: Personalization) => void }) { const set = (key: keyof Personalization) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: event.target.value }); return <div className="personalization-fields"><label>Skin tone<input value={value.skinTone} onChange={set("skinTone")} placeholder="e.g. medium olive" /></label><label>Eye colour<input value={value.eyeColor} onChange={set("eyeColor")} placeholder="e.g. brown" /></label><label>Hair colour<input value={value.hairColor} onChange={set("hairColor")} placeholder="e.g. black" /></label><label>Fit preference<select value={value.fitPreference} onChange={set("fitPreference")}><option value="">No preference</option><option>Relaxed</option><option>Regular</option><option>Tailored</option></select></label><label className="wide">Styles you feel best in<input value={value.preferredStyles} onChange={set("preferredStyles")} placeholder="e.g. minimal, smart casual" /></label><label className="wide">Colours to avoid<input value={value.colorsToAvoid} onChange={set("colorsToAvoid")} placeholder="e.g. bright yellow, beige" /></label><label className="wide">About your style<textarea value={value.styleBiography} onChange={set("styleBiography")} placeholder="Describe your usual style, work, lifestyle, comfort limits, or how you want to come across." /></label></div>; }
function PersonalizationModal({ user, onSave }: { user: User; onSave: (profile: { name: string; personalization: Personalization }) => void }) { const [personalization, setPersonalization] = useState({ ...emptyPersonalization, ...user.personalization }); return <div className="modal-backdrop"><section className="edit-modal onboarding-modal"><span className="eyebrow">MAKE IT PERSONAL</span><h2>A few details,<br />a better edit.</h2><p>Optional details help assmbl consider colour, fit, and the styles you naturally reach for. You can change them any time in Profile.</p><PersonalizationFields value={personalization} onChange={setPersonalization} /><button className="primary-button edit-save" onClick={() => onSave({ name: user.name, personalization: { ...personalization, completed: true } })}>Save my preferences <Check size={16} /></button></section></div>; }
function ProfilePage({ user, wardrobeCount, archivedCount, onSave, onSignOut }: { user: User; wardrobeCount: number; archivedCount: number; onSave: (profile: { name: string; personalization: Personalization }) => void; onSignOut: () => void }) { const [name, setName] = useState(user.name); const [personalization, setPersonalization] = useState({ ...emptyPersonalization, ...user.personalization }); return <section className="page profile-page"><span className="eyebrow">YOUR ACCOUNT</span><h1>Made for<br /><em>{user.name}.</em></h1><div className="profile-grid"><section className="profile-card"><UserRound size={23} /><h2>Profile</h2><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input value={user.email} disabled /></label><h3>Personal styling</h3><PersonalizationFields value={personalization} onChange={setPersonalization} /><button className="primary-button" onClick={() => onSave({ name, personalization: { ...personalization, completed: true } })}>Save changes <Check size={16} /></button></section><section className="profile-card profile-stats"><span>{wardrobeCount}</span><p>pieces in rotation</p><span>{archivedCount}</span><p>pieces in archive</p><button className="secondary-button danger" onClick={onSignOut}><LogOut size={16} /> Sign out</button></section></div></section>; }
function ItemModal({ item, archived, onClose, onFavorite, onEdit, onArchive, onRestore, onDelete }: { item: Garment; archived: boolean; onClose: () => void; onFavorite: () => void; onEdit: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="item-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={onClose}><X size={20} /></button><div className="item-image"><img src={item.image} alt={item.name} /></div><div className="item-details"><span className="eyebrow">{item.category.toUpperCase()}{archived ? " · ARCHIVED" : ""}</span><h2>{item.name}</h2><p>{item.brand || "Unbranded"} · {item.color}</p><div className="tags">{[...item.style, ...item.season].map((tag) => <span key={tag}>{tag}</span>)}</div><dl><div><dt>Type</dt><dd>{item.type}</dd></div><div><dt>Formality</dt><dd>{item.formality}/5</dd></div><div><dt>Last worn</dt><dd>{item.worn || "Not yet"}</dd></div></dl><div className="modal-actions"><button className="secondary-button" onClick={onFavorite}><Heart size={17} fill={item.favorite ? "currentColor" : "none"} />{item.favorite ? "Favourited" : "Favourite"}</button><button className="secondary-button" onClick={onEdit}><Pencil size={17} /> Edit</button></div><div className="modal-actions danger-actions">{archived ? <button className="secondary-button" onClick={onRestore}><ArchiveRestore size={17} /> Restore</button> : <button className="secondary-button" onClick={onArchive}><Archive size={17} /> Archive</button>}<button className="secondary-button danger" onClick={onDelete}><Trash2 size={17} /> Delete</button></div></div></section></div>; }
function EditModal({ item, onClose, onSave }: { item: Garment; onClose: () => void; onSave: (item: Garment) => void }) { const [form, setForm] = useState({ name: item.name, category: item.category, type: item.type, color: item.color, brand: item.brand || "", formality: item.formality, style: item.style.join(", "), season: item.season.join(", ") }); const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value })); const submit = () => onSave({ ...item, name: form.name.trim() || item.name, category: form.category, type: form.type.trim() || item.type, color: form.color.trim() || item.color, brand: form.brand.trim(), formality: Number(form.formality), style: form.style.split(",").map((tag) => tag.trim()).filter(Boolean), season: form.season.split(",").map((tag) => tag.trim()).filter(Boolean) }); return <div className="modal-backdrop" onMouseDown={onClose}><section className="edit-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={onClose}><X size={20} /></button><span className="eyebrow">EDIT ITEM</span><h2>Fine tune the detail.</h2><div className="edit-grid"><label>Name<input value={form.name} onChange={set("name")} /></label><label>Category<select value={form.category} onChange={set("category")}>{categories.slice(1).map((option) => <option key={option}>{option}</option>)}</select></label><label>Type<input value={form.type} onChange={set("type")} /></label><label>Colour<input value={form.color} onChange={set("color")} /></label><label>Brand<input value={form.brand} onChange={set("brand")} /></label><label>Formality<select value={form.formality} onChange={set("formality")}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}</select></label><label className="wide">Styles<input value={form.style} onChange={set("style")} /></label><label className="wide">Seasons<input value={form.season} onChange={set("season")} /></label></div><button className="primary-button edit-save" onClick={submit}>Save item <Check size={16} /></button></section></div>; }
function OutfitModal({ outfit, items, onClose, onAnother, onLike, onDislike, onSave, onWear }: { outfit: Outfit; items: Garment[]; onClose: () => void; onAnother: () => void; onLike: () => void; onDislike: () => void; onSave: () => void; onWear: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="outfit-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={onClose}><X size={20} /></button><span className="eyebrow">ASSEMBLED FOR YOU</span><h2>{outfit.title}</h2><div className="outfit-pieces">{items.map((item, index) => <div className="outfit-piece" key={item.id}>{index > 0 && <span className="plus">+</span>}<img src={item.image} alt={item.name} /><b>{item.name}</b><small>{item.category}</small></div>)}</div><div className="reason"><Sparkles size={17} /><div><b>Why this works</b><p>{outfit.reasoning}</p></div></div><div className="outfit-actions"><button className="secondary-button" onClick={onAnother}><Sparkles size={17} /> Try another</button><button className="secondary-button feedback-button" onClick={onLike} aria-label="Like this look"><ThumbsUp size={17} /> Like</button><button className="secondary-button feedback-button" onClick={onDislike} aria-label="Dislike this look"><ThumbsDown size={17} /> Dislike</button><button className="secondary-button" onClick={onSave}><Heart size={17} /> Save look</button><button className="primary-button" onClick={onWear}><Check size={17} /> Wear this</button></div></section></div>; }

import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<App />);
