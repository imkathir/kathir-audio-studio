# kathirStudio — Universal Text to Audio Format Converter

[![Deploy to GitHub Pages](https://github.com/imkathir/kathir-tts-studio/actions/workflows/deploy.yml/badge.svg)](https://github.com/imkathir/kathir-tts-studio/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**kathirStudio** is a full-featured text-to-speech studio that converts text of any length into high-fidelity audio across 9 major operating system audio formats, with native support for Apple iPhone formats alongside Universal and Lossless audio standards.

---

## 🌟 Key Features

- **Chunked Text-to-Speech (Unlimited Duration)**:
  - Multi-page texts (30,000 to 60,000+ characters) are automatically partitioned by paragraphs and syntactic boundaries, synthesized, and merged seamlessly with audio normalization. No 3-minute cutoff.
- **Selectable Target Formats**:
  - Checkboxes to choose exactly which formats to generate (`.mp3`, `.m4a`, `.m4r`, `.wav`, `.flac`, `.ogg`, `.opus`, `.aiff`, `.caf`) to save processing time and storage.
- **Native Apple iPhone & iOS Support**:
  - `.m4r` (iOS Ringtone: directly recognizable by iOS for ringtones & alarms)
  - `.m4a` (Apple AAC: high-efficiency audio for iPhone, iPad, Apple Watch, Mac)
  - `.aiff` (Apple uncompressed studio PCM)
  - `.caf` (Apple 64-bit CoreAudio container)
- **Universal & Lossless Standards**:
  - `.mp3`, `.ogg` Vorbis, `.opus` VoIP
  - `.wav` 16-bit PCM Master, `.flac` Bit-Perfect Lossless
- **Natural Voices**:
  - Formant-preserved neural male voices (`Charon`, `Fenrir`, `Puck`) and natural studio female narrators (`Kore`, `Zephyr`).
- **Interactive Audio Studio**:
  - Live audio waveform visualizer, frequency spectrum, volume controls, playback speed modulation, looping, and ZIP batch download.

---

## 🚀 Live Demo

- **Vercel (current)**: [https://kathir-audio-studio.vercel.app](https://kathir-audio-studio.vercel.app)
- **GitHub Pages**: [https://imkathir.github.io/kathir-tts-studio/](https://imkathir.github.io/kathir-tts-studio/)

---

## ☕ Buy me a coffee (Razorpay Standard Checkout)

The app ships with a "Buy me a coffee" section at the bottom of the page. The top bar has a
coffee-cup button and a "Buy me a coffee" link that smooth-scrolls down to it, where the
supporter picks an amount in their own currency (INR, USD, EUR, GBP, AUD, CAD, SGD, AED, JPY, ZAR)
and pays through the Razorpay Standard Checkout modal.

### How it works

| Step | Where | What happens |
| --- | --- | --- |
| 1. Create order | `POST /api/create-order` | The server creates a Razorpay order (`amount` in minor units, `currency`, unique `receipt`). Returns `{ order_id, amount, currency }`. Minimum order amount is `100` minor units (100 paise = ₹1). |
| 2. Checkout | Browser | `https://checkout.razorpay.com/v1/checkout.js` opens the modal with the `order_id`. On success the browser receives `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`. |
| 3. Verify | `POST /api/verify-payment` | The server recomputes `HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)` and compares it with `razorpay_signature`. The payment is only accepted when the signatures match (constant-time comparison). |

### Environment variables

`.env` is git-ignored - never commit the key secret.

```bash
# Server-side only (never sent to the browser)
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_key_secret

# Public key id, inlined into the browser bundle by Vite
VITE_RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
```

On Vercel, add the three variables as **Project → Settings → Environment Variables**
(`RAZORPAY_KEY_SECRET` should be marked *sensitive* / *encrypted*). `VITE_RAZORPAY_KEY_ID` is read
at build time, so redeploy after changing it.

### Where the code lives

| Path | Purpose |
| --- | --- |
| `api/create-order.js` | Vercel serverless function that creates the Razorpay order (official SDK, with a REST fallback). |
| `api/verify-payment.js` | Vercel serverless function that verifies the payment signature. |
| `api/package.json` | Marks the `/api` directory as CommonJS (see the note below). |
| `shared/currency.ts` | Currency table, minor-unit conversion and formatting. |
| `src/components/SupportSection.tsx` | The "Buy me a coffee" UI. |
| `src/utils/razorpay.ts` | Checkout script loader and browser helpers. |
| `server.ts` | The local Express backend mounts the very same two handlers. |

> **Why is `/api` CommonJS?** Vercel compiles ES module syntax to CommonJS *unless* the nearest
> `package.json` declares `"type": "module"`. The root `package.json` does declare it (the Vite app
> and `server.ts` need it), so `/api/package.json` pins the serverless functions to CommonJS -
> otherwise every request fails with `FUNCTION_INVOCATION_FAILED`. The handlers are also
> self-contained (no cross-file imports) and use the global `fetch` for the Razorpay REST API, with
> the `razorpay` SDK as the primary path.

> International currencies require **international transactions** to be enabled on the Razorpay
> account; otherwise Razorpay rejects the order and the error is shown in the section.

---

## 🛠️ Local Development & Full Server Setup

To enable local FFmpeg transcoding for all 9 formats with the Node.js Express server:

### Prerequisites

- Node.js (v18+)
- FFmpeg installed on your machine (`brew install ffmpeg` on macOS, `sudo apt-get install ffmpeg` on Ubuntu/Debian)

### Installation

```bash
# 1. Clone repository
git clone https://github.com/imkathir/kathir-audio-studio.git
cd kathir-audio-studio

# 2. Install dependencies
npm install

# 3. Add your Razorpay keys (optional, enables the coffee section)
cp .env.example .env

# 4. Start development server (Express backend + Vite frontend)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 Build for Production

```bash
# Build frontend
npm run build

# Start production server
npm run start
```

---

## 📄 License

MIT License. Free for personal and commercial use.
