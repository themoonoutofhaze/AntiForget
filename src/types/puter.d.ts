declare global {
  interface Window {
    puter?: {
      ai?: {
        chat: (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
      };
    };
  }
}

export {};
