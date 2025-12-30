import { Api } from 'telegram';

const buildCallbackButton = (text, data) => new Api.KeyboardButtonCallback({ text, data: Buffer.from(data) });

class InlineKeyboard {
  constructor() {
    this.rows = [[]];
  }

  static text(text, data) {
    return buildCallbackButton(text, data);
  }

  text(text, data) {
    this.rows[this.rows.length - 1].push(buildCallbackButton(text, data));
    return this;
  }

  row(...buttons) {
    if (buttons.length) {
      this.rows.push(buttons);
      return this;
    }
    this.rows.push([]);
    return this;
  }

  toReplyMarkup() {
    const rows = this.rows
      .filter((row) => row.length > 0)
      .map((buttons) => new Api.KeyboardButtonRow({ buttons }));
    if (!rows.length) return undefined;
    return new Api.ReplyInlineMarkup({ rows });
  }
}

export { InlineKeyboard };
