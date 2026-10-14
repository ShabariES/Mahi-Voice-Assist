import { useState, useEffect, useRef, useCallback } from 'react';
import { voiceService } from '../services/voiceService';

export function useVoice({ onFinalTranscript, onTranscriptChange, fieldContext, silenceTimeoutMs = 3000 } = {}) {
  // Mode: recorded cloud transcription or browser Web Speech API recognition.
  const [engineMode, setEngineMode] = useState('whisper');
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [waveform, setWaveform] = useState(() => Array(48).fill(0));
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);

  // References
  const isListeningRef = useRef(false);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const browserFinalTranscriptRef = useRef('');
  const browserSilenceTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const silenceCheckRef = useRef(null);
  const lastSpeechAtRef = useRef(0);
  const hasDetectedSpeechRef = useRef(false);
  const speechAnalysisAvailableRef = useRef(false);
  const fieldContextRef = useRef(fieldContext);
  fieldContextRef.current = fieldContext;
  const silenceTimeoutRef = useRef(silenceTimeoutMs);
  silenceTimeoutRef.current = silenceTimeoutMs;

  // Keep references to latest parent callbacks
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onTranscriptChangeRef = useRef(onTranscriptChange);
  onTranscriptChangeRef.current = onTranscriptChange;

  // Check Web Speech API availability
  const SpeechRecognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const isBrowserSpeechSupported = Boolean(SpeechRecognition);

  // Cleanup all audio resources
  const cleanupResources = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (browserSilenceTimerRef.current) {
      clearTimeout(browserSilenceTimerRef.current);
      browserSilenceTimerRef.current = null;
    }
    if (silenceCheckRef.current) {
      clearInterval(silenceCheckRef.current);
      silenceCheckRef.current = null;
    }
    setWaveform(Array(48).fill(0));
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    isListeningRef.current = false;
    setIsListening(false);
    setRecordingSeconds(0);
  }, []);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  // ---------------- Stop Listening / Recording ----------------
  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    setIsListening(false);

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (browserSilenceTimerRef.current) {
      clearTimeout(browserSilenceTimerRef.current);
      browserSilenceTimerRef.current = null;
    }
    if (silenceCheckRef.current) {
      clearInterval(silenceCheckRef.current);
      silenceCheckRef.current = null;
    }
    setWaveform(Array(48).fill(0));
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Stop Whisper MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }

    // Stop Browser SpeechRecognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  }, []);

  // ---------------- Start Listening (based on engineMode) ----------------
  const startListening = useCallback(async () => {
    cleanupResources();
    setError(null);
    setTranscript('');
    hasDetectedSpeechRef.current = false;
    speechAnalysisAvailableRef.current = false;
    isListeningRef.current = true;
    setIsListening(true);
    setRecordingSeconds(0);

    // ====================================================================
    // MODE 1: record audio and send it to the configured cloud transcription providers.
    // ====================================================================
    if (engineMode === 'whisper') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        mediaStreamRef.current = stream;

        // Stop after the configured silence interval once speech has started.
        // The analyser works independently of the browser's language model.
        try {
          const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
          if (AudioContextConstructor) {
            const audioContext = new AudioContextConstructor();
            audioContextRef.current = audioContext;
            await audioContext.resume();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            audioContext.createMediaStreamSource(stream).connect(analyser);
            speechAnalysisAvailableRef.current = true;
            const samples = new Uint8Array(analyser.fftSize);
            hasDetectedSpeechRef.current = false;
            lastSpeechAtRef.current = 0;
            silenceCheckRef.current = setInterval(() => {
              analyser.getByteTimeDomainData(samples);
              let energy = 0;
              for (const sample of samples) {
                const amplitude = (sample - 128) / 128;
                energy += amplitude * amplitude;
              }
              const rms = Math.sqrt(energy / samples.length);
              const now = Date.now();
              if (rms >= 0.015) {
                hasDetectedSpeechRef.current = true;
                lastSpeechAtRef.current = now;
              } else if (hasDetectedSpeechRef.current && now - lastSpeechAtRef.current >= silenceTimeoutRef.current) {
                stopListening();
              }
              const points = 48;
              const step = Math.floor(samples.length / points);
              const nextWaveform = Array.from({ length: points }, (_, index) => {
                const sample = samples[index * step] || 128;
                return Math.max(-1, Math.min(1, ((sample - 128) / 128) * 3.5));
              });
              setWaveform(nextWaveform);
            }, 80);
          }
        } catch {
          // Recording still works if the browser cannot provide audio analysis.
        }

        audioChunksRef.current = [];
        const supportedMimeType = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/ogg;codecs=opus',
        ].find((type) => MediaRecorder.isTypeSupported(type));

        // Some browsers choose their own supported format. Avoid forcing an
        // unsupported audio/mp4 fallback when the browser cannot record it.
        const recorder = supportedMimeType
          ? new MediaRecorder(stream, { mimeType: supportedMimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          // Release microphone hardware immediately
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }

          const blob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || supportedMimeType || 'application/octet-stream',
          });
          if (speechAnalysisAvailableRef.current && !hasDetectedSpeechRef.current) {
            setError('No speech was detected. Check your microphone, speak clearly, and try again.');
            return;
          }
          if (blob.size < 800) {
            setError('No speech was detected. Check your microphone, speak clearly, and try again.');
            return;
          }

          // Transcribe audio using backend Whisper API
          setIsTranscribing(true);
          try {
            const result = await voiceService.transcribeAudio(blob, fieldContextRef.current);
            if (result.success && result.text && result.text.trim()) {
              const cleanText = result.text.trim();
              setTranscript(cleanText);
              if (onTranscriptChangeRef.current) {
                onTranscriptChangeRef.current(cleanText);
              }
              if (onFinalTranscriptRef.current) {
                onFinalTranscriptRef.current(cleanText);
              }
            } else {
              setError(result.error || 'Could not understand audio. You can try speaking again or type in the box.');
            }
          } catch (err) {
            setError(`Transcription error: ${err.message}`);
          } finally {
            setIsTranscribing(false);
          }
        };

        recorder.start(200);

        // Track recording duration
        let sec = 0;
        recordingTimerRef.current = setInterval(() => {
          sec += 1;
          setRecordingSeconds(sec);
          // Auto-stop after 15 seconds to prevent runaway recording
          if (sec >= 15) {
            stopListening();
          }
        }, 1000);

      } catch (micErr) {
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          setError('Microphone permission blocked. Click the lock/site settings in your browser address bar to allow microphone access.');
        } else {
          setError(`Microphone error: ${micErr.message}. Make sure a microphone is connected.`);
        }
        setIsListening(false);
        isListeningRef.current = false;
      }
      return;
    }

    // ====================================================================
    // MODE 2: BROWSER REALTIME SPEECH (Clean Web Speech API - No conflict!)
    // ====================================================================
    if (engineMode === 'browser') {
      if (!SpeechRecognition) {
        setError('Browser speech is not supported in this browser. Please use AI Whisper mode or Google Chrome.');
        setIsListening(false);
        isListeningRef.current = false;
        return;
      }

      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = fieldContextRef.current?.languageCode || navigator.language || 'en-US';
        recognition.maxAlternatives = 1;
        browserFinalTranscriptRef.current = '';

        recognition.onstart = () => {
          isListeningRef.current = true;
          setIsListening(true);
        };

        recognition.onresult = (event) => {
          if (browserSilenceTimerRef.current) {
            clearTimeout(browserSilenceTimerRef.current);
          }
          browserSilenceTimerRef.current = setTimeout(() => {
            stopListening();
          }, silenceTimeoutRef.current);

          let fullStr = '';
          let finalStr = '';
          for (let i = 0; i < event.results.length; ++i) {
            const result = event.results[i];
            const text = result[0].transcript.trim();
            fullStr += `${text} `;
            if (result.isFinal) finalStr += `${text} `;
          }
          const cleaned = fullStr.trim();
          browserFinalTranscriptRef.current = finalStr.trim();
          setTranscript(cleaned);
          if (onTranscriptChangeRef.current) {
            onTranscriptChangeRef.current(cleaned);
          }
        };

        recognition.onerror = (event) => {
          if (event.error === 'no-speech') return;
          if (event.error === 'not-allowed') {
            setError('Microphone permission denied.');
            stopListening();
          } else {
            console.warn('SpeechRecognition warning:', event.error);
          }
        };

        recognition.onend = () => {
          if (browserSilenceTimerRef.current) {
            clearTimeout(browserSilenceTimerRef.current);
            browserSilenceTimerRef.current = null;
          }
          const shouldFinalize = recognitionRef.current === recognition;
          recognitionRef.current = null;
          setIsListening(false);
          isListeningRef.current = false;
          const finalText = browserFinalTranscriptRef.current.trim();
          if (shouldFinalize && finalText && onFinalTranscriptRef.current) {
            onFinalTranscriptRef.current(finalText);
          } else if (shouldFinalize && !finalText) {
            setError('No speech was detected. Check your microphone, speak clearly, and try again.');
          }
        };

        recognitionRef.current = recognition;
        recognition.start();

      } catch (recErr) {
        setError(`Failed to start speech recognition: ${recErr.message}`);
        setIsListening(false);
        isListeningRef.current = false;
      }
    }
  }, [engineMode, SpeechRecognition, cleanupResources, stopListening]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  return {
    engineMode,
    setEngineMode,
    isListening,
    isTranscribing,
    recordingSeconds,
    waveform,
    transcript,
    error,
    isBrowserSpeechSupported,
    startListening,
    stopListening,
    resetTranscript,
  };
}
