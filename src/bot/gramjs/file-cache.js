import { Api } from 'telegram';

const serializeInputDocument = (document) =>
  JSON.stringify({
    type: 'document',
    id: document.id.toString(),
    accessHash: document.accessHash.toString(),
    fileReference: Buffer.from(document.fileReference).toString('base64'),
  });

const parseSerializedDocument = (value) => {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type !== 'document') return null;
    return new Api.InputDocument({
      id: BigInt(parsed.id),
      accessHash: BigInt(parsed.accessHash),
      fileReference: Buffer.from(parsed.fileReference, 'base64'),
    });
  } catch (error) {
    return null;
  }
};

const extractDocumentFromMessage = (message) => {
  if (!message?.media) return null;
  if (message.media.document) return message.media.document;
  return null;
};

export { serializeInputDocument, parseSerializedDocument, extractDocumentFromMessage };
