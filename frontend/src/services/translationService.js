import api from './api';

export const translationService = {
  async translateTexts(texts, sourceLanguageCode, targetLanguageCode) {
    if (sourceLanguageCode === targetLanguageCode) return texts;
    const translated = [...texts];
    const indexed = texts.map((text, index) => ({ text, index })).filter(({ text }) => text?.trim());
    for (let start = 0; start < indexed.length; start += 70) {
      const batch = indexed.slice(start, start + 70);
      const response = await api.post('/api/localization/translate', {
        texts: batch.map(({ text }) => text),
        source_language_code: sourceLanguageCode,
        target_language_code: targetLanguageCode,
      });
      batch.forEach(({ index }, batchIndex) => {
        translated[index] = response.data.translations[batchIndex] || texts[index];
      });
    }
    return translated;
  },
};
