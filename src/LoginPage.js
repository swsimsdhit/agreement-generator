// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Create a new file: src/LoginPage.js
// Copy everything below this line into that new file
// ─────────────────────────────────────────────────────────────────────────────
 
import { useState } from "react";
 
export default function LoginPage({ onLogin }) {
  const [name, setName]         = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [locked, setLocked]     = useState(false);
 
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (locked) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        if (data.locked) setLocked(true);
      } else {
        onLogin(data.user);
      }
    } catch {
      setError("Could not connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };
 
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f4f5f7",
      fontFamily: "Arial, sans-serif",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 12,
        padding: "48px 40px",
        width: "100%",
        maxWidth: 400,
        boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src="/logo.png"
            alt="Dynamic Health IT"
            style={{ height: 56, objectFit: "contain" }}
            onError={e => { e.target.style.display = "none"; }}
          />
          <div style={{
            fontSize: 13,
            color: "#888",
            marginTop: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Agreement Builder
          </div>
        </div>
 
        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#444", marginBottom: 6 }}>
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter your full name"
              disabled={locked}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #ddd",
                borderRadius: 6,
                fontSize: 14,
                boxSizing: "border-box",
                background: locked ? "#f9f9f9" : "#fff",
              }}
            />
          </div>
 
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#444", marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={locked}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #ddd",
                borderRadius: 6,
                fontSize: 14,
                boxSizing: "border-box",
                background: locked ? "#f9f9f9" : "#fff",
              }}
            />
          </div>
 
          {error && (
            <div style={{
              background: locked ? "#fff3e0" : "#fdecea",
              color: locked ? "#e65100" : "#c62828",
              border: `1px solid ${locked ? "#ffcc80" : "#f5c6cb"}`,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}
 
          <button
            type="submit"
            disabled={loading || locked}
            style={{
              width: "100%",
              padding: "11px",
              background: locked ? "#ccc" : "#1a1a2e",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 15,
              fontWeight: 500,
              cursor: locked ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in…" : locked ? "Account locked" : "Sign in"}
          </button>
        </form>
 
        <p style={{ textAlign: "center", fontSize: 12, color: "#bbb", marginTop: 24, marginBottom: 0 }}>
          Dynamic Health IT, Inc. — Internal use only
        </p>
      </div>
    </div>
  );
}
 