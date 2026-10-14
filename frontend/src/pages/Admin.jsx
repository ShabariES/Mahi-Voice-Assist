import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { formService } from '../services/formService';
import { authService } from '../services/authService';
import { issueService } from '../services/issueService';
import { formatDate } from '../utils/formatters';
import { parseOptions } from '../utils/options';
import { useVoice } from '../hooks/useVoice';
import Button from '../components/Button';
import Input from '../components/Input';
import Icon from '../components/Icon';
import { SUPPORTED_LANGUAGES } from '../constants/languages';
import { translationService } from '../services/translationService';
import '../styles/admin.css';
import '../styles/issues.css';

const getApiErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || JSON.stringify(item)).join(' ');
  }
  if (detail && typeof detail === 'object') return detail.msg || JSON.stringify(detail);
  return error?.message || fallback;
};

const markDuplicateAccountMatches = (records) => {
  const seenUserIds = new Set();
  return records.map((record) => {
    const userId = record.user_id ? String(record.user_id) : null;
    const duplicateMatch = userId && seenUserIds.has(userId);
    if (userId) seenUserIds.add(userId);
    return {
      ...record,
      include: Boolean(userId && !duplicateMatch),
      match_error: duplicateMatch ? 'This account also matches another PDF record. Only one record per account can be imported.' : record.match_error,
    };
  });
};

