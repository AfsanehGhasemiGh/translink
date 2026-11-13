export async function restoreFabricSession(auth, allowStoredSession) {
  if (!allowStoredSession) return false;
  const signedIn = () => {
    const session = auth.getSession();
    return session.isAuthenticated && !session.isAnonymous;
  };
  if (signedIn()) return true;
  if (!auth.hasRefreshToken()) return false;
  await auth.refreshSession();
  return signedIn();
}
