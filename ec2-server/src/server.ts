import express from "express";
import cors from "cors";

// Shape returned by https://picsum.photos/v2/list
interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
  url: string;
  download_url: string;
}

// Shape returned to the frontend
interface Pin {
  id: string;
  author: string;
  url: string;
  width: number;
  height: number;
  sourceUrl: string;
}

const PORT = Number(process.env.PORT ?? 3000);
const PIN_WIDTH = 400;
const DEFAULT_COUNT = 20;
const MAX_COUNT = 50;
// Picsum has ~1000 photos; with limit<=50 per page, pages 1-20 are always full.
const MAX_PAGE = 20;

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function fetchRandomPins(count: number): Promise<Pin[]> {
  const page = randomInt(1, MAX_PAGE);
  const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=${count}`);
  if (!res.ok) {
    throw new Error(`Picsum responded with ${res.status}`);
  }
  const photos = (await res.json()) as PicsumPhoto[];

  return shuffle(
    photos.map((photo) => {
      // Varying heights give the Pinterest-style masonry look
      const height = randomInt(300, 700);
      return {
        id: photo.id,
        author: photo.author,
        url: `https://picsum.photos/id/${photo.id}/${PIN_WIDTH}/${height}`,
        width: PIN_WIDTH,
        height,
        sourceUrl: photo.url,
      };
    }),
  );
}

const app = express();
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/images", async (req, res) => {
  const requested = Number(req.query.count ?? DEFAULT_COUNT);
  const count = Number.isFinite(requested)
    ? Math.min(Math.max(Math.floor(requested), 1), MAX_COUNT)
    : DEFAULT_COUNT;

  try {
    const images = await fetchRandomPins(count);
    res.json({ images });
  } catch (err) {
    console.error("Failed to fetch images:", err);
    res.status(502).json({ error: "Failed to fetch images from upstream" });
  }
});

app.listen(PORT, () => {
  console.log(`Image server listening on port ${PORT}`);
});
