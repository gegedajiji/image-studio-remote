import { Routes, Route } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import Home from "./pages/Home";
import Workspace from "./pages/Workspace";
import Canvas from "./pages/Canvas";
import Community from "./pages/Community";
import ApiDocs from "./pages/ApiDocs";
import Settings from "./pages/Settings";
import Admin from "./pages/admin/Admin";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/canvas" element={<Canvas />} />
        <Route path="/community" element={<Community />} />
        <Route path="/docs" element={<ApiDocs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster theme="light" position="top-center" richColors />
    </>
  );
}
