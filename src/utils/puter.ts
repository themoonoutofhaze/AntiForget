type PuterAuthApi = NonNullable<NonNullable<Window['puter']>['auth']>;

const getPuter = () => {
  return typeof window !== 'undefined' ? window.puter : undefined;
};

let pendingSignIn: Promise<void> | null = null;

const isPuterSignedIn = async (auth: PuterAuthApi): Promise<boolean> => {
  if (typeof auth.isSignedIn === 'function') {
    try {
      return Boolean(await auth.isSignedIn());
    } catch {
      return false;
    }
  }

  if (typeof auth.getUser === 'function') {
    try {
      const user = await auth.getUser();
      return Boolean(user);
    } catch {
      return false;
    }
  }

  return false;
};

const beginPuterSignIn = (auth: PuterAuthApi): Promise<void> | null => {
  if (pendingSignIn) {
    return pendingSignIn;
  }
  if (typeof auth.signIn !== 'function') {
    return null;
  }

  pendingSignIn = Promise.resolve(auth.signIn())
    .then(() => undefined)
    .finally(() => {
      pendingSignIn = null;
    });

  return pendingSignIn;
};

export const primePuterAuth = () => {
  const puter = getPuter();
  const auth = puter?.auth;
  if (!auth) {
    return;
  }

  void (async () => {
    if (await isPuterSignedIn(auth)) {
      return;
    }
    const signInTask = beginPuterSignIn(auth);
    if (!signInTask) {
      return;
    }
    try {
      await signInTask;
    } catch {
      // Ignore priming failures; puterChat will surface a user-facing error if still unauthenticated.
    }
  })();
};

const ensurePuterSession = async () => {
  const puter = getPuter();
  if (!puter?.ai?.chat) {
    throw new Error('Puter.js SDK is unavailable. Ensure https://js.puter.com/v2/ is loaded.');
  }

  const auth = puter.auth;
  if (!auth) {
    return;
  }

  if (await isPuterSignedIn(auth)) {
    return;
  }

  const signInTask = beginPuterSignIn(auth);
  if (!signInTask) {
    return;
  }

  try {
    await signInTask;
  } catch {
    throw new Error('Puter sign-in was blocked or canceled. Allow pop-ups in Safari and sign in to continue.');
  }

  if (!(await isPuterSignedIn(auth))) {
    throw new Error('Sign in to your Puter account to use the prioritized Puter model.');
  }
};

export const isPuterAvailable = (): boolean => {
  const puter = getPuter();
  return Boolean(puter?.ai?.chat);
};

export const hasActivePuterSession = async (): Promise<boolean> => {
  const puter = getPuter();
  const auth = puter?.auth;
  if (!auth) {
    return false;
  }

  return await isPuterSignedIn(auth);
};

export const puterChat = async (
  prompt: string,
  options?: Record<string, unknown>,
): Promise<string> => {
  await ensurePuterSession();
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
