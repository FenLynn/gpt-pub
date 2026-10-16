import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LorentzGolden from "./golden/LorentzGolden";
import "mathjax/es5/tex-svg.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("golden") === "lorentz" ? <LorentzGolden /> : <App />}
  </React.StrictMode>
);
