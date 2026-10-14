import api from './api';

let activeAudio = null;

export const voiceService = {
  // Check backend voice configuration status
  async getConfig() {
    try {
      const response = await api.get('/api/voice/config');
      return response.data;
    } catch {
      return { elevenlabs_configured: false, fallback_available: true };
    }
  },

  // Fetch Scribe realtime token/websocket URL
  async getScribeToken() {
    try {
      const response = await api.post('/api/voice/scribe-token');
      return response.data;
    } catch (err) {
      return { provider: 'browser_fallback', message: err.message };
    }
  },

  // Transcribe recorded audio with the configured backend provider chain.
  async transcribeAudio(audioBlob, fieldContext = {}) {
    try {
      const formData = new FormData();
      const mimeType = audioBlob.type || 'audio/webm';
      const extension = mimeType.includes('mp4') || mimeType.includes('m4a')
        ? 'mp4'
        : mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('wav')
        ? 'wav'
        : 'webm';
      formData.append('file', audioBlob, `audio_recording.${extension}`);
      if (fieldContext.fieldType) formData.append('field_type', fieldContext.fieldType);
      if (fieldContext.question) formData.append('question', fieldContext.question);
      if (fieldContext.options) formData.append('options', fieldContext.options);
      if (fieldContext.languageCode) formData.append('language_code', fieldContext.languageCode);

      // Override api's JSON default so Axios keeps this as FormData. In the
      // browser adapter Axios clears the header value and lets the browser add
      // the required multipart boundary.
      const endpoint = fieldContext.transcriptionEndpoint || '/api/voice/transcribe';
      const response = await api.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    } catch (err) {
      console.warn('Backend audio transcription error:', err);
      const detail = err.response?.data?.detail;
      return {
        success: false,
        text: '',
        error: typeof detail === 'string' ? detail : detail?.[0]?.msg || err.message,
      };
    }
  },

  // Stop currently playing speech audio
  stopAudio() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  },

  // Speak text: tries backend ElevenLabs TTS first; if not configured or errors, falls back to browser TTS
  async speakQuestion(text, voiceId = null, languageCode = 'en-IN') {
    // Stop any speech currently playing
    this.stopAudio();

    try {
      const response = await api.post(
        '/api/voice/tts',
        { text, voice_id: voiceId, language_code: languageCode },
        { responseType: 'blob' }
      );

      // If backend returned audio blob
      if (response.headers['content-type']?.includes('audio')) {
        const audioUrl = URL.createObjectURL(response.data);
        return new Promise((resolve, reject) => {
          const audio = new Audio(audioUrl);
          activeAudio = audio;
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            activeAudio = null;
            resolve();
          };
          audio.onerror = (e) => {
            URL.revokeObjectURL(audioUrl);
            activeAudio = null;
            // Fall back to browser TTS on audio playback error
            this.speakWithBrowser(text, languageCode).then(resolve).catch(reject);
          };
          audio.play().catch(() => {
            // Browser autoplay policy might block audio if user hasn't clicked yet
            this.speakWithBrowser(text, languageCode).then(resolve).catch(reject);
          });
        });
      }
    } catch {
      // If endpoint failed or returned non-blob (e.g. use_browser_tts)
    }

    // Seamless browser TTS fallback
    return this.speakWithBrowser(text, languageCode);
  },

  // Native Browser SpeechSynthesis fallback
  speakWithBrowser(text, languageCode = 'en-IN') {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported in this browser.');
        resolve();
        return;
      }

      window.speechSynthesis.cancel(); // Reset queue
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = languageCode;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Select natural English voice if available
      const voices = window.speechSynthesis.getVoices();
      const prefix = languageCode.split('-')[0].toLowerCase();
      const preferredVoice = voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || voices.find((v) => v.lang.toLowerCase().startsWith('en'));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }
};
