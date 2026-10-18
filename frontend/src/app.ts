interface AppConfig {
  imagesApiUrl: string;
  profileFunctionUrl: string;
}

interface Pin {
  id: string;
  author: string;
  url: string;
  width: number;
  height: number;
  sourceUrl: string;
}

interface Profile {
  userId: string;
  displayName?: string;
  email?: string;
  bio?: string;
  interests?: string[];
}

declare global {
  interface Window {
    APP_CONFIG?: AppConfig;
  }
}

const BATCH_SIZE = 20;
// Start loading the next batch this far before the user actually hits the bottom
const PREFETCH_MARGIN_PX = 800;
const LAST_USER_KEY = "pinboard:lastUserId";

const config = window.APP_CONFIG;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  form: $<HTMLFormElement>("profile-form"),
  userId: $<HTMLInputElement>("userId"),
  displayName: $<HTMLInputElement>("displayName"),
  email: $<HTMLInputElement>("email"),
  bio: $<HTMLTextAreaElement>("bio"),
  interests: $<HTMLInputElement>("interests"),
  loadBtn: $<HTMLButtonElement>("load-btn"),
  saveBtn: $<HTMLButtonElement>("save-btn"),
  profileStatus: $<HTMLSpanElement>("profile-status"),
  greeting: $<HTMLSpanElement>("greeting"),
  feed: $<HTMLDivElement>("feed"),
  feedStatus: $<HTMLDivElement>("feed-status"),
  sentinel: $<HTMLDivElement>("sentinel"),
};

// ---------- Profile (S3 page -> Lambda Function URL -> DynamoDB) ----------

function setProfileStatus(message: string, kind: "" | "error" | "success" = "") {
  els.profileStatus.textContent = message;
  els.profileStatus.className = `status ${kind}`;
}

