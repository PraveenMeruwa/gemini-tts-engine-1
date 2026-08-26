# 🎙️ Sleepy Tales Den — Voice Generator

Transforms bedtime stories and scripts into cinematic narration using the custom-tuned **Algieba** voice (*Gentle Giant, American General*).

Built with React 19, Vite, Tailwind CSS v4, Motion, and Google Gemini TTS engine.

---

## ✨ Features

- **Custom-Tuned Algieba Voice**: Locked exclusively to the Algieba voice persona with deliberate, hypnotic baritone pacing.
- **Smart Script Chunking**: Automatically analyzes word count and divides long bedtime stories into seamless audio chunks.
- **Dual-Mode Synthesis**:
  - **Local Node/Express Server**: Runs with local proxy endpoints.
  - **GitHub Pages / Serverless**: Direct browser-to-Gemini REST synthesis with automatic fallback.
- **Audio Stitching**: Combines 24kHz mono PCM chunks into a continuous WAV file with native playback and instant download.
- **Client-Side Key Management**: Securely store and change your Antigravity / Gemini API key directly in browser `localStorage`.

---

## 🚀 Running Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)

### Steps
1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure API Key**:
   Create or edit `.env.local`:
   ```env
   GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   VITE_GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   ```

3. **Start the local server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## 🌐 Deploying to GitHub Pages

This repository is pre-configured with a GitHub Actions workflow (`.github/workflows/deploy.yml`) for instant automated deployment:

1. **Create a GitHub repository** (e.g. `sleepy-tales-den-voice-generator`).
2. **Push your code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Sleepy Tales Den Algieba Voice Generator"
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
   git push -u origin main
   ```
3. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Navigate to **Settings** > **Pages**.
   - Under **Build and deployment** > **Source**, select **GitHub Actions**.
4. **Access your live site**:
   Your live application will be available at:
   ```
   https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/
   ```

<!-- Trigger build -->

<!-- Trigger build -->

<!-- Trigger build -->

<!-- Trigger build -->
