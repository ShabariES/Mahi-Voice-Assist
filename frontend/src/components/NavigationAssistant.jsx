import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useVoice } from '../hooks/useVoice';
import { assistantService } from '../services/assistantService';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { translationService } from '../services/translationService';
import '../styles/navigation-assistant.css';

const getErrorText = (error) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : 'The assistant could not process that command. Try again.';
};

const normalizeCommand = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Handle direct UI actions locally so they work even when the navigation AI is unavailable.
function runPageAction(rawCommand) {
  const text = normalizeCommand(rawCommand);
  const assistant = document.querySelector('.navigation-assistant');

  if (/^(close|close this|close assistant|hide assistant)$/.test(text)) return 'close-assistant';

  if (/^(open|show) (the )?(navigation|nav) (bar|menu)$/.test(text)) {
    const toggle = document.querySelector('.mobile-menu-toggle');
    if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click();
    return 'navigation-opened';
  }
  if (/^(close|hide) (the )?(navigation|nav) (bar|menu)$/.test(text)) {
    const toggle = document.querySelector('.mobile-menu-toggle');
    if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
    return 'navigation-closed';
  }

  const startForm = /^(open |start |begin )?(the )?start form$/.test(text)
    || /^(open|start|begin) form( now)?$/.test(text);
  if (startForm) {
    const buttons = [...document.querySelectorAll('button')].filter((button) =>
      !assistant?.contains(button) && normalizeCommand(button.innerText) === 'start form' && !button.disabled,
    );
    if (buttons.length === 1) {
      buttons[0].click();
      return 'action-done';
    }
    if (buttons.length > 1) return 'choose-form';
  }

  // Explicit “click/press/open <label>” commands activate a visible, enabled control
  // whose accessible label or text exactly matches the requested label.
  const clickMatch = text.match(/^(click|press|tap|open|select) (?:the )?(.+)$/);
  if (clickMatch) {
    const target = clickMatch[2];
    const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter((element) => {
      if (assistant?.contains(element) || element.disabled) return false;
      const label = normalizeCommand(element.getAttribute('aria-label') || element.innerText || element.textContent || '');
      return label === target || label === `open ${target}`;
    });
    if (controls.length === 1) {
      controls[0].click();
      return 'action-done';
    }
    if (controls.length > 1) return 'choose-control';
  }
  return null;
}

