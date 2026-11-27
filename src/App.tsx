import type { VoiceOptions } from './utils/speech-controls';
import React, { useState, useEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { AudioInputPanel } from './components/AudioInputPanel';
import { WaveformPlayer } from './components/WaveformPlayer';
import { FormatResultsGrid } from './components/FormatResultsGrid';
import { SupportSection } from './components/SupportSection';
import { audioService } from './services/audio-service';
import { AudioJob, FormatItem, ColorTheme, ConversionProgressInfo } from './types';
import { Volume2, Sparkles, CheckCircle2, ShieldCheck, Music2, Apple, Smartphone, Info } from 'lucide-react';
import { createStaticPagesJob, normalizeMp3Bitrate } from './utils/client-tts';
import { Logo } from './components/Logo';

export default function App() {
  const [theme, setTheme] = useState<ColorTheme>(() => {
    const saved = localStorage.getItem('kathir_tts_theme') as ColorTheme;
    return saved || 'indigo';
  });

  const [currentJob, setCurrentJob] = useState<AudioJob | null>(null);
  const [activeFormat, setActiveFormat] = useState<FormatItem | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [conversionProgress, setConversionProgress] = useState<string>('');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<ConversionProgressInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isLooping, setIsLooping] = useState<boolean>(false);

  const formatsRef = useRef<HTMLDivElement | null>(null);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const supportRef = useRef<HTMLDivElement | null>(null);

  // Sync theme to root element and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kathir_tts_theme', theme);
  }, [theme]);

  useEffect(() => {
    const unsub = audioService.subscribe(() => {
      setIsPlaying(audioService.isPlaying);
      setCurrentTime(audioService.currentTime);
      setDuration(audioService.duration);
      setVolume(audioService.volume);
      setPlaybackRate(audioService.playbackRate);
      setIsLooping(audioService.isLooping);
      setActiveFormat(audioService.activeFormat);
      if (audioService.currentJob) {
        setCurrentJob(audioService.currentJob);
      }
    });
    return unsub;
  }, []);

  const applyCompletedJob = (jobData: AudioJob) => {
    setCurrentJob(jobData);
    audioService.currentJob = jobData;
    const defaultFmt = jobData.formats.find((f) => f.format === 'mp3') || jobData.formats[0];
    if (defaultFmt) {
      setActiveFormat(defaultFmt);
      audioService.activeFormat = defaultFmt;
    }
  };

  const handleConvert = async (params: {
    text: string;
    voice: string;
    gender: 'female' | 'male';
    language: string;
    languageName?: string;
    speechStyle: string;
    sampleRate: number;
    bitrate: string;
    title: string;
    formats: string[];
    isAutoInit?: boolean;
    voiceOptions?: Partial<VoiceOptions>;
  }) => {
    setIsConverting(true);
    setConversionError(null);
    const initialText =
      params.text.length > 2000
        ? `Preparing full document (${Math.round(params.text.length / 1000)}k chars) across sections...`
        : 'Synthesizing speech from text...';
    setConversionProgress(initialText);
    setProgressInfo({
      status: 'analyzing',
      percent: 3,
      currentChunk: 0,
      totalChunks: Math.max(1, Math.ceil(params.text.length / 360)),
      statusText: initialText,
      charsProcessed: 0,
      totalChars: params.text.length,
    });

    const isStaticHost =
      window.location.hostname.includes('github.io') ||
      window.location.hostname.includes('vercel.app');
    const customBackend = localStorage.getItem('kathir_tts_backend_url') || '';
    const baseBackend = customBackend ? customBackend.replace(/\/+$/, '') : '';

    // On GitHub Pages / Vercel (or static hosting without custom backend), execute the client-side neural engine
    if (isStaticHost && !customBackend) {
      try {
        const clientJob = await createStaticPagesJob({ ...params, mp3Bitrate: normalizeMp3Bitrate(params.bitrate) }, (info) => {
          setProgressInfo(info);
          setConversionProgress(info.statusText);
        });
        applyCompletedJob(clientJob);
      } catch (err: any) {
        console.error('Client speech synthesis error:', err);
        setConversionError(err?.message || 'Speech synthesis failed. Please try again.');
      } finally {
        setIsConverting(false);
        setProgressInfo(null);
        setConversionProgress('');
      }
      return;
    }

    // Call Express backend using non-blocking /api/convert-async + polling so long 60k+ texts never time out
    try {
      const asyncEndpoint = `${baseBackend}/api/convert-async`;
      const startRes = await fetch(asyncEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (startRes.ok) {
        const { asyncJobId } = await startRes.json();
        const statusUrl = `${baseBackend}/api/job-status/${asyncJobId}`;

        // Poll job status until completed or failed
        while (true) {
          await new Promise((r) => setTimeout(r, 700));
          const pollRes = await fetch(statusUrl);
          if (!pollRes.ok) {
            throw new Error(`Status check failed (HTTP ${pollRes.status})`);
          }
          const state = await pollRes.json();

          if (state.status === 'processing') {
            const pct = typeof state.percent === 'number' ? state.percent : 10;
            const statusText = state.statusText || 'Synthesizing Neural Speech...';
            setConversionProgress(statusText);
            setProgressInfo({
              status: pct >= 88 ? 'encoding' : 'synthesizing',
              percent: pct,
              currentChunk: state.currentChunk || 1,
              totalChunks: state.totalChunks || 1,
              statusText,
              charsProcessed: state.charsProcessed || 0,
              totalChars: state.totalChars || params.text.length,
            });
          } else if (state.status === 'completed' && state.result) {
            applyCompletedJob(state.result as AudioJob);
            return;
          } else if (state.status === 'failed') {
            throw new Error(state.error || 'Server conversion failed');
          }
        }
      }

      // If /api/convert-async doesn't exist (404), try synchronous /api/convert
      if (startRes.status === 404) {
        const syncEndpoint = `${baseBackend}/api/convert`;
        const res = await fetch(syncEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (res.ok) {
          setConversionProgress(
            `Transcoding into ${params.formats.length} selected audio format${params.formats.length !== 1 ? 's' : ''}...`
          );
          const data: AudioJob = await res.json();
          applyCompletedJob(data);
          return;
        }
      }

      throw new Error(`Backend returned HTTP ${startRes.status}`);
    } catch (err: any) {
      console.warn('Backend synthesis unavailable or failed, using browser speech engine:', err);
      try {
        const clientJob = await createStaticPagesJob({ ...params, mp3Bitrate: normalizeMp3Bitrate(params.bitrate) }, (info) => {
          setProgressInfo(info);
          setConversionProgress(info.statusText);
        });
        applyCompletedJob(clientJob);
      } catch (clientErr: any) {
        console.error('Fallback browser speech synthesis also failed:', clientErr);
        setConversionError(clientErr?.message || err?.message || 'Speech conversion failed.');
      }
    } finally {
      setIsConverting(false);
      setProgressInfo(null);
      setConversionProgress('');
    }
  };

  // Convert real spoken text on initial load with popular formats (MP3 & M4A)
  useEffect(() => {
    handleConvert({
      text: 'Welcome to kathirStudio. Convert any text into crystal clear audio files instantly.',
      voice: 'Kore',
      gender: 'female',
      language: 'auto',
      speechStyle: 'Clear, natural studio voice',
      sampleRate: 44100,
      bitrate: '128k',
      title: 'kathirStudio_Welcome',
      formats: ['mp3', 'm4a'],
      isAutoInit: true,
    });
  }, []);

  const scrollToFormats = () => {
    formatsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToStudio = () => {
    studioRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToSupport = () => {
    supportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)] flex flex-col font-sans selection:bg-[var(--accent-primary)]/30 selection:text-white transition-colors duration-200">
      {/* Top Bar with Brand and Color Theme Switcher */}
      <TopBar
        onScrollToFormats={scrollToFormats}
        onScrollToStudio={scrollToStudio}
        onScrollToSupport={scrollToSupport}
        currentTheme={theme}
        onSelectTheme={setTheme}
      />

      {/* Main Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {/* Studio Hero with Logo */}
        <div ref={studioRef} className="mb-8">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--accent-primary)] mb-3 font-medium">
            <Volume2 className="h-4 w-4" />
            <span>Multi-Language Neural Speech Synthesis</span>
            <span>·</span>
            <span>9 Audio Formats</span>
            <span>·</span>
            <span className="flex items-center gap-1 text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
              <Apple className="h-3 w-3" /> Full iPhone Coverage (M4R, M4A, AIFF, CAF)
            </span>
            <span>·</span>
            <span className="text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              <ShieldCheck className="h-3 w-3" /> 100% Free &amp; Unlimited
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Logo size="xl" showText={false} className="hidden sm:flex shrink-0" />
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--text-primary)]">
                <span>kathir</span>
                <span className="text-[var(--accent-primary)]">Studio</span>{' '}
                <span className="text-[var(--text-muted)] font-normal text-xl sm:text-2xl block sm:inline sm:ml-2">— Universal Text to Audio Format Converter</span>
              </h1>
              <p className="mt-2 text-sm sm:text-base text-[var(--text-muted)] max-w-3xl leading-relaxed">
                Convert text into natural speech across all 9 major audio formats. Full support for Apple iPhone native formats (<strong className="text-[var(--text-primary)]">M4R Ringtone, M4A AAC, Apple AIFF, Core Audio CAF</strong>) alongside Android &amp; Universal formats (<strong className="text-[var(--text-primary)]">MP3, WAV, FLAC, OGG, OPUS</strong>).
              </p>
            </div>
          </div>
        </div>

        {/* Studio Layout */}
        <div className="space-y-8">
          {conversionError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
              <span>{conversionError}</span>
              <button
                type="button"
                onClick={() => setConversionError(null)}
                className="text-rose-200 hover:underline font-semibold shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Input Panel with Language Detection & Gender Switcher */}
          <AudioInputPanel
            onConvert={handleConvert}
            isConverting={isConverting}
            conversionProgress={conversionProgress}
            progressInfo={progressInfo}
          />

          {/* Waveform Player */}
          <WaveformPlayer
            currentJob={currentJob}
            activeFormat={activeFormat}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            volume={volume}
            playbackRate={playbackRate}
            isLooping={isLooping}
          />

          {/* Results Grid with Device Filter Pills */}
          {currentJob && (
            <div ref={formatsRef}>
              <FormatResultsGrid
                job={currentJob}
                activeFormat={activeFormat}
                isPlaying={isPlaying}
              />
            </div>
          )}

          {/* Features Highlights */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-6 shadow-sm transition-colors">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-primary)]">
                  <Apple className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Full iPhone &amp; Apple Coverage</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Includes <strong>.m4r</strong> (official iPhone ringtone format for direct iOS syncing), <strong>.m4a</strong> (Apple AAC), <strong>.aiff</strong> (Apple uncompressed), and <strong>.caf</strong> (Core Audio Format).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-primary)]">
                  <Volume2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Acoustic Formant-Preserved Voices</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Improved male voice engine preserves vocal tract formants and tempo, removing demonic distortion for clear, deep human articulation.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">100% Free &amp; Unlimited Engine</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Powered by Google's public neural speech synthesis and local container FFmpeg transcoding. No subscriptions, no tokens, and no hidden costs.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Buy me a coffee - support section */}
          <SupportSection sectionRef={(el) => { supportRef.current = el; }} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-color)] bg-[var(--bg-main)] py-6 text-center text-xs text-[var(--text-muted)] transition-colors">
        <div className="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Logo size="sm" showText={false} />
            <span className="font-semibold text-[var(--text-primary)]">
              <span>kathir</span>
              <span className="text-[var(--accent-primary)] font-bold">Studio</span>
            </span>
            <span>·</span>
            <span>Universal Text to Audio Format Converter</span>
          </div>
          <div className="text-[var(--text-muted)]">
            Client-Side Speech Synthesis Engine &amp; Multi-Format Audio Package
          </div>
        </div>
      </footer>
    </div>
  );
}
