import { useEffect, useRef, useState } from "react";
import { Archive, ArrowRight, Check, ChevronRight, CloudSun, Heart, LoaderCircle, Plus, RotateCcw, Search, Settings2, Shirt, Sparkles, ThumbsDown, ThumbsUp, Upload, X } from "lucide-react";
import "./styles.css";

type Garment = {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string;
  brand?: string;
  style: string[];
  season: string[];
  formality: number;
  image: string;
  favorite?: boolean;
  worn?: string;
};

type Outfit = { id: string; title: string; itemIds: string[]; reasoning: string; createdAt: string; occasion: string };

const seedWardrobe: Garment[] = [
  { id: "polo", name: "Navy pique polo", category: "Tops", type: "Polo shirt", color: "Navy", brand: "Ralph Lauren", style: ["Casual", "Smart casual"], season: ["Spring", "Summer"], formality: 2, image: "https://images.unsplash.com/photo-1626497764746-6dc36546b388?auto=format&fit=crop&w=800&q=85", favorite: true },
  { id: "trousers", name: "Stone straight trousers", category: "Bottoms", type: "Trousers", color: "Stone", brand: "COS", style: ["Smart casual"], season: ["Spring", "Summer"], formality: 3, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=800&q=85" },
  { id: "sneakers", name: "White leather sneakers", category: "Shoes", type: "Sneakers", color: "White", brand: "Adidas", style: ["Casual"], season: ["All year"], formality: 1, image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=85", favorite: true },
  { id: "tee", name: "Washed black tee", category: "Tops", type: "T-shirt", color: "Black", style: ["Casual"], season: ["All year"], formality: 1, image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=85" },
  { id: "jeans", name: "Straight blue denim", category: "Bottoms", type: "Jeans", color: "Indigo", style: ["Casual"], season: ["All year"], formality: 1, image: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=85" },
  { id: "overshirt", name: "Olive linen overshirt", category: "Jackets", type: "Overshirt", color: "Olive", style: ["Casual"], season: ["Spring", "Autumn"], formality: 2, image: "https://images.unsplash.com/photo-1583743814966-8936f37f9c38?auto=format&fit=crop&w=800&q=85" }
];

const categories = ["All", "Tops", "Bottoms", "Shoes", "Jackets", "Accessories"];
const occasions = ["Casual", "Work", "Dinner", "Date", "Going out", "Formal", "Gym"];
const fallbackReason = "The navy and stone pairing feels polished without becoming formal. White sneakers keep it easy for a hot, humid day.";

function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}

function App() {
  const [wardrobe, setWardrobe] = useState<Garment[]>(() => readStored("closetly-wardrobe", seedWardrobe));
  const [saved, setSaved] = useState<Outfit[]>(() => readStored("closetly-saved", []));
  const [history, setHistory] = useState<Outfit[]>(() => readStored("closetly-history", []));
  const [activeCategory, setActiveCategory] = useState("All");
  const [screen, setScreen] = useState<"home" | "wardrobe" | "outfits" | "saved">("home");
  const [selected, setSelected] = useState<Garment | null>(null);
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [occasion, setOccasion] = useState("Dinner");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem("closetly-wardrobe", JSON.stringify(wardrobe)); }, [wardrobe]);
  useEffect(() => { localStorage.setItem("closetly-saved", JSON.stringify(saved)); }, [saved]);
  useEffect(() => { localStorage.setItem("closetly-history", JSON.stringify(history)); }, [history]);
  useEffect(() => { fetch("/api/status").then((r) => r.json()).then((data) => setAiConnected(data.connected)).catch(() => setAiConnected(false)); }, []);
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(""), 2600); return () => window.clearTimeout(timer); } }, [toast]);

  const visible = activeCategory === "All" ? wardrobe : wardrobe.filter((item) => item.category === activeCategory);
  const outfitItems = outfit ? outfit.itemIds.map((id) => wardrobe.find((item) => item.id === id)).filter(Boolean) as Garment[] : [];

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    const additions = await Promise.all(Array.from(files).map(async (file, index) => {
      const image = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      try {
        const result = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) }).then((r) => r.json());
        if (result.error) throw new Error(result.error);
        return { id: crypto.randomUUID(), image, ...result.item } as Garment;
      } catch {
        return { id: crypto.randomUUID(), name: `New wardrobe piece ${index + 1}`, category: "Tops", type: "Shirt", color: "Unknown", style: ["Casual"], season: ["All year"], formality: 2, image } as Garment;
      }
    }));
    setWardrobe((items) => [...additions, ...items]);
    setLoading(false);
    setToast(`${additions.length} item${additions.length > 1 ? "s" : ""} added to your wardrobe`);
  }

  async function generateOutfit() {
    setLoading(true);
    let next: Outfit = { id: crypto.randomUUID(), title: "Tonight's easy dinner", itemIds: ["polo", "trousers", "sneakers"].filter((id) => wardrobe.some((item) => item.id === id)), reasoning: fallbackReason, createdAt: new Date().toISOString(), occasion };
    try {
      const result = await fetch("/api/outfit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ occasion, note, weather: "Dubai, 34C, hot and humid", wardrobe: wardrobe.map(({ id, name, category, color, style, formality }) => ({ id, name, category, color, style, formality })), feedback }) }).then((r) => r.json());
      if (result.outfit?.itemIds?.length) next = { ...next, ...result.outfit, id: crypto.randomUUID(), createdAt: new Date().toISOString(), occasion };
    } catch { /* Demo fallback is intentionally usable offline. */ }
    if (next.itemIds.length < 2) next.itemIds = wardrobe.slice(0, 3).map((item) => item.id);
    setOutfit(next);
    setLoading(false);
  }

  function saveOutfit() { if (outfit && !saved.some((item) => item.id === outfit.id)) { setSaved((items) => [outfit, ...items]); setToast("Look saved to your collection"); } }
  function wearOutfit() { if (outfit) { setHistory((items) => [outfit, ...items]); setToast("Marked as worn today"); } }
  function toggleFavorite(id: string) { setWardrobe((items) => items.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item)); }
  function discard(id: string) { setWardrobe((items) => items.filter((item) => item.id !== id)); setSelected(null); setToast("Item archived"); }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="wordmark" onClick={() => setScreen("home")}>closet<span>ly</span></button>
      <nav>{[["home", "Home"], ["wardrobe", "Wardrobe"], ["outfits", "Outfits"], ["saved", "Saved"]].map(([id, label]) => <button key={id} className={screen === id ? "nav-item active" : "nav-item"} onClick={() => setScreen(id as typeof screen)}>{label}</button>)}</nav>
      <div className="side-bottom"><div className="profile-dot">H</div><div><strong>Hamdan</strong><small>Free plan</small></div><button className="icon-button" aria-label="Settings"><Settings2 size={17} /></button></div>
    </aside>
    <main>
      <header className="topbar"><div className="mobile-mark">closet<span>ly</span></div><div className="weather"><CloudSun size={19}/><span>Dubai</span><b>34 C</b><small>Hot and humid</small></div><div className={aiConnected ? "ai-status connected" : "ai-status"}><i></i>{aiConnected ? "OpenCode AI live" : "Demo styling"}</div></header>
      {screen === "home" && <section className="page home-page">
        <div className="eyebrow">THURSDAY, AUGUST 27</div><h1>Good morning,<br/><em>Hamdan.</em></h1>
        <div className="generator">
          <div className="generator-heading"><div><span className="spark-icon"><Sparkles size={18}/></span><h2>What should I wear?</h2><p>Tell us the plan. We will handle the outfit.</p></div><span className="weather-note">Lightweight layers recommended</span></div>
          <div className="occasion-row">{occasions.map((item) => <button key={item} className={occasion === item ? "occasion selected" : "occasion"} onClick={() => setOccasion(item)}>{item}</button>)}</div>
          <label className="note-input"><Search size={17}/><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Dinner somewhere nice but not too formal"/><button onClick={generateOutfit} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17}/> : <>Generate <ArrowRight size={16}/></>}</button></label>
        </div>
        <section className="wardrobe-preview"><div className="section-header"><div><span className="eyebrow">YOUR WARDROBE</span><h2>{wardrobe.length} items, all yours.</h2></div><button className="text-button" onClick={() => setScreen("wardrobe")}>View wardrobe <ChevronRight size={16}/></button></div><div className="mini-grid">{wardrobe.slice(0, 4).map((item) => <GarmentCard item={item} key={item.id} onSelect={setSelected}/>)}</div></section>
      </section>}
      {screen === "wardrobe" && <section className="page wardrobe-page"><div className="section-header"><div><span className="eyebrow">YOUR WARDROBE</span><h1>Everything you own,<br/><em>in one place.</em></h1></div><button className="primary-button" onClick={() => inputRef.current?.click()}><Plus size={18}/> Add clothes</button></div><div className="filters">{categories.map((item) => <button className={activeCategory === item ? "filter active" : "filter"} key={item} onClick={() => setActiveCategory(item)}>{item}</button>)}<span>{visible.length} items</span></div><div className="garment-grid">{visible.map((item) => <GarmentCard item={item} key={item.id} onSelect={setSelected}/>)}</div></section>}
      {screen === "outfits" && <section className="page outfits-page"><span className="eyebrow">YOUR STYLIST</span><h1>Made from your<br/><em>actual wardrobe.</em></h1><button className="large-cta" onClick={generateOutfit}><Sparkles size={22}/> What should I wear?<ArrowRight size={20}/></button><div className="history-list"><h2>Recently worn</h2>{history.length ? history.map((entry) => <OutfitLine key={entry.id} outfit={entry} wardrobe={wardrobe}/>) : <p>You have not worn a generated outfit yet.</p>}</div></section>}
      {screen === "saved" && <section className="page saved-page"><span className="eyebrow">SAVED LOOKS</span><h1>A little less thinking.<br/><em>A lot more wearing.</em></h1><div className="saved-grid">{saved.length ? saved.map((entry) => <OutfitLine key={entry.id} outfit={entry} wardrobe={wardrobe}/>) : <div className="empty-state"><Heart size={26}/><h2>Nothing saved yet</h2><p>Generate an outfit you love and save it here.</p><button className="primary-button" onClick={() => setScreen("home")}>Create an outfit</button></div>}</div></section>}
    </main>
    <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void addPhotos(event.target.files)}/>
    {outfit && <OutfitModal outfit={outfit} items={outfitItems} onClose={() => setOutfit(null)} onSave={saveOutfit} onWear={wearOutfit} onAnother={generateOutfit} loading={loading} feedback={feedback} setFeedback={setFeedback}/>} 
    {selected && <ItemModal item={selected} onClose={() => setSelected(null)} onFavorite={() => toggleFavorite(selected.id)} onArchive={() => discard(selected.id)}/>} 
    {loading && !outfit && <div className="processing"><LoaderCircle className="spin"/><span>Styling your wardrobe...</span></div>}
    {toast && <div className="toast"><Check size={17}/>{toast}</div>}
  </div>;
}

