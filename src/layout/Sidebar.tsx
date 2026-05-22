import { NavLink } from "react-router-dom";
import {
  Users2,
  FileText,
  BookOpen,
  Shield,
  Settings,
  LogOut,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthContext";

const nav = [
  { to: "/grupos", label: "Grupos", icon: Users2, adminOnly: false },
  { to: "/resumos", label: "Resumos", icon: FileText, adminOnly: false },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, adminOnly: false },
  { to: "/equipe", label: "Equipe", icon: Shield, adminOnly: true },
  { to: "/settings/credentials", label: "Credenciais", icon: Settings, adminOnly: true },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { user, role, signOut } = useAuth();

  const visibleNav = nav.filter(
    (item) => !item.adminOnly || role === "admin" || role === "owner"
  );

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-brand-500/15 bg-black/30 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow-sm">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-ink-50">GrupOS</span>
          <span className="text-[10px] uppercase tracking-wider text-ink-400">
            by Agentise
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {visibleNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                isActive
                  ? "bg-brand-500/10 text-ink-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_30px_rgba(59,130,246,0.25)] border border-brand-500/30"
                  : "text-ink-400 hover:bg-brand-500/5 hover:text-ink-50"
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-brand-500/15 p-3">
        <div className="mb-1 flex items-center gap-2 px-3">
          <span className="text-xs text-ink-400 truncate">{user?.email}</span>
          {role && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              role === "admin"
                ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                : "bg-brand-500/15 text-brand-400 border border-brand-500/30"
            )}>
              {role}
            </span>
          )}
        </div>
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-400 transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
