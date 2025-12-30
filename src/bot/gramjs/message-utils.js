import { Api } from 'telegram';
import { _parseMessageText } from 'telegram/client/messageParse.js';
import { InlineKeyboard } from './inline-keyboard.js';

const normalizeParseMode = (parseMode) => {
  if (!parseMode) return undefined;
  return typeof parseMode === 'string' ? parseMode.toLowerCase() : parseMode;
};

const parseTextEntities = async (client, text, parseMode) => {
  const normalized = normalizeParseMode(parseMode);
  const [message, entities] = await _parseMessageText(client, text || '', normalized || false);
  return { message, entities };
};

const buildReplyMarkup = (markup) => {
  if (!markup) return undefined;
  if (markup instanceof Api.ReplyInlineMarkup) return markup;
  if (markup instanceof InlineKeyboard) return markup.toReplyMarkup();
  if (typeof markup.toReplyMarkup === 'function') return markup.toReplyMarkup();
  return markup;
};

export { normalizeParseMode, parseTextEntities, buildReplyMarkup };
