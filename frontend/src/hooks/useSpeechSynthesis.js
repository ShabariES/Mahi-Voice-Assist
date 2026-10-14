import { useState, useCallback, useEffect, useRef } from 'react';
import { voiceService } from '../services/voiceService';

export function useSpeechSynthesis(languageCode = 'en-IN') {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      voiceService.stopAudio();
    };
  }, []);

  const speak = useCallback(async (text) => {
    if (!text) return;
    setIsSpeaking(true);
    try {
      await voiceService.speakQuestion(text, null, languageCode);
    } catch (err) {
      console.warn('Speech synthesis playback error:', err);
    } finally {
      if (mountedRef.current) {
        setIsSpeaking(false);
      }
    }
  }, [languageCode]);

  const stop = useCallback(() => {
    voiceService.stopAudio();
    setIsSpeaking(false);
  }, []);

  return {
    isSpeaking,
    speak,
    stop,
  };
}
