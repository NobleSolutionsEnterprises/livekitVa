import { type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import DashboardLayout from "@/components/layout";

import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Setup from "@/pages/setup";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import Voicemails from "@/pages/voicemails";
import Documents from "@/pages/documents";
import Calendar from "@/pages/calendar";
import Campaigns from "@/pages/campaigns";
import CampaignDetail from "@/pages/campaign-detail";
import CampaignNew from "@/pages/campaign-new";
import Analytics from "@/pages/analytics";
import Settings from "@/pages/settings";
import AdminBusinesses from "@/pages/admin-businesses";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ path, component: Component }: { path: string; component: ComponentType }) {
  return (
    <Route path={path}>
      {(params) => {
        const { user, businessId, isLoading } = useAuth();
        
        if (isLoading) return <div className="h-screen w-full flex items-center justify-center bg-background"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
        if (!user) return <Redirect to="/login" />;
        if (!businessId && path !== "/setup") return <Redirect to="/setup" />;
        
        if (path === "/setup") return <Component />;
        
        return (
          <DashboardLayout>
            <Component />
          </DashboardLayout>
        );
      }}
    </Route>
  );
}

function AdminRoute({ path, component: Component }: { path: string; component: ComponentType }) {
  return (
    <Route path={path}>
      {() => {
        const { user, isLoading } = useAuth();
        const { data: adminData, isLoading: adminLoading } = useQuery({
          queryKey: ["admin", "me"],
          queryFn: async () => {
            const res = await fetch("/api/admin/me", { credentials: "include" });
            if (!res.ok) return { is_admin: false };
            return res.json() as Promise<{ is_admin: boolean }>;
          },
          enabled: !!user,
        });

        if (isLoading || adminLoading) return <div className="h-screen w-full flex items-center justify-center bg-background"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
        if (!user) return <Redirect to="/login" />;
        if (!adminData?.is_admin) return <Redirect to="/calls" />;

        return (
          <DashboardLayout>
            <Component />
          </DashboardLayout>
        );
      }}
    </Route>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <TooltipProvider>
          <AuthProvider>
            <Switch>
              <Route path="/login" component={Login} />
              <Route path="/signup" component={Signup} />
              
              <Route path="/">
                {() => {
                  const { user, businessId, isLoading } = useAuth();
                  if (isLoading) return null;
                  if (!user) return <Redirect to="/login" />;
                  if (!businessId) return <Redirect to="/setup" />;
                  return <Redirect to="/calls" />;
                }}
              </Route>

              <ProtectedRoute path="/setup" component={Setup} />
              <ProtectedRoute path="/calls" component={Calls} />
              <ProtectedRoute path="/calls/:id" component={CallDetail} />
              <ProtectedRoute path="/voicemails" component={Voicemails} />
              <ProtectedRoute path="/documents" component={Documents} />
              <ProtectedRoute path="/calendar" component={Calendar} />
              <ProtectedRoute path="/campaigns" component={Campaigns} />
              <ProtectedRoute path="/campaigns/new" component={CampaignNew} />
              <ProtectedRoute path="/campaigns/:id" component={CampaignDetail} />
              <ProtectedRoute path="/analytics" component={Analytics} />
              <ProtectedRoute path="/settings" component={Settings} />

              <AdminRoute path="/admin" component={AdminBusinesses} />
              <AdminRoute path="/admin/businesses" component={AdminBusinesses} />
              
              <Route component={NotFound} />
            </Switch>
          </AuthProvider>
        </TooltipProvider>
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
