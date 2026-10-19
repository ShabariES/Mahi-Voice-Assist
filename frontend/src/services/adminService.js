import api from './api';

export const adminService = {
  async exportAllData() {
    const response = await api.get('/api/admin/export', { responseType: 'blob' });
    return response.data;
  },
};
