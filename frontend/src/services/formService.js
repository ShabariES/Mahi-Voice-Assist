import api from './api';

export const formService = {
  // Get all forms
  async getForms() {
    const response = await api.get('/api/forms');
    return response.data;
  },

  // Get single form by ID with fields
  async getFormById(id) {
    const response = await api.get(`/api/forms/${id}`);
    return response.data;
  },

  // Create new form (Admin / Form Manager)
  async createForm(formData) {
    const response = await api.post('/api/forms', formData);
    return response.data;
  },

  // Update form (Admin / Form Manager)
  async updateForm(id, formData) {
    const response = await api.put(`/api/forms/${id}`, formData);
    return response.data;
  },

  // Delete form (Admin / Form Manager)
  async deleteForm(id) {
    const response = await api.delete(`/api/forms/${id}`);
    return response.data;
  },

  // Get submissions for a form
  async getFormSubmissions(id) {
    const response = await api.get(`/api/forms/${id}/submissions`);
    return response.data;
  },

  // Start a new form session
  async startSession(formId) {
    const response = await api.post('/api/sessions', { form_id: formId });
    return response.data;
  },

  // Get active session status
  async getSession(sessionId) {
    const response = await api.get(`/api/sessions/${sessionId}`);
    return response.data;
  },

  // Submit answer for current field
  async submitAnswer(sessionId, answer) {
    const response = await api.post(`/api/sessions/${sessionId}/answer`, { answer });
    return response.data;
  },

  // Correct a saved answer from the completed form review
  async updateSessionAnswer(sessionId, fieldId, answer) {
    const response = await api.put(
      `/api/sessions/${sessionId}/answers/${fieldId}`,
      { answer },
    );
    return response.data;
  },

  // Save user-reviewed values extracted from a PDF and resume on the first unanswered field.
  async importSessionAnswers(sessionId, answers) {
    const response = await api.post(`/api/sessions/${sessionId}/import-answers`, { answers });
    return response.data;
  },

  // OCR a scanned/table PDF with the backend's PP-StructureV3 pipeline.
  async extractPdfStructure(file) {
    const body = new FormData();
    body.append('file', file);
    const response = await api.post('/api/sessions/pdf/structure', body, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async previewBulkPdf(formId, files) {
    const body = new FormData();
    body.append('form_id', formId);
    files.forEach((file) => body.append('files', file));
    const response = await api.post('/api/admin/bulk-pdf/preview', body, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async importBulkPdf(formId, records) {
    const response = await api.post('/api/admin/bulk-pdf/import', { form_id: formId, records });
    return response.data;
  },

  // Get all answers for a completed/active session
  async getSessionAnswers(sessionId) {
    const response = await api.get(`/api/sessions/${sessionId}/answers`);
    return response.data;
  },

  // Get all sessions belonging to the current user
  async getMySessions() {
    const response = await api.get('/api/sessions/my');
    return response.data;
  }
};
