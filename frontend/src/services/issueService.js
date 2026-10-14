import api from './api';

export const issueService = {
  async createReport(payload) {
    const response = await api.post('/api/issues', payload);
    return response.data;
  },
  async getReports() {
    const response = await api.get('/api/issues');
    return response.data;
  },
  async updateStatus(id, status) {
    const response = await api.patch(`/api/issues/${id}/status`, { status });
    return response.data;
  },
  async sendReply(id, subject, message) {
    const response = await api.post(`/api/issues/${id}/reply`, { subject, message });
    return response.data;
  },
};
