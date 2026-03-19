import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/hooks/use-sse";
import {
  Phone, Voicemail, FileText, Calendar, Megaphone,
  BarChart, Settings, LogOut, ExternalLink, Activity,
  Menu, ShieldCheck
} from "lucide-react";
import { useListVoicemails, getListVoicemailsQueryKey } from "@/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

function NavItems({ onClick }: { onClick?: () => void }) {
  const [location] = useLocation();
  const { businessId, user } = useAuth();
  
  // Real-time unread badge
  const { data: vmData } = useListVoicemails(businessId!, { 
    query: { queryKey: getListVoicemailsQueryKey(businessId!), enabled: !!businessId, refetchInterval: 30000 } 
  });
  const unreadCount = vmData?.items.filter(v => !v.read).length || 0;

  const links = [
    { href: "/calls", label: "Calls", icon: Phone, indicator: true },
    { href: "/voicemails", label: "Voicemails", icon: Voicemail, badge: unreadCount },
    { href: "/documents", label: "Documents", icon: FileText },
    { href: "/calendar", label: "Calendar", icon: Calendar },
    { href: "/campaigns", label: "Campaigns", icon: Megaphone },
    { href: "/analytics", label: "Analytics", icon: BarChart },
    { href: "/settings", label: "Settings", icon: Settings },
    ...(user?.is_admin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  return (
    <div className="flex flex-col gap-2 p-4 w-full">
      {links.map((item) => {
        const active = location.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} onClick={onClick} className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 w-full",
            active 
              ? "bg-primary/10 text-primary font-medium border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]" 
              : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
          )}>
            <item.icon className="w-5 h-5" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.indicator && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
            {!!item.badge && item.badge > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg shadow-primary/25">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}

      <div className="my-4 h-px bg-border/50" />

      <a href="/grafana" target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 rounded-xl text-muted-foreground hover:bg-card hover:text-foreground transition-all duration-300 w-full">
        <Activity className="w-5 h-5" />
        <span className="flex-1 text-left">Grafana Metrics</span>
        <ExternalLink className="w-4 h-4 opacity-50" />
      </a>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { businessId, user, logout } = useAuth();
  
  // Initialize real-time updates for the whole dashboard
  useSSE(businessId);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-card/40 backdrop-blur-2xl border-r border-border/50 fixed left-0 top-0 h-screen">
        <div className="p-6 flex items-center gap-3 border-b border-border/50">
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-8 h-8 rounded-lg" />
          <div>
            <h2 className="font-display font-bold text-lg leading-tight tracking-tight">Vocalize.ai</h2>
            <p className="text-xs text-muted-foreground truncate w-40">{user?.name}</p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2">
          <NavItems />
        </div>

        <div className="p-4 border-t border-border/50">
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={logout}>
            <LogOut className="w-5 h-5 mr-3" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-card/80 backdrop-blur-xl border-b border-border/50 flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-6 h-6 rounded-md" />
          <h2 className="font-display font-bold">Vocalize.ai</h2>
        </div>
        
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon"><Menu className="w-6 h-6" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 flex flex-col bg-background/95 backdrop-blur-2xl border-r-border/50">
            <div className="p-6 border-b border-border/50 mt-8">
              <h2 className="font-display font-bold text-xl">{user?.name}</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavItems />
            </div>
            <div className="p-4 border-t border-border/50">
              <Button variant="destructive" className="w-full" onClick={logout}>Sign Out</Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 md:ml-64 pt-16 md:pt-0 min-h-screen">
        <div className="max-w-7xl mx-auto p-4 md:p-8 animate-in fade-in duration-500">
          {children}
        </div>
      </main>
    </div>
  );
}
