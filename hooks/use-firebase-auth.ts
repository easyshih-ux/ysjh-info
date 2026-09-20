"use client";

import { useCallback, useEffect, useState } from "react";
import { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  getFirebaseAuthClient,
  isFirebaseConfigured,
} from "@/lib/firebaseClient";
import { shouldWarnBeforeGoogleLogin } from "@/lib/browserEnvironment";

export type FirebaseAuthStatus =
  | "checking"
  | "signed-out"
  | "signed-in"
  | "configuration-missing";

export function useFirebaseAuth() {
  const [status, setStatus] = useState<FirebaseAuthStatus>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lineLoginWarningOpen, setLineLoginWarningOpen] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setStatus("configuration-missing");
      return;
    }

    let unsubscribe = () => {};
    let cancelled = false;

    getFirebaseAuthClient()
      .then(auth => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(
          auth,
          nextUser => {
            setUser(nextUser);
            setStatus(nextUser ? "signed-in" : "signed-out");
          },
          error => {
            setErrorCode(getFirebaseAuthErrorCode(error));
            setStatus("signed-out");
          },
        );
      })
      .catch(error => {
        setErrorCode(getFirebaseAuthErrorCode(error));
        setStatus("signed-out");
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async () => {
    if (shouldWarnBeforeGoogleLogin()) {
      setLineLoginWarningOpen(true);
      return;
    }

    setBusy(true);
    setErrorCode("");
    try {
      const auth = await getFirebaseAuthClient();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      setErrorCode(getFirebaseAuthErrorCode(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const closeLineLoginWarning = useCallback(() => {
    setLineLoginWarningOpen(false);
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    setErrorCode("");
    try {
      await signOut(await getFirebaseAuthClient());
    } catch (error) {
      setErrorCode(getFirebaseAuthErrorCode(error));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    user,
    errorCode,
    busy,
    lineLoginWarningOpen,
    login,
    closeLineLoginWarning,
    logout,
  };
}

export function getFirebaseAuthErrorCode(error: unknown) {
  if (error instanceof FirebaseError) return error.code;
  if (error instanceof Error && error.message === "firebase/config-missing") {
    return "firebase/config-missing";
  }
  return "auth/unknown-error";
}
