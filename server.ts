import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  // API Route
  app.post("/api/synthesize", async (req, res) => {
    try {
      const { text, stylePrompt, apiKey: reqApiKey } = req.body;
      if (!text) {
        return res.status(400).json({ error: { message: "Text script is required" } });
      }

      const apiKey = reqApiKey || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: { message: "GEMINI_API_KEY environment variable is missing. Set it in .env.local" },
        });
      }

      // Prepend context style prompts
      const narratorPrompt = stylePrompt ? `${stylePrompt}\n\n${text}` : text;

      let base64Audio: string | undefined;
      let mimeType = "audio/L16;rate=24000";

      // Method 1: Try GoogleGenAI SDK
      try {
        const aiInstance = getAI(apiKey);
        const response = await aiInstance.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: narratorPrompt }] }],
          config: {
            temperature: 1,
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Algieba",
                },
              },
            },
          },
        });

        const candidates = response.candidates || [];
        for (const cand of candidates) {
          const parts = cand.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              base64Audio = part.inlineData.data;
              if (part.inlineData.mimeType) {
                mimeType = part.inlineData.mimeType;
              }
              break;
            }
          }
          if (base64Audio) break;
        }
      } catch (sdkError: any) {
        console.warn("SDK synthesis attempt encountered issue, trying direct REST endpoint:", sdkError?.message || sdkError);
      }

      // Method 2: Direct REST v1beta fallback if SDK didn't return audio
      if (!base64Audio) {
        const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
        const restBody = {
          contents: [
            {
              role: "user",
              parts: [{ text: narratorPrompt }],
            },
          ],
          generationConfig: {
            temperature: 1,
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Algieba",
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
          const errMsg = errData?.error?.message || `Direct TTS API call failed with status ${restRes.status}`;
          throw new Error(errMsg);
        }

        const data = await restRes.json();
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        for (const part of parts) {
          if (part.inlineData?.data) {
            base64Audio = part.inlineData.data;
            if (part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            break;
          }
        }

        if (!base64Audio) {
          const textPart = parts.find((p: any) => p.text)?.text;
          const finishReason = candidate?.finishReason;
          const promptFeedback = data?.promptFeedback;
          console.error("Direct REST response details:", JSON.stringify({ candidate, promptFeedback }, null, 2));

          throw new Error(
            textPart
              ? `Model returned text instead of audio: "${textPart.substring(0, 120)}..."`
              : finishReason
              ? `TTS generation ended without audio (reason: ${finishReason})`
              : "No audio returned from Gemini TTS API"
          );
        }
      }

      return res.json({
        audio: base64Audio,
        mimeType,
      });

    } catch (error: any) {
      console.error("Synthesize error:", error);
      const isQuota =
        error?.status === 429 ||
        error?.message?.includes("quota") ||
        error?.message?.includes("RESOURCE_EXHAUSTED") ||
        error?.message?.includes("rate limit") ||
        error?.message?.includes("rate-limit") ||
        error?.message?.includes("429");

      const statusCode = isQuota ? 429 : (error?.status || 500);

      return res.status(statusCode).json({
        error: {
          code: isQuota ? "RESOURCE_EXHAUSTED" : "SYNTHESIS_ERROR",
          message: error.message || "Internal server error",
          isQuota,
        },
      });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

function getAI(customKey?: string): GoogleGenAI {
  const key = customKey || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!key) {
    throw new Error("API Key is not configured in environment variables (.env.local).");
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

startServer();
