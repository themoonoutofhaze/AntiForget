import { getStoredUser } from './auth';

export const getCurrentUserId = (): string => {
  const user = getStoredUser();
  return user?.id || 'local-anon-user';
};
