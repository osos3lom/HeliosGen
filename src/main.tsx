import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import "@fontsource/geist/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource/doto/latin-900.css";
import "./globals.css";
import RootLayout from "./RootLayout";
import GalleryPage from "./routes/GalleryPage";
import ChatPage from "./routes/ChatPage";
import WorkflowListPage from "./routes/WorkflowListPage";
import WorkflowPage from "./routes/WorkflowPage";

// Hash routing: GitHub Pages has no SPA fallback, so deep links live after "#".
const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/gallery?tab=images" replace /> },
      { path: "gallery", element: <GalleryPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "workflow", element: <WorkflowListPage /> },
      { path: "workflow/:id", element: <WorkflowPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
