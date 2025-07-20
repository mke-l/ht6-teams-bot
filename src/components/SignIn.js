// src/pages/SignIn.js
import React, { useState } from "react";
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import { FaGoogle } from "react-icons/fa";

import { auth, provider, oidcProvider } from "../services/firebase";
import { db } from "../services/firebase";          // ← Firestore instance

/* ───────────────────── helper: ensure profile doc has `email` field ───────────────────── */
async function ensureUserProfile(user) {
  if (!user) return;

  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  // only (re)write if the doc is missing or lacks an e‑mail field
  if (!snap.exists() || !snap.data().email) {
    await setDoc(
      ref,
      {
        email      : user.email        ?? "",
        displayName: user.displayName  ?? "",
        photoURL   : user.photoURL     ?? "",
      },
      { merge: true }
    );
  }

  /* 🔍 just so you can confirm it worked */
  const saved = (await getDoc(ref)).data();
  console.log("👤 user profile stored/verified →", saved);
}

const SignIn = () => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const navigate                = useNavigate();

  /* ─────────── Google ─────────── */
  const handleGoogleSignIn = async () => {
    try {
      const cred = await signInWithPopup(auth, provider);
      await ensureUserProfile(cred.user);
      navigate("/dashboard");
    } catch (err) {
      console.error("Error signing in with Google:", err);
      setError(err.message);
    }
  };

  /* ─────────── OIDC / SSO ─────────── */
  const handleOIDCSignIn = async () => {
    try {
      const cred = await signInWithPopup(auth, oidcProvider);
      await ensureUserProfile(cred.user);
      navigate("/dashboard");
    } catch (err) {
      console.error("OIDC Sign‑In error:", err);
      setError(err.message);
    }
  };

  /* ─────────── E‑mail / Password ─────────── */
  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserProfile(cred.user);
      navigate("/dashboard");
    } catch (err) {
      console.error("Error signing in with Email/Password:", err);
      setError(err.message);
    }
  };

  return (
    <div className="signin-container">
      <div className="signin-card">
        <h1>Welcome to Benefits Insights</h1>
        <p>Your trusted assistant for employee benefits trends and analytics.</p>

        {/* ——— E‑mail / password form (commented out by default) ——— */}
        {/*
        <form onSubmit={handleEmailSignIn} className="email-signin-form">
          <div className="form-group">
            <label>Email:</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>
          <button type="submit" className="signin-button">
            Sign In
          </button>
        </form>
        */}

        {/* ——— Google ——— */}
        <button className="google-signin-button" onClick={handleGoogleSignIn}>
          <FaGoogle className="google-icon" /> Sign in with Google
        </button>

        <p>Or</p>

        {/* ——— SSO / OIDC ——— */}
        <button className="oidc-signin-button" onClick={handleOIDCSignIn}>
          <i className="fa-solid fa-key" />  Sign in with SSO
        </button>

        {error && <p className="error">{error}</p>}

        <p>
          Don&rsquo;t have an account? <Link to="/register">Register here</Link>
        </p>
      </div>
    </div>
  );
};

export default SignIn;
