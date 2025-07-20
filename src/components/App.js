// src/App.js
import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { auth } from "./services/firebase";
import SignIn from "./pages/SignIn";

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });
    return unsubscribe;
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" /> : <SignIn />} />
        <Route path="/signin" element={user ? <Navigate to="/dashboard" /> : <SignIn />} />
      </Routes>
    </Router>
  );
}

export default App;
