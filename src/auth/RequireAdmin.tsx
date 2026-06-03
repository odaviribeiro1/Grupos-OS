import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();

  if (loading) return null;
  if (role !== "owner" && role !== "admin") return <Navigate to="/grupos" replace />;

  return <>{children}</>;
}
