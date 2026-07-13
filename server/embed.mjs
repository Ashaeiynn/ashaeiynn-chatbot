// Shared multilingual embedder (runs locally in Node, no API, no Python at serve time).
// Model: multilingual-e5-small (384-dim) — handles Hindi↔English cross-lingual matching.
// e5 models expect "query: " on questions and "passage: " on indexed text.
// The model weights SHIP IN THE REPO (models/, split into <100MB parts for GitHub)
// so no environment ever downloads anything — deploys can't be broken by flaky networks.
import { pipeline, env as hfEnv } from "@huggingface/transformers";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const MODEL = "Xenova/multilingual-e5-small";
export const EMBED_DIM = 384;

const modelsDir = path.join(ROOT, "models");
const onnxDir = path.join(modelsDir, MODEL, "onnx");
const fullModel = path.join(onnxDir, "model_quantized.onnx");
// Reassemble the split weights on first run in any fresh environment.
if (!existsSync(fullModel) && existsSync(onnxDir)) {
  const parts = readdirSync(onnxDir).filter((f) => f.includes(".onnx.part-")).sort();
  if (parts.length) {
    writeFileSync(fullModel, Buffer.concat(parts.map((p) => readFileSync(path.join(onnxDir, p)))));
    console.log(`embed: assembled ${parts.length} model parts → model_quantized.onnx`);
  }
}
if (existsSync(fullModel)) {
  hfEnv.localModelPath = modelsDir;
  hfEnv.allowRemoteModels = false; // fully offline — the repo carries everything
}

let extractorPromise = null;
function getExtractor() {
  // q8 (8-bit) weights: ~4× less memory than fp32 with near-identical similarity
  // rankings — required to fit the 512MB free hosting instance.
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL, { dtype: "q8" }).catch((err) => {
      extractorPromise = null; // e.g. transient download failure — retry on next request
      throw err;
    });
  }
  return extractorPromise;
}

// Warm the model at startup so the first real request isn't slow.
export async function warmup() {
  await getExtractor();
}

// Embed an array of passages (indexed transcript chunks). Returns Float32Array[].
export async function embedPassages(texts) {
  const extractor = await getExtractor();
  const prefixed = texts.map((t) => `passage: ${t}`);
  const out = await extractor(prefixed, { pooling: "mean", normalize: true });
  return unstack(out, texts.length);
}

// Embed a single query (a visitor's question). Returns Float32Array.
export async function embedQuery(text) {
  const extractor = await getExtractor();
  const out = await extractor(`query: ${text}`, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data);
}

// Split a stacked [n * dim] tensor into n vectors.
function unstack(out, n) {
  const data = out.data;
  const dim = data.length / n;
  const vecs = [];
  for (let i = 0; i < n; i++) vecs.push(Float32Array.from(data.subarray(i * dim, (i + 1) * dim)));
  return vecs;
}

// Cosine similarity for normalized vectors is just the dot product.
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