export default function NavigationAssistant() {
  const { user } = useAuth();
  const languageCode = user?.preferred_language || 'en-IN';
  const { speak } = useSpeechSynthesis(languageCode);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(user ? 'Try “open forms” or “go to dashboard”.' : 'Hi, I’m Mahi. Ask me to sign in or create an account.');
  const [error, setError] = useState('');
  const [translations, setTranslations] = useState({});
  const uiTexts = ['Ask Mahi', 'Navigate by voice or text', 'Page command', 'e.g. go to my forms', 'Go', 'Done speaking', 'Transcribing…', '🎙 Speak command', 'Listening… pause when finished.', 'Try “open forms” or “go to dashboard”.', 'Hi, I’m Mahi. Ask me to sign in or create an account.', 'Spoken commands run automatically after you finish speaking. Try dashboard, forms, support, or admin.', 'Spoken commands run automatically. Try “sign in” or “create account”.', 'Close assistant'];
  const t = (value) => translations[value] || value;

  useEffect(() => {
    let cancelled = false;
    if (languageCode === 'en-IN') {
      setTranslations({});
      return undefined;
    }
    translationService.translateTexts(uiTexts, 'en-IN', languageCode)
      .then((values) => { if (!cancelled) setTranslations(Object.fromEntries(uiTexts.map((value, index) => [value, values[index] || value]))); })
      .catch(() => { if (!cancelled) setTranslations({}); });
    return () => { cancelled = true; };
  }, [languageCode]);

  const runCommand = useCallback(async (rawCommand, fromVoice = false) => {
    const text = rawCommand.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setMessage(fromVoice ? `Heard “${text}”. Navigating…` : 'Understanding your command…');
    const action = runPageAction(text);
    if (action) {
      if (action === 'close-assistant') {
        setOpen(false);
        setBusy(false);
        return;
      }
      const actionMessages = {
        'navigation-opened': 'Opening the navigation menu.',
        'navigation-closed': 'Closing the navigation menu.',
        'action-done': 'Done.',
        'choose-form': 'I found several forms. Say “start form” from the form you want, or use its start button.',
        'choose-control': 'Several controls match. Please include the exact button label.',
      };
      const actionMessage = actionMessages[action];
      const localizedMessage = languageCode === 'en-IN' ? actionMessage : (await translationService.translateTexts([actionMessage], 'en-IN', languageCode).then(([value]) => value).catch(() => actionMessage));
      setMessage(localizedMessage);
      if (fromVoice) await speak(localizedMessage);
      setBusy(false);
      return;
    }
    try {
      const result = await assistantService.navigate(text, location.pathname);
      setMessage(result.message);
      if (fromVoice && result.message) await speak(result.message);
      if (result.path && result.path !== location.pathname) navigate(result.path);
    } catch (requestError) {
      setError(getErrorText(requestError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }, [busy, languageCode, location.pathname, navigate, speak]);

  const handleVoiceCommand = useCallback((transcript) => {
    setCommand(transcript.trim());
    runCommand(transcript, true);
  }, [runCommand]);

  const {
    isListening,
    isTranscribing,
    error: voiceError,
    startListening,
    stopListening,
  } = useVoice({
    onFinalTranscript: handleVoiceCommand,
    silenceTimeoutMs: 1800,
    fieldContext: {
      fieldType: 'text',
      question: 'Transcribe the spoken website navigation command. Preserve the intended page name. The speaker may use Tamil or Tanglish.',
      languageCode,
      transcriptionEndpoint: user ? '/api/voice/transcribe' : '/api/assistant/transcribe',
    },
  });

  useEffect(() => {
    const initial = user ? 'Try “open forms” or “go to dashboard”.' : 'Hi, I’m Mahi. Ask me to sign in or create an account.';
    if (languageCode === 'en-IN') setMessage(initial);
    else translationService.translateTexts([initial], 'en-IN', languageCode).then(([value]) => setMessage(value || initial)).catch(() => setMessage(initial));
  }, [user, languageCode]);

  const submitText = (event) => {
    event.preventDefault();
    runCommand(command);
  };

  const toggleMicrophone = () => {
    setOpen(true);
    setError('');
    if (isListening) stopListening();
    else if (!isTranscribing && !busy) startListening();
  };

  return (
    <aside className="navigation-assistant" aria-label={t('AI page navigation assistant')}>
      {open && (
        <section className="navigation-assistant-panel" aria-label="Navigation assistant">
          <header className="navigation-assistant-header">
            <div>
                <strong>{t('Ask Mahi')}</strong>
              <span>{t('Navigate by voice or text')}</span>
            </div>
            <button type="button" className="navigation-assistant-close" onClick={() => setOpen(false)} aria-label={t('Close assistant')}>×</button>
          </header>
          <form onSubmit={submitText} className="navigation-assistant-form">
            <label className="sr-only" htmlFor="navigation-command">{t('Page command')}</label>
            <input
              id="navigation-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={t('e.g. go to my forms')}
              maxLength={400}
              disabled={busy || isTranscribing}
            />
            <button type="submit" disabled={busy || isTranscribing || !command.trim()}>{t('Go')}</button>
          </form>
          <div className="navigation-assistant-actions">
            <button type="button" onClick={toggleMicrophone} disabled={busy || isTranscribing} aria-pressed={isListening}>
              {isListening ? t('Done speaking') : isTranscribing ? t('Transcribing…') : t('🎙 Speak command')}
            </button>
            <span role="status" aria-live="polite">{isListening ? t('Listening… pause when finished.') : message}</span>
          </div>
          {(error || voiceError) && <p className="navigation-assistant-error" role="alert">{error || voiceError}</p>}
          <small>
            {user
            ? t('Spoken commands run automatically after you finish speaking. Try dashboard, forms, support, or admin.')
              : t('Spoken commands run automatically. Try “sign in” or “create account”.')}
          </small>
        </section>
      )}
      <button
        type="button"
        className="navigation-assistant-launcher"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={open ? 'Close Mahi assistant' : 'Open Mahi assistant'}
        aria-expanded={open}
        title="Mahi assistant"
      >
        <span aria-hidden="true">M</span>
      </button>
    </aside>
  );
}
