import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Import the fetch interceptor before anything else
import { setupFetchInterceptor } from "./lib/fetchInterceptor";

// Initialize the fetch interceptor to redirect CloudFront API requests
setupFetchInterceptor();

createRoot(document.getElementById("root")!).render(<App />);
