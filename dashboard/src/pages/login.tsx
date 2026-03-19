import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { getGetMeQueryKey } from "@/api-client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await login.mutateAsync({ data: { email, password } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setLocation(res.business_id ? "/calls" : "/setup");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid credentials";
      toast({ 
        title: "Login Failed", 
        description: message, 
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <div 
        className="hidden lg:flex w-1/2 bg-cover bg-center relative items-center justify-center" 
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/hero-bg.png)` }}
      >
        <div className="absolute inset-0 bg-background/20 backdrop-blur-[2px]" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative z-10 text-center text-white p-12"
        >
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-24 h-24 mx-auto mb-8 shadow-2xl rounded-2xl" />
          <h1 className="text-5xl font-display font-bold mb-4 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60">
            Vocalize.ai
          </h1>
          <p className="text-lg text-white/80 max-w-md mx-auto">
            The intelligent voice infrastructure for modern businesses. Connect, automate, and scale your communications.
          </p>
        </motion.div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <Card className="p-8 border-border/50 shadow-2xl shadow-black/50 bg-card/50 backdrop-blur-xl">
            <div className="mb-8">
              <h2 className="text-3xl font-display font-bold text-foreground mb-2">Welcome back</h2>
              <p className="text-muted-foreground">Enter your credentials to access your dashboard.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                  className="bg-background/50 h-12 rounded-xl focus-visible:ring-primary/50"
                  placeholder="name@company.com"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-foreground">Password</label>
                </div>
                <Input 
                  type="password" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  required 
                  className="bg-background/50 h-12 rounded-xl focus-visible:ring-primary/50"
                  placeholder="••••••••"
                />
              </div>

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-semibold rounded-xl bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-200"
                disabled={login.isPending}
              >
                {login.isPending ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <p className="mt-8 text-center text-muted-foreground text-sm">
              Don't have an account?{" "}
              <Link href="/signup" className="text-primary hover:text-primary/80 font-medium transition-colors">
                Create one now
              </Link>
            </p>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