function GarmentCard({ item, onSelect }: { item: Garment; onSelect: (item: Garment) => void }) { return <button className="garment-card" onClick={() => onSelect(item)}><img src={item.image} alt={item.name}/><span className="card-shade"></span><span className="card-info"><b>{item.name}</b><small>{item.color} · {item.type}</small></span>{item.favorite && <Heart className="card-heart" size={16} fill="currentColor"/>}</button>; }
function OutfitLine({ outfit, wardrobe }: { outfit: Outfit; wardrobe: Garment[] }) { const image = wardrobe.find((item) => outfit.itemIds.includes(item.id))?.image; return <article className="outfit-line">{image && <img src={image} alt=""/>}<div><b>{outfit.title}</b><small>{new Date(outfit.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {outfit.occasion}</small></div><ChevronRight size={18}/></article>; }
function ItemModal({ item, onClose, onFavorite, onArchive }: { item: Garment; onClose: () => void; onFavorite: () => void; onArchive: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="item-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={onClose}><X size={20}/></button><div className="item-image"><img src={item.image} alt={item.name}/></div><div className="item-details"><span className="eyebrow">{item.category.toUpperCase()}</span><h2>{item.name}</h2><p>{item.brand || "Unbranded"} · {item.color}</p><div className="tags">{item.style.map((tag) => <span key={tag}>{tag}</span>)}{item.season.map((tag) => <span key={tag}>{tag}</span>)}</div><dl><div><dt>Type</dt><dd>{item.type}</dd></div><div><dt>Formality</dt><dd>{item.formality}/5</dd></div><div><dt>Last worn</dt><dd>{item.worn || "Not yet"}</dd></div></dl><div className="modal-actions"><button className="secondary-button" onClick={onFavorite}><Heart size={17} fill={item.favorite ? "currentColor" : "none"}/>{item.favorite ? "Favourited" : "Favourite"}</button><button className="icon-button archive" title="Archive item" onClick={onArchive}><Archive size={18}/></button></div></div></section></div>; }
function OutfitModal({ outfit, items, onClose, onSave, onWear, onAnother, loading, feedback, setFeedback }: { outfit: Outfit; items: Garment[]; onClose: () => void; onSave: () => void; onWear: () => void; onAnother: () => void; loading: boolean; feedback: string[]; setFeedback: (items: string[]) => void }) { const toggle = (value: string) => setFeedback(feedback.includes(value) ? feedback.filter((item) => item !== value) : [...feedback, value]); return <div className="modal-backdrop" onMouseDown={onClose}><section className="outfit-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={onClose}><X size={20}/></button><span className="eyebrow">TODAY'S OUTFIT</span><h2>{outfit.title}</h2><div className="outfit-pieces">{items.map((item, index) => <div className="outfit-piece" key={item.id}>{index > 0 && <span className="plus">+</span>}<img src={item.image} alt={item.name}/><b>{item.name}</b><small>{item.category}</small></div>)}</div><div className="reason"><Sparkles size={17}/><div><b>Why this works</b><p>{outfit.reasoning}</p></div></div><div className="feedback"><span>Improve the next one</span><button onClick={() => toggle("like")} className={feedback.includes("like") ? "selected" : ""}><ThumbsUp size={16}/> Similar</button><button onClick={() => toggle("too-formal")} className={feedback.includes("too-formal") ? "selected" : ""}><ThumbsDown size={16}/> Less formal</button></div><div className="outfit-actions"><button className="secondary-button" onClick={onAnother} disabled={loading}><RotateCcw size={17}/>{loading ? "Styling..." : "Try another"}</button><button className="secondary-button" onClick={onSave}><Heart size={17}/> Save outfit</button><button className="primary-button" onClick={onWear}><Check size={18}/> Wear this</button></div></section></div>; }

export default App;
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<App />);