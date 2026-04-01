const getPuter = () => {
  return typeof window !== 'undefined' ? window.puter : undefined;
};

export const isPuterAvailable = (): boolean => {
  const puter = getPuter();
  return Boolean(puter?.ai?.chat);
};

export const puterChat = async (
  prompt: string,
  options?: Record<string, unknown>,
): Promise<string> => {
  const puter = getPuter();

  if (!puter?.ai?.chat) {
    throw new Error('Puter.js SDK is unavailable. Ensure https://js.puter.com/v2/ is loaded.');
  }

  const result = await puter.ai.chat(prompt, options);

  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object') {
    const text = (result as { text?: unknown }).text;
    if (typeof text === 'string') {
      return text;
    }

    const message = (result as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return String(result ?? '');
};
