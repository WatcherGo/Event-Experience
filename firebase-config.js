/**
 * PROMPTWAR — Firebase Configuration
 * ─────────────────────────────────────────────────────────────
 * Replace these placeholder values with your Firebase project
 * credentials from: Firebase Console → Project Settings → General
 *
 * DEMO MODE: If FIREBASE_ENABLED is false (default), the app
 * runs entirely in-browser using BroadcastChannel to simulate
 * real-time Firestore updates across tabs. No Firebase account
 * needed for demos.
 * ─────────────────────────────────────────────────────────────
 */

window.FIREBASE_ENABLED = false; // ← Set to true to use real Firebase

window.FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
