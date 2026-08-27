import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 8787);
const endpoint = "https://opencode.ai/zen/go/v1/chat/completions";

app.use(cors());
app.use(express.json({ limit: "12mb" }));

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(candidate);
}

async function askOpenCode(messages) {
  if (!process.env.OPENCODE_GO_API_KEY) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENCODE_GO_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENCODE_MODEL || "glm-5.3-flash",
      temperature: 0.45,
      messages
    })
  });
  if (!response.ok) throw new Error(`OpenCode returned ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

app.get("/api/status", (_request, response) => {
  response.json({ connected: Boolean(process.env.OPENCODE_GO_API_KEY), model: process.env.OPENCODE_MODEL || "glm-5.3-flash" });
});

app.post("/api/analyze", async (request, response) => {
  const { image } = request.body;
  if (!image) return response.status(400).json({ error: "An image is required." });
  try {
    const content = await askOpenCode([
      {
        role: "system",
        content: "You catalogue wardrobe images. Return ONLY JSON with name, category, type, color, brand, style (array), season (array), formality (number 1-5). Make a useful best guess."
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Identify the single most prominent clothing item in this photo." },
          { type: "image_url", image_url: { url: image } }
        ]
      }
    ]);
    if (!content) return response.json({ demo: true, item: { name: "New wardrobe piece", category: "Tops", type: "Shirt", color: "Navy", brand: "", style: ["Casual"], season: ["Spring", "Summer"], formality: 2 } });
    return response.json({ demo: false, item: extractJson(content) });
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : "Could not analyze that image." });
  }
});

app.post("/api/outfit", async (request, response) => {
  const { occasion, note, weather, wardrobe, feedback } = request.body;
  try {
    const content = await askOpenCode([
      {
        role: "system",
        content: "You are a personal stylist. Select a cohesive outfit using only the provided wardrobe ids. Respect occasion, weather and feedback. Return ONLY JSON: {itemIds:string[], title:string, reasoning:string}. Pick 2-4 pieces."
      },
      {
        role: "user",
        content: JSON.stringify({ occasion, note, weather, wardrobe, feedback })
      }
    ]);
    if (!content) return response.json({ demo: true });
    return response.json({ demo: false, outfit: extractJson(content) });
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : "Could not create an outfit." });
  }
});

app.listen(port, () => console.log(`Closetly AI proxy listening on ${port}`));