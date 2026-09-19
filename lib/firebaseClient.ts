import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const missingFirebaseConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const isFirebaseConfigured = missingFirebaseConfigKeys.length === 0;

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error("firebase/config-missing");
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export async function getFirebaseAuthClient() {
  const auth = getAuth(getFirebaseApp());
  await setPersistence(auth, browserLocalPersistence);
  return auth;
}
