import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "mathjax/es5/tex-svg.js";
import "./styles.css";

class FigureStudioErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("FigureStudio render failure", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="figurestudio-fatal-error"
          style={{
            margin: 24,
            padding: 18,
            border: "1px solid #d8b7b7",
            borderRadius: 8,
            background: "#fff8f8",
            color: "#7d2525",
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            whiteSpace: "pre-wrap"
          }}
        >
          <strong>FigureStudio render failure</strong>
          {"\n"}
          {this.state.error.name + ": " + this.state.error.message}
          {"\n\n"}
          {this.state.error.stack?.slice(0, 2400)}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FigureStudioErrorBoundary>
      <App />
    </FigureStudioErrorBoundary>
  </React.StrictMode>
);
