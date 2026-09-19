import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseApp } from "./firebaseClient.ts";

export const FIREBASE_STORAGE_BUCKET = "gs://ysjh-public-affairs.firebasestorage.app";

export function getFirebaseStorageClient(): FirebaseStorage {
  return getStorage(getFirebaseApp(), FIREBASE_STORAGE_BUCKET);
}
