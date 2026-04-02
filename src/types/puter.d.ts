declare global {
  interface Window {
    puter?: {
      ai?: {
        chat: (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
      };
      auth?: {
        signIn?: () => Promise<unknown>;
        isSignedIn?: () => Promise<boolean>;
        getUser?: () => Promise<unknown>;
      };
    };
  }
}

export {};