function profileUrl(params?: Record<string, string>): string {
  const url = new URL(config!.profileFunctionUrl);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function fillForm(profile: Profile) {
  els.userId.value = profile.userId;
  els.displayName.value = profile.displayName ?? "";
  els.email.value = profile.email ?? "";
  els.bio.value = profile.bio ?? "";
  els.interests.value = (profile.interests ?? []).join(", ");
  els.greeting.textContent = `Hi, ${profile.displayName || profile.userId}`;
}

function readUserId(): string | null {
  const userId = els.userId.value.trim();
  if (!userId || !els.userId.checkValidity()) {
    setProfileStatus("Enter a username (letters, numbers, '.', '_' or '-').", "error");
    els.userId.focus();
    return null;
  }
  return userId;
}

function rememberUser(userId: string) {
  try {
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // Storage may be unavailable (private mode); not critical
  }
}

async function loadProfile(userId: string) {
  els.loadBtn.disabled = true;
  setProfileStatus("Loading…");
  try {
    const res = await fetch(profileUrl({ userId }));
    const data = await res.json();
    if (res.status === 404) {
      setProfileStatus("No profile yet — fill in the fields and save to create one.");
      els.greeting.textContent = "";
      return;
    }
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    fillForm(data.profile);
    rememberUser(userId);
    setProfileStatus("Profile loaded.", "success");
  } catch (err) {
    setProfileStatus(`Could not load profile: ${(err as Error).message}`, "error");
  } finally {
    els.loadBtn.disabled = false;
  }
}

async function saveProfile() {
  const userId = readUserId();
  if (!userId) return;

  const profile: Profile = {
    userId,
    displayName: els.displayName.value,
    email: els.email.value,
    bio: els.bio.value,
    interests: els.interests.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  els.saveBtn.disabled = true;
  setProfileStatus("Saving…");
  try {
    const res = await fetch(profileUrl(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    fillForm(data.profile);
    rememberUser(userId);
    setProfileStatus("Profile saved!", "success");
  } catch (err) {
    setProfileStatus(`Could not save profile: ${(err as Error).message}`, "error");
  } finally {
    els.saveBtn.disabled = false;
  }
}

// ---------- Infinite scroll (S3 page -> API Gateway -> EC2 -> Picsum) ----------

let isLoading = false;

// Masonry: pins go into the shortest column. Heights are tracked from the
// aspect ratios the server sends, so placement never waits on image loads and
// already-placed pins never move when a new batch arrives.
const TARGET_COLUMN_WIDTH = 236;
const pins: HTMLElement[] = [];
let columns: { el: HTMLDivElement; height: number }[] = [];

function columnCountForWidth(width: number): number {
  return Math.max(2, Math.floor(width / TARGET_COLUMN_WIDTH));
}

function placePin(figure: HTMLElement) {
  const shortest = columns.reduce((a, b) => (b.height < a.height ? b : a));
  shortest.el.append(figure);
  // + rough allowance for the caption and margin, in column-width units
  shortest.height += Number(figure.dataset.aspect) + 0.2;
}

function buildColumns() {
  const count = columnCountForWidth(els.feed.clientWidth);
  if (count === columns.length) return;
  columns = Array.from({ length: count }, () => {
    const el = document.createElement("div");
    el.className = "feed-column";
    return { el, height: 0 };
  });
  els.feed.replaceChildren(...columns.map((c) => c.el));
  pins.forEach(placePin);
}

function renderPin(pin: Pin): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "pin";
  figure.dataset.aspect = String(pin.height / pin.width);

  const link = document.createElement("a");
  link.href = pin.sourceUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const img = document.createElement("img");
  img.src = pin.url;
  img.alt = `Photo by ${pin.author}`;
  img.loading = "lazy";
  // Reserve space up front so the layout doesn't jump while images load
  img.width = pin.width;
  img.height = pin.height;

  const caption = document.createElement("figcaption");
  caption.textContent = pin.author;

  link.append(img);
  figure.append(link, caption);
  return figure;
}

function showFeedSpinner() {
  els.feedStatus.replaceChildren();
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  els.feedStatus.append(spinner);
}

function showFeedError(message: string) {
  els.feedStatus.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  const retry = document.createElement("button");
  retry.className = "btn secondary";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => loadMoreImages());
  els.feedStatus.append(text, retry);
}

function sentinelNearViewport(): boolean {
  return els.sentinel.getBoundingClientRect().top < window.innerHeight + PREFETCH_MARGIN_PX;
}

async function loadMoreImages() {
  if (isLoading) return;
  isLoading = true;
  showFeedSpinner();

  try {
    const base = config!.imagesApiUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/images?count=${BATCH_SIZE}`);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data: { images: Pin[] } = await res.json();

    for (const pin of data.images) {
      const figure = renderPin(pin);
      pins.push(figure);
      placePin(figure);
    }
    els.feedStatus.replaceChildren();
  } catch (err) {
    showFeedError(`Couldn't load more pins: ${(err as Error).message}`);
    isLoading = false;
    return;
  }

  isLoading = false;
  // The observer only fires when visibility changes, so if a batch didn't
  // fill the screen (e.g. tall monitors), keep loading until it does.
  if (sentinelNearViewport()) {
    void loadMoreImages();
  }
}

// ---------- Startup ----------

function init() {
  if (!config?.imagesApiUrl || !config?.profileFunctionUrl) {
    els.feedStatus.textContent =
      "Missing config.js — copy config.example.js to config.js and set your endpoint URLs.";
    return;
  }

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveProfile();
  });
  els.loadBtn.addEventListener("click", () => {
    const userId = readUserId();
    if (userId) void loadProfile(userId);
  });

  let lastUser: string | null = null;
  try {
    lastUser = localStorage.getItem(LAST_USER_KEY);
  } catch {
    // ignore
  }
  if (lastUser) {
    els.userId.value = lastUser;
    void loadProfile(lastUser);
  }

  buildColumns();
  window.addEventListener("resize", buildColumns);

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreImages();
      }
    },
    { rootMargin: `0px 0px ${PREFETCH_MARGIN_PX}px 0px` },
  );
  observer.observe(els.sentinel);
}

init();

export {};
