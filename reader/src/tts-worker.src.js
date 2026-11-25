// Doc Reader voice worker. Runs the Kokoro voice model inside the browser and
// returns finished MP3 audio for each piece of text. Nothing is sent anywhere.
// Built into ../tts-worker.js with:  npx esbuild (see BUILD.md)
import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { env } from "@huggingface/transformers";
import { Mp3Encoder } from "@breezystack/lamejs";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const RATE = 24000;
let tts = null, lastPhonemes = "", info = {};

function post(m, transfer) { self.postMessage(m, transfer || []); }

async function init(o) {
  env.backends.onnx.wasm.wasmPaths = o.wasmPaths;
  const iso = self.crossOriginIsolated === true;
  const threads = iso ? Math.max(1, o.threads | 0) : 1;
  env.backends.onnx.wasm.numThreads = threads;
  if (o.modelHost) env.remoteHost = o.modelHost;
  const seen = {};
  tts = await KokoroTTS.from_pretrained(MODEL, {
    dtype: o.dtype, device: o.device,
    progress_callback: (p) => {
      if (p.status !== "progress" || !/\.onnx$/.test(p.file || "")) return;
      const pct = Math.floor((p.loaded / p.total) * 100);
      if (seen[p.file] === pct) return;
      seen[p.file] = pct;
      post({ type: "download", loaded: p.loaded, total: p.total });
    },
  });
  // Remember the phoneme text of the last call so we can tell if the model's
  // 510-token limit cut a piece short.
  const tok = tts.tokenizer;
  tts.tokenizer = (text, opts) => { lastPhonemes = text; return tok(text, opts); };
  info = { device: o.device, dtype: o.dtype, threads, isolated: iso };
  post({ type: "ready", info });
}

// Break text into chunks the model can speak in one go.
function chunks(text, limit) {
  const sp = new TextSplitterStream();
  sp.push(text); sp.close();
  const out = []; let cur = "";
  for (const s0 of sp) {
    for (const s of hardSplit(s0, limit)) {
      if (cur && cur.length + s.length + 1 > limit) { out.push(cur); cur = s; }
      else cur = cur ? cur + " " + s : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}
// A single sentence longer than the limit: cut at a comma, semicolon or space.
function hardSplit(s, limit) {
  const out = [];
  while (s.length > limit) {
    const head = s.slice(0, limit);
    let cut = Math.max(head.lastIndexOf("; "), head.lastIndexOf(": "), head.lastIndexOf(", "), head.lastIndexOf(" – "), head.lastIndexOf(" — "));
    if (cut < limit * 0.4) cut = head.lastIndexOf(" ");
    if (cut < 1) cut = limit - 1;
    out.push(s.slice(0, cut + 1).trim());
    s = s.slice(cut + 1).trim();
  }
  if (s) out.push(s);
  return out;
}

async function sayChunk(text, voice, speed, depth) {
  const a = await tts.generate(text, { voice, speed });
  if (lastPhonemes.length > 505 && text.length > 40 && (depth || 0) < 4) {
    // Too long for the model: it would have dropped the end. Split and redo.
    const parts = hardSplit(text, Math.ceil(text.length / 2) + 10);
    if (parts.length > 1) {
      const bufs = [];
      for (const p of parts) bufs.push(await sayChunk(p, voice, speed, (depth || 0) + 1));
      return join(bufs);
    }
  }
  return trim(a.audio, 0.03, 0.3);
}
// The model leaves about a third of a second of silence before each chunk and
// more after it. Trim both so pauses between sentences stay natural.
function trim(a, lead, tail) {
  let s = 0, e = a.length - 1;
  while (s < e && Math.abs(a[s]) < 0.008) s++;
  while (e > s && Math.abs(a[e]) < 0.008) e--;
  s = Math.max(0, s - Math.round(RATE * lead));
  e = Math.min(a.length - 1, e + Math.round(RATE * tail));
  return a.subarray(s, e + 1);
}
function join(bufs) {
  let n = 0; for (const b of bufs) n += b.length;
  const out = new Float32Array(n); let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return out;
}
function toMp3(f32, kbps) {
  const enc = new Mp3Encoder(1, RATE, kbps);
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    pcm[i] = v < 0 ? v * 32768 : v * 32767;
  }
  const parts = []; let size = 0;
  for (let i = 0; i < pcm.length; i += 11520) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 11520));
    if (b.length) { parts.push(b); size += b.length; }
  }
  const tail = enc.flush();
  if (tail.length) { parts.push(tail); size += tail.length; }
  const out = new Uint8Array(size); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function healthy(f32) {
  if (!f32.length) return false;
  let sum = 0, peak = 0;
  for (let i = 0; i < f32.length; i++) {
    const v = f32[i];
    if (v !== v) return false; // NaN
    sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / f32.length);
  return rms > 0.005 && rms < 0.5 && peak <= 1.5;
}

async function speak(m) {
  const t0 = performance.now();
  const bufs = [];
  for (const c of chunks(m.text, m.limit || 300)) {
    if (!/[A-Za-z0-9]/.test(c)) continue;
    bufs.push(await sayChunk(c, m.voice, m.speed));
  }
  bufs.push(new Float32Array(Math.round(RATE * (m.gap == null ? 0.45 : m.gap))));
  const audio = join(bufs);
  const ok = healthy(audio.subarray(0, audio.length - bufs[bufs.length - 1].length));
  const out = { type: "piece", id: m.id, seconds: audio.length / RATE, ms: performance.now() - t0, ok };
  if (m.raw) { out.pcm = audio.buffer; post(out, [out.pcm]); return; }
  const mp3 = toMp3(audio, m.kbps || 64);
  out.mp3 = mp3.buffer;
  post(out, [out.mp3]);
}

let chain = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data;
  chain = chain.then(async () => {
    try {
      if (m.type === "init") await init(m);
      else if (m.type === "speak") await speak(m);
    } catch (err) {
      post({ type: "error", id: m.id, where: m.type, message: String((err && err.message) || err) });
    }
  });
};
