import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

type Status = "loading" | "needs-onboarding" | "ready";

export function useOnboardingStatus(): Status {
  const { user } = useAuth();
  return user ? "ready" : "loading";
}

export function RequireOnboarding({
  children,
}: {
  children: React.ReactNode;
}) {
  const status = useOnboardingStatus();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-ink-400">
        Carregando…
      </div>
    );
  }
  if (status === "needs-onboarding") {
    return <Navigate to="/onboarding" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export function RedirectIfOnboarded({
  children,
}: {
  children: React.ReactNode;
}) {
  const status = useOnboardingStatus();
  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-ink-400">
        Carregando…
      </div>
    );
  }
  if (status === "ready") {
    return <Navigate to="/grupos" replace />;
  }
  return <>{children}</>;
}
