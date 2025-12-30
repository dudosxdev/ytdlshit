import { TelegramClient, Api, events, Utils } from 'telegram';
import { StoreSession } from 'telegram/sessions';
import { createApi } from './api.js';

const getChatType = (peer) => {
  if (peer instanceof Api.PeerUser) return 'private';
  if (peer instanceof Api.PeerChat) return 'group';
  if (peer instanceof Api.PeerChannel) return 'channel';
  return 'unknown';
};

const getPeerId = (peer) => Number(Utils.getPeerId(peer));

const compose = (middlewares) => (ctx, handler) => {
  let index = -1;
  const dispatch = async (i) => {
    if (i <= index) throw new Error('next() called multiple times');
    index = i;
    const fn = i === middlewares.length ? handler : middlewares[i];
    if (!fn) return;
    return fn(ctx, () => dispatch(i + 1));
  };
  return dispatch(0);
};

const buildUser = (user) =>
  user
    ? {
        id: Number(user.id),
        username: user.username,
        first_name: user.firstName,
        last_name: user.lastName,
        language_code: user.langCode,
      }
    : null;

const buildChat = (peer) => ({
  id: getPeerId(peer),
  type: getChatType(peer),
});

const createBot = ({ apiId, apiHash, botToken, sessionPath }) => {
  const client = new TelegramClient(new StoreSession(sessionPath), apiId, apiHash, { connectionRetries: 5 });
  const api = createApi(client);

  const middlewares = [];
  const commandHandlers = new Map();
  const messageTextHandlers = [];
  const inlineQueryHandlers = [];
  const chosenInlineHandlers = [];
  const callbackHandlers = [];
  let errorHandler = null;

  const runWithMiddlewares = compose(middlewares);

  const handleError = async (ctx, error) => {
    if (errorHandler) {
      await errorHandler({ ctx, error });
    } else {
      console.error('Unhandled error:', error);
    }
  };

  const createBaseContext = (update, updateType) => ({
    update: {
      update_id: update?.pts || update?.queryId || update?.id || null,
      raw: update,
    },
    updateType,
    api,
  });

  const handleMessage = async (event) => {
    const message = event.message;
    if (!message) return;
    const sender = await message.getSender();
    const peer = message.peerId;
    const ctx = createBaseContext(event.originalUpdate || event, 'message');
    ctx.message = {
      message_id: message.id,
      text: message.message,
      reply_to_message: message.replyTo?.replyToMsgId ? { message_id: message.replyTo.replyToMsgId } : undefined,
    };
    ctx.chat = buildChat(peer);
    ctx.from = buildUser(sender);
    ctx.reply = (text, options = {}) => api.sendMessage(ctx.chat.id, text, options);
    ctx.replyWithChatAction = async () => {};

    const text = message.message || '';
    const commandMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@[\w_]+)?/);

    if (commandMatch) {
      const command = commandMatch[1];
      const handler = commandHandlers.get(command);
      if (handler) {
        try {
          await runWithMiddlewares(ctx, handler);
        } catch (error) {
          await handleError(ctx, error);
        }
      }
    }

    if (message.message) {
      for (const handler of messageTextHandlers) {
        try {
          await runWithMiddlewares(ctx, handler);
        } catch (error) {
          await handleError(ctx, error);
        }
      }
    }
  };

  const handleInlineQuery = async (update) => {
    const user = await client.getEntity(update.userId);
    const ctx = createBaseContext(update, 'inline_query');
    ctx.inlineQuery = {
      id: update.queryId,
      query: update.query,
      offset: update.offset,
      from: buildUser(user),
    };
    ctx.from = ctx.inlineQuery.from;
    ctx.answerInlineQuery = (results, options = {}) => api.answerInlineQuery(update.queryId, results, options);

    for (const handler of inlineQueryHandlers) {
      try {
        await runWithMiddlewares(ctx, handler);
      } catch (error) {
        await handleError(ctx, error);
      }
    }
  };

  const handleChosenInline = async (update) => {
    const user = await client.getEntity(update.userId);
    const ctx = createBaseContext(update, 'chosen_inline_result');
    ctx.chosenInlineResult = {
      result_id: update.id,
      inline_message_id: update.msgId,
      from: buildUser(user),
      query: update.query,
    };
    ctx.from = ctx.chosenInlineResult.from;

    for (const handler of chosenInlineHandlers) {
      try {
        await runWithMiddlewares(ctx, handler);
      } catch (error) {
        await handleError(ctx, error);
      }
    }
  };

  const handleCallbackQuery = async (update, isInline) => {
    const user = await client.getEntity(update.userId);
    const ctx = createBaseContext(update, 'callback_query');
    const data = update.data ? Buffer.from(update.data).toString() : '';
    ctx.callbackQuery = {
      id: update.queryId,
      data,
      from: buildUser(user),
      inline_message_id: isInline ? update.msgId : undefined,
    };
    ctx.from = ctx.callbackQuery.from;

    if (!isInline) {
      const peerId = getPeerId(update.peer);
      const [message] = await client.getMessages(peerId, { ids: [update.msgId] });
      let replyMessage;
      if (message?.replyTo?.replyToMsgId) {
        [replyMessage] = await client.getMessages(peerId, { ids: [message.replyTo.replyToMsgId] });
      }
      ctx.chat = buildChat(update.peer);
      ctx.callbackQuery.message = message
        ? {
            message_id: message.id,
            text: message.message,
            reply_to_message: replyMessage
              ? { message_id: replyMessage.id, text: replyMessage.message }
              : message.replyTo?.replyToMsgId
              ? { message_id: message.replyTo.replyToMsgId }
              : undefined,
          }
        : undefined;
      ctx.reply = (text, options = {}) => api.sendMessage(ctx.chat.id, text, options);
      ctx.editMessageText = (text, options = {}) =>
        api.editMessageText(ctx.chat.id, ctx.callbackQuery.message?.message_id, text, options);
    }

    ctx.answerCallbackQuery = (options = {}) =>
      client.invoke(
        new Api.messages.SetBotCallbackAnswer({
          queryId: update.queryId,
          message: options.text,
          alert: options.show_alert,
        }),
      );

    for (const { match, handler } of callbackHandlers) {
      const matcher = typeof match === 'string' ? new RegExp(`^${match}$`) : match;
      const matches = data.match(matcher);
      if (!matches) continue;
      ctx.match = matches;
      try {
        await runWithMiddlewares(ctx, handler);
      } catch (error) {
        await handleError(ctx, error);
      }
    }
  };

  const start = async () => {
    await client.start({ botAuthToken: botToken });
    client.addEventHandler(handleMessage, new events.NewMessage({}));
    client.addEventHandler(async (update) => {
      if (update instanceof Api.UpdateBotInlineQuery) {
        await handleInlineQuery(update);
      } else if (update instanceof Api.UpdateBotInlineSend) {
        await handleChosenInline(update);
      } else if (update instanceof Api.UpdateBotCallbackQuery) {
        await handleCallbackQuery(update, false);
      } else if (update instanceof Api.UpdateInlineBotCallbackQuery) {
        await handleCallbackQuery(update, true);
      }
    }, new events.Raw({}));
  };

  const stop = async () => client.disconnect();

  return {
    api,
    command: (command, handler) => commandHandlers.set(command, handler),
    on: (event, handler) => {
      if (event === 'message:text') messageTextHandlers.push(handler);
      if (event === 'inline_query') inlineQueryHandlers.push(handler);
      if (event === 'chosen_inline_result') chosenInlineHandlers.push(handler);
    },
    callbackQuery: (match, handler) => callbackHandlers.push({ match, handler }),
    use: (middleware) => middlewares.push(middleware),
    catch: (handler) => {
      errorHandler = handler;
    },
    start,
    stop,
    client,
  };
};

export { createBot };
