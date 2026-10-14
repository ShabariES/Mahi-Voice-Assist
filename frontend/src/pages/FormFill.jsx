import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { formService } from '../services/formService';
import { useVoice } from '../hooks/useVoice';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { parseOptions } from '../utils/options';
import { parsePdfForFields, parsePdfOcrTextForFields } from '../utils/pdfFormParser';
import { playListeningCue } from '../utils/audioCue';
import { useAuth } from '../context/AuthContext';
import { translationService } from '../services/translationService';

import QuestionCard from '../components/QuestionCard';
import VoiceButton from '../components/VoiceButton';
import VoiceStatus from '../components/VoiceStatus';
import ProgressBar from '../components/ProgressBar';
import Button from '../components/Button';
import Icon from '../components/Icon';

import '../styles/voice-form.css';

const formatFieldLabel = (name = '') => name
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const FORM_UI_TEXT = [
  'Submission complete', 'You’re all set', 'Your answers for', 'are saved and ready to review.', 'answer saved', 'answers saved',
  'Review your answers', 'Make any corrections before you leave this page.', 'Editable', 'Return to Dashboard', 'Browse More Forms',
  'Voice Interactive Mode', 'Speak naturally or type your answers into the field.', 'Import answers from a PDF',
  'Optional · Match details to this form', 'Close', 'Open', 'Choose a document', 'Review and edit each suggested answer before importing it.',
  'Reading PDF…', 'Choose a PDF', 'Selectable PDF text is read on this device. Scanned PDFs are sent to the Mahi backend for PaddleOCR processing, then removed; review every suggestion before importing.',
  'Review suggested answers', 'matched · edit or select before import', 'No confident match — answer this field by voice or text.',
  'Not found in PDF', 'Unmatched fields will be asked one at a time.', 'Import selected answers',
  'These fields are complete. The form continues with the first unanswered question below.',
  'Hear each question, then answer by voice.', 'Start voice flow', 'Tap or speak option:', 'Tap or speak Yes/No:', 'Your Answer',
  'Transcribing your voice...', 'Listening… speak your answer', 'Type an answer or use the mic…', 'Clear input',
  'Speak naturally. It submits after 3 seconds of silence; click Done Speaking to submit sooner.',
  'You can type or edit answers. After the last question, review and edit any answer before finishing.',
  'Heard:', 'You can edit it now; submitting automatically in', 'second', 'seconds', 'Submit Answer',
  'Form Progress', 'Question', 'of', 'Listen to question again', 'Type:', 'Ready to speak', 'Translating your answer...',
  'Saving answer...', 'Speaking question...', 'Listening... Speak now', 'Stops after 3 seconds of silence. You can also stop sooner.',
  'Start speaking', 'Stop listening', 'Click to finish speaking', 'Click to speak your answer', 'Multilingual AI',
  'Your form has been successfully completed! Thank you.', 'Recording', 'speak your answer', 'Yes', 'No', 'Text', 'Email',
  'Phone', 'Number', 'Date', 'Choice', 'Yes/No', 'Replay Question Audio', 'Field', 'Question',
  'Your Answer', 'Your answer', 'FIELD', 'PDF · up to 12 MB', 'Save correction', 'Edit answer', 'Cancel',
  'so far', 'selected PDF answer', 'waiting for its question.', 'waiting for their questions.',
  'Keep editing',
];

