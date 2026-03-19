import React, { createContext, useContext } from "react";
import { useGetMe, getGetMeQueryKey, MeResponse } from "@/api-client";

type AuthContextType = {
  user: MeResponse["user"] | null;
  businessId: string | null;
  isLoading: boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error("Logout failed", e);
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: data?.user ?? null,
        businessId: data?.business_id ?? null,
        isLoading,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
