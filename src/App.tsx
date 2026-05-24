import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastContainer } from "@/components/ui/Toast";
import { AuthProvider } from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import {
  RedirectIfOnboarded,
  RequireOnboarding,
} from "@/auth/OnboardingGate";
import { RequireAdmin } from "@/auth/RequireAdmin";
import { AppLayout } from "@/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { SetPasswordPage } from "@/pages/SetPasswordPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { GruposPage } from "@/pages/GruposPage";
import { GrupoDetailPage } from "@/pages/GrupoDetailPage";
import { ResumosPage } from "@/pages/ResumosPage";
import { KnowledgePage } from "@/pages/KnowledgePage";
import { EquipePage } from "@/pages/EquipePage";
import { CredentialsPage } from "@/pages/settings/CredentialsPage";
import { SetupPage } from "@/pages/setup/SetupPage";
import { isSupabaseConfigured } from "@/lib/supabase";

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <RedirectIfOnboarded>
                  <OnboardingPage />
                </RedirectIfOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RequireOnboarding>
                  <AppLayout />
                </RequireOnboarding>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/grupos" replace />} />
            <Route path="grupos" element={<GruposPage />} />
            <Route path="grupos/:id" element={<GrupoDetailPage />} />
            <Route path="resumos" element={<ResumosPage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route
              path="equipe"
              element={
                <RequireAdmin>
                  <EquipePage />
                </RequireAdmin>
              }
            />
            <Route path="settings/credentials" element={<RequireAdmin><CredentialsPage /></RequireAdmin>} />
            <Route path="configuracoes" element={<Navigate to="/settings/credentials" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ToastContainer />
      </AuthProvider>
    </BrowserRouter>
  );
}
