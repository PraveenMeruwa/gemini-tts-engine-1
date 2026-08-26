import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Volume2,
  Settings,
  Flame,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Download,
  RotateCcw,
  Loader2,
  Info,
  Key,
  Check,
  X
} from "lucide-react";
import { ChunkLogItem } from "./types";

const SAMPLE_RATE = 24000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 4000; // ms base for exponential backoff

export default function App() {
  // API Key management
  const [apiKey, setApiKey] = useState<string>(() => {
    return (
      localStorage.getItem("antigravity_api_key") ||
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      ""
    );
  });
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState(apiKey);

  // Config state
  const [scriptText, setScriptText] = useState("");
  const [stylePrompt, setStylePrompt] = useState(
    "Deliver this as a seasoned American narrator with a deep, gravelly baritone voice. Pace is slow and deliberate, like a storyteller recounting a grand adventure. Each sentence lands with weight. Pause between paragraphs. Build atmosphere through stillness. This is a cinematic narration — immersive, rich, and unhurried."
  );
  const [chunkSize, setChunkSize] = useState<number>(200);

  // Generation flow state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressTitle, setProgressTitle] = useState("Preparing script…");
  const [chunkLogs, setChunkLogs] = useState<ChunkLogItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError] = useState(false);

  // Audio output state
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [outputMeta, setOutputMeta] = useState("");
  const [outputTitle, setOutputTitle] = useState("");

  // Cached chunk buffers across retries
  const cachedBuffersRef = useRef<(ArrayBuffer | null)[]>([]);
  const chunksRef = useRef<string[]>([]);

  // Stats
  const [numChars, setNumChars] = useState(0);
  const [numWords, setNumWords] = useState(0);
  const [estimatedMins, setEstimatedMins] = useState(0);
  const [numChunks, setNumChunks] = useState(0);

  // Calculate live stats on script input change
  useEffect(() => {
    const trimmed = scriptText.trim();
    const chars = trimmed.length;
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(0, Math.round(words / 130)); // ~130 WPM at 0.9x pacing
    const chunksCount = words > 0 ? Math.ceil(words / chunkSize) : 0;

    setNumChars(chars);
    setNumWords(words);
    setEstimatedMins(mins);
    setNumChunks(chunksCount);
  }, [scriptText, chunkSize]);

  // Text chunker algorithm matching the raw JS
  function chunkText(text: string, maxWords: number): string[] {
    const hardCap = Math.min(maxWords, 250);
    // Split on sentence boundaries to avoid cutting mid-sentence
    const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
    const chunks: string[] = [];
    let current = "";
    let wordCount = 0;

    for (const sentence of sentences) {
      const sentWords = sentence.trim().split(/\s+/).length;

      // If a single sentence exceeds the hard cap, force-split it at word boundary
      if (sentWords > hardCap) {
        if (current.trim()) {
          chunks.push(current.trim());
          current = "";
          wordCount = 0;
        }
        const words = sentence.trim().split(/\s+/);
        let forcedChunk = "";
        let forcedCount = 0;
        for (const word of words) {
          if (forcedCount >= hardCap) {
            chunks.push(forcedChunk.trim());
            forcedChunk = word + " ";
            forcedCount = 1;
          } else {
            forcedChunk += word + " ";
            forcedCount++;
          }
        }
        if (forcedChunk.trim()) {
          current = forcedChunk;
          wordCount = forcedCount;
        }
        continue;
      }

      if (wordCount + sentWords > hardCap && current.trim()) {
        chunks.push(current.trim());
        current = sentence;
        wordCount = sentWords;
      } else {
        current += sentence;
        wordCount += sentWords;
      }
    }
    if (current.trim()) {
      chunks.push(current.trim());
    }
    return chunks;
  }

  // Direct client-side synthesis for GitHub Pages / static hosting
  async function synthesiseDirect(
    text: string,
    stylePromptText: string,
    key: string
  ): Promise<{ audio: string; mimeType: string }> {
    const narratorPrompt = stylePromptText
      ? `${stylePromptText}\n\nStrictly narrate only the text below verbatim. Do not add, continue, or improvise any extra sentences:\n\n${text}`
      : text;
    const models = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
    ];
    let lastError: any = null;

    const endpoints = [
      (m: string) => `https://us-central1-aiplatform.googleapis.com/v1/projects/gen-lang-client-0356788890/locations/us-central1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
      (m: string) => `https://us-central1-aiplatform.googleapis.com/v1beta1/projects/gen-lang-client-0356788890/locations/us-central1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
    ];

    for (const model of models) {
      for (const getUrl of endpoints) {
        try {
          const restUrl = getUrl(model);
          const isV1 = restUrl.includes("/v1/");
          const endpointLabel = `Vertex AI ${isV1 ? "v1" : "v1beta1"} (${model})`;
          const restBody = {
            contents: [
              {
                role: "user",
                parts: [{ text: narratorPrompt }],
              },
            ],
            safety_settings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
            ],
            generation_config: {
              temperature: 1,
              response_modalities: ["AUDIO"],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: "Algieba",
                  },
                },
              },
            },
          };

          const restRes = await fetch(restUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "aistudio-build",
            },
            body: JSON.stringify(restBody),
          });

          if (!restRes.ok) {
            const errData = await restRes.json().catch(() => ({}));
            const errMsg =
              errData?.error?.message || `TTS API call failed with status ${restRes.status}`;
            throw new Error(`[${endpointLabel}] ${errMsg}`);
          }

          const data = await restRes.json();
          const candidate = data?.candidates?.[0] || data?.predictions?.[0];
          const parts = candidate?.content?.parts || candidate?.parts || [];

          let base64Audio: string | undefined;
          let mimeType = "audio/L16;rate=24000";

          for (const part of parts) {
            const inlineData = part.inline_data || part.inlineData || part.inline_bytes || part.inlineBytes;
            if (inlineData?.data) {
              base64Audio = inlineData.data;
              if (inlineData.mime_type || inlineData.mimeType) {
                mimeType = inlineData.mime_type || inlineData.mimeType;
              }
              break;
            }
            if (typeof part.audio === "string") {
              base64Audio = part.audio;
              break;
            }
          }

          if (base64Audio) {
            return { audio: base64Audio, mimeType };
          }

          const textPart = parts.find((p: any) => p.text)?.text;
          const finishReason = candidate?.finishReason || candidate?.finish_reason;
          const rawPreview = JSON.stringify(data).substring(0, 250);
          throw new Error(
            textPart
              ? `Model returned text instead of audio: "${textPart.substring(0, 100)}..."`
              : finishReason
              ? `TTS ended without audio (reason: ${finishReason})`
              : `No audio stream returned in response: ${rawPreview}`
          );
        } catch (e: any) {
          lastError = e;
          if (
            e.message?.includes("API_KEY_INVALID") ||
            e.message?.includes("API key not valid") ||
            e.message?.includes("quota") ||
            e.message?.includes("RESOURCE_EXHAUSTED") ||
            e.message?.includes("429")
          ) {
            throw e;
          }
        }
      }
    }

    throw lastError || new Error("Failed to synthesize audio with Gemini TTS");
  }

  // Single synthesis step with dual fallback (Server -> Direct REST) and retry backoff
  async function synthesiseChunk(
    text: string,
    stylePromptText: string,
    attempt = 1
  ): Promise<ArrayBuffer> {
    try {
      let base64Audio: string | undefined;
      let mimeType = "audio/L16;rate=24000";
      const activeKey = apiKey.trim();

      let serverHandled = false;

      // 1. First attempt local Node/Express backend if running locally
      try {
        const response = await fetch("/api/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            stylePrompt: stylePromptText,
            apiKey: activeKey,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.audio) {
            base64Audio = data.audio;
            mimeType = data.mimeType || mimeType;
            serverHandled = true;
          }
        } else if (response.status === 429) {
          setIsQuotaError(true);
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.error?.message || "Rate limit or quota exceeded");
        }
      } catch (serverErr: any) {
        if (
          serverErr.message?.includes("Rate limit") ||
          serverErr.message?.includes("quota") ||
          serverErr.message?.includes("RESOURCE_EXHAUSTED")
        ) {
          throw serverErr;
        }
      }

      // 2. If running on GitHub Pages (static) or server failed, use direct browser synthesis
      if (!serverHandled) {
        if (!activeKey) {
          throw new Error("API Key is missing. Please set your API key in Key Settings.");
        }
        const directResult = await synthesiseDirect(text, stylePromptText, activeKey);
        base64Audio = directResult.audio;
        mimeType = directResult.mimeType;
      }

      if (!base64Audio) {
        throw new Error("No audio returned from Gemini TTS engine");
      }

      const raw = atob(base64Audio);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }

      if (mimeType.includes("wav") || mimeType.includes("wave")) {
        // Strip 44-byte header to get raw PCM for stitching
        return bytes.buffer.slice(44);
      } else {
        return bytes.buffer;
      }
    } catch (err: any) {
      const isQuota =
        err?.message?.includes("quota") ||
        err?.message?.includes("RESOURCE_EXHAUSTED") ||
        err?.message?.includes("429");
      if (isQuota) {
        setIsQuotaError(true);
      }

      if (attempt < MAX_RETRIES) {
        // Wait backoff delay (e.g. 4s, 8s)
        const delay = RETRY_BASE_DELAY * attempt;
        await new Promise((r) => setTimeout(r, delay));
        return synthesiseChunk(text, stylePromptText, attempt + 1);
      }
      throw err;
    }
  }

  // Stitches PCM Buffers into a single continuous mono 16-bit 24kHz WAV stream
  function pcmBuffersToWav(buffers: ArrayBuffer[], sampleRate: number): ArrayBuffer {
    let totalLength = 0;
    const arrays = buffers.map((buf) => new Int16Array(buf));
    arrays.forEach((a) => (totalLength += a.length));

    const wavBuffer = new ArrayBuffer(44 + totalLength * 2);
    const view = new DataView(wavBuffer);

    function writeStr(offset: number, str: string) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + totalLength * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, totalLength * 2, true);

    let offset = 44;
    for (const arr of arrays) {
      for (let i = 0; i < arr.length; i++) {
        view.setInt16(offset, arr[i], true);
        offset += 2;
      }
    }

    return wavBuffer;
  }

  // Orchestrator function (supports retry on failed chunks)
  async function runSynthesisFlow(onlyFailed = false) {
    if (isGenerating) return;

    const script = scriptText.trim();
    if (!script) {
      setErrorMsg("Please paste your script before generating.");
      return;
    }
    if (script.length < 20) {
      setErrorMsg("Script is too short. Paste your full Sleepy Tales Den script.");
      return;
    }

    setErrorMsg(null);
    setIsQuotaError(false);
    setIsGenerating(true);
    setProgressPct(0);
    setProgressTitle("Dividing script into optimal story segments…");

    let chunks = chunksRef.current;
    if (!onlyFailed || chunks.length === 0) {
      chunks = chunkText(script, chunkSize);
      chunksRef.current = chunks;
      cachedBuffersRef.current = new Array(chunks.length).fill(null);
    }

    const total = chunks.length;

    // Create logs template
    if (!onlyFailed || chunkLogs.length !== total) {
      const initialLogs: ChunkLogItem[] = chunks.map((text, idx) => ({
        index: idx,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        status: "generating",
        message: `Chunk ${idx + 1} of ${total} — queued`,
      }));
      setChunkLogs(initialLogs);
    }

    let successCount = 0;
    let failCount = 0;

    let lastDetailedError = "";

    for (let i = 0; i < total; i++) {
      // If already generated successfully, skip
      if (onlyFailed && cachedBuffersRef.current[i]) {
        successCount++;
        continue;
      }

      // Update state for current processing chunk
      setChunkLogs((prev) =>
        prev.map((log, idx) =>
          idx === i
            ? { ...log, status: "generating", message: `Chunk ${i + 1} of ${total} — synthesising` }
            : log
        )
      );
      setProgressPct((i / total) * 85);
      setProgressTitle(`Rendering narration segment ${i + 1} of ${total}…`);

      try {
        const buffer = await synthesiseChunk(chunks[i], stylePrompt);
        cachedBuffersRef.current[i] = buffer;
        successCount++;
        setChunkLogs((prev) =>
          prev.map((log, idx) =>
            idx === i ? { ...log, status: "done", message: `Chunk ${i + 1} of ${total} — complete` } : log
          )
        );
      } catch (err: any) {
        failCount++;
        const msg = err.message || "Synthesise error";
        lastDetailedError = msg;
        setChunkLogs((prev) =>
          prev.map((log, idx) =>
            idx === i
              ? {
                  ...log,
                  status: "error",
                  message: `Chunk ${i + 1} failed: ${msg}`,
                }
              : log
          )
        );
      }

      // Friendly breathing room between chunks (3.5s) to avoid bursting rate limits
      if (i < total - 1) {
        await new Promise((r) => setTimeout(r, 3500));
      }
    }

    const validBuffers = cachedBuffersRef.current.filter((b): b is ArrayBuffer => b !== null);

    if (validBuffers.length === 0) {
      if (isQuotaError) {
        setErrorMsg(`Gemini API rate limit or quota exceeded (429): ${lastDetailedError || "Rate limit reached. Please wait 60s or ensure billing is active."}`);
      } else {
        setErrorMsg(lastDetailedError ? `Google API Error: ${lastDetailedError}` : "All chunks failed. Check your API key and connection, then try again.");
      }
      setIsGenerating(false);
      return;
    }

    // Stitch logic
    setProgressPct(90);
    setProgressTitle("Stitching voice clips into single soundscape…");

    try {
      const wavBuffer = pcmBuffersToWav(validBuffers, SAMPLE_RATE);
      const blob = new Blob([wavBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      const durationSec =
        validBuffers.reduce((sum, buf) => sum + new Int16Array(buf).length, 0) / SAMPLE_RATE;
      const mins = Math.floor(durationSec / 60);
      const secs = Math.round(durationSec % 60);

      setProgressPct(100);
      setProgressTitle("Cinematic narration generation complete!");
      setAudioUrl(url);
      setOutputTitle("Sleepy Tales Den — Algieba · Custom Tuned");
      setOutputMeta(
        `${mins}m ${secs}s · ${validBuffers.length} of ${total} chunks stitched · 24kHz mono WAV${
          failCount > 0 ? ` · (${failCount} chunk(s) pending/failed)` : ""
        }`
      );

      if (failCount > 0) {
        setErrorMsg(
          `${failCount} chunk(s) encountered rate limit and were skipped. The WAV file below contains all successfully generated parts. You can click 'Resume / Retry Failed Chunks' to fill in the missing parts.`
        );
      }
    } catch (err: any) {
      setErrorMsg(`Failed to stitch audio: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  function startGeneration() {
    runSynthesisFlow(false);
  }

  function retryFailedChunks() {
    runSynthesisFlow(true);
  }

  function resetAll() {
    setAudioUrl(null);
    setIsGenerating(false);
    setChunkLogs([]);
    setScriptText("");
    setErrorMsg(null);
    setIsQuotaError(false);
    setProgressPct(0);
    setProgressTitle("");
    cachedBuffersRef.current = [];
    chunksRef.current = [];
  }

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
      {/* Top Bar: Key Settings */}
      <div className="w-full flex justify-end mb-3">
        <button
          onClick={() => {
            setTempApiKey(apiKey);
            setShowKeyModal(true);
          }}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 hover:bg-surface border border-border-custom hover:border-ember text-xs text-ash hover:text-parchment transition-all shadow-sm cursor-pointer"
          title="Configure API Key"
        >
          <Key className="w-3.5 h-3.5 text-ember" />
          <span className="font-mono text-[11px]">
            {apiKey ? `Key: ${apiKey.substring(0, 6)}...${apiKey.slice(-4)}` : "Set API Key"}
          </span>
          <Settings className="w-3 h-3 text-ash ml-0.5" />
        </button>
      </div>

      {/* Header */}
      <header className="text-center mb-8" id="narration-header">
        <div className="text-xs tracking-[0.25em] uppercase text-ember font-semibold mb-2">
          Sleepy Tales Den
        </div>
        <h1 className="font-serif text-3xl md:text-5xl font-normal text-parchment leading-tight mb-3">
          Voice Generator
        </h1>
        <p className="text-sm text-ash max-w-md mx-auto leading-relaxed">
          Transforms your scripts into cinematic narration using the Algieba voice — Gentle Giant, American General.
        </p>
      </header>

      {/* Flame divider */}
      <div className="flex justify-center items-center gap-1 mb-8">
        <div className="w-16 h-[1px] bg-gradient-to-r from-transparent to-ember" />
        <Flame className="w-4 h-4 text-ember animate-pulse" />
        <div className="w-16 h-[1px] bg-gradient-to-l from-transparent to-ember" />
      </div>

      {/* Main card */}
      <main className="w-full bg-surface border border-border-custom rounded-xl shadow-2xl overflow-hidden p-6 md:p-8 space-y-8">
        
        {/* Section 1: Script Area */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ember font-semibold">
            <FileText className="w-4 h-4" />
            <span>Your Script</span>
          </div>

          <textarea
            id="script-input"
            className="w-full min-h-[220px] bg-surface-2 border border-border-custom rounded-lg p-4 text-sm text-parchment leading-relaxed placeholder-ash/50 outline-none transition-colors focus:border-ember"
            placeholder="Paste your full script here. Long scripts are automatically split into chunks and stitched into one seamless WAV file..."
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            disabled={isGenerating}
          />

          <div className="flex justify-between items-center text-xs text-ash">
            <span className={numChars > 50000 ? "text-ember font-medium" : ""}>
              {numChars.toLocaleString()} characters · {numWords.toLocaleString()} words · ~{estimatedMins} min audio
            </span>
          </div>

          {/* Expanded live chunk preview */}
          <AnimatePresence>
            {numWords > chunkSize && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-surface-2 border border-border-custom rounded-lg p-4 flex gap-3 text-xs leading-relaxed text-ash">
                  <Info className="w-4 h-4 text-ember flex-shrink-0 mt-0.5" />
                  <div>
                    Script will be split into <strong className="text-parchment">{numChunks}</strong> chunks of ~{chunkSize} words each, generated separately and stitched into one seamless WAV file.
                    <br />
                    Estimated generation time: <strong className="text-parchment">{numChunks * 12}–{numChunks * 20} seconds</strong>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Section 2: Config items */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-border-custom">
          
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider text-ash">Voice</label>
            <select
              className="w-full bg-surface-2 border border-border-custom rounded-lg px-3 py-2.5 text-xs text-parchment opacity-70 cursor-not-allowed outline-none"
              disabled
              value="Algieba"
            >
              <option value="Algieba">Algieba — Gentle Giant (Tuned)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider text-ash">Pacing Control</label>
            <div className="bg-surface-2 border border-border-custom rounded-lg px-3 py-2 text-xs text-ash leading-relaxed">
              Controlled via <strong className="text-parchment">Director's Notes</strong> below
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider text-ash">Chunk Size Limit</label>
            <select
              className="w-full bg-surface-2 border border-border-custom rounded-lg px-3 py-2.5 text-xs text-parchment outline-none cursor-pointer focus:border-ember transition-colors"
              value={chunkSize}
              onChange={(e) => setChunkSize(parseInt(e.target.value))}
              disabled={isGenerating}
            >
              <option value={150}>150 words — ultra reliable</option>
              <option value={200}>200 words — recommended</option>
              <option value={250}>250 words — maximum limit</option>
            </select>
          </div>

        </section>

        {/* Section 3: Director Notes */}
        <section className="space-y-3 pt-4 border-t border-border-custom">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ember font-semibold">
            <Sparkles className="w-4 h-4" />
            <span>Director's Notes (Style Prompt)</span>
          </div>
          <textarea
            className="w-full min-h-[90px] bg-surface-2 border border-border-custom rounded-lg p-3 text-xs text-parchment leading-relaxed placeholder-ash/50 outline-none transition-colors focus:border-ember"
            placeholder="Optional styling instructions - mood, pacing, delivery character..."
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
            disabled={isGenerating}
          />
        </section>

        {/* Action triggers */}
        <section className="space-y-4 pt-4 border-t border-border-custom">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={startGeneration}
              disabled={isGenerating || !scriptText.trim()}
              className="flex-1 py-4 bg-ember hover:bg-[#D4722D] active:translate-y-[1px] disabled:bg-ember-dim disabled:opacity-50 disabled:cursor-not-allowed text-parchment rounded-lg font-serif text-lg tracking-wide transition-all duration-150 flex justify-center items-center gap-2.5"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Generating Narration Stream…</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-5 h-5" />
                  <span>Generate Voiceover</span>
                </>
              )}
            </button>

            {chunkLogs.some((c) => c.status === "error") && !isGenerating && (
              <button
                onClick={retryFailedChunks}
                className="py-4 px-6 bg-surface-2 border border-ember text-ember hover:bg-ember hover:text-parchment rounded-lg font-serif text-base tracking-wide transition-all duration-150 flex justify-center items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Resume / Retry Failed</span>
              </button>
            )}
          </div>

          {/* Global error banner */}
          <AnimatePresence>
            {errorMsg && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="bg-danger/15 border border-danger p-4 rounded-lg flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-300 leading-relaxed space-y-1">
                  <div className="font-semibold text-red-200">
                    {isQuotaError ? "Rate Limit or API Quota Exceeded" : "Generation Notice"}
                  </div>
                  <div>{errorMsg}</div>
                  {isQuotaError && (
                    <div className="pt-1 text-[11px] text-ash">
                      Tip: Gemini TTS preview has per-minute request limits. Wait 30–60 seconds, or select a paid billing API key in the AI Studio Settings menu to increase your quota.
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Section: Generating progress status logs */}
        <AnimatePresence>
          {isGenerating && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="pt-6 border-t border-border-custom space-y-4 overflow-hidden"
              id="progress-section"
            >
              <div className="text-xs uppercase tracking-wider text-ember font-semibold">Generating</div>
              <div className="flex justify-between items-center text-xs">
                <span className="font-serif text-sm text-parchment">{progressTitle}</span>
                <span className="text-ember font-semibold text-sm">{Math.round(progressPct)}%</span>
              </div>
              <div className="h-1 bg-border-custom rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-ember-dim to-ember"
                  style={{ width: `${progressPct}%` }}
                  transition={{ ease: "easeInOut" }}
                />
              </div>

              {/* Step Logs trace */}
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                {chunkLogs.map((log) => (
                  <div
                    key={log.index}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-xs leading-relaxed transition-all duration-300 ${
                      log.status === "generating"
                        ? "bg-surface-2 border-ember-dim text-parchment"
                        : log.status === "done"
                        ? "bg-surface-2 border-success text-parchment"
                        : log.status === "error"
                        ? "bg-surface-2 border-danger text-red-300"
                        : "bg-surface-2 border-border-custom text-ash"
                    }`}
                  >
                    {log.status === "generating" && (
                      <Loader2 className="w-4 h-4 animate-spin text-ember" />
                    )}
                    {log.status === "done" && (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    )}
                    {log.status === "error" && (
                      <AlertTriangle className="w-4 h-4 text-danger" />
                    )}
                    <span className="flex-1">
                      {log.message}
                    </span>
                    <span className="text-[10px] text-ash">{log.wordCount} words</span>
                  </div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Section: Output area */}
        <AnimatePresence>
          {audioUrl && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-6 border-t border-border-custom space-y-4"
              id="output-section"
            >
              <div className="text-xs uppercase tracking-wider text-ember font-semibold">
                Your Voiceover is Ready
              </div>
              <div>
                <h3 className="font-serif text-lg text-parchment mb-1">{outputTitle}</h3>
                <p className="text-xs text-ash">{outputMeta}</p>
              </div>

              {/* Native audio player with sepia filter styling matching original visual density */}
              <audio
                src={audioUrl}
                controls
                className="w-full rounded-lg bg-surface-2 border border-border-custom shadow-inner focus:outline-none mix-blend-screen"
                style={{
                  filter: "invert(0.9) sepia(0.8) saturate(1.8) hue-rotate(330deg)",
                }}
              />

              <div className="flex flex-wrap gap-3 pt-2">
                <a
                  href={audioUrl}
                  download={`sleepy-tales-den-voiceover-${Date.now()}.wav`}
                  className="inline-flex items-center gap-2 py-2.5 px-6 border border-ember text-ember hover:bg-ember hover:text-parchment text-xs font-semibold rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download WAV</span>
                </a>
                <button
                  onClick={resetAll}
                  className="inline-flex items-center gap-2 py-2.5 px-6 border border-border-custom text-ash hover:border-ash hover:text-parchment text-xs font-semibold rounded-lg transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>New Script</span>
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

      </main>

      <footer className="mt-10 mb-16 text-[11px] text-ash text-center opacity-50 font-normal">
        Sleepy Tales Den · Internal Production Tool · Algieba Custom Tuned · Gemini TTS v3 · gemini-3.1-flash-tts-preview
      </footer>

      {/* API Key Modal */}
      <AnimatePresence>
        {showKeyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md bg-surface border border-border-custom rounded-xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-ember font-serif text-lg">
                  <Key className="w-5 h-5" />
                  <span>API Key Configuration</span>
                </div>
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="text-ash hover:text-parchment p-1 rounded-md cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-ash leading-relaxed">
                Configure your Antigravity / Gemini API key. The key is securely saved in your browser's <code className="text-parchment font-mono">localStorage</code> and used directly for text-to-speech generation.
              </p>

              <div className="space-y-1.5">
                <label className="block text-[11px] uppercase tracking-wider text-ash font-semibold">
                  API Key
                </label>
                <input
                  type="password"
                  className="w-full bg-surface-2 border border-border-custom rounded-lg p-3 text-xs font-mono text-parchment outline-none focus:border-ember transition-colors"
                  placeholder="AQ... or AIzaSy..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setTempApiKey("");
                    setApiKey("");
                    localStorage.removeItem("antigravity_api_key");
                    setShowKeyModal(false);
                  }}
                  className="text-xs text-ash hover:text-ember transition-colors underline underline-offset-2 cursor-pointer"
                >
                  Clear Key
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowKeyModal(false)}
                    className="px-4 py-2 text-xs text-ash hover:text-parchment border border-border-custom rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = tempApiKey.trim();
                      setApiKey(trimmed);
                      localStorage.setItem("antigravity_api_key", trimmed);
                      setShowKeyModal(false);
                    }}
                    className="px-4 py-2 bg-ember hover:bg-[#D4722D] text-parchment text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Key</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
