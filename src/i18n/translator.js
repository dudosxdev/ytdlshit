const createTranslator = ({ translations, userLanguages, defaultLocale, getBotUsername }) => {
  const t = (langOrUserId, key, data = {}) => {
    const lang = userLanguages[langOrUserId] || langOrUserId || defaultLocale;
    const langStrings = translations[lang] || translations[defaultLocale];
    let text = langStrings[key] || `[${key}]`;

    if (key === 'inline_search_result_description' && data.views !== undefined) {
      if (lang === 'ru') {
        const num = data.views;
        let viewsStr = 'просмотров';
        if (num % 10 === 1 && num % 100 !== 11) viewsStr = 'просмотр';
        else if ([2, 3, 4].includes(num % 10) && ![12, 13, 14].includes(num % 100)) viewsStr = 'просмотра';
        data.views = `${num.toLocaleString('ru-RU')} ${viewsStr}`;
      } else {
        data.views = `${data.views.toLocaleString('en-US')}`;
      }
    }

    const botUsername = getBotUsername?.();
    if (botUsername && text.includes('{botUsername}')) {
      text = text.replace(/\{botUsername\}/g, botUsername);
    }

    for (const placeholder in data) {
      const regex = new RegExp(`\\{${placeholder}\\}`, 'g');
      text = text.replace(regex, data[placeholder] !== undefined && data[placeholder] !== null ? data[placeholder] : '');
    }
    return text;
  };

  const botUsernameSuffix = () => {
    const botUsername = getBotUsername?.();
    if (!botUsername) return '';
    return `\n\n@${botUsername}`;
  };

  return { t, botUsernameSuffix };
};

export { createTranslator };