export default function FormFill() {
  const { user } = useAuth();
  const preferredLanguageCode = user?.preferred_language || 'en-IN';
  const { id: formId } = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
  const navigate = useNavigate();

  // Session & UI state
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [voiceReviewSeconds, setVoiceReviewSeconds] = useState(0);
  const [completedAnswers, setCompletedAnswers] = useState([]);
  const [completionNotice, setCompletionNotice] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [hasStartedVoice, setHasStartedVoice] = useState(false);
  const [editingAnswerId, setEditingAnswerId] = useState(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [answerEditError, setAnswerEditError] = useState('');
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);
  const [formFields, setFormFields] = useState([]);
  const [pdfSuggestions, setPdfSuggestions] = useState([]);
  const [savedAnswers, setSavedAnswers] = useState([]);
  const [pendingPdfCount, setPendingPdfCount] = useState(0);
  const [pdfFilename, setPdfFilename] = useState('');
  const [pdfPanelOpen, setPdfPanelOpen] = useState(false);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [isImportingPdf, setIsImportingPdf] = useState(false);
  const [pdfMessage, setPdfMessage] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [translations, setTranslations] = useState({});
  const [sourceFormLanguageCode, setSourceFormLanguageCode] = useState('en-IN');
  const translate = useCallback((text) => translations[text] || text, [translations]);
  const translateOptions = useCallback((options) => parseOptions(options).map(translate).join(', '), [translate]);
  const translateRuntimeText = useCallback(async (text) => {
    if (!text || preferredLanguageCode === 'en-IN') return text;
    try {
      const [value] = await translationService.translateTexts([text], 'en-IN', preferredLanguageCode);
      return value || text;
    } catch {
      return text;
    }
  }, [preferredLanguageCode]);

  // References to avoid stale closures
  const sessionRef = useRef(null);
  sessionRef.current = session;
  const pdfQueueRef = useRef(new Map());

  const inputRef = useRef(null);
  const voiceReviewTimerRef = useRef(null);

  // Speech Synthesis Hook
  const { isSpeaking, speak, stop: stopSpeaking } = useSpeechSynthesis(preferredLanguageCode);

  // Forward declaration ref for submit to connect to voice hook
  const submitAnswerRef = useRef(null);

  useEffect(() => () => {
    if (voiceReviewTimerRef.current) clearInterval(voiceReviewTimerRef.current);
  }, []);

  // Handle final transcript from speech recognition
  const handleFinalTranscript = useCallback((finalText) => {
    if (!finalText || finalText.trim() === '') return;
    const answer = finalText.trim();
    setInputValue(answer);
    if (voiceReviewTimerRef.current) clearInterval(voiceReviewTimerRef.current);
    let remaining = 3;
    setVoiceReviewSeconds(remaining);
    voiceReviewTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(voiceReviewTimerRef.current);
        voiceReviewTimerRef.current = null;
        setVoiceReviewSeconds(0);
        submitAnswerRef.current?.(answer);
      } else {
        setVoiceReviewSeconds(remaining);
      }
    }, 1000);
  }, []);

  // Handle live transcription changes while user is actively speaking
  const handleTranscriptChange = useCallback((liveText) => {
    setInputValue(liveText);
  }, []);

  // Voice Hook
  const {
    engineMode,
    setEngineMode,
    isListening,
    isTranscribing,
    recordingSeconds,
    waveform,
    error: micError,
    startListening,
    stopListening,
    resetTranscript,
  } = useVoice({
    onFinalTranscript: handleFinalTranscript,
    onTranscriptChange: handleTranscriptChange,
    fieldContext: {
      fieldType: session?.current_field_type,
      question: translate(session?.current_question || ''),
      options: translateOptions(session?.current_field_options || ''),
      languageCode: preferredLanguageCode,
    },
  });

  useEffect(() => {
    if (!formFields.length || !session) return;
    let cancelled = false;
    const localize = async () => {
      try {
        const labels = [...new Set(formFields.map((field) => formatFieldLabel(field.field_name)))];
        const uiTexts = [...new Set([...FORM_UI_TEXT, ...labels])];
        const formTexts = [...new Set([session.form_name || '', ...formFields.flatMap((field) => [field.question, ...parseOptions(field.options)])].filter(Boolean))];
        const [translatedUi, translatedForm] = await Promise.all([
          preferredLanguageCode === 'en-IN' ? Promise.resolve(uiTexts) : translationService.translateTexts(uiTexts, 'en-IN', preferredLanguageCode),
          translationService.translateTexts(formTexts, sourceFormLanguageCode, preferredLanguageCode),
        ]);
        if (cancelled) return;
        const result = Object.fromEntries(uiTexts.map((value, index) => [value, translatedUi[index] || value]));
        formTexts.forEach((value, index) => { result[value] = translatedForm[index] || value; });
        setTranslations(result);
      } catch (error) {
        if (!cancelled) setValidationError(error.response?.data?.detail || 'Could not translate this form. Check your connection and try again.');
      }
    };
    localize();
    return () => { cancelled = true; };
  }, [formFields, session?.form_id, session?.form_name, preferredLanguageCode, sourceFormLanguageCode]);

  const startListeningWithCue = useCallback(async () => {
    await playListeningCue();
    await startListening();
  }, [startListening]);

  // Use the established one-field answer endpoint. This saves each PDF value
  // against the exact active field and stops at the first field needing a person.
  const saveQueuedPdfAnswers = useCallback(async (startOrder) => {
    let order = startOrder;
    let lastResponse = null;
    let importedCount = 0;

    while (true) {
      const field = formFields.find((item) => item.field_order === order);
      const candidate = field && pdfQueueRef.current.get(field.id);
      if (!field || !candidate) break;

      const nextQueue = new Map(pdfQueueRef.current);
      nextQueue.delete(field.id);
      pdfQueueRef.current = nextQueue;
      setPendingPdfCount(nextQueue.size);

      let result;
      try {
        result = await formService.submitAnswer(sessionId, candidate.answer);
      } catch (error) {
        const restoredQueue = new Map(pdfQueueRef.current);
        restoredQueue.set(field.id, candidate);
        pdfQueueRef.current = restoredQueue;
        setPendingPdfCount(restoredQueue.size);
        throw error;
      }
      if (!result.success) {
        return {
          lastResponse,
          importedCount,
          invalidField: field,
          invalidAnswer: candidate.answer,
          validationError: result.error || 'Please check this PDF value.',
        };
      }

      importedCount += 1;
      lastResponse = result;
      if (result.completed) return { lastResponse, importedCount, completed: true };
      order = result.current_field;
    }

    return { lastResponse, importedCount };
  }, [formFields, sessionId]);

  // Submit Answer to Backend
  const submitCurrentAnswer = useCallback(async (answerText) => {
    if (voiceReviewTimerRef.current) {
      clearInterval(voiceReviewTimerRef.current);
      voiceReviewTimerRef.current = null;
      setVoiceReviewSeconds(0);
    }
    const activeSession = sessionRef.current;
    if (!sessionId || !activeSession) return;

    const trimmed = (answerText || '').trim();
    if (!trimmed) {
      setValidationError('Please speak or type your answer before submitting.');
      return;
    }

    setIsProcessing(true);
    setValidationError('');
    stopListening();
    stopSpeaking();

    try {
      const answerToSave = ['choice', 'yes_no'].includes(activeSession.current_field_type)
        ? Object.entries(translations).find(([, localized]) => localized.toLowerCase() === trimmed.toLowerCase())?.[0] || trimmed
        : trimmed;
      const response = await formService.submitAnswer(sessionId, answerToSave);

      if (!response.success) {
        // Backend validation rejected answer (e.g. invalid email format)
        const validationMessage = await translateRuntimeText(response.error || 'Please provide a valid answer.');
        setValidationError(validationMessage);
        setIsProcessing(false);
        // Read out the validation error gently so user knows what to fix
        if (response.error) {
          speak(validationMessage);
        }
        return;
      }

      // Success: Clear current input field
      setInputValue('');
      resetTranscript();

      let finalResponse = response;
      let queuedResult = null;
      if (!response.completed && pdfQueueRef.current.size > 0) {
        queuedResult = await saveQueuedPdfAnswers(response.current_field);
        finalResponse = queuedResult.lastResponse || response;
      }

      if (response.completed || queuedResult?.completed) {
        // Form is completed!
        stopListening();
        stopSpeaking();
        setSession((prev) => ({ ...prev, status: 'completed' }));
        const answersData = await formService.getSessionAnswers(sessionId);
        setCompletedAnswers(answersData.answers || []);
        const emailStatus = queuedResult?.lastResponse?.email_status || response.email_status;
        setCompletionNotice(emailStatus === 'queued'
          ? 'A welcome email has been queued for delivery.'
          : 'Email delivery is not configured yet. Add SMTP settings to backend/.env to send a welcome email.');
        speak(translate('Your form has been successfully completed! Thank you.'));
      } else {
        const savedData = await formService.getSessionAnswers(sessionId);
        setSavedAnswers(savedData.answers || []);

        // Advance to next field
        const updated = {
          ...activeSession,
          current_field: queuedResult?.invalidField?.field_order ?? finalResponse.current_field,
          current_question: queuedResult?.invalidField?.question ?? finalResponse.next_question,
          current_field_type: queuedResult?.invalidField?.field_type ?? finalResponse.field_type,
          current_field_options: queuedResult?.invalidField?.options ?? finalResponse.field_options,
        };
        setSession(updated);

        if (queuedResult?.invalidField) {
          setInputValue(queuedResult.invalidAnswer);
          setValidationError(`${queuedResult.invalidField.field_name}: ${queuedResult.validationError} Please correct the value below.`);
          setIsProcessing(false);
          return;
        }

        // Read out the next question and auto-open microphone afterwards
        if (finalResponse.next_question) {
          try {
            await speak(translate(finalResponse.next_question));
            // Brief pause to prevent microphone from catching the speaker's own audio
            setTimeout(() => {
              startListeningWithCue();
            }, 350);
          } catch {
            startListeningWithCue();
          }
        }
      }
    } catch (err) {
      setValidationError(await translateRuntimeText(err.response?.data?.detail || 'An error occurred while submitting.'));
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, stopListening, stopSpeaking, speak, resetTranscript, startListeningWithCue, saveQueuedPdfAnswers, translations, translate, translateRuntimeText]);

  submitAnswerRef.current = submitCurrentAnswer;

  // Load session data
  useEffect(() => {
    const fetchSession = async () => {
      if (!sessionId) {
        try {
          const newSess = await formService.startSession(formId);
          navigate(`/forms/${formId}/fill?session=${newSess.id}`, { replace: true });
        } catch {
          alert('Could not start form session.');
          navigate('/forms');
        }
        return;
      }

      try {
        const sessData = await formService.getSession(sessionId);
        setSession(sessData);
        const formData = await formService.getFormById(formId);
        setSourceFormLanguageCode(formData.language_code || 'en-IN');
        
        setFormFields(formData.fields || []);

        const answersData = await formService.getSessionAnswers(sessionId);
        if (sessData.status === 'completed') {
          setCompletedAnswers(answersData.answers || []);
        } else {
          setSavedAnswers(answersData.answers || []);
        }
      } catch {
        alert('Could not load session.');
        navigate('/forms');
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [formId, sessionId, navigate]);

  // Start voice flow when user triggers "Start Voice Flow"
  const handleStartVoiceFlow = async () => {
    setHasStartedVoice(true);
    if (!session || session.status === 'completed' || !session.current_question) return;

    setValidationError('');
    stopListening();

    try {
      await speak(translate(session.current_question));
      setTimeout(() => {
        startListeningWithCue();
        inputRef.current?.focus();
      }, 350);
    } catch {
      startListeningWithCue();
    }
  };

  // Toggle microphone button
  const handleToggleListening = () => {
    setHasStartedVoice(true);
    if (isListening) {
      stopListening();
    } else {
      stopSpeaking();
      resetTranscript();
      startListeningWithCue();
      inputRef.current?.focus();
    }
  };

  // Replay question audio
  const handleReplayAudio = async () => {
    if (!session?.current_question) return;
    stopListening();
    try {
      await speak(translate(session.current_question));
      setTimeout(() => {
        startListeningWithCue();
      }, 350);
    } catch {
      startListeningWithCue();
    }
  };

  // Quick choice selection pill click
  const handleQuickOptionSelect = (optionValue) => {
    const localizedOption = translate(optionValue);
    setInputValue(localizedOption);
    submitCurrentAnswer(localizedOption);
  };

  // Form submit from keyboard enter or button click
  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) {
      setValidationError('Please speak or type an answer before submitting. Your field has not been saved.');
      inputRef.current?.focus();
      return;
    }
    submitCurrentAnswer(inputValue);
  };

  const beginEditAnswer = (answer) => {
    setEditingAnswerId(answer.field_id);
    setAnswerDraft(answer.answer || '');
    setAnswerEditError('');
  };

  const renderAnswerEditor = (item) => (
    editingAnswerId === item.field_id ? (
      <div className="answer-edit-controls">
        <input
          aria-label={`Edit ${item.field_name}`}
          className="form-input"
          value={answerDraft}
          onChange={(event) => setAnswerDraft(event.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={isSavingAnswer} onClick={() => saveEditedAnswer(item)}>
          {isSavingAnswer ? 'Saving…' : 'Save correction'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={isSavingAnswer} onClick={() => setEditingAnswerId(null)}>
          Cancel
        </button>
      </div>
    ) : (
      <div className="answer-display">
        <span>{item.answer}</span>
        <button type="button" className="btn btn-secondary" onClick={() => beginEditAnswer(item)}>
          Edit
        </button>
      </div>
    )
  );

  const saveEditedAnswer = async (answer) => {
    setIsSavingAnswer(true);
    setAnswerEditError('');
    try {
      const updated = await formService.updateSessionAnswer(
        sessionId,
        answer.field_id,
        answerDraft,
      );
      setCompletedAnswers((previous) => previous.map((item) => (
        item.field_id === answer.field_id ? updated : item
      )));
      setEditingAnswerId(null);
    } catch (err) {
      setAnswerEditError(err.response?.data?.detail || 'Could not save this answer.');
    } finally {
      setIsSavingAnswer(false);
    }
  };

  const handlePdfFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setPdfError('');
    setPdfMessage('');
    setPdfSuggestions([]);
    setPdfFilename(file.name);
    setIsParsingPdf(true);
    try {
      let parsed;
      let usedOcr = false;
      try {
        parsed = await parsePdfForFields(file, formFields);
        // If native PDF text did not yield any usable field values, ask the
        // table-aware OCR pipeline to inspect scanned or complex layouts.
        if (!parsed.some((item) => item.value)) {
          const structured = await formService.extractPdfStructure(file);
          parsed = parsePdfOcrTextForFields(structured.text, formFields);
          usedOcr = true;
        }
      } catch (error) {
        if (!String(error.message || '').includes('OCR is needed')) throw error;
        const structured = await formService.extractPdfStructure(file);
        parsed = parsePdfOcrTextForFields(structured.text, formFields);
        usedOcr = true;
      }
      const suggestions = parsed.map((item) => ({
        ...item,
        selected: Boolean(item.value),
      }));
      setPdfSuggestions(suggestions);
      const matched = suggestions.filter((item) => item.value).length;
      const ocrPrefix = usedOcr ? 'Scanned/table PDF processed with PaddleOCR. ' : '';
      setPdfMessage(matched
        ? `${ocrPrefix}Found ${matched} possible answer${matched === 1 ? '' : 's'}. Review them before importing.`
        : `${ocrPrefix}Text was read, but no fields could be matched confidently. Continue with voice or type your answers.`);
    } catch (error) {
      setPdfError(error.response?.data?.detail || error.message || 'Could not read this PDF. Please try another file.');
      setPdfFilename('');
    } finally {
      setIsParsingPdf(false);
    }
  };

  const handleImportPdfAnswers = async () => {
    const selectedAnswers = pdfSuggestions
      .filter((item) => item.selected && item.value.trim())
      .map((item) => ({ field_id: item.field_id, answer: item.value.trim() }));
    if (!selectedAnswers.length) {
      setPdfError('Select or enter at least one answer to import.');
      return;
    }

    setIsImportingPdf(true);
    setPdfError('');
    try {
      const activeOrder = sessionRef.current?.current_field;
      const currentQueue = new Map();
      selectedAnswers.forEach((answer) => {
        const field = formFields.find((candidate) => candidate.id === answer.field_id);
        if (field && field.field_order >= activeOrder) currentQueue.set(field.id, answer);
      });
      pdfQueueRef.current = currentQueue;
      setPendingPdfCount(currentQueue.size);
      stopListening();
      stopSpeaking();
      resetTranscript();

      const result = await saveQueuedPdfAnswers(activeOrder);
      const savedData = await formService.getSessionAnswers(sessionId);
      setSavedAnswers(savedData.answers || []);

      if (result.completed) {
        setCompletedAnswers(savedData.answers || []);
        setSession((previous) => ({ ...previous, status: 'completed' }));
        setCompletionNotice(result.lastResponse?.email_status === 'queued'
          ? 'A welcome email has been queued for delivery.'
          : 'Email delivery is not configured yet. Add SMTP settings to backend/.env to send a welcome email.');
        setPdfSuggestions([]);
        setPdfMessage(`Imported ${result.importedCount} answer${result.importedCount === 1 ? '' : 's'}. The form is complete.`);
        return;
      }

      const nextField = result.invalidField || formFields.find((field) => field.field_order === (result.lastResponse?.current_field ?? activeOrder));
      if (nextField) {
        setSession((previous) => ({
          ...previous,
          current_field: nextField.field_order,
          current_question: nextField.question,
          current_field_type: nextField.field_type,
          current_field_options: nextField.options,
        }));
      }

      if (result.invalidField) {
        setInputValue(result.invalidAnswer);
        setValidationError(`${result.invalidField.field_name}: ${result.validationError} Please correct the value below.`);
        setPdfSuggestions((previous) => previous.map((item) => item.field_id === result.invalidField.id
          ? { ...item, error: result.validationError }
          : item));
      } else {
        setPdfSuggestions([]);
        setPdfMessage(result.importedCount
          ? `Imported ${result.importedCount} answer${result.importedCount === 1 ? '' : 's'}. ${currentQueue.size - result.importedCount} selected answer${currentQueue.size - result.importedCount === 1 ? '' : 's'} remain queued and will save automatically as you reach those questions.`
          : currentQueue.size
            ? `${currentQueue.size} selected answer${currentQueue.size === 1 ? '' : 's'} queued. Answer the current question and matching later answers will save automatically.`
            : 'None of the selected values match unanswered fields in this session.');
        if (hasStartedVoice && nextField?.question) {
          await speak(translate(nextField.question));
          setTimeout(() => startListeningWithCue(), 350);
        }
      }
    } catch (error) {
      const statusCode = error.response?.status;
      const detail = error.response?.data?.detail;
      if (statusCode) {
        setPdfError(`Import failed (${statusCode}): ${detail || 'The server could not save these answers.'}`);
      } else {
        setPdfError('Could not reach the backend. Check that the backend is running, then retry the import.');
      }
    } finally {
      setIsImportingPdf(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="spinner" style={{ width: '48px', height: '48px' }} />
      </div>
    );
  }

  // ---------------- Render: Completed State ----------------
  if (session?.status === 'completed') {
    return (
      <div className="voice-form-wrapper">
        <div className="card completion-card">
          <div className="completion-hero">
            <div className="completion-icon"><Icon name="circleCheck" /></div>
            <span className="completion-status"><Icon name="check" /> {translate('Submission complete')}</span>
            <h1 className="completion-title">{translate('You’re all set')}</h1>
            <p className="completion-subtitle">
              {translate('Your answers for')} <strong>{translate(session.form_name)}</strong> {translate('are saved and ready to review.')}
            </p>
            <div className="completion-summary" aria-label={`${completedAnswers.length} ${translate('answers saved')}`}>
              <Icon name="list" />
              <strong>{completedAnswers.length}</strong>
              <span>{translate(completedAnswers.length === 1 ? 'answer saved' : 'answers saved')}</span>
            </div>
          </div>
          {completionNotice && <p className="email-completion-notice" role="status"><Icon name="envelope" /> {completionNotice}</p>}

          <ProgressBar current={session.total_fields} total={session.total_fields} isCompleted={true} translate={translate} />

          <div className="completion-review-heading">
            <div>
              <h2>{translate('Review your answers')}</h2>
              <p>{translate('Make any corrections before you leave this page.')}</p>
            </div>
            <span><Icon name="edit" /> {translate('Editable')}</span>
          </div>
          {answerEditError && (
            <div className="alert alert-danger" role="alert">{answerEditError}</div>
          )}

          <div className="completion-answers-table-wrap">
          <table className="summary-answers-table">
            <thead>
              <tr>
                <th>{translate('Field')}</th>
                <th>{translate('Question')}</th>
                <th>{translate('Your Answer')}</th>
              </tr>
            </thead>
            <tbody>
              {completedAnswers.map((item) => (
                <tr key={item.id}>
                  <td className="completion-field-name">{translate(formatFieldLabel(item.field_name))}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{translate(item.question)}</td>
                  <td className="summary-answer-cell">{renderAnswerEditor(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="completion-answer-cards">
            {completedAnswers.map((item, index) => (
              <article className="completion-answer-card" key={item.id}>
                <div className="completion-answer-card-topline">
                  <span>{translate('FIELD')} {index + 1}</span>
                  <strong>{translate(formatFieldLabel(item.field_name))}</strong>
                </div>
                <p className="completion-answer-question">{translate(item.question)}</p>
                <div className="completion-answer-value">
                  <span>{translate('Your answer')}</span>
                  {renderAnswerEditor(item)}
                </div>
              </article>
            ))}
          </div>

          <div className="completion-actions">
            <Link to="/dashboard">
              <Button variant="primary">{translate('Return to Dashboard')}</Button>
            </Link>
            <Link to="/forms">
              <Button variant="secondary">{translate('Browse More Forms')}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Render: Active Voice Form Question ----------------
  const optionsList = parseOptions(translateOptions(session?.current_field_options || ''));

  return (
    <div className="voice-form-wrapper">
      <div className="voice-form-header">
        <span className="voice-form-badge">{translate('Voice Interactive Mode')}</span>
        <h1 className="voice-form-title">{session?.form_name || ''}</h1>
        <p className="voice-form-subtitle">{translate('Speak naturally or type your answers into the field.')}</p>
      </div>

      <details
        className="pdf-import-card"
        open={pdfPanelOpen}
        onToggle={(event) => setPdfPanelOpen(event.currentTarget.open)}
      >
        <summary className="pdf-import-summary">
          <span className="pdf-import-icon"><Icon name="file" /></span>
          <span className="pdf-import-summary-copy">
            <strong>{translate('Import answers from a PDF')}</strong>
            <small>{savedAnswers.length ? `${savedAnswers.length} ${translate(savedAnswers.length === 1 ? 'answer saved' : 'answers saved')} · ${translate('Review your answers')}` : translate('Optional · Match details to this form')}</small>
          </span>
          <span className="pdf-import-summary-action">{translate(pdfPanelOpen ? 'Close' : 'Open')} <Icon name="chevronRight" /></span>
        </summary>
        <div className="pdf-import-body">
          <div className="pdf-import-heading">
            <div>
              <h2 id="pdf-import-title">{translate('Choose a document')}</h2>
              <p>{translate('Review and edit each suggested answer before importing it.')}</p>
            </div>
          </div>
        <label className="pdf-upload-control">
          <input type="file" accept="application/pdf,.pdf" onChange={handlePdfFile} disabled={isParsingPdf || isImportingPdf} />
          <Icon name={isParsingPdf ? 'clock' : 'upload'} />
          <span>{isParsingPdf ? translate('Reading PDF…') : pdfFilename || translate('Choose a PDF')}</span>
          <span className="pdf-upload-limit">{translate('PDF · up to 12 MB')}</span>
        </label>
          <p className="pdf-privacy-note">{translate('Selectable PDF text is read on this device. Scanned PDFs are sent to the Mahi backend for PaddleOCR processing, then removed; review every suggestion before importing.')}</p>

        {pendingPdfCount > 0 && <p className="pdf-import-message" role="status"><Icon name="clock" /> {pendingPdfCount} {translate('selected PDF answer')} {translate(pendingPdfCount === 1 ? 'waiting for its question.' : 'waiting for their questions.')}</p>}
        {pdfMessage && <p className="pdf-import-message" role="status"><Icon name="check" /> {pdfMessage}</p>}
        {pdfError && <p className="pdf-import-error" role="alert"><Icon name="warning" /> {pdfError}</p>}

        {pdfSuggestions.length > 0 && (
          <div className="pdf-suggestion-list">
            <div className="pdf-suggestion-title">
              <strong>{translate('Review suggested answers')}</strong>
              <span>{pdfSuggestions.filter((item) => item.value).length} {translate('matched · edit or select before import')}</span>
            </div>
            {pdfSuggestions.map((item) => (
              <div className={`pdf-suggestion-row ${item.value ? 'matched' : 'unmatched'}`} key={item.field_id}>
                <label className="pdf-suggestion-check">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    disabled={!item.value || Boolean(item.error) || isImportingPdf}
                    onChange={(event) => setPdfSuggestions((previous) => previous.map((candidate) => (
                      candidate.field_id === item.field_id ? { ...candidate, selected: event.target.checked } : candidate
                    )))}
                    aria-label={`Select ${item.field_name} for import`}
                  />
                </label>
                <div className="pdf-suggestion-field">
                  <strong>{translate(formatFieldLabel(item.field_name))}</strong>
                  <span>{item.value ? translate(item.question) : translate('No confident match — answer this field by voice or text.')}</span>
                </div>
                <input
                  type="text"
                  className="pdf-suggestion-input"
                  value={item.value}
                  placeholder={translate('Not found in PDF')}
                  disabled={isImportingPdf}
                  onChange={(event) => setPdfSuggestions((previous) => previous.map((candidate) => (
                    candidate.field_id === item.field_id
                      ? { ...candidate, value: event.target.value, selected: Boolean(event.target.value.trim()), error: '' }
                      : candidate
                  )))}
                  aria-label={`${translate('PDF answer')} ${translate(formatFieldLabel(item.field_name))}`}
                />
                {item.error && <small className="pdf-suggestion-error">{item.error}</small>}
              </div>
            ))}
            <div className="pdf-import-actions">
              <span>{translate('Unmatched fields will be asked one at a time.')}</span>
              <Button type="button" variant="primary" onClick={handleImportPdfAnswers} loading={isImportingPdf} disabled={isImportingPdf || !pdfSuggestions.some((item) => item.selected && item.value.trim())}>
                <Icon name="check" /> {translate('Import selected answers')}
              </Button>
            </div>
          </div>
        )}

        {savedAnswers.length > 0 && (
          <div className="pdf-imported-summary">
            <div className="pdf-imported-summary-heading">
              <span className="pdf-imported-check"><Icon name="check" /></span>
              <div>
                <strong>{savedAnswers.length} {translate(savedAnswers.length === 1 ? 'answer saved' : 'answers saved')} {translate('so far')}</strong>
                <p>{translate('These fields are complete. The form continues with the first unanswered question below.')}</p>
              </div>
            </div>
            <div className="pdf-imported-answer-list">
              {savedAnswers.map((item) => (
                <div className="pdf-imported-answer" key={item.field_id}>
                  <span>{translate(formatFieldLabel(item.field_name))}</span>
                  <strong>{item.answer}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </details>

      {validationError && (
        <div className="alert alert-danger" style={{ justifyContent: 'center' }} role="alert" aria-live="assertive">
          <span><Icon name="warning" /> {validationError}</span>
        </div>
      )}

      {micError && (
        <div className="alert alert-danger" style={{ justifyContent: 'center' }}>
          <span><Icon name="microphone" /> {micError}</span>
        </div>
      )}

      {!hasStartedVoice && (
        <div className="alert alert-info voice-flow-prompt">
          <span><Icon name="headphones" /> {translate('Hear each question, then answer by voice.')}</span>
          <Button
            variant="primary"
            onClick={handleStartVoiceFlow}
          >
            <Icon name="play" /> {translate('Start voice flow')}
          </Button>
        </div>
      )}

      <div className="question-container">
        <QuestionCard
          currentField={session?.current_field || 1}
          totalFields={session?.total_fields || 1}
          question={translate(session?.current_question || '')}
          fieldType={session?.current_field_type || 'text'}
          options={translateOptions(session?.current_field_options || '')}
          onReplayAudio={handleReplayAudio}
          isSpeaking={isSpeaking}
          translate={translate}
        />

        {/* Microphone Voice Controls & Status */}
        <div className="mic-section">
          <div className="voice-engine-bar">
            <button
              type="button"
              className={`engine-toggle-btn ${engineMode === 'whisper' ? 'active' : ''}`}
              onClick={() => {
                stopListening();
                setEngineMode('whisper');
              }}
              title={translate('Uses multilingual AI speech translation to convert your spoken answer into English')}
            >
              <Icon name="sparkle" /> {translate('Multilingual AI')}
            </button>
          </div>

          <VoiceButton
            isListening={isListening}
            isSpeaking={isSpeaking}
            onToggleListening={handleToggleListening}
            disabled={isProcessing || isTranscribing}
            translate={translate}
          />

          <VoiceStatus
            isListening={isListening}
            isSpeaking={isSpeaking}
            isProcessing={isProcessing}
            isTranscribing={isTranscribing}
            recordingSeconds={recordingSeconds}
            waveform={waveform}
            engineMode={engineMode}
            translate={translate}
          />
        </div>

        {/* Quick select options for choice and yes/no fields */}
        {session?.current_field_type === 'choice' && optionsList.length > 0 && (
          <div className="choice-quick-select">
            <span className="choice-quick-label">{translate('Tap or speak option:')}</span>
            <div className="choice-pills-row">
              {optionsList.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`choice-select-btn ${inputValue.toLowerCase().includes(opt.toLowerCase()) ? 'active' : ''}`}
                  onClick={() => handleQuickOptionSelect(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {session?.current_field_type === 'yes_no' && (
          <div className="choice-quick-select">
            <span className="choice-quick-label">{translate('Tap or speak Yes/No:')}</span>
            <div className="choice-pills-row">
                  {['Yes', 'No'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`choice-select-btn ${inputValue.toLowerCase() === translate(opt).toLowerCase() ? 'active' : ''}`}
                  onClick={() => handleQuickOptionSelect(opt)}
                >
                  {translate(opt)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* LIVE TRANSCRIBED ANSWER FIELD */}
        <form onSubmit={handleSubmitForm} className="live-field-form">
          <div className="live-field-wrapper">
            <label className="live-field-label" htmlFor="form-answer-input">
              <span>{translate('Your Answer')}</span>
              {isListening && (
                <span className="live-transcribing-badge">
                  <span className="pulse-dot" /> {translate('Transcribing your voice...')}
                </span>
              )}
            </label>

            <div className="live-input-container">
              <input
                id="form-answer-input"
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => {
                  if (voiceReviewTimerRef.current) {
                    clearInterval(voiceReviewTimerRef.current);
                    voiceReviewTimerRef.current = null;
                  }
                  setVoiceReviewSeconds(0);
                  setInputValue(e.target.value);
                }}
                placeholder={translate(isListening ? 'Listening… speak your answer' : 'Type an answer or use the mic…')}
                className={`live-form-input ${isListening ? 'listening-active' : ''}`}
                disabled={isProcessing}
                autoComplete="off"
              />

              {inputValue && (
                <button
                  type="button"
                  className="clear-input-btn"
                  onClick={() => {
                    if (voiceReviewTimerRef.current) {
                      clearInterval(voiceReviewTimerRef.current);
                      voiceReviewTimerRef.current = null;
                    }
                    setVoiceReviewSeconds(0);
                    setInputValue('');
                    resetTranscript();
                  }}
                  title={translate('Clear input')}
                >
                  ✕
                </button>
              )}
            </div>

            <p className="live-field-hint">
              💡 {isListening
                ? translate('Speak naturally. It submits after 3 seconds of silence; click Done Speaking to submit sooner.')
                : translate('You can type or edit answers. After the last question, review and edit any answer before finishing.')}
            </p>
            {voiceReviewSeconds > 0 && (
              <p className="voice-review-notice" role="status" aria-live="polite">
                {translate('Heard:')} “{inputValue}”. {translate('You can edit it now; submitting automatically in')} {voiceReviewSeconds} {translate(voiceReviewSeconds === 1 ? 'second' : 'seconds')}.
                {' '}<button type="button" className="voice-review-cancel" onClick={() => {
                  if (voiceReviewTimerRef.current) clearInterval(voiceReviewTimerRef.current);
                  voiceReviewTimerRef.current = null;
                  setVoiceReviewSeconds(0);
                  inputRef.current?.focus();
                }}>{translate('Keep editing')}</button>
              </p>
            )}
          </div>

          <div className="field-action-buttons">
            <Button
              type="submit"
              variant="primary"
              loading={isProcessing}
              disabled={isProcessing}
              style={{ minWidth: '140px' }}
            >
              {translate('Submit Answer')} ➔
            </Button>

          </div>
        </form>

        {/* Form Progress */}
        <ProgressBar
          current={session?.current_field || 1}
          total={session?.total_fields || 1}
          translate={translate}
        />
      </div>
    </div>
  );
}
