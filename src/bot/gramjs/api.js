import { Api, Utils } from 'telegram';
import { CustomFile } from 'telegram/client/uploads.js';
import { buildReplyMarkup, normalizeParseMode, parseTextEntities } from './message-utils.js';
import { parseSerializedDocument } from './file-cache.js';

const buildInlineResult = async (client, result) => {
  const messageText = result.input_message_content?.message_text || '';
  const parseMode = normalizeParseMode(result.input_message_content?.parse_mode);
  const { message, entities } = await parseTextEntities(client, messageText, parseMode);
  const replyMarkup = buildReplyMarkup(result.reply_markup);

  let thumb;
  if (result.thumbnail_url) {
    thumb = new Api.InputWebDocument({
      url: result.thumbnail_url,
      size: 0,
      mimeType: 'image/jpeg',
      attributes: [],
    });
  }

  return new Api.InputBotInlineResult({
    id: result.id,
    type: result.type || 'article',
    title: result.title,
    description: result.description,
    thumb,
    sendMessage: new Api.InputBotInlineMessageText({
      message,
      entities,
      noWebpage: result.input_message_content?.disable_web_page_preview,
      replyMarkup,
    }),
  });
};

const resolveInputFile = (file) => {
  const parsed = parseSerializedDocument(file);
  if (parsed) return parsed;
  if (file?.buffer && file?.size && file?.name) {
    return new CustomFile(file.name, file.size, file.path || '', file.buffer);
  }
  return file;
};

const normalizeMessage = (message) => {
  if (!message) return message;
  const chatId = message.peerId ? Number(Utils.getPeerId(message.peerId)) : undefined;
  return {
    ...message,
    message_id: message.id,
    chat: chatId ? { id: chatId } : undefined,
    text: message.message,
  };
};

const createApi = (client) => ({
  client,
  async getMe() {
    const me = await client.getMe();
    return { id: me.id, username: me.username };
  },
  async setMyCommands(commands) {
    const botCommands = commands.map((command) => new Api.BotCommand(command));
    return client.invoke(
      new Api.bots.SetBotCommands({
        scope: new Api.BotCommandScopeDefault(),
        langCode: '',
        commands: botCommands,
      }),
    );
  },
  async sendMessage(chatId, text, options = {}) {
    const message = await client.sendMessage(chatId, {
      message: text,
      parseMode: normalizeParseMode(options.parse_mode),
      linkPreview: !options.disable_web_page_preview,
      buttons: buildReplyMarkup(options.reply_markup),
    });
    return normalizeMessage(message);
  },
  async sendAudio(chatId, file, options = {}) {
    const attributes = [
      new Api.DocumentAttributeAudio({
        duration: options.duration,
        performer: options.performer,
        title: options.title,
      }),
    ];
    const message = await client.sendFile(chatId, {
      file: resolveInputFile(file),
      caption: options.caption,
      parseMode: normalizeParseMode(options.parse_mode),
      attributes,
      silent: options.disable_notification,
      replyTo: options.reply_to_message_id,
      buttons: buildReplyMarkup(options.reply_markup),
    });
    return normalizeMessage(message);
  },
  async sendVideo(chatId, file, options = {}) {
    const attributes = [
      new Api.DocumentAttributeVideo({
        duration: options.duration,
        w: options.width || 0,
        h: options.height || 0,
        supportsStreaming: options.supports_streaming,
      }),
    ];
    const message = await client.sendFile(chatId, {
      file: resolveInputFile(file),
      caption: options.caption,
      parseMode: normalizeParseMode(options.parse_mode),
      attributes,
      supportsStreaming: options.supports_streaming,
      thumb: options.thumbnail,
      silent: options.disable_notification,
      replyTo: options.reply_to_message_id,
      buttons: buildReplyMarkup(options.reply_markup),
    });
    return normalizeMessage(message);
  },
  async editMessageText(chatId, messageId, text, options = {}) {
    const message = await client.editMessage(chatId, {
      message: messageId,
      text,
      parseMode: normalizeParseMode(options.parse_mode),
      linkPreview: !options.disable_web_page_preview,
      buttons: buildReplyMarkup(options.reply_markup),
    });
    return normalizeMessage(message);
  },
  async editMessageTextInline(inlineMessageId, text, options = {}) {
    const { message, entities } = await parseTextEntities(client, text, options.parse_mode);
    return client.invoke(
      new Api.messages.EditInlineBotMessage({
        id: inlineMessageId,
        message,
        entities,
        noWebpage: options.disable_web_page_preview,
        replyMarkup: buildReplyMarkup(options.reply_markup),
      }),
    );
  },
  async deleteMessage(chatId, messageId) {
    return client.deleteMessages(chatId, [messageId], { revoke: true });
  },
  async editMessageMediaInline(inlineMessageId, mediaPayload, options = {}) {
    let message = mediaPayload.caption || mediaPayload.message || '';
    let entities = mediaPayload.entities;
    if (!entities) {
      const parsed = await parseTextEntities(client, message, mediaPayload.parse_mode);
      message = parsed.message;
      entities = parsed.entities;
    }
    return client.invoke(
      new Api.messages.EditInlineBotMessage({
        id: inlineMessageId,
        message,
        entities,
        media: mediaPayload.media,
        replyMarkup: buildReplyMarkup(options.reply_markup),
      }),
    );
  },
  async answerInlineQuery(queryId, results, options = {}) {
    const converted = [];
    for (const result of results) {
      converted.push(await buildInlineResult(client, result));
    }
    return client.invoke(
      new Api.messages.SetInlineBotResults({
        queryId,
        results: converted,
        cacheTime: options.cache_time ?? 0,
        nextOffset: options.next_offset,
        switchPm: options.switch_pm_text
          ? new Api.InlineBotSwitchPM({ text: options.switch_pm_text, startParam: options.switch_pm_parameter || '' })
          : undefined,
      }),
    );
  },
});

export { createApi, resolveInputFile };