export default function Admin() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState('forms');
  const [forms, setForms] = useState([]);
  const [users, setUsers] = useState([]);
  const [issueReports, setIssueReports] = useState([]);
  const [issueReplies, setIssueReplies] = useState({});
  const [issueLoading, setIssueLoading] = useState(false);
  const [activeReplyReportId, setActiveReplyReportId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bulkFormId, setBulkFormId] = useState('');
  const [bulkFiles, setBulkFiles] = useState([]);
  const [bulkRecords, setBulkRecords] = useState([]);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // Modal State for Form Builder
  const [showModal, setShowModal] = useState(false);
  const [editingFormId, setEditingFormId] = useState(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLanguageCode, setFormLanguageCode] = useState(user?.preferred_language || 'en-IN');
  const [formContentLanguageCode, setFormContentLanguageCode] = useState('en-IN');
  const [isTranslatingForm, setIsTranslatingForm] = useState(false);
  const [fields, setFields] = useState([
    { field_name: '', question: '', field_type: 'text', required: true, options: '', field_order: 1 }
  ]);
  const [activeVoiceTarget, setActiveVoiceTarget] = useState(null);
  const voiceTargetRef = useRef(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const builderFormRef = useRef(null);
  const activeReplyReportRef = useRef(null);
  const voiceFlowActiveRef = useRef(false);
  const voiceFlowStepsRef = useRef([]);
  const voiceFlowIndexRef = useRef(0);
  const voiceAdvanceTimerRef = useRef(null);

  const makeVoiceSteps = (fieldCount) => [
    { scope: 'form', key: 'formName' },
    { scope: 'form', key: 'description' },
    ...Array.from({ length: fieldCount }, (_, index) => [
      { scope: 'field', index, key: 'field_name' },
      { scope: 'field', index, key: 'question' },
      { scope: 'field', index, key: 'field_type' },
      { scope: 'field', index, key: 'options' },
    ]).flat(),
    { scope: 'command' },
  ];

  const applyVoiceTranscript = React.useCallback((transcript) => {
    const target = voiceTargetRef.current;
    const value = transcript?.trim();
    if (!target || !value) return;
    if (target.scope === 'command') {
      const command = value.toLowerCase().replace(/[.!?]/g, '').trim();
      if (/(add|new|another) (a )?(question|field)/.test(command)) {
        handleAddField();
        return 'add';
      }
      if (/(save|submit) (the )?(form|builder)/.test(command)) {
        builderFormRef.current?.requestSubmit();
        return 'stop';
      }
      if (/(cancel|close)(?: (the )?(form|builder))?/.test(command)) {
        setShowModal(false);
        return 'stop';
      }
      setError(`I heard “${value}”. Try “add question”, “save form”, or “cancel”.`);
    } else if (target.scope === 'form') {
      if (target.key === 'formName') setFormName(value);
      else setFormDescription(value);
    } else if (target.key === 'field_type') {
      const normalized = value.toLowerCase().replace(/[^a-z_ ]/g, '').trim().replace(/\s+/g, '_');
      const aliases = { yes: 'yes_no', yesno: 'yes_no', yes_no: 'yes_no', yes_or_no: 'yes_no', multiple_choice: 'choice', long_text: 'textarea', short_text: 'text' };
      const fieldType = aliases[normalized] || normalized;
      const allowed = ['text', 'email', 'phone', 'number', 'date', 'yes_no', 'choice', 'textarea'];
      if (allowed.includes(fieldType)) {
        setFields((previous) => previous.map((field, index) => index === target.index ? { ...field, field_type: fieldType } : field));
      } else {
        setError(`I heard “${value}”. Say a type such as text, email, phone, number, date, yes/no, choice, or textarea.`);
      }
    } else {
      setFields((previous) => previous.map((field, index) => {
        if (index !== target.index) return field;
        const nextValue = target.key === 'field_name'
          ? value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          : value;
        return { ...field, [target.key]: nextValue };
      }));
    }
  }, []);

  const handleFinalVoiceTranscript = React.useCallback((transcript) => {
    const result = applyVoiceTranscript(transcript);
    if (!voiceFlowActiveRef.current) {
      voiceTargetRef.current = null;
      setActiveVoiceTarget(null);
      return;
    }
    if (result === 'stop') {
      voiceFlowActiveRef.current = false;
      voiceTargetRef.current = null;
      setActiveVoiceTarget(null);
      return;
    }
    if (result === 'add') {
      const newIndex = fieldsRef.current.length - 1;
      const steps = voiceFlowStepsRef.current;
      steps.splice(voiceFlowIndexRef.current, 0,
        { scope: 'field', index: newIndex, key: 'field_name' },
        { scope: 'field', index: newIndex, key: 'question' },
        { scope: 'field', index: newIndex, key: 'field_type' },
        { scope: 'field', index: newIndex, key: 'options' },
      );
    }
    voiceFlowIndexRef.current += 1;
    const nextTarget = voiceFlowStepsRef.current[voiceFlowIndexRef.current];
    if (!nextTarget) {
      voiceFlowActiveRef.current = false;
      voiceTargetRef.current = null;
      setActiveVoiceTarget(null);
      return;
    }
    if (voiceAdvanceTimerRef.current) clearTimeout(voiceAdvanceTimerRef.current);
    voiceAdvanceTimerRef.current = setTimeout(() => {
      if (!voiceFlowActiveRef.current) return;
      voiceTargetRef.current = nextTarget;
      setActiveVoiceTarget(nextTarget);
      startQuestionListening();
    }, 2000);
  }, [applyVoiceTranscript]);

  const {
    isListening: isQuestionListening,
    isTranscribing: isQuestionTranscribing,
    error: questionVoiceError,
    startListening: startQuestionListening,
    stopListening: stopQuestionListening,
  } = useVoice({
    onFinalTranscript: handleFinalVoiceTranscript,
    silenceTimeoutMs: 2000,
    fieldContext: {
      fieldType: 'text',
      question: 'Transcribe the spoken words clearly. Preserve names, labels, and option values.',
      languageCode: formContentLanguageCode,
    },
  });

  const handleReplyTranscript = useCallback((transcript) => {
    const reportId = activeReplyReportRef.current;
    if (reportId) setIssueReplies((previous) => ({ ...previous, [reportId]: transcript.trim() }));
  }, []);

  const {
    isListening: isReplyListening,
    isTranscribing: isReplyTranscribing,
    error: replyVoiceError,
    startListening: startReplyListening,
    stopListening: stopReplyListening,
  } = useVoice({
    onFinalTranscript: handleReplyTranscript,
    silenceTimeoutMs: 2000,
    fieldContext: { fieldType: 'text', question: 'Dictate a concise and helpful support email reply. Preserve the speaker’s wording.' },
  });

  useEffect(() => {
    if (!showModal) {
      voiceFlowActiveRef.current = false;
      if (voiceAdvanceTimerRef.current) clearTimeout(voiceAdvanceTimerRef.current);
      voiceTargetRef.current = null;
      setActiveVoiceTarget(null);
      if (isQuestionListening) stopQuestionListening();
    }
  }, [showModal, isQuestionListening, stopQuestionListening]);

  const handleVoiceMicClick = () => {
    if (voiceFlowActiveRef.current) {
      if (!isQuestionListening && !isQuestionTranscribing && questionVoiceError) {
        startQuestionListening();
        return;
      }
      voiceFlowActiveRef.current = false;
      if (voiceAdvanceTimerRef.current) clearTimeout(voiceAdvanceTimerRef.current);
      stopQuestionListening();
      return;
    }
    if (isQuestionListening || isQuestionTranscribing) return;
    voiceFlowStepsRef.current = makeVoiceSteps(fieldsRef.current.length);
    voiceFlowIndexRef.current = 0;
    voiceFlowActiveRef.current = true;
    const firstTarget = voiceFlowStepsRef.current[0];
    voiceTargetRef.current = firstTarget;
    setActiveVoiceTarget(firstTarget);
    setError('');
    startQuestionListening();
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const formsData = await formService.getForms();
      setForms(formsData);

      if (isAdmin) {
        const usersData = await authService.getAllUsers();
        setUsers(usersData);
      }
    } catch (err) {
      setError('Failed to fetch data.');
    } finally {
      setLoading(false);
    }
  };

  const loadIssueReports = async () => {
    setIssueLoading(true);
    try {
      setIssueReports(await issueService.getReports());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load issue reports.'));
    } finally {
      setIssueLoading(false);
    }
  };

  const selectAdminTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'reports') loadIssueReports();
  };

  const toggleReplyVoice = (reportId) => {
    if (isReplyListening && activeReplyReportId === reportId) {
      stopReplyListening();
      return;
    }
    if (isReplyListening || isReplyTranscribing) return;
    activeReplyReportRef.current = reportId;
    setActiveReplyReportId(reportId);
    startReplyListening();
  };

  const handleIssueStatusChange = async (reportId, status) => {
    try {
      const updated = await issueService.updateStatus(reportId, status);
      setIssueReports((previous) => previous.map((report) => report.id === reportId ? updated : report));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not update report status.'));
    }
  };

  const handleUserRoleChange = async (targetUser, role) => {
    if (targetUser.role === role) return;
    try {
      const updated = await authService.updateUserRole(targetUser.id, role);
      setUsers((previous) => previous.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setSuccess(`Updated ${updated.name}'s role.`);
      setError('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not update this account role.'));
    }
  };

  const handleSendIssueReply = async (report) => {
    const message = (issueReplies[report.id] || '').trim();
    const subject = `Re: ${report.subject}`;
    if (!message) {
      setError('Dictate or type a reply before sending.');
      return;
    }
    if (!window.confirm(`Send this email to ${report.user_name} at ${report.user_email}?\n\nSubject: ${subject}\n\n${message}`)) return;
    setError('');
    try {
      const updated = await issueService.sendReply(report.id, subject, message);
      setIssueReports((previous) => previous.map((item) => item.id === report.id ? updated : item));
      setActiveReplyReportId(null);
      activeReplyReportRef.current = null;
      setSuccess(`Reply sent to ${report.user_email}.`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not send the email reply.'));
    }
  };

  useEffect(() => {
    loadData();
  }, [isAdmin]);

  const handleOpenCreateModal = () => {
    setEditingFormId(null);
    setFormName('');
    setFormDescription('');
    setFormContentLanguageCode('en-IN');
    setFormLanguageCode(user?.preferred_language || 'en-IN');
    setFields([
      { field_name: '', question: '', field_type: 'text', required: true, options: '', field_order: 1 }
    ]);
    setShowModal(true);
  };

  const handleOpenEditModal = async (formId) => {
    setError('');
    try {
      const form = await formService.getFormById(formId);
      setEditingFormId(form.id);
      setFormName(form.source_name || form.name);
      setFormDescription(form.source_description ?? form.description ?? '');
      setFormContentLanguageCode(form.source_language_code || form.language_code || 'en-IN');
      setFormLanguageCode(form.language_code || 'en-IN');
      setFields((form.fields || []).map((field) => ({
        ...field,
        question: field.source_question || field.question,
        options: field.source_options ?? field.options ?? '',
      })));
      setShowModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not open this form for editing.'));
    }
  };

  const handleAddField = () => {
    const nextField = {
        field_name: '',
        question: '',
        field_type: 'text',
        required: true,
        options: '',
        field_order: fieldsRef.current.length + 1
      };
    fieldsRef.current = [...fieldsRef.current, nextField];
    setFields(fieldsRef.current);
  };

  const handleRemoveField = (index) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index, key, value) => {
    setFields((prev) => {
      const updated = [...prev];
      updated[index][key] = value;
      return updated;
    });
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (fields.length === 0) {
      setError('Please add at least one question field.');
      return;
    }

    const normalizedNames = fields.map((field) => field.field_name.trim().toLowerCase());
    if (normalizedNames.some((name) => !name) || new Set(normalizedNames).size !== normalizedNames.length) {
      setError('Give every question a unique field name before saving. Use letters, numbers, and underscores.');
      return;
    }

    if (fields.some((field) => field.field_type === 'choice' && parseOptions(field.options).length === 0)) {
      setError('Add at least one option for every Choice field. Separate options with commas or new lines.');
      return;
    }

    try {
      setIsTranslatingForm(true);
      const texts = [formName, formDescription];
      fields.forEach((field) => {
        texts.push(field.question);
        if (field.field_type === 'choice') texts.push(...parseOptions(field.options));
      });
      let translated = texts;
      let savedLanguageCode = formLanguageCode;
      let savedWithoutTranslation = false;
      try {
        translated = await translationService.translateTexts(texts, formContentLanguageCode, formLanguageCode);
      } catch (translationError) {
        if (![502, 503].includes(translationError.response?.status)) throw translationError;
        // Translation is optional for saving. Keep the form's declared language
        // aligned with its actual text when the hosted provider is unavailable.
        translated = texts;
        savedLanguageCode = formContentLanguageCode;
        savedWithoutTranslation = true;
      }
      let textIndex = 2;
      const localizedFields = fields.map((field, index) => {
        const question = translated[textIndex++] || field.question;
        const options = field.field_type === 'choice'
          ? parseOptions(field.options).map(() => translated[textIndex++] || '').join(', ')
          : field.options;
        return { ...field, question, options, field_order: index + 1 };
      });
      const payload = {
        name: translated[0] || formName,
        description: translated[1] || formDescription,
        source_name: formName,
        source_description: formDescription,
        source_language_code: formContentLanguageCode,
        language_code: savedLanguageCode,
        fields: localizedFields.map((field, index) => ({
          ...field,
          source_question: fields[index].question,
          source_options: fields[index].options,
        })),
      };
      if (editingFormId) {
        await formService.updateForm(editingFormId, payload);
        setSuccess(savedWithoutTranslation
          ? 'Form updated in its original language. Configure SARVAM_API_KEY on the API service to enable automatic translation.'
          : 'Form updated successfully!');
      } else {
        await formService.createForm(payload);
        setSuccess(savedWithoutTranslation
          ? 'Form created in its original language. Configure SARVAM_API_KEY on the API service to enable automatic translation.'
          : 'Form created successfully!');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to save form.'));
    } finally {
      setIsTranslatingForm(false);
    }
  };

  const handleDeleteForm = async (formId) => {
    if (!window.confirm('Are you sure you want to delete this form?')) return;
    try {
      await formService.deleteForm(formId);
      setSuccess('Form deleted.');
      loadData();
    } catch (err) {
      setError('Could not delete form.');
    }
  };

  const handleBulkPreview = async () => {
    setError('');
    setSuccess('');
    setBulkResult(null);
    if (!bulkFormId) {
      setError('Choose a form before uploading PDFs.');
      return;
    }
    if (!bulkFiles.length) {
      setError('Choose at least one PDF.');
      return;
    }
    setBulkPreviewLoading(true);
    try {
      const result = await formService.previewBulkPdf(Number(bulkFormId), bulkFiles);
      setBulkRecords(markDuplicateAccountMatches(result.records.map((record, index) => ({
        ...record,
        key: `${record.source_file}-${index}`,
        answers: record.answers.map((answer) => ({ ...answer, value: answer.value || '' })),
      }))));
      setSuccess(`Read ${result.records.length} person record${result.records.length === 1 ? '' : 's'} from ${result.files_processed} PDF${result.files_processed === 1 ? '' : 's'}. Review matches and values before importing.`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not extract records from these PDFs.'));
      setBulkRecords([]);
    } finally {
      setBulkPreviewLoading(false);
    }
  };

  const handleBulkImport = async () => {
    setError('');
    setSuccess('');
    const selectedRows = bulkRecords.filter((record) => record.include && record.user_id);
    const seenUserIds = new Set();
    const selected = selectedRows.filter((record) => {
      const userId = String(record.user_id);
      if (seenUserIds.has(userId)) return false;
      seenUserIds.add(userId);
      return true;
    });
    const skippedDuplicateCount = selectedRows.length - selected.length;
    if (!selected.length) {
      setError('Select at least one record and match it to a user account.');
      return;
    }
    if (skippedDuplicateCount) {
      setBulkRecords((previous) => {
        const keptUserIds = new Set();
        return previous.map((record) => {
          if (!record.include || !record.user_id) return record;
          const userId = String(record.user_id);
          if (keptUserIds.has(userId)) return { ...record, include: false };
          keptUserIds.add(userId);
          return record;
        });
      });
    }
    setBulkImporting(true);
    try {
      const result = await formService.importBulkPdf(Number(bulkFormId), selected.map((record) => ({
        user_id: Number(record.user_id),
        answers: record.answers.filter((answer) => answer.value.trim()).map((answer) => ({ field_id: answer.field_id, answer: answer.value.trim() })),
      })));
      setBulkResult(result);
      const completedCount = result.created?.filter((item) => item.status === 'completed').length || 0;
      const inProgressCount = result.created_count - completedCount;
      if (result.created_count > 0) {
        const summary = [`Imported ${result.created_count} record${result.created_count === 1 ? '' : 's'}`];
        if (completedCount) summary.push(`${completedCount} submitted`);
        if (inProgressCount) summary.push(`${inProgressCount} need user follow-up`);
        setSuccess(`${summary.join(' · ')}.`);
      }
      if (skippedDuplicateCount) {
        setError(`${skippedDuplicateCount} duplicate row${skippedDuplicateCount === 1 ? ' was' : 's were'} skipped because an account can receive only one session per import.`);
      }
      if (result.rejected?.length) {
        const rejectedMessage = result.created_count === 0
          ? `No records were imported. ${result.rejected.length} record${result.rejected.length === 1 ? '' : 's'} failed validation; review the reasons below.`
          : `${result.rejected.length} record${result.rejected.length === 1 ? '' : 's'} could not be imported; review the reasons below.`;
        setError((previous) => [previous, rejectedMessage].filter(Boolean).join(' '));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not create form sessions.'));
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="dashboard-title">Management Console</h1>
          <p className="dashboard-desc">Manage voice forms, questions, and system accounts.</p>
        </div>
        {activeTab === 'forms' && (
          <Button variant="primary" onClick={handleOpenCreateModal}>
            <Icon name="plus" /> Create New Form
          </Button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'forms' ? 'active' : ''}`}
          onClick={() => selectAdminTab('forms')}
        >
          Forms Management ({forms.length})
        </button>
        {isAdmin && (
          <button
            className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => selectAdminTab('users')}
          >
            User Accounts ({users.length})
          </button>
        )}
        {isAdmin && (
          <button
            className={`admin-tab ${activeTab === 'bulk' ? 'active' : ''}`}
            onClick={() => selectAdminTab('bulk')}
          >
            Bulk PDF Fill
          </button>
        )}
        <button
          className={`admin-tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => selectAdminTab('reports')}
        >
          Issue Reports ({issueReports.filter((report) => report.status !== 'resolved').length})
        </button>
      </div>

      {activeTab === 'forms' ? (
        <>
        <div className="card admin-data-table" style={{ padding: '0.5rem 1rem' }}>
          <table className="recent-sessions-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Form Name</th>
                <th>Description</th>
                <th>Questions</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f, index) => (
                <tr key={f.id}>
                  <td>#{index + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{f.name}</td>
                  <td style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.description}
                  </td>
                  <td>
                    <span className="field-badge">{f.total_fields} {f.total_fields === 1 ? 'Field' : 'Fields'}</span>
                  </td>
                  <td>{formatDate(f.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Button
                        variant="secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => handleOpenEditModal(f.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => handleDeleteForm(f.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-mobile-list">
          {forms.map((f, index) => (
            <article className="card admin-mobile-card" key={f.id}>
              <div className="admin-mobile-card-heading">
                <span className="admin-mobile-kicker">FORM #{index + 1}</span>
                <span className="field-badge">{f.total_fields} {f.total_fields === 1 ? 'Field' : 'Fields'}</span>
              </div>
              <h2>{f.name}</h2>
              <p>{f.description || 'No description provided.'}</p>
              <div className="admin-mobile-meta">
                <span>Created</span>
                <strong>{formatDate(f.created_at)}</strong>
              </div>
              <div className="admin-mobile-card-actions">
                <Button variant="secondary" onClick={() => handleOpenEditModal(f.id)}>Edit Form</Button>
                <Button variant="danger" onClick={() => handleDeleteForm(f.id)}>Delete Form</Button>
              </div>
            </article>
          ))}
        </div>
        </>
      ) : activeTab === 'bulk' && isAdmin ? (
        <section className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Fill a form for multiple users</h2>
          <p>Upload up to 20 PDFs, including a single PDF with a labeled table of people. Records are matched by registered email, or by a unique exact name when no email is present. Review every value and account match before importing; OCR can misread scanned or unusual layouts.</p>
          <p className="admin-pdf-privacy-note">PDF contents are sent to this server for extraction. Do not upload documents you are not authorized to process. Review the extracted details before creating user sessions.</p>
          <div style={{ display: 'grid', gap: '1rem', maxWidth: '760px' }}>
            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <strong>Form</strong>
              <select className="form-select" value={bulkFormId} onChange={(event) => { setBulkFormId(event.target.value); setBulkRecords([]); setBulkResult(null); }}>
                <option value="">Choose a form…</option>
                {forms.map((form) => <option value={form.id} key={form.id}>{form.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <strong>PDF files</strong>
              <input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { setBulkFiles(Array.from(event.target.files || [])); setBulkRecords([]); setBulkResult(null); }} />
              <small>{bulkFiles.length ? `${bulkFiles.length} PDF${bulkFiles.length === 1 ? '' : 's'} selected` : 'Each PDF can contain one or more people. Maximum 12 MB and 40 pages per file.'}</small>
            </label>
            <div>
              <Button variant="primary" onClick={handleBulkPreview} loading={bulkPreviewLoading} disabled={bulkPreviewLoading || bulkImporting || !bulkFormId || !bulkFiles.length}>
                {bulkPreviewLoading ? 'Reading PDFs…' : 'Extract and review records'}
              </Button>
            </div>
          </div>

          {bulkRecords.length > 0 && (
            <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
              <h3 style={{ marginBottom: 0 }}>Review extracted people ({bulkRecords.length})</h3>
              <p>Only selected records with a matched user account are imported. Blank fields stay unanswered; sessions with missing fields remain in progress.</p>
              <p role="status" aria-live="polite">
                {bulkRecords.filter((record) => record.include).length} selected · {bulkRecords.filter((record) => record.include && record.user_id).length} matched to user accounts
                {bulkRecords.some((record) => record.include && !record.user_id) ? ` · ${bulkRecords.filter((record) => record.include && !record.user_id).length} need an account match` : ''}
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => setBulkRecords((previous) => previous.map((record) => ({ ...record, include: true })))} disabled={bulkImporting}>
                  Select all
                </Button>
                <Button variant="outline" onClick={() => setBulkRecords((previous) => previous.map((record) => ({ ...record, include: false })))} disabled={bulkImporting}>
                  Clear selection
                </Button>
              </div>
              {bulkRecords.map((record, recordIndex) => (
                <article key={record.key} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1rem', display: 'grid', gap: '0.8rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input type="checkbox" checked={record.include} onChange={(event) => setBulkRecords((previous) => previous.map((item) => item.key === record.key ? { ...item, include: event.target.checked } : item))} />
                    <strong>{record.name || `Record ${recordIndex + 1}`}</strong>
                    <small>{record.source_file}</small>
                  </label>
                  <label style={{ display: 'grid', gap: '0.4rem', maxWidth: '480px' }}>
                    <strong>Match to user account</strong>
                    <select className="form-select" value={record.user_id || ''} onChange={(event) => setBulkRecords((previous) => previous.map((item) => item.key === record.key ? { ...item, user_id: event.target.value ? Number(event.target.value) : null, user_name: users.find((candidate) => candidate.id === Number(event.target.value))?.name || null, user_email: users.find((candidate) => candidate.id === Number(event.target.value))?.email || null, match_error: event.target.value ? null : 'Choose a user account.' } : item))}>
                      <option value="">No matched account — choose one…</option>
                      {users.filter((candidate) => candidate.role === 'user').map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email}</option>)}
                    </select>
                    <small>{record.email ? `PDF email: ${record.email}` : 'No email was found in this record.'}{record.user_email ? ` · Matched: ${record.user_email}` : ''}{record.match_error ? ` · ${record.match_error}` : ''}</small>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
                    {record.answers.map((answer) => (
                      <label key={answer.field_id} style={{ display: 'grid', gap: '0.35rem' }}>
                        <span>{answer.field_name}</span>
                        <input className="form-input" value={answer.value} onChange={(event) => setBulkRecords((previous) => previous.map((item) => item.key === record.key ? { ...item, answers: item.answers.map((candidate) => candidate.field_id === answer.field_id ? { ...candidate, value: event.target.value } : candidate) } : item))} placeholder="Not found" />
                      </label>
                    ))}
                  </div>
                </article>
              ))}
              <div>
                <Button variant="primary" onClick={handleBulkImport} loading={bulkImporting} disabled={bulkImporting || bulkPreviewLoading || !bulkRecords.some((record) => record.include && record.user_id)}>
                  {bulkImporting ? 'Creating sessions…' : `Import ${bulkRecords.filter((record) => record.include && record.user_id).length} selected records`}
                </Button>
              </div>
            </div>
          )}
          {bulkResult && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3>Import results</h3>
              {bulkResult.created?.map((item) => <p key={item.session_id}>Created session #{item.session_id} for {item.user_email}: {item.status}{item.missing_fields?.length ? ` · missing ${item.missing_fields.join(', ')}` : ''}</p>)}
              {bulkResult.rejected?.map((item) => <p key={item.user_id}>Could not import {item.user_email}: {item.errors.join(' ')}</p>)}
            </div>
          )}
        </section>
      ) : activeTab === 'users' ? (
        <>
        <div className="card admin-data-table" style={{ padding: '0.5rem 1rem' }}>
          <table className="recent-sessions-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>#{u.id}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select className="form-select" aria-label={`Role for ${u.name}`} value={u.role} onChange={(event) => handleUserRoleChange(u, event.target.value)}>
                      <option value="user">User</option>
                      <option value="form_manager">Form Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{formatDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-mobile-list">
          {users.map((u) => (
            <article className="card admin-mobile-card" key={u.id}>
              <div className="admin-mobile-card-heading">
                <span className="admin-mobile-kicker">USER #{u.id}</span>
                <span className={`user-role-badge role-${u.role}`}>{u.role.replace('_', ' ')}</span>
              </div>
              <h2>{u.name}</h2>
              <p className="admin-mobile-email">{u.email}</p>
              <label className="admin-mobile-meta">
                <span>Account role</span>
                <select className="form-select" aria-label={`Role for ${u.name}`} value={u.role} onChange={(event) => handleUserRoleChange(u, event.target.value)}>
                  <option value="user">User</option>
                  <option value="form_manager">Form Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <div className="admin-mobile-meta">
                <span>Joined</span>
                <strong>{formatDate(u.created_at)}</strong>
              </div>
            </article>
          ))}
        </div>
        </>
      ) : (
        <section className="issue-admin-list">
          {issueLoading ? <div className="card issue-empty">Loading issue reports…</div> : issueReports.length === 0 ? (
            <div className="card issue-empty">
              <span className="issue-icon"><Icon name="circleCheck" /></span>
              <h2>No reports yet</h2>
              <p>User reports will appear here. Admins can dictate a response and send it after reviewing the recipient and message.</p>
            </div>
          ) : issueReports.map((report) => (
            <article className="card issue-admin-card" key={report.id}>
              <div className="issue-admin-header">
                <div>
                  <p className="issue-eyebrow">REPORT #{report.id} · {formatDate(report.created_at)}</p>
                  <h2>{report.subject}</h2>
                  <p className="issue-reporter"><Icon name="user" /> {report.user_name} · <a href={`mailto:${report.user_email}`}>{report.user_email}</a></p>
                </div>
                <label className="issue-status-control">
                  <span>Status</span>
                  <select value={report.status} onChange={(event) => handleIssueStatusChange(report.id, event.target.value)}>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>
              </div>
              <p className="issue-report-description">{report.description}</p>
              {report.admin_reply && <p className="issue-sent-reply"><strong>Last reply sent:</strong> {report.admin_reply}</p>}
              {isAdmin ? (
                <div className="issue-reply-box">
                  <label htmlFor={`issue-reply-${report.id}`}>Reply by voice or edit the draft</label>
                  <textarea
                    id={`issue-reply-${report.id}`}
                    rows={4}
                    maxLength={5000}
                    value={issueReplies[report.id] || ''}
                    onChange={(event) => setIssueReplies((previous) => ({ ...previous, [report.id]: event.target.value }))}
                    placeholder="Dictate or type a helpful reply…"
                  />
                  <div className="issue-reply-footer">
                    <button
                      type="button"
                      className={`question-mic-button issue-reply-mic ${isReplyListening && activeReplyReportId === report.id ? 'is-listening' : ''}`}
                      onClick={() => toggleReplyVoice(report.id)}
                      disabled={isReplyTranscribing || (isReplyListening && activeReplyReportId !== report.id)}
                    >
                      <Icon name={isReplyListening && activeReplyReportId === report.id ? 'stop' : 'microphone'} />
                      {isReplyListening && activeReplyReportId === report.id ? 'Done speaking' : isReplyTranscribing && activeReplyReportId === report.id ? 'Transcribing…' : 'Dictate reply'}
                    </button>
                    <span className="issue-mail-destination"><Icon name="envelope" /> To: {report.user_email} · Subject: Re: {report.subject}</span>
                    <Button variant="primary" onClick={() => handleSendIssueReply(report)} disabled={isReplyListening || isReplyTranscribing || !issueReplies[report.id]?.trim()}>
                      <Icon name="envelope" /> Send reply
                    </Button>
                  </div>
                  {isReplyListening && activeReplyReportId === report.id && <p className="question-stt-status" role="status">Listening for your reply… 2 seconds of silence will finish dictation.</p>}
                  {replyVoiceError && activeReplyReportId === report.id && <p className="issue-error" role="alert">{replyVoiceError}</p>}
                </div>
              ) : (
                <p className="issue-manager-note">Only an admin can send email replies. You can update the report status above.</p>
              )}
            </article>
          ))}
        </section>
      )}

      {/* Form Builder Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h2>{editingFormId ? 'Edit Form' : 'Create New Voice Form'}</h2>
              <button
                className="icon-btn"
                onClick={() => setShowModal(false)}
                style={{ fontSize: '1.5rem' }}
              >
                <Icon name="close" />
              </button>
            </div>

    <form ref={builderFormRef} onSubmit={handleSaveForm}>
              <div className="admin-voice-input">
                <label className="form-label" htmlFor="form-content-language">Language the questions are written in</label>
                <select id="form-content-language" className="form-input form-select" value={formContentLanguageCode} onChange={(event) => setFormContentLanguageCode(event.target.value)}>
                  {SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
                </select>
                <label className="form-label" htmlFor="form-language-code">Language to create the form in</label>
                <select id="form-language-code" className="form-input form-select" value={formLanguageCode} onChange={(event) => setFormLanguageCode(event.target.value)}>
                  {SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
                </select>
                <small className="field-hint">The form name, description, questions, and choices are translated before saving when SARVAM_API_KEY is configured. If translation is unavailable, the form saves in its original language.</small>
                <Input label="Form Name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Patient Intake Form" required />
              </div>
              <div className="admin-voice-input admin-voice-textarea">
                <Input label="Description" as="textarea" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Describe what this form is for..." />
              </div>
              <div className="admin-voice-input">
              </div>

              <div className="field-builder-heading">
                <h3 style={{ fontSize: '1.1rem' }}>Form Questions & Fields</h3>
                <div className="builder-voice-actions">
                  <button
                    type="button"
                    className={`question-mic-button builder-single-mic ${isQuestionListening ? 'is-listening' : ''}`}
                    onClick={handleVoiceMicClick}
                    disabled={isQuestionTranscribing}
                    aria-label={voiceFlowActiveRef.current ? (isQuestionListening ? 'Stop voice form setup' : 'Retry current voice field') : 'Start voice form setup'}
                    title={voiceFlowActiveRef.current ? (isQuestionListening ? 'Stop voice form setup' : 'Retry current voice field') : 'Start voice form setup'}
                  >
                    <Icon name={voiceFlowActiveRef.current && isQuestionListening ? 'stop' : 'microphone'} />
                    <span>{voiceFlowActiveRef.current ? (isQuestionListening ? 'Stop' : 'Retry') : 'Build by voice'}</span>
                  </button>
                  <Button variant="secondary" onClick={handleAddField} disabled={isQuestionListening || isQuestionTranscribing} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                    + Add Question
                  </Button>
                </div>
              </div>
              <p className="builder-voice-hint">One microphone guides you through the form name, description, and each question. Pause for 2 seconds after speaking to move on. At the end, say “add question”, “save form”, or “cancel”.</p>
              {questionVoiceError && (
                <p className="question-stt-error" role="alert">{questionVoiceError}</p>
              )}
              {(isQuestionListening || isQuestionTranscribing) && activeVoiceTarget && (
                <p className="question-stt-status" role="status" aria-live="polite">
                  {isQuestionTranscribing ? 'Transcribing…' : `Listening for ${activeVoiceTarget.scope === 'command' ? 'a builder command' : activeVoiceTarget.key === 'field_type' ? 'the field type' : activeVoiceTarget.key === 'field_name' ? 'the field key' : activeVoiceTarget.key === 'options' ? 'choice options' : activeVoiceTarget.key === 'formName' ? 'the form name' : activeVoiceTarget.key === 'description' ? 'the form description' : 'the spoken question'}…`}
                </p>
              )}

              {fields.map((field, idx) => (
                <div key={idx} className="field-builder-row">
                  <div className="field-key-control">
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Field Key</label>
                    <div className="question-input-with-mic">
                      <input
                        className="form-input"
                        placeholder="e.g. phone"
                        value={field.field_name}
                        onChange={(e) => handleFieldChange(idx, 'field_name', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="field-question-control">
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Spoken Question</label>
                    <div className="question-input-with-mic">
                      <input
                        className="form-input"
                        placeholder="e.g. What is your phone?"
                        value={field.question}
                        onChange={(e) => handleFieldChange(idx, 'question', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="field-type-control">
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Type</label>
                    <div className="question-input-with-mic">
                      <select
                        className="form-select"
                        value={field.field_type}
                        onChange={(e) => handleFieldChange(idx, 'field_type', e.target.value)}
                      >
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="yes_no">Yes / No</option>
                        <option value="choice">Choice</option>
                        <option value="textarea">Textarea</option>
                      </select>
                    </div>
                  </div>

                  <div className="field-options-control">
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {field.field_type === 'choice' ? 'Choice Options' : 'Options (used for Choice fields)'}
                    </label>
                    <div className="question-input-with-mic">
                    <input
                      className="form-input"
                      placeholder="Choice options: Nayagan, Baasha (or one per line)"
                      value={field.options || ''}
                      onChange={(e) => handleFieldChange(idx, 'options', e.target.value)}
                    />
                    </div>
                    {field.field_type === 'choice' && (
                      <small style={{ color: 'var(--text-dim)' }}>
                        These values appear as selectable options and guide speech recognition.
                      </small>
                    )}
                  </div>

                  <button
                    type="button"
                    className="icon-btn field-remove-btn"
                    onClick={() => handleRemoveField(idx)}
                    disabled={isQuestionListening || isQuestionTranscribing}
                    title="Remove question"
                    aria-label={`Remove question ${idx + 1}`}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}

              <div className="field-builder-actions">
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={isTranslatingForm} disabled={isQuestionListening || isQuestionTranscribing || isTranslatingForm}>
                  {isTranslatingForm ? 'Translating and saving…' : 'Save Form'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
